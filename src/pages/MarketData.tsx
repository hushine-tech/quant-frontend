import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatUTCWithLocal } from "@/utils/time";
import PageHeader from "@/components/PageHeader";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import { FilterField } from "@/components/FilterControls";
import {
  cancelMarketDataRequest,
  createMarketDataRequest,
  listMarketDataRequestsPage,
  queryMarketDataCoverage,
  queryMarketDataKlines,
  type CreateMarketDataRequestPayload,
  type MarketDataCoverage,
  type MarketDataEntry,
  type MarketDataKlines,
  type MarketDataRequest,
  type MarketDataStream,
} from "@/api/client";
import SymbolPicker from "@/components/SymbolPicker";
import InfiniteTable from "@/components/InfiniteTable";
import DateTimeRangePicker from "@/components/DateTimeRangePicker";
import { safeInternalReturnTo } from "@/utils/returnTo";

const SUPPORTED_EXCHANGES = ["binance"] as const;
const SUPPORTED_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
const INTERVAL_MS: Record<(typeof SUPPORTED_INTERVALS)[number], number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};
type MarketDataTab = "live" | "coverage" | "data" | "requests";

const MARKET_DATA_TABS: Array<PageTab<MarketDataTab>> = [
  { id: "live", label: "Live Streams" },
  { id: "coverage", label: "Historical Coverage" },
  { id: "data", label: "Data Viewer" },
  { id: "requests", label: "Request Live Streams" },
];

function statusBadge(text: string, tone: "good" | "warn" | "bad" | "idle") {
  const cls = {
    good: "status-badge status-badge--completed",
    warn: "status-badge status-badge--running",
    bad: "status-badge status-badge--failed",
    idle: "status-badge status-badge--stopped",
  }[tone];
  return <span className={cls}>{text}</span>;
}

function streamStateBadge(s: MarketDataStream) {
  switch (s.actual_state) {
    case "running":
      return statusBadge("running", "good");
    case "pending":
    case "starting":
    case "draining":
      return statusBadge(s.actual_state, "warn");
    case "error":
      return statusBadge("error", "bad");
    default:
      return statusBadge(s.actual_state || "stopped", "idle");
  }
}

function requestStatusBadge(r: MarketDataRequest) {
  if (r.status === "ready" || r.status === "active") return statusBadge(r.status, "good");
  if (r.status === "running" || r.status === "verifying" || r.status === "pending") return statusBadge(r.status, "warn");
  if (r.status === "error") return statusBadge("error", "bad");
  return statusBadge(r.status || "unknown", "idle");
}

function freshnessHint(s: MarketDataStream): string {
  if (!s.last_data_at) return "no data yet";
  const ageMs = Date.now() - new Date(s.last_data_at).getTime();
  if (ageMs < 0) return "just now";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s ago`;
  if (ageMs < 60 * 60_000) return `${Math.round(ageMs / 60_000)}m ago`;
  return `${Math.round(ageMs / 3_600_000)}h ago`;
}

function toLocalInputValue(date: Date): string {
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return copy.toISOString().slice(0, 16);
}

function parseLocalInputMs(raw: string): number | null {
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function alignRangeToInterval(
  startAt: string,
  endAt: string,
  interval: string,
): { startAt: string; endAt: string } {
  const intervalMs = INTERVAL_MS[normalizeInterval(interval) as keyof typeof INTERVAL_MS];
  const rawStartMs = parseLocalInputMs(startAt);
  const rawEndMs = parseLocalInputMs(endAt);
  if (rawStartMs == null || rawEndMs == null) return { startAt, endAt };

  const startMs = Math.floor(rawStartMs / intervalMs) * intervalMs;
  let endMs = Math.floor(rawEndMs / intervalMs) * intervalMs;
  if (endMs <= startMs) endMs = startMs + intervalMs;
  return {
    startAt: toLocalInputValue(new Date(startMs)),
    endAt: toLocalInputValue(new Date(endMs)),
  };
}

function normalizeMarketDataTab(value: string | null): MarketDataTab {
  return value === "coverage" || value === "data" || value === "requests" ? value : "live";
}

function normalizeExchange(value?: string): (typeof SUPPORTED_EXCHANGES)[number] {
  return SUPPORTED_EXCHANGES.includes(value as (typeof SUPPORTED_EXCHANGES)[number])
    ? value as (typeof SUPPORTED_EXCHANGES)[number]
    : "binance";
}

function normalizeMarket(value?: string): "perpetual_futures" | "spot" {
  return value === "spot" ? "spot" : "perpetual_futures";
}

function normalizeInterval(value?: string): string {
  return SUPPORTED_INTERVALS.includes(value as (typeof SUPPORTED_INTERVALS)[number]) ? value as string : "1m";
}

export default function MarketDataPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MarketDataTab>(() => normalizeMarketDataTab(searchParams.get("tab")));
  const [refreshKey, setRefreshKey] = useState(0);
  const returnTo = safeInternalReturnTo(searchParams.get("return_to"));

  useEffect(() => {
    setActiveTab(normalizeMarketDataTab(searchParams.get("tab")));
  }, [searchParams]);

  function changeTab(tab: MarketDataTab) {
    setActiveTab(tab);
    const next: Record<string, string> = {};
    if (tab !== "live") next.tab = tab;
    for (const key of ["return_to", "exchange", "market", "symbol", "interval"]) {
      const value = searchParams.get(key);
      if (value) next[key] = value;
    }
    setSearchParams(next);
  }

  const loadRequestPage = useCallback(async (offset: number, limit: number) => {
    setLoading(true);
    setErr(null);
    try {
      const page = await listMarketDataRequestsPage({ offset, limit });
      return {
        ...page,
        items: page.items.filter((entry) => entry.request.scope === "live"),
      };
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleCancel(id: number) {
    try {
      await cancelMarketDataRequest(id);
      setRefreshKey((v) => v + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Market Data"
        description="Manage live streams, historical coverage, raw kline inspection, and download requests."
        loading={loading}
        onRefresh={() => setRefreshKey((v) => v + 1)}
      />

      <PageTabs tabs={MARKET_DATA_TABS} activeTab={activeTab} onChange={changeTab} ariaLabel="Market data sections">
        {activeTab === "requests" ? (
          <CreateRequestForm
            defaultExchange={searchParams.get("exchange") || undefined}
            defaultMarket={searchParams.get("market") || undefined}
            defaultSymbol={searchParams.get("symbol") || undefined}
            defaultInterval={searchParams.get("interval") || undefined}
            onCreated={() => {
              setRefreshKey((v) => v + 1);
              if (returnTo) navigate(returnTo, { replace: true });
            }}
          />
        ) : null}

        {err ? <p className="error">{err}</p> : null}

        {activeTab === "coverage" ? <HistoricalCoveragePanel onRequestCreated={() => setRefreshKey((v) => v + 1)} /> : null}
        {activeTab === "data" ? <KlineDataViewerPanel /> : null}

        {activeTab === "live" ? (
          <RequestList
            loadPage={loadRequestPage}
            refreshKey={`live-${refreshKey}`}
            emptyText="No live streams yet."
            onCancel={handleCancel}
          />
        ) : null}

        {activeTab === "requests" ? (
          <RequestList
            loadPage={loadRequestPage}
            refreshKey={`requests-${refreshKey}`}
            emptyText="No live stream requests yet."
            onCancel={handleCancel}
          />
        ) : null}
      </PageTabs>
    </div>
  );
}

function RequestList({
  loadPage,
  refreshKey,
  emptyText,
  onCancel,
}: {
  loadPage: (offset: number, limit: number) => Promise<{ items: MarketDataEntry[]; next_offset: number; has_more: boolean; total: number }>;
  refreshKey: string;
  emptyText: string;
  onCancel: (id: number) => void;
}) {
  return (
    <InfiniteTable<MarketDataEntry>
      columns={["Symbol", "Market", "Status", "Collector", "Freshness", "Created", "Action"]}
      loadPage={loadPage}
      refreshKey={refreshKey}
      emptyText={emptyText}
      rowKey={(entry) => String(entry.request.request_id)}
      renderRow={(entry) => (
        <>
          <td>{entry.request.key.symbol}</td>
          <td>{entry.request.key.exchange} · {entry.request.key.market} · {entry.request.key.interval}</td>
          <td>{requestStatusBadge(entry.request)}</td>
          <td>{entry.stream ? streamStateBadge(entry.stream) : "—"}</td>
          <td>{entry.stream ? freshnessHint(entry.stream) : "no data yet"}</td>
          <td>{formatUTCWithLocal(entry.request.created_at)}</td>
          <td>
            {entry.request.status !== "cancelled" ? (
              <button type="button" onClick={() => onCancel(entry.request.request_id)}>Cancel</button>
            ) : null}
          </td>
        </>
      )}
    />
  );
}

function HistoricalCoveragePanel({ onRequestCreated }: { onRequestCreated: () => void | Promise<void> }) {
  const [exchange, setExchange] = useState<(typeof SUPPORTED_EXCHANGES)[number]>("binance");
  const [market, setMarket] = useState<"perpetual_futures" | "spot">("perpetual_futures");
  const [symbol, setSymbol] = useState("");
  const [interval, setInterval] = useState("1m");
  const [startAt, setStartAt] = useState(() => toLocalInputValue(new Date(Date.now() - 24 * 60 * 60_000)));
  const [endAt, setEndAt] = useState(() => toLocalInputValue(new Date()));
  const [coverage, setCoverage] = useState<MarketDataCoverage | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadingGap, setDownloadingGap] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setSymbol("");
    setCoverage(null);
  }, [market]);

  async function handleQuery(e: React.FormEvent) {
    e.preventDefault();
    if (!symbol) {
      setErr("Please pick a symbol from the list below.");
      return;
    }
    const startMs = parseLocalInputMs(startAt);
    const endMs = parseLocalInputMs(endAt);
    if (startMs == null || endMs == null || endMs <= startMs) {
      setErr("Start and end must be a valid increasing range.");
      return;
    }

    setLoading(true);
    setErr(null);
    setMessage(null);
    try {
      const result = await queryMarketDataCoverage({
        exchange,
        market,
        kind: "kline",
        symbol: symbol.trim().toUpperCase(),
        interval,
        start_time_ms: startMs,
        end_time_ms: endMs,
      });
      setCoverage(result);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Coverage query failed");
    } finally {
      setLoading(false);
    }
  }

  async function downloadGap(startISO: string, endISO: string) {
    if (!symbol || !startISO || !endISO) return;
    const startMs = new Date(startISO).getTime();
    const endMs = new Date(endISO).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      setErr("Gap range is invalid.");
      return;
    }

    const key = `${startISO}-${endISO}`;
    setDownloadingGap(key);
    setErr(null);
    setMessage(null);
    try {
      await createMarketDataRequest({
        exchange,
        market,
        kind: "kline",
        symbol: symbol.trim().toUpperCase(),
        interval,
        scope: "historical",
        start_time_ms: startMs,
        end_time_ms: endMs,
        needs_live_delivery: false,
      });
      setMessage("Historical download request created.");
      await onRequestCreated();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Download request failed");
    } finally {
      setDownloadingGap(null);
    }
  }

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <p style={{ fontWeight: 600, marginBottom: "0.75rem" }}>Historical Coverage</p>
      <form className="filter-panel" onSubmit={handleQuery}>
        <FilterField label="Exchange">
          <select
            name="exchange"
            value={exchange}
            onChange={(e) => setExchange(e.target.value as (typeof SUPPORTED_EXCHANGES)[number])}
          >
            {SUPPORTED_EXCHANGES.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Market">
          <select name="market" value={market} onChange={(e) => setMarket(e.target.value as "perpetual_futures" | "spot")}>
            <option value="perpetual_futures">Perpetual futures</option>
            <option value="spot">spot</option>
          </select>
        </FilterField>

        <SymbolPicker
          market={market === "perpetual_futures" ? "usdm_futures" : "spot"}
          label="Symbol"
          onAdd={setSymbol}
          selected={symbol}
          className="filter-field filter-field--wide"
        />

        <FilterField label="Interval">
          <select
            name="interval"
            value={interval}
            onChange={(e) => {
              const nextInterval = e.target.value;
              const aligned = alignRangeToInterval(startAt, endAt, nextInterval);
              setInterval(nextInterval);
              setStartAt(aligned.startAt);
              setEndAt(aligned.endAt);
              setCoverage(null);
              setErr(null);
            }}
          >
            {SUPPORTED_INTERVALS.map((iv) => (
              <option key={iv} value={iv}>{iv}</option>
            ))}
          </select>
        </FilterField>

        <DateTimeRangePicker
          label="Time range"
          startValue={startAt}
          endValue={endAt}
          onStartChange={setStartAt}
          onEndChange={setEndAt}
          className="filter-field--wide"
        />

        <p className="filter-action">
          <button type="submit" className="primary" disabled={loading || !symbol}>
            {loading ? "Checking…" : "Check Coverage"}
          </button>
        </p>
      </form>

      {err ? <p className="error" style={{ marginTop: "0.75rem" }}>{err}</p> : null}
      {message ? <p className="muted" style={{ marginTop: "0.75rem" }}>{message}</p> : null}

      {coverage ? (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            {coverage.complete ? statusBadge("complete", "good") : statusBadge("gaps", "warn")}
            <span className="muted">
              {coverage.covered_count}/{coverage.expected_count} bars
            </span>
            {coverage.non_downloadable_reason ? statusBadge("non-downloadable", "bad") : null}
          </div>

          <p className="muted" style={{ fontSize: "0.82rem", margin: "0.5rem 0 0" }}>
            requested: {formatUTCWithLocal(coverage.requested_start_at)}
            {" → "}
            {formatUTCWithLocal(coverage.requested_end_at)}
          </p>

          <CoverageTimeline coverage={coverage} />
          <CoverageSegments title="Covered Segments" coverage={coverage} />
          <CoverageGaps
            coverage={coverage}
            downloadingGap={downloadingGap}
            onDownload={(startISO, endISO) => void downloadGap(startISO, endISO)}
          />
        </div>
      ) : null}
    </div>
  );
}

function KlineDataViewerPanel() {
  const [exchange, setExchange] = useState<(typeof SUPPORTED_EXCHANGES)[number]>("binance");
  const [market, setMarket] = useState<"perpetual_futures" | "spot">("perpetual_futures");
  const [symbol, setSymbol] = useState("");
  const [interval, setInterval] = useState("1m");
  const [startAt, setStartAt] = useState(() => toLocalInputValue(new Date(Date.now() - 60 * 60_000)));
  const [endAt, setEndAt] = useState(() => toLocalInputValue(new Date()));
  const [limit, setLimit] = useState(100);
  const [result, setResult] = useState<MarketDataKlines | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setSymbol("");
    setResult(null);
  }, [market]);

  async function handleQuery(e: React.FormEvent) {
    e.preventDefault();
    if (!symbol) {
      setErr("Please pick a symbol from the list below.");
      return;
    }
    const startMs = parseLocalInputMs(startAt);
    const endMs = parseLocalInputMs(endAt);
    if (startMs == null || endMs == null || endMs <= startMs) {
      setErr("Start and end must be a valid increasing range.");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const rows = await queryMarketDataKlines({
        exchange,
        market,
        kind: "kline",
        symbol: symbol.trim().toUpperCase(),
        interval,
        start_time_ms: startMs,
        end_time_ms: endMs,
        limit,
      });
      setResult(rows);
    } catch (e2) {
      setResult(null);
      setErr(e2 instanceof Error ? e2.message : "Kline query failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <p style={{ fontWeight: 600, marginBottom: "0.75rem" }}>Data Viewer</p>
      <form className="filter-panel" onSubmit={handleQuery}>
        <FilterField label="Exchange">
          <select
            name="exchange"
            value={exchange}
            onChange={(e) => setExchange(e.target.value as (typeof SUPPORTED_EXCHANGES)[number])}
          >
            {SUPPORTED_EXCHANGES.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Market">
          <select name="market" value={market} onChange={(e) => setMarket(e.target.value as "perpetual_futures" | "spot")}>
            <option value="perpetual_futures">Perpetual futures</option>
            <option value="spot">spot</option>
          </select>
        </FilterField>

        <SymbolPicker
          market={market === "perpetual_futures" ? "usdm_futures" : "spot"}
          label="Symbol"
          onAdd={setSymbol}
          selected={symbol}
          className="filter-field filter-field--wide"
        />

        <FilterField label="Interval">
          <select name="interval" value={interval} onChange={(e) => setInterval(e.target.value)}>
            {SUPPORTED_INTERVALS.map((iv) => (
              <option key={iv} value={iv}>{iv}</option>
            ))}
          </select>
        </FilterField>

        <DateTimeRangePicker
          label="Time range"
          startValue={startAt}
          endValue={endAt}
          onStartChange={setStartAt}
          onEndChange={setEndAt}
          className="filter-field--wide"
        />

        <FilterField label="Limit">
          <input
            type="number"
            min={1}
            max={500}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
          />
        </FilterField>

        <p className="filter-action">
          <button type="submit" className="primary" disabled={loading || !symbol}>
            {loading ? "Loading…" : "Load Raw Klines"}
          </button>
        </p>
      </form>

      {err ? <p className="error" style={{ marginTop: "0.75rem" }}>{err}</p> : null}
      {result ? <KlineRowsTable title="Raw Klines" result={result} /> : null}
    </div>
  );
}

function KlineRowsTable({ title, result }: { title: string; result: MarketDataKlines }) {
  return (
    <div style={{ marginTop: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <p style={{ fontWeight: 600, margin: 0 }}>{title}</p>
        <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
          {result.row_count} row(s){result.truncated ? `, limited to ${result.limit}` : ""}
        </p>
      </div>
      {result.rows.length === 0 ? (
        <p className="muted">No raw Kline rows in this range.</p>
      ) : (
        <>
          <KlinePriceChart result={result} />
          <div className="table-scroll" style={{ marginTop: "0.75rem" }}>
            <table className="compact" style={{ width: "100%", minWidth: "780px" }}>
              <thead>
                <tr>
                  <th>Open Time</th>
                  <th>Close Time</th>
                  <th>Open</th>
                  <th>High</th>
                  <th>Low</th>
                  <th>Close</th>
                  <th>Volume</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={`${row.open_time}-${row.close_time}`}>
                    <td>{formatUTCWithLocal(row.open_time)}</td>
                    <td>{formatUTCWithLocal(row.close_time)}</td>
                    <td>{row.open}</td>
                    <td>{row.high}</td>
                    <td>{row.low}</td>
                    <td>{row.close}</td>
                    <td>{row.volume}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function CoverageTimeline({ coverage }: { coverage: MarketDataCoverage }) {
  const startMs = new Date(coverage.requested_start_at).getTime();
  const endMs = new Date(coverage.requested_end_at).getTime();
  const duration = Math.max(1, endMs - startMs);
  const segments = [
    ...coverage.covered_segments.map((seg) => ({
      key: `covered-${seg.start_at}-${seg.end_at}`,
      start: new Date(seg.start_at).getTime(),
      end: new Date(seg.end_at).getTime(),
      color: "#16a34a",
      label: `covered ${seg.row_count}`,
    })),
    ...coverage.missing_segments.map((seg) => ({
      key: `missing-${seg.start_at}-${seg.end_at}`,
      start: new Date(seg.start_at).getTime(),
      end: new Date(seg.end_at).getTime(),
      color: "#dc2626",
      label: `missing ${seg.expected_count}`,
    })),
  ].filter((seg) => Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.end > startMs && seg.start < endMs);

  const xFor = (ms: number) => Math.max(0, Math.min(1000, ((ms - startMs) / duration) * 1000));

  return (
    <div style={{ marginTop: "1rem" }}>
      <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Coverage Timeline</p>
      <div style={{ border: "1px solid #d8e0ee", borderRadius: 8, padding: "0.75rem", background: "#fff" }}>
        <svg viewBox="0 0 1000 96" role="img" aria-label="Coverage Timeline" style={{ display: "block", width: "100%", height: 96 }}>
          <rect x="0" y="34" width="1000" height="18" rx="5" fill="#e5e7eb" />
          {segments.map((seg) => {
            const x = xFor(seg.start);
            const w = Math.max(2, xFor(seg.end) - x);
            return <rect key={seg.key} x={x} y="30" width={w} height="26" rx="4" fill={seg.color}><title>{seg.label}</title></rect>;
          })}
          <line x1="0" y1="70" x2="1000" y2="70" stroke="#cbd5e1" strokeWidth="1" />
          <text x="0" y="90" fontSize="22" fill="#64748b">{formatUTCWithLocal(coverage.requested_start_at)}</text>
          <text x="1000" y="90" fontSize="22" fill="#64748b" textAnchor="end">{formatUTCWithLocal(coverage.requested_end_at)}</text>
        </svg>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.5rem", fontSize: "0.85rem" }}>
          <span className="muted"><span style={{ display: "inline-block", width: 10, height: 10, background: "#16a34a", borderRadius: 2, marginRight: 6 }} />covered</span>
          <span className="muted"><span style={{ display: "inline-block", width: 10, height: 10, background: "#dc2626", borderRadius: 2, marginRight: 6 }} />missing</span>
        </div>
      </div>
    </div>
  );
}

function KlinePriceChart({ result }: { result: MarketDataKlines }) {
  const rows = result.rows;
  if (rows.length === 0) return null;
  const width = 1000;
  const height = 300;
  const padX = 42;
  const padY = 30;
  const minPrice = Math.min(...rows.map((row) => row.low));
  const maxPrice = Math.max(...rows.map((row) => row.high));
  const span = Math.max(1e-9, maxPrice - minPrice);
  const plotWidth = width - padX * 2;
  const plotHeight = height - padY * 2;
  const xFor = (index: number) => padX + (rows.length === 1 ? plotWidth / 2 : (index / (rows.length - 1)) * plotWidth);
  const yFor = (price: number) => padY + ((maxPrice - price) / span) * plotHeight;
  const candleWidth = Math.max(2, Math.min(9, plotWidth / Math.max(1, rows.length) * 0.58));
  const closePath = rows.map((row, index) => `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(2)} ${yFor(row.close).toFixed(2)}`).join(" ");

  return (
    <div style={{ marginTop: "0.75rem", border: "1px solid #d8e0ee", borderRadius: 8, padding: "0.75rem", background: "#fff" }}>
      <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>Price Chart</p>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Kline price chart" style={{ display: "block", width: "100%", height: 300 }}>
        <rect x={padX} y={padY} width={plotWidth} height={plotHeight} fill="#f8fafc" stroke="#d8e0ee" />
        {[0, 0.5, 1].map((ratio) => {
          const y = padY + ratio * plotHeight;
          const price = maxPrice - ratio * span;
          return (
            <g key={ratio}>
              <line x1={padX} x2={width - padX} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={padX - 8} y={y + 5} fontSize="18" fill="#64748b" textAnchor="end">{price.toFixed(4)}</text>
            </g>
          );
        })}
        {rows.map((row, index) => {
          const x = xFor(index);
          const openY = yFor(row.open);
          const closeY = yFor(row.close);
          const highY = yFor(row.high);
          const lowY = yFor(row.low);
          const up = row.close >= row.open;
          return (
            <g key={`${row.open_time}-${row.close_time}`}>
              <line x1={x} x2={x} y1={highY} y2={lowY} stroke={up ? "#16a34a" : "#dc2626"} strokeWidth="1.5" />
              <rect
                x={x - candleWidth / 2}
                y={Math.min(openY, closeY)}
                width={candleWidth}
                height={Math.max(2, Math.abs(openY - closeY))}
                fill={up ? "#16a34a" : "#dc2626"}
                opacity="0.85"
              />
            </g>
          );
        })}
        <path d={closePath} fill="none" stroke="#2563eb" strokeWidth="2" />
      </svg>
      <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
        {formatUTCWithLocal(rows[0].open_time)} → {formatUTCWithLocal(rows[rows.length - 1].close_time)}
      </p>
    </div>
  );
}

function CoverageSegments({ title, coverage }: { title: string; coverage: MarketDataCoverage }) {
  return (
    <div style={{ marginTop: "1rem" }}>
      <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>{title}</p>
      {coverage.covered_segments.length === 0 ? (
        <p className="muted">No covered segment in this range.</p>
      ) : (
        <div className="table-scroll">
          <table className="compact" style={{ width: "100%", minWidth: "640px" }}>
            <thead>
              <tr>
                <th>Start</th>
                <th>End</th>
                <th>Rows</th>
                <th>Year</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {coverage.covered_segments.map((segment) => (
                <tr key={`${segment.start_at}-${segment.end_at}-${segment.year}`}>
                  <td>{formatUTCWithLocal(segment.start_at)}</td>
                  <td>{formatUTCWithLocal(segment.end_at)}</td>
                  <td>{segment.row_count}</td>
                  <td>{segment.year}</td>
                  <td>{segment.source || "storage"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CoverageGaps({
  coverage,
  downloadingGap,
  onDownload,
}: {
  coverage: MarketDataCoverage;
  downloadingGap: string | null;
  onDownload: (startISO: string, endISO: string) => void;
}) {
  return (
    <div style={{ marginTop: "1rem" }}>
      <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Missing Segments</p>
      {coverage.missing_segments.length === 0 ? (
        <p className="muted">No missing segment in this range.</p>
      ) : (
        <div className="table-scroll">
          <table className="compact" style={{ width: "100%", minWidth: "720px" }}>
            <thead>
              <tr>
                <th>Start</th>
                <th>End</th>
                <th>Expected Bars</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {coverage.missing_segments.map((gap) => {
                const gapKey = `${gap.start_at}-${gap.end_at}`;
                return (
                  <tr key={gapKey}>
                    <td>{formatUTCWithLocal(gap.start_at)}</td>
                    <td>{formatUTCWithLocal(gap.end_at)}</td>
                    <td>{gap.expected_count}</td>
                    <td>
                      <button
                        type="button"
                        disabled={Boolean(coverage.non_downloadable_reason) || downloadingGap === gapKey}
                        onClick={() => onDownload(gap.start_at, gap.end_at)}
                      >
                        {downloadingGap === gapKey ? "Requesting…" : "Download gap"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {coverage.non_downloadable_reason ? (
        <p className="error" style={{ marginTop: "0.5rem" }}>{coverage.non_downloadable_reason}</p>
      ) : null}
    </div>
  );
}

function CreateRequestForm({
  defaultExchange,
  defaultMarket,
  defaultSymbol,
  defaultInterval,
  onCreated,
}: {
  defaultExchange?: string;
  defaultMarket?: string;
  defaultSymbol?: string;
  defaultInterval?: string;
  onCreated: (entry: MarketDataEntry) => void;
}) {
  const [exchange, setExchange] = useState<(typeof SUPPORTED_EXCHANGES)[number]>(() => normalizeExchange(defaultExchange));
  const [market, setMarket] = useState<"perpetual_futures" | "spot">(() => normalizeMarket(defaultMarket));
  const [symbol, setSymbol] = useState(() => (defaultSymbol || "").trim().toUpperCase());
  const [interval, setInterval] = useState(() => normalizeInterval(defaultInterval));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!symbol) {
      setErr("Please pick a symbol from the list below.");
      return;
    }

    const payload: CreateMarketDataRequestPayload = {
      exchange,
      market,
      kind: "kline",
      symbol: symbol.trim().toUpperCase(),
      interval,
      scope: "live",
      needs_live_delivery: true,
    };

    setErr(null);
    setSubmitting(true);
    try {
      const entry = await createMarketDataRequest(payload);
      onCreated(entry);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <p style={{ fontWeight: 600, marginBottom: "0.75rem" }}>Request Live Stream</p>
      <form className="filter-panel" onSubmit={handleSubmit}>
        <FilterField label="Exchange">
          <select
            name="exchange"
            value={exchange}
            onChange={(e) => setExchange(e.target.value as (typeof SUPPORTED_EXCHANGES)[number])}
          >
            {SUPPORTED_EXCHANGES.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Market">
          <select
            name="market"
            value={market}
            onChange={(e) => {
              setMarket(e.target.value as "perpetual_futures" | "spot");
              setSymbol("");
            }}
          >
            <option value="perpetual_futures">Perpetual futures</option>
            <option value="spot">spot</option>
          </select>
        </FilterField>

        <SymbolPicker
          market={market === "perpetual_futures" ? "usdm_futures" : "spot"}
          label="Symbol"
          onAdd={setSymbol}
          selected={symbol}
          className="filter-field filter-field--wide"
        />

        <FilterField label="Interval">
          <select name="interval" value={interval} onChange={(e) => setInterval(e.target.value)}>
            {SUPPORTED_INTERVALS.map((iv) => (
              <option key={iv} value={iv}>{iv}</option>
            ))}
          </select>
        </FilterField>

        {err ? <p className="error" style={{ marginTop: "0.5rem" }}>{err}</p> : null}
        <p className="filter-action">
          <button type="submit" className="primary" disabled={submitting || !symbol}>
            {submitting ? "Requesting…" : "Request Live Stream"}
          </button>
        </p>
      </form>
    </div>
  );
}
