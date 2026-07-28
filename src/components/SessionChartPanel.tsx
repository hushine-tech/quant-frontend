import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type HistogramData,
  type LineData,
  type LogicalRange,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  getSessionIndicatorChunks,
  getSessionIndicators,
  getSessionFills,
  getSessionLifecycleEvents,
  queryMarketDataKlines,
  isSessionTerminal,
  type MarketDataKline,
  type OrderLifecycleEvent,
  type Session,
  type StrategyIndicatorChunk,
  type StrategyIndicatorDefinition,
  type SessionOrderFill,
  type StrategyInputDeclaration,
} from "@/api/client";
import { calculateMACD, calculateRSI } from "@/utils/chartIndicators";
import { formatUTCWithLocal } from "@/utils/time";
import {
  buildIndicatorMarkersV2,
  createIndicatorRequestOwner,
  expandScalarIndicatorV2,
  indicatorPollDecision,
  indicatorTailState,
  mergeIndicatorChunksV2,
} from "@/components/sessionIndicatorData";

const KLINE_LIMIT = 500;
const PAGE_LIMIT = 200;
const MAX_KLINE_CHUNKS = 40;
const MAX_AUDIT_PAGES = 20;
const INDICATOR_WARMUP_BARS = 200;
const SESSION_CHART_HEIGHT = 480;
const RSI_PERIODS = [6, 12, 24] as const;
const MACD_DIF_COLOR = "#2563eb";
const MACD_DEA_COLOR = "#d97706";
const MACD_UP_COLOR = "rgba(22, 163, 74, 0.65)";
const MACD_DOWN_COLOR = "rgba(220, 38, 38, 0.65)";
const RSI_COLORS: Record<RSIPeriod, string> = {
  6: "#7c3aed",
  12: "#0891b2",
  24: "#db2777",
};
const RSI_LABELS: Record<RSIPeriod, string> = {
  6: "RSI6",
  12: "RSI12",
  24: "RSI24",
};
const CUSTOM_INDICATOR_FALLBACK_COLORS = [
  "#0f766e",
  "#9333ea",
  "#ea580c",
  "#0284c7",
  "#be123c",
  "#4d7c0f",
];

type ChartInput = StrategyInputDeclaration & {
  label: string;
};

type RSIPeriod = (typeof RSI_PERIODS)[number];

type ChartState = {
  rows: MarketDataKline[];
  fills: SessionOrderFill[];
  lifecycleEvents: OrderLifecycleEvent[];
  customIndicators: {
    definitions: StrategyIndicatorDefinition[];
    chunks: StrategyIndicatorChunk[];
    error: string;
  };
};

type HoverCandle = {
  timeKey: number;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  direction: "up" | "down";
};

type ChartSeries = ISeriesApi<"Candlestick"> | ISeriesApi<"Histogram"> | ISeriesApi<"Line">;

type CustomIndicatorSeries = ISeriesApi<"Histogram"> | ISeriesApi<"Line">;

type CustomIndicatorSeriesRef = {
  series: CustomIndicatorSeries;
  signature: string;
};

type ChartViewport = {
  logicalRange: LogicalRange | null;
};

function intervalToMs(interval: string): number {
  const match = /^(\d+)([mhdw])$/i.exec(interval.trim());
  if (!match) return 60_000;
  const value = Number(match[1]);
  switch (match[2].toLowerCase()) {
    case "m": return value * 60_000;
    case "h": return value * 60 * 60_000;
    case "d": return value * 24 * 60 * 60_000;
    case "w": return value * 7 * 24 * 60 * 60_000;
    default: return 60_000;
  }
}

function toTimestamp(input: string | number): UTCTimestamp {
  const ms = typeof input === "number" ? input : Date.parse(input);
  return Math.floor(ms / 1000) as UTCTimestamp;
}

function timeKey(input: Time | undefined): number | null {
  if (typeof input === "number") return input;
  if (typeof input === "string") {
    const ms = Date.parse(input);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  if (input && typeof input === "object") {
    const ms = Date.UTC(input.year, input.month - 1, input.day);
    return Math.floor(ms / 1000);
  }
  return null;
}

function isCandleData(data: unknown): data is CandlestickData<Time> {
  if (!data || typeof data !== "object") return false;
  const candidate = data as Partial<CandlestickData<Time>>;
  return (
    typeof candidate.open === "number"
    && typeof candidate.high === "number"
    && typeof candidate.low === "number"
    && typeof candidate.close === "number"
  );
}

function hoverCandleFromRow(row: MarketDataKline): HoverCandle {
  return {
    timeKey: Number(toTimestamp(row.open_time)),
    time: row.open_time,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    direction: row.close >= row.open ? "up" : "down",
  };
}

function formatChartNumber(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 8,
  });
}

function alignToBarTime(ms: number, stepMs: number): UTCTimestamp {
  return (Math.floor(ms / stepMs) * (stepMs / 1000)) as UTCTimestamp;
}

function formatChartStreamLabel(input: StrategyInputDeclaration): string {
  const market = normalizeMarketForStreamKey(input.market);
  const marketLabel = market === "spot"
    ? "Spot"
    : market === "perpetual_futures"
      ? "Perpetual Futures"
      : market || "Unknown Market";
  return `${input.symbol} · ${marketLabel} · ${input.interval}`;
}

function chartInputsFromStrategy(inputs: StrategyInputDeclaration[]): ChartInput[] {
  return inputs
    .filter((input) => input.symbol && input.interval)
    .map((input) => ({
      ...input,
      exchange: input.exchange || "binance",
      kind: input.kind || "kline",
      label: formatChartStreamLabel(input),
    }));
}

function normalizeMarketForStreamKey(market: string): string {
  const raw = String(market || "").trim().toLowerCase();
  if (raw === "futures" || raw === "usdm_futures") return "perpetual_futures";
  return raw;
}

function chartStreamKey(input: ChartInput): string {
  return [
    String(input.exchange || "binance").trim().toLowerCase(),
    normalizeMarketForStreamKey(input.market),
    String(input.symbol || "").trim().toUpperCase(),
    String(input.interval || "").trim(),
  ].join(":");
}

function customIndicatorKey(definition: StrategyIndicatorDefinition): string {
  return definition.indicator_key.trim();
}

function customIndicatorLabel(definition: StrategyIndicatorDefinition): string {
  return definition.name || definition.indicator_key;
}

function customIndicatorFallbackColor(index: number): string {
  return CUSTOM_INDICATOR_FALLBACK_COLORS[index % CUSTOM_INDICATOR_FALLBACK_COLORS.length];
}

function parseIndicatorConfig(definition: StrategyIndicatorDefinition): Record<string, unknown> {
  if (!definition.config_json) return {};
  try {
    const parsed = JSON.parse(definition.config_json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringConfig(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value : "";
}

function numberConfig(config: Record<string, unknown>, key: string): number | null {
  const value = config[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function lineWidthConfig(config: Record<string, unknown>): 1 | 2 | 3 | 4 {
  const raw = Math.max(1, Math.min(4, Math.round(numberConfig(config, "line_width") ?? 1)));
  if (raw === 2 || raw === 3 || raw === 4) return raw;
  return 1;
}

function expandCustomIndicatorChunks(
  definition: StrategyIndicatorDefinition,
  chunks: StrategyIndicatorChunk[],
  fallbackColor: string,
): Array<LineData<UTCTimestamp> | HistogramData<UTCTimestamp>> {
  const config = parseIndicatorConfig(definition);
  const positiveColor = definition.color || stringConfig(config, "positive_color") || fallbackColor;
  const negativeColor = stringConfig(config, "negative_color") || "rgba(220, 38, 38, 0.55)";
  const rows: Array<LineData<UTCTimestamp> | HistogramData<UTCTimestamp>> = [];
  const relevantChunks = chunks
    .filter((chunk) => chunk.indicator_key === definition.indicator_key)
    .sort((left, right) => left.chunk_index - right.chunk_index);
  for (const chunk of relevantChunks) {
    try {
      for (const point of expandScalarIndicatorV2(definition, chunk)) {
        if (definition.type === "histogram") {
          rows.push({
            time: point.time,
            value: point.value,
            color: point.value >= 0 ? positiveColor : negativeColor,
          });
        } else {
          rows.push({
            time: point.time,
            value: point.value,
          });
        }
      }
    } catch {
      // Invalid chunks are rejected by the merge boundary. Keep rendering
      // defensive if a stale in-memory value survives a hot reload.
    }
  }
  return rows;
}

function buildCustomIndicatorMarkers(
  definitions: StrategyIndicatorDefinition[],
  chunks: StrategyIndicatorChunk[],
  visibility: Record<string, boolean>,
): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  definitions.forEach((definition, index) => {
    if (definition.type !== "marker") return;
    const key = customIndicatorKey(definition);
    if (visibility[key] === false) return;
    const fallbackColor = definition.color || customIndicatorFallbackColor(index);
    const relevantChunks = chunks
      .filter((chunk) => chunk.indicator_key === definition.indicator_key)
      .sort((left, right) => left.chunk_index - right.chunk_index);
    for (const chunk of relevantChunks) {
      try {
        markers.push(...buildIndicatorMarkersV2(
          { ...definition, color: definition.color || fallbackColor },
          chunk,
        ));
      } catch {
        // See scalar path above: merge validation is authoritative.
      }
    }
  });
  return markers;
}

function customIndicatorSeriesSignature(definition: StrategyIndicatorDefinition, fallbackColor: string): string {
  return [
    definition.type,
    definition.pane,
    definition.color || fallbackColor,
    definition.name,
    definition.config_json,
  ].join("|");
}

function customIndicatorPaneName(definition: StrategyIndicatorDefinition): string {
  const pane = String(definition.pane || "strategy").trim().toLowerCase();
  if (pane === "price" || pane === "main") return "price";
  return pane || "strategy";
}

function syncCustomIndicatorSeries(
  chart: IChartApi,
  definitions: StrategyIndicatorDefinition[],
  visibility: Record<string, boolean>,
  customIndicatorSeriesRefs: Map<string, CustomIndicatorSeriesRef>,
  firstCustomPaneIndex: number,
) {
  const wanted = new Map<string, { definition: StrategyIndicatorDefinition; fallbackColor: string; signature: string }>();
  definitions.forEach((definition, index) => {
    const key = customIndicatorKey(definition);
    if (!key || visibility[key] === false) return;
    if (definition.type !== "line" && definition.type !== "histogram") return;
    const fallbackColor = customIndicatorFallbackColor(index);
    wanted.set(key, {
      definition,
      fallbackColor,
      signature: customIndicatorSeriesSignature(definition, fallbackColor),
    });
  });

  for (const [key, ref] of customIndicatorSeriesRefs) {
    const next = wanted.get(key);
    if (!next || next.signature !== ref.signature) {
      chart.removeSeries(ref.series);
      customIndicatorSeriesRefs.delete(key);
    }
  }

  const paneIndexes = new Map<string, number>();
  let nextPaneIndex = firstCustomPaneIndex;
  for (const item of wanted.values()) {
    const paneName = customIndicatorPaneName(item.definition);
    if (paneName !== "price" && !paneIndexes.has(paneName)) {
      paneIndexes.set(paneName, nextPaneIndex);
      nextPaneIndex += 1;
    }
  }

  for (const [key, item] of wanted) {
    if (customIndicatorSeriesRefs.has(key)) continue;
    const config = parseIndicatorConfig(item.definition);
    const paneName = customIndicatorPaneName(item.definition);
    const paneIndex = paneName === "price" ? 0 : paneIndexes.get(paneName) ?? firstCustomPaneIndex;
    const color = item.definition.color || item.fallbackColor;
    if (item.definition.type === "histogram") {
      const series = chart.addSeries(HistogramSeries, {
        title: customIndicatorLabel(item.definition),
        color,
        priceScaleId: paneIndex === 0 ? "right" : "",
      }, paneIndex);
      customIndicatorSeriesRefs.set(key, { series, signature: item.signature });
    } else {
      const series = chart.addSeries(LineSeries, {
        title: customIndicatorLabel(item.definition),
        color,
        lineWidth: lineWidthConfig(config),
        priceLineVisible: false,
        priceScaleId: paneIndex === 0 ? "right" : "",
      }, paneIndex);
      customIndicatorSeriesRefs.set(key, { series, signature: item.signature });
    }
  }

  const panes = chart.panes();
  for (const paneIndex of paneIndexes.values()) {
    panes[paneIndex]?.setStretchFactor(1.05);
  }
}

function dedupeRows(rows: MarketDataKline[]): MarketDataKline[] {
  const byTime = new Map<string, MarketDataKline>();
  for (const row of rows) byTime.set(row.open_time, row);
  return [...byTime.values()].sort((a, b) => Date.parse(a.open_time) - Date.parse(b.open_time));
}

async function fetchKlines(input: ChartInput, startMs: number, endMs: number): Promise<MarketDataKline[]> {
  const rows: MarketDataKline[] = [];
  let cursor = startMs;
  for (let chunk = 0; chunk < MAX_KLINE_CHUNKS && cursor < endMs; chunk += 1) {
    const page = await queryMarketDataKlines({
      exchange: input.exchange || "binance",
      market: input.market,
      kind: input.kind || "kline",
      symbol: input.symbol,
      interval: input.interval,
      start_time_ms: cursor,
      end_time_ms: endMs,
      limit: KLINE_LIMIT,
    });
    if (page.rows.length === 0) break;
    rows.push(...page.rows);
    const last = page.rows[page.rows.length - 1];
    const next = Date.parse(last.close_time) + 1;
    if (!Number.isFinite(next) || next <= cursor) break;
    cursor = next;
    if (!page.truncated) break;
  }
  return dedupeRows(rows);
}

async function fetchAllFills(sessionId: string): Promise<SessionOrderFill[]> {
  const rows: SessionOrderFill[] = [];
  let offset = 0;
  for (let pageIndex = 0; pageIndex < MAX_AUDIT_PAGES; pageIndex += 1) {
    const page = await getSessionFills(sessionId, { limit: PAGE_LIMIT, offset });
    rows.push(...page.items);
    if (!page.has_more) break;
    offset = page.next_offset;
  }
  return rows;
}

async function fetchAllLifecycleEvents(sessionId: string): Promise<OrderLifecycleEvent[]> {
  const rows: OrderLifecycleEvent[] = [];
  let afterEventId = 0;
  for (let pageIndex = 0; pageIndex < MAX_AUDIT_PAGES; pageIndex += 1) {
    const page = await getSessionLifecycleEvents(sessionId, { limit: PAGE_LIMIT, after_event_id: afterEventId });
    rows.push(...page.items);
    if (!page.has_more) break;
    afterEventId = page.next_event_id;
  }
  return rows;
}

function klineRangeForSession(session: Session, input: ChartInput): { startMs: number; endMs: number; visibleStartMs: number } {
  const stepMs = intervalToMs(input.interval);
  const visibleStartMs = session.start_time_ms || Date.parse(session.started_at || "") || Date.now() - (stepMs * 300);
  const requestedStart = Math.max(0, visibleStartMs - (INDICATOR_WARMUP_BARS * stepMs));
  const endMs = session.end_time_ms || (isSessionTerminal(session) && session.completed_at ? Date.parse(session.completed_at) : Date.now());
  return {
    startMs: requestedStart,
    endMs: Math.max(endMs, visibleStartMs + stepMs),
    visibleStartMs,
  };
}

function buildFillMarkers(fills: SessionOrderFill[], stepMs: number, enabled: boolean): SeriesMarker<Time>[] {
  if (!enabled) return [];
  return fills
    .filter((fill) => fill.time && fill.symbol)
    .map((fill) => {
      const isBuy = fill.side.toUpperCase() === "BUY";
      return {
        time: alignToBarTime(Date.parse(fill.time), stepMs),
        position: isBuy ? "belowBar" : "aboveBar",
        shape: isBuy ? "arrowUp" : "arrowDown",
        color: isBuy ? "#16a34a" : "#dc2626",
        text: `${fill.side} ${fill.qty} @ ${fill.fill_price.toFixed(2)}`,
      } satisfies SeriesMarker<Time>;
    });
}

function buildLifecycleMarkers(events: OrderLifecycleEvent[], stepMs: number, enabled: boolean): SeriesMarker<Time>[] {
  if (!enabled) return [];
  return events
    .filter((event) => event.event_type === "liquidation" || event.order_status === "REJECTED" || event.order_status === "FAILED")
    .map((event) => {
      const liquidation = event.event_type === "liquidation";
      return {
        time: alignToBarTime(Date.parse(event.occurred_at), stepMs),
        position: "aboveBar",
        shape: liquidation ? "square" : "circle",
        color: liquidation ? "#991b1b" : "#d97706",
        text: liquidation ? "LIQ" : (event.order_status || event.event_type),
      } satisfies SeriesMarker<Time>;
    });
}

function buildSessionBoundaryMarkers(session: Session, stepMs: number): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  const startMs = session.start_time_ms || Date.parse(session.started_at || "");
  const endMs = session.end_time_ms || (session.completed_at ? Date.parse(session.completed_at) : 0);
  if (Number.isFinite(startMs) && startMs > 0) {
    markers.push({
      time: alignToBarTime(startMs, stepMs),
      position: "belowBar",
      shape: "circle",
      color: "#2563eb",
      text: "START",
    });
  }
  if (Number.isFinite(endMs) && endMs > 0) {
    markers.push({
      time: alignToBarTime(endMs, stepMs),
      position: "aboveBar",
      shape: "circle",
      color: "#0f172a",
      text: "END",
    });
  }
  return markers;
}

function applyPaneStretchFactors(chart: IChartApi, layers: { volume: boolean; macd: boolean; rsi: boolean }) {
  const panes = chart.panes();
  panes[0]?.setStretchFactor(5);
  let paneIndex = 1;
  if (layers.volume) {
    panes[paneIndex]?.setStretchFactor(1);
    paneIndex += 1;
  }
  if (layers.macd) {
    panes[paneIndex]?.setStretchFactor(1.25);
    paneIndex += 1;
  }
  if (layers.rsi) {
    panes[paneIndex]?.setStretchFactor(1.05);
  }
}

function collectChartSeries(series: Array<ChartSeries | null>): ChartSeries[] {
  return series.filter((item): item is ChartSeries => item !== null);
}

function captureChartViewport(chart: IChartApi): ChartViewport {
  return {
    logicalRange: chart.timeScale().getVisibleLogicalRange(),
  };
}

function restorePriceAutoScale(series: ChartSeries[]) {
  for (const item of series) item.priceScale().setAutoScale(true);
}

function restoreChartViewport(chart: IChartApi, viewport: ChartViewport, series: ChartSeries[]) {
  restorePriceAutoScale(series);
  if (viewport.logicalRange) {
    chart.timeScale().setVisibleLogicalRange(viewport.logicalRange);
  }
}

function restoreChartViewportAfterDataUpdate(chart: IChartApi, viewport: ChartViewport, series: ChartSeries[]) {
  restoreChartViewport(chart, viewport, series);
  window.requestAnimationFrame(() => restoreChartViewport(chart, viewport, series));
}

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    resizeObserver.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => resizeObserver.disconnect();
  }, [ref]);
  return width;
}

type SessionChartPanelProps = {
  session: Session;
  inputs: StrategyInputDeclaration[];
};

export default function SessionChartPanel({ session, inputs }: SessionChartPanelProps) {
  const chartInputs = useMemo(() => chartInputsFromStrategy(inputs), [inputs]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [chartState, setChartState] = useState<ChartState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showVolume, setShowVolume] = useState(true);
  const [showMACD, setShowMACD] = useState(true);
  const [showRSIPeriods, setShowRSIPeriods] = useState<Record<RSIPeriod, boolean>>({
    6: true,
    12: true,
    24: true,
  });
  const [showFills, setShowFills] = useState(true);
  const [showLifecycle, setShowLifecycle] = useState(true);
  const [showCustomIndicators, setShowCustomIndicators] = useState<Record<string, boolean>>({});
  const [hoverCandle, setHoverCandle] = useState<HoverCandle | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const macdHistogramSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const macdLineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiSeriesRefs = useRef<Map<RSIPeriod, ISeriesApi<"Line">>>(new Map());
  const customIndicatorSeriesRefs = useRef<Map<string, CustomIndicatorSeriesRef>>(new Map());
  const chartRequestOwnerRef = useRef(createIndicatorRequestOwner());
  const chartLoadInFlightRef = useRef(false);
  const chartLoadPendingRef = useRef(false);
  const chartLoadRef = useRef<(() => void) | null>(null);
  const indicatorCacheRef = useRef<StrategyIndicatorChunk[]>([]);
  const indicatorDefinitionsRef = useRef<StrategyIndicatorDefinition[]>([]);
  const indicatorRequestOwnerRef = useRef(createIndicatorRequestOwner());
  const indicatorAbortRef = useRef<AbortController | null>(null);
  const indicatorTimerRef = useRef<number | undefined>(undefined);
  const indicatorRetryAttemptRef = useRef(0);
  const indicatorInFlightRef = useRef(false);
  const indicatorPollRef = useRef<(() => void) | null>(null);
  const indicatorWarningKeysRef = useRef(new Set<string>());
  const indicatorIdentityRef = useRef("");
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const firstCustomPaneIndexRef = useRef(1);
  const rowsByTimeRef = useRef<Map<number, MarketDataKline>>(new Map());
  const initialVisibleRangeAppliedRef = useRef(false);
  const width = useElementWidth(containerRef);
  const selectedInput = chartInputs[Math.min(selectedIndex, Math.max(chartInputs.length - 1, 0))];
  const showRSI = RSI_PERIODS.some((period) => showRSIPeriods[period]);
  const rsiStateKey = RSI_PERIODS.map((period) => `${period}:${showRSIPeriods[period] ? "1" : "0"}`).join("|");
  const customDefinitions = chartState?.customIndicators.definitions ?? [];
  const customIndicatorTail = indicatorTailState(
    chartState?.customIndicators.chunks ?? [],
  );
  const isLiveIndicatorSession =
    !isSessionTerminal(session) || session.indicator_finalization_pending;
  const customIndicatorVisibilityKey = customDefinitions
    .map((definition) => `${customIndicatorKey(definition)}:${showCustomIndicators[customIndicatorKey(definition)] === false ? "0" : "1"}`)
    .join("|");
  const inputSignature = useMemo(() => (
    chartInputs
      .map((input) => `${input.exchange}-${input.market}-${input.kind}-${input.symbol}-${input.interval}`)
      .join("|")
  ), [chartInputs]);
  const selectedInputKey = selectedInput
    ? `${selectedInput.exchange}-${selectedInput.market}-${selectedInput.kind}-${selectedInput.symbol}-${selectedInput.interval}`
    : "";
  const sessionRangeKey = [
    session.session_id,
    session.status,
    session.start_time_ms ?? "",
    session.end_time_ms ?? "",
    session.started_at ?? "",
    session.completed_at ?? "",
    session.indicator_finalization_pending ? "indicator-pending" : "indicator-settled",
  ].join("|");
  const sessionBoundaryKey = [
    session.session_id,
    session.start_time_ms ?? "",
    session.end_time_ms ?? "",
    session.started_at ?? "",
    session.completed_at ?? "",
  ].join("|");
  const hasMeasuredWidth = width > 0;
  const showInitialLoading = loading && chartState === null;

  const load = useCallback(async () => {
    if (!selectedInput) return;
    if (chartLoadInFlightRef.current) {
      chartLoadPendingRef.current = true;
      return;
    }
    chartLoadInFlightRef.current = true;
    chartLoadPendingRef.current = false;
    const capturedSession = session;
    const capturedInput = selectedInput;
    const token = chartRequestOwnerRef.current.begin(
      capturedSession.session_id,
      selectedInputKey,
    );
    const { startMs, endMs } = klineRangeForSession(capturedSession, capturedInput);
    setLoading(true);
    setError(null);
    try {
      const [rows, fills, lifecycleEvents] = await Promise.all([
        fetchKlines(capturedInput, startMs, endMs),
        fetchAllFills(capturedSession.session_id),
        fetchAllLifecycleEvents(capturedSession.session_id),
      ]);
      if (!chartRequestOwnerRef.current.isCurrent(token)) return;
      setChartState((current) => ({
        rows,
        fills,
        lifecycleEvents,
        customIndicators: current?.customIndicators ?? {
          definitions: indicatorDefinitionsRef.current,
          chunks: indicatorCacheRef.current,
          error: "",
        },
      }));
    } catch (err) {
      if (chartRequestOwnerRef.current.isCurrent(token)) {
        setError(err instanceof Error ? err.message : "Failed to load session chart");
      }
    } finally {
      if (chartRequestOwnerRef.current.isCurrent(token)) {
        setLoading(false);
      }
      chartLoadInFlightRef.current = false;
      if (chartLoadPendingRef.current) {
        chartLoadPendingRef.current = false;
        chartLoadRef.current?.();
      }
    }
  }, [selectedInputKey, sessionRangeKey]);
  chartLoadRef.current = () => { void load(); };

  useEffect(() => {
    setSelectedIndex(0);
  }, [session.session_id, inputSignature]);

  useEffect(() => {
    chartRequestOwnerRef.current.invalidate();
    rowsByTimeRef.current.clear();
    setHoverCandle(null);
    setChartState(null);
    setError(null);
    setLoading(selectedInputKey !== "");
  }, [session.session_id, selectedInputKey]);

  useEffect(() => {
    chartRequestOwnerRef.current.invalidate();
    chartLoadPendingRef.current = true;
    void load();
    return () => {
      chartRequestOwnerRef.current.invalidate();
      chartLoadPendingRef.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (!selectedInput) return undefined;
    const sessionID = session.session_id;
    const streamKey = chartStreamKey(selectedInput);
    const identityKey = `${sessionID}\u0000${streamKey}`;
    let cancelled = false;
    let inFlight = false;

    indicatorIdentityRef.current = identityKey;
    indicatorRequestOwnerRef.current.invalidate();
    indicatorAbortRef.current?.abort();
    indicatorAbortRef.current = null;
    if (indicatorTimerRef.current !== undefined) {
      window.clearTimeout(indicatorTimerRef.current);
      indicatorTimerRef.current = undefined;
    }
    indicatorCacheRef.current = [];
    indicatorDefinitionsRef.current = [];
    indicatorRetryAttemptRef.current = 0;
    indicatorInFlightRef.current = false;
    indicatorWarningKeysRef.current.clear();
    setChartState((current) => current ? {
      ...current,
      customIndicators: { definitions: [], chunks: [], error: "" },
    } : current);

    const identityIsCurrent = () =>
      !cancelled && indicatorIdentityRef.current === identityKey;

    const scheduleNext = () => {
      if (!identityIsCurrent()) return;
      const decision = indicatorPollDecision(
        sessionRef.current,
        indicatorCacheRef.current,
        indicatorRetryAttemptRef.current,
      );
      if (!decision.poll) return;
      indicatorTimerRef.current = window.setTimeout(() => {
        indicatorTimerRef.current = undefined;
        indicatorPollRef.current?.();
      }, decision.delayMs);
    };

    const poll = async () => {
      if (!identityIsCurrent() || inFlight) return;
      inFlight = true;
      indicatorInFlightRef.current = true;
      const token = indicatorRequestOwnerRef.current.begin(sessionID, streamKey);
      const controller = new AbortController();
      indicatorAbortRef.current = controller;
      let progressed = false;
      try {
        const { startMs, endMs } = klineRangeForSession(sessionRef.current, selectedInput);
        const definitionsResponse = await getSessionIndicators(
          sessionID,
          streamKey,
          controller.signal,
        );
        if (
          !identityIsCurrent() ||
          !indicatorRequestOwnerRef.current.isCurrent(token)
        ) return;
        const definitions = definitionsResponse.items ?? [];
        for (const definition of definitions) {
          if (
            definition.protocol_version !== 2 ||
            definition.session_id !== sessionID ||
            definition.stream_key !== streamKey
          ) {
            throw new Error("invalid indicator V2 definition identity or protocol");
          }
        }
        if (
          indicatorDefinitionsRef.current.length > 0 &&
          JSON.stringify(indicatorDefinitionsRef.current) !== JSON.stringify(definitions)
        ) {
          throw new Error("indicator definitions changed within a Session stream");
        }
        const chunksResponse = definitions.length === 0
          ? { items: [] as StrategyIndicatorChunk[] }
          : await getSessionIndicatorChunks(
              sessionID,
              {
                stream_key: streamKey,
                keys: definitions.map((definition) => definition.indicator_key),
                start_time_ms: startMs,
                end_time_ms: endMs,
              },
              controller.signal,
            );
        if (
          !identityIsCurrent() ||
          !indicatorRequestOwnerRef.current.isCurrent(token)
        ) return;
        const merge = mergeIndicatorChunksV2(
          definitions,
          indicatorCacheRef.current,
          chunksResponse.items ?? [],
        );
        for (const conflict of merge.conflicts) {
          const warningKey = `${conflict.key}\u0000${conflict.reason}`;
          if (indicatorWarningKeysRef.current.has(warningKey)) continue;
          indicatorWarningKeysRef.current.add(warningKey);
          console.warn(`Indicator V2 chunk ignored: ${conflict.reason}`);
        }
        indicatorDefinitionsRef.current = definitions;
        indicatorCacheRef.current = merge.chunks;
        progressed = merge.progressed;
        indicatorRetryAttemptRef.current = progressed
          ? 0
          : indicatorRetryAttemptRef.current + 1;
        if (
          !identityIsCurrent() ||
          !indicatorRequestOwnerRef.current.isCurrent(token)
        ) return;
        setChartState((current) => ({
          rows: current?.rows ?? [],
          fills: current?.fills ?? [],
          lifecycleEvents: current?.lifecycleEvents ?? [],
          customIndicators: {
            definitions,
            chunks: merge.chunks,
            error: merge.conflicts.length > 0
              ? "Some indicator updates were rejected because they conflicted with durable V2 data."
              : "",
          },
        }));
      } catch (err) {
        if (
          controller.signal.aborted ||
          !identityIsCurrent() ||
          !indicatorRequestOwnerRef.current.isCurrent(token)
        ) return;
        indicatorRetryAttemptRef.current += 1;
        setChartState((current) => ({
          rows: current?.rows ?? [],
          fills: current?.fills ?? [],
          lifecycleEvents: current?.lifecycleEvents ?? [],
          customIndicators: {
            definitions: indicatorDefinitionsRef.current,
            chunks: indicatorCacheRef.current,
            error: err instanceof Error ? err.message : "Failed to load custom indicators",
          },
        }));
      } finally {
        if (indicatorAbortRef.current === controller) {
          indicatorAbortRef.current = null;
        }
        inFlight = false;
        if (identityIsCurrent()) {
          indicatorInFlightRef.current = false;
        }
        if (
          identityIsCurrent() &&
          indicatorRequestOwnerRef.current.isCurrent(token)
        ) {
          scheduleNext();
        }
      }
    };
    indicatorPollRef.current = () => { void poll(); };
    void poll();

    return () => {
      cancelled = true;
      indicatorPollRef.current = null;
      indicatorRequestOwnerRef.current.invalidate();
      indicatorAbortRef.current?.abort();
      indicatorAbortRef.current = null;
      inFlight = false;
      indicatorInFlightRef.current = false;
      if (indicatorTimerRef.current !== undefined) {
        window.clearTimeout(indicatorTimerRef.current);
        indicatorTimerRef.current = undefined;
      }
    };
  }, [session.session_id, selectedInputKey]);

  useEffect(() => {
    if (customDefinitions.length === 0) return;
    setShowCustomIndicators((current) => {
      let changed = false;
      const next = { ...current };
      for (const definition of customDefinitions) {
        const key = customIndicatorKey(definition);
        if (key && next[key] === undefined) {
          next[key] = true;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [customDefinitions.map((definition) => customIndicatorKey(definition)).join("|")]);

  useEffect(() => {
    if (isSessionTerminal(session)) return undefined;
    let cancelled = false;
    let timer: number | undefined = window.setTimeout(async function poll() {
      timer = undefined;
      await load();
      if (!cancelled) {
        timer = window.setTimeout(poll, 5000);
      }
    }, 5000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [load, session.status]);

  useEffect(() => {
    // A lifecycle transition gets its own bounded convergence window. Without
    // resetting here, retries accumulated while the Session was running could
    // suppress the one final fetch after finalization_pending clears.
    indicatorRetryAttemptRef.current = 0;
    const decision = indicatorPollDecision(
      session,
      indicatorCacheRef.current,
      indicatorRetryAttemptRef.current,
    );
    if (!decision.poll && indicatorTimerRef.current !== undefined) {
      window.clearTimeout(indicatorTimerRef.current);
      indicatorTimerRef.current = undefined;
    } else if (
      decision.poll &&
      indicatorTimerRef.current === undefined &&
      !indicatorInFlightRef.current
    ) {
      indicatorPollRef.current?.();
    }
  }, [session.status, session.indicator_finalization_pending]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !selectedInputKey || !hasMeasuredWidth) return undefined;

    const chart = createChart(container, {
      width,
      height: SESSION_CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#475569",
      },
      grid: {
        vertLines: { color: "#eef2f7" },
        horzLines: { color: "#eef2f7" },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: "#dbe3ef",
      },
      timeScale: {
        borderColor: "#dbe3ef",
        timeVisible: true,
        secondsVisible: false,
      },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderUpColor: "#16a34a",
      borderDownColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    }, 0);
    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      const data = param.seriesData.get(candleSeries);
      if (!isCandleData(data)) return;
      const key = timeKey(data.time ?? param.time);
      const row = key === null ? null : rowsByTimeRef.current.get(key);
      setHoverCandle({
        timeKey: key ?? 0,
        time: row?.open_time ?? (key === null ? "" : new Date(key * 1000).toISOString()),
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
        volume: row?.volume ?? 0,
        direction: data.close >= data.open ? "up" : "down",
      });
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    markersRef.current = createSeriesMarkers(candleSeries, [], { zOrder: "top" });
    volumeSeriesRef.current = null;
    macdHistogramSeriesRef.current = null;
    macdLineSeriesRef.current = null;
    macdSignalSeriesRef.current = null;
    rsiSeriesRefs.current.clear();
    initialVisibleRangeAppliedRef.current = false;

    let nextPaneIndex = 1;
    if (showVolume) {
      volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "",
      }, nextPaneIndex);
      nextPaneIndex += 1;
    }

    if (showMACD) {
      const macdPaneIndex = nextPaneIndex;
      nextPaneIndex += 1;
      macdHistogramSeriesRef.current = chart.addSeries(
        HistogramSeries,
        { title: "MACD", priceScaleId: "", color: "#64748b" },
        macdPaneIndex,
      );
      macdLineSeriesRef.current = chart.addSeries(
        LineSeries,
        { title: "DIF", color: MACD_DIF_COLOR, lineWidth: 1, priceLineVisible: false },
        macdPaneIndex,
      );
      macdSignalSeriesRef.current = chart.addSeries(
        LineSeries,
        { title: "DEA", color: MACD_DEA_COLOR, lineWidth: 1, priceLineVisible: false },
        macdPaneIndex,
      );
    }

    if (showRSI) {
      const rsiPaneIndex = nextPaneIndex;
      nextPaneIndex += 1;
      for (const period of RSI_PERIODS) {
        if (!showRSIPeriods[period]) continue;
        rsiSeriesRefs.current.set(period, chart.addSeries(LineSeries, {
          title: RSI_LABELS[period],
          color: RSI_COLORS[period],
          lineWidth: 1,
          priceLineVisible: false,
        }, rsiPaneIndex));
      }
    }

    firstCustomPaneIndexRef.current = nextPaneIndex;
    applyPaneStretchFactors(chart, { volume: showVolume, macd: showMACD, rsi: showRSI });
    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markersRef.current = null;
      volumeSeriesRef.current = null;
      macdHistogramSeriesRef.current = null;
      macdLineSeriesRef.current = null;
      macdSignalSeriesRef.current = null;
      rsiSeriesRefs.current.clear();
      customIndicatorSeriesRefs.current.clear();
      initialVisibleRangeAppliedRef.current = false;
    };
  }, [hasMeasuredWidth, session.session_id, selectedInputKey, showMACD, showRSI, showVolume, rsiStateKey]);

  useEffect(() => {
    if (!chartRef.current || width <= 0) return;
    chartRef.current.applyOptions({ width, height: SESSION_CHART_HEIGHT });
  }, [width]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const markers = markersRef.current;
    if (!chart || !candleSeries || !markers || !selectedInput || !chartState || chartState.rows.length === 0) return;

    const previousViewport = initialVisibleRangeAppliedRef.current
      ? captureChartViewport(chart)
      : null;
    syncCustomIndicatorSeries(
      chart,
      chartState.customIndicators.definitions,
      showCustomIndicators,
      customIndicatorSeriesRefs.current,
      firstCustomPaneIndexRef.current,
    );
    const activeSeries = collectChartSeries([
      candleSeries,
      volumeSeriesRef.current,
      macdHistogramSeriesRef.current,
      macdLineSeriesRef.current,
      macdSignalSeriesRef.current,
      ...rsiSeriesRefs.current.values(),
      ...[...customIndicatorSeriesRefs.current.values()].map((item) => item.series),
    ]);
    const rowsByTime = new Map<number, MarketDataKline>();
    for (const row of chartState.rows) rowsByTime.set(Number(toTimestamp(row.open_time)), row);
    rowsByTimeRef.current = rowsByTime;
    const latestRow = chartState.rows[chartState.rows.length - 1];
    setHoverCandle((current) => {
      if (current) {
        const currentRow = rowsByTime.get(current.timeKey);
        if (currentRow) return hoverCandleFromRow(currentRow);
      }
      return latestRow ? hoverCandleFromRow(latestRow) : null;
    });
    const candleData: CandlestickData<UTCTimestamp>[] = chartState.rows.map((row) => ({
      time: toTimestamp(row.open_time),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
    }));
    candleSeries.setData(candleData);

    const stepMs = intervalToMs(selectedInput.interval);
    markers.setMarkers([
      ...buildSessionBoundaryMarkers(session, stepMs),
      ...buildFillMarkers(chartState.fills, stepMs, showFills),
      ...buildLifecycleMarkers(chartState.lifecycleEvents, stepMs, showLifecycle),
      ...buildCustomIndicatorMarkers(
        chartState.customIndicators.definitions,
        chartState.customIndicators.chunks,
        showCustomIndicators,
      ),
    ].sort((a, b) => Number(a.time) - Number(b.time)));

    if (volumeSeriesRef.current) {
      const volumeData: HistogramData<UTCTimestamp>[] = chartState.rows.map((row) => ({
        time: toTimestamp(row.open_time),
        value: row.volume,
        color: row.close >= row.open ? "rgba(22, 163, 74, 0.35)" : "rgba(220, 38, 38, 0.35)",
      }));
      volumeSeriesRef.current.setData(volumeData);
    }

    const closes = chartState.rows.map((row) => row.close);
    if (macdHistogramSeriesRef.current && macdLineSeriesRef.current && macdSignalSeriesRef.current) {
      const macd = calculateMACD(closes);
      const histogramData: HistogramData<UTCTimestamp>[] = macd.map((point, index) => ({
        time: toTimestamp(chartState.rows[index].open_time),
        value: point.macd,
        color: point.macd >= 0 ? MACD_UP_COLOR : MACD_DOWN_COLOR,
      }));
      const difLine: LineData<UTCTimestamp>[] = macd.map((point, index) => ({
        time: toTimestamp(chartState.rows[index].open_time),
        value: point.dif,
      }));
      const deaLine: LineData<UTCTimestamp>[] = macd.map((point, index) => ({
        time: toTimestamp(chartState.rows[index].open_time),
        value: point.dea,
      }));
      macdHistogramSeriesRef.current.setData(histogramData);
      macdLineSeriesRef.current.setData(difLine);
      macdSignalSeriesRef.current.setData(deaLine);
    }

    for (const period of RSI_PERIODS) {
      const series = rsiSeriesRefs.current.get(period);
      if (!series) continue;
      const rsi = calculateRSI(closes, period);
      const rsiData: LineData<UTCTimestamp>[] = rsi
        .map((point, index) => point.value === null ? null : ({
          time: toTimestamp(chartState.rows[index].open_time),
          value: point.value,
        }))
        .filter((point): point is LineData<UTCTimestamp> => point !== null);
      series.setData(rsiData);
    }

    chartState.customIndicators.definitions.forEach((definition, index) => {
      const key = customIndicatorKey(definition);
      if (showCustomIndicators[key] === false) return;
      const ref = customIndicatorSeriesRefs.current.get(key);
      if (!ref) return;
      const data = expandCustomIndicatorChunks(
        definition,
        chartState.customIndicators.chunks,
        customIndicatorFallbackColor(index),
      );
      if (definition.type === "histogram") {
        (ref.series as ISeriesApi<"Histogram">).setData(data as HistogramData<UTCTimestamp>[]);
      } else {
        (ref.series as ISeriesApi<"Line">).setData(data as LineData<UTCTimestamp>[]);
      }
    });

    const { visibleStartMs } = klineRangeForSession(session, selectedInput);
    if (!initialVisibleRangeAppliedRef.current) {
      chart.timeScale().setVisibleRange({
        from: toTimestamp(visibleStartMs),
        to: candleData[candleData.length - 1].time,
      });
      initialVisibleRangeAppliedRef.current = true;
    } else if (previousViewport) {
      restoreChartViewportAfterDataUpdate(chart, previousViewport, activeSeries);
    }
  }, [chartState, selectedInputKey, sessionBoundaryKey, showCustomIndicators, showFills, showLifecycle, showMACD, showRSI, showVolume, rsiStateKey, customIndicatorVisibilityKey]);

  if (chartInputs.length === 0) {
    return <p className="muted">No chartable market input found for this session.</p>;
  }

  return (
    <div className="session-chart">
      <div className="session-chart__toolbar">
        <label>
          <span>Stream</span>
          <select value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))}>
            {chartInputs.map((input, index) => (
              <option key={`${input.exchange}-${input.market}-${input.symbol}-${input.interval}`} value={index}>
                {input.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => { void load(); }} disabled={loading}>
          Refresh
        </button>
      </div>

      <div className="session-chart__indicator-sections">
        <section className="session-chart__indicator-group session-chart__default-indicators" aria-label="Default Indicators">
          <p className="session-chart__indicator-title">Default Indicators</p>
          <div className="session-chart__toggles">
            <label><input type="checkbox" checked={showVolume} onChange={(event) => setShowVolume(event.target.checked)} /> Volume</label>
            <label><input type="checkbox" checked={showMACD} onChange={(event) => setShowMACD(event.target.checked)} /> DIF/DEA/MACD</label>
            {RSI_PERIODS.map((period) => (
              <label key={period}>
                <input
                  type="checkbox"
                  checked={showRSIPeriods[period]}
                  onChange={(event) => {
                    setShowRSIPeriods((current) => ({
                      ...current,
                      [period]: event.target.checked,
                    }));
                  }}
                /> RSI{period}
              </label>
            ))}
            <label><input type="checkbox" checked={showFills} onChange={(event) => setShowFills(event.target.checked)} /> Fills</label>
            <label><input type="checkbox" checked={showLifecycle} onChange={(event) => setShowLifecycle(event.target.checked)} /> Events</label>
          </div>
        </section>

        {customDefinitions.length > 0 ? (
          <section className="session-chart__indicator-group session-chart__custom-indicators" aria-label="Strategy Custom Indicators">
            <p className="session-chart__indicator-title">Strategy Custom Indicators</p>
            <span className="session-chart__indicator-tail" aria-live="polite">
              {customIndicatorTail.openChunks > 0
                ? `Live tail · ${customIndicatorTail.openChunks} open`
                : isLiveIndicatorSession
                  ? "Waiting for next live indicator chunk"
                  : "Indicators finalized"}
            </span>
            <div className="session-chart__toggles session-chart__custom-indicator-toggles">
              {customDefinitions.map((definition) => {
                const key = customIndicatorKey(definition);
                return (
                  <label key={key} className="custom-indicator">
                    <input
                      type="checkbox"
                      checked={showCustomIndicators[key] !== false}
                      onChange={(event) => {
                        setShowCustomIndicators((current) => ({
                          ...current,
                          [key]: event.target.checked,
                        }));
                      }}
                    /> {customIndicatorLabel(definition)}
                  </label>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>

      <div className="session-chart__legend" aria-label="Indicator legend">
        {showMACD ? (
          <>
            <span><i style={{ background: MACD_DIF_COLOR }} />DIF</span>
            <span><i style={{ background: MACD_DEA_COLOR }} />DEA</span>
            <span><i style={{ background: "#16a34a" }} />MACD</span>
          </>
        ) : null}
        {RSI_PERIODS.map((period) => (
          showRSIPeriods[period] ? (
            <span key={period}><i style={{ background: RSI_COLORS[period] }} />{RSI_LABELS[period]}</span>
          ) : null
        ))}
        {customDefinitions.map((definition, index) => {
          const key = customIndicatorKey(definition);
          if (showCustomIndicators[key] === false) return null;
          return (
            <span key={key} className="custom-indicator">
              <i style={{ background: definition.color || customIndicatorFallbackColor(index) }} />
              {customIndicatorLabel(definition)}
            </span>
          );
        })}
      </div>

      <div className={`session-chart__ohlcv ${hoverCandle?.direction === "down" ? "is-down" : "is-up"}`} aria-live="polite">
        {hoverCandle ? (
          <>
            <span className="session-chart__ohlcv-time">{formatUTCWithLocal(hoverCandle.time)}</span>
            <span><b>O</b>{formatChartNumber(hoverCandle.open)}</span>
            <span><b>H</b>{formatChartNumber(hoverCandle.high)}</span>
            <span><b>L</b>{formatChartNumber(hoverCandle.low)}</span>
            <span><b>C</b>{formatChartNumber(hoverCandle.close)}</span>
            <span><b>V</b>{formatChartNumber(hoverCandle.volume)}</span>
          </>
        ) : (
          <span className="muted">Hover candle for OHLCV</span>
        )}
      </div>

      {error ? <p className="error">{error}</p> : null}
      {chartState?.customIndicators.error ? <p className="muted">{chartState.customIndicators.error}</p> : null}
      {showInitialLoading ? <p className="muted">Loading chart…</p> : null}
      {!loading && chartState?.rows.length === 0 ? <p className="muted">No market data in this range.</p> : null}

      <div ref={containerRef} className="session-chart__canvas" />

      {chartState?.rows.length ? (
        <p className="muted session-chart__range">
          {formatUTCWithLocal(chartState.rows[0].open_time)}{" -> "}{formatUTCWithLocal(chartState.rows[chartState.rows.length - 1].close_time)}
        </p>
      ) : null}
    </div>
  );
}
