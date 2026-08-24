import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { formatUTCWithLocal } from "@/utils/time";
import { portfolioEnvironmentLabel } from "@/utils/portfolioEnvironment";
import {
  getSession,
  getSessionAttempts,
  getSessionFills,
  getSessionIntents,
  getSessionLifecycleEvents,
  getSessionSnapshots,
  getSessionOrders,
  getSessionReconciliation,
  getSessionReconciliationSummary,
  getStrategy,
  listSessionDeliveryHealth,
  finishSession,
  listPortfolioStrategies,
  listSessions,
  runStrategy,
  stopSessionResult,
  isSessionTerminal,
  shouldPollSessionRecord,
  exactDecimalText,
  strategyStreamKey,
  sessionLeverageDisplayFacts,
  strategyLeverageDisplayFact,
  strategyLeverageSourceLabel,
  strategyStartNavigationState,
  strategyStartResultFromNavigationState,
  runtimeRoleForSessionEnvironment,
  type Session,
  type SessionReconciliationSummary,
  type SnapshotEntry,
  type ReconciliationRun,
  type ReconciliationFieldDiff,
  type SessionDeliveryHealth,
  type OrderLifecycleEvent,
  type SessionOrderIntent,
  type SessionOrderAttempt,
  type SessionOrder,
  type SessionOrderFill,
  type Strategy,
  type StrategyInputDeclaration,
  type StrategyOrderTargetDeclaration,
  type StrategySession,
  type PreviewRunStrategy,
} from "@/api/client";
import StopSessionDialog from "@/components/StopSessionDialog";
import OrderTree from "@/components/OrderTree";
import SessionChartPanel from "@/components/SessionChartPanel";
import Pager from "@/components/Pager";
import RuntimeSelectionDialog from "@/components/RuntimeSelectionDialog";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import { extractStrategyInputs, extractStrategyOrderTargets } from "@/utils/strategyDeclarations";
import { useResumeStrategyPreview } from "@/hooks/useResumeStrategyPreview";

const DEFAULT_MAX_LOSS_CLOSE_PERCENT = 30;

function parseMaxLossClosePct(percentText: string): number | null {
  const value = Number(percentText);
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null;
  return value / 100;
}

async function resumeWithNewSession(portfolioId: number, session: Session, runtimeId: string, maxLossClosePct: number): Promise<StrategySession> {
  const entries = await listPortfolioStrategies(portfolioId);
  const targetStrategyId = session.strategy_id;
  if (!targetStrategyId || targetStrategyId <= 0) {
    throw new Error("Cannot resume session: original strategy is missing");
  }
  if (!entries.some((entry) => entry.active && entry.strategy.strategy_id === targetStrategyId)) {
    throw new Error("The active strategy changed after preview. Activate this Session's original strategy and review the preview again.");
  }
  return runStrategy(portfolioId, {
    interval: session.interval || "1m",
    start_time_ms: session.start_time_ms,
    end_time_ms: session.end_time_ms,
    runtime_id: runtimeId,
    max_loss_close_pct: maxLossClosePct,
    resume_session_id: session.session_id,
  });
}

function SessionLeverageFacts({ session }: { session: Session }) {
  const facts = sessionLeverageDisplayFacts(session);
  if (facts.length === 0) return null;
  return (
    <div>
      <div className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.25rem" }}>Futures leverage</div>
      <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
        {facts.map((fact) => (
          <span key={fact.symbol} className="status-badge status-badge--idle">
            <code>{fact.symbol}</code>{" "}<strong>{fact.leverage}</strong>{" "}<span className="muted">{fact.source}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ResumeLeverageApplyResult({ result, applying }: { result: StrategySession | null; applying: boolean }) {
  if (applying && !result) return <p className="muted">Applying and confirming strategy leverage…</p>;
  if (!result || (result.target_results?.length ?? 0) === 0) return null;
  return (
    <div className="card" style={{ marginTop: "0.75rem", borderLeft: `4px solid ${result.rollback_failed || !result.ok ? "#ef4444" : "#16a34a"}` }}>
      <strong>{result.rollback_failed ? "Leverage rollback requires attention" : result.ok ? "Strategy leverage confirmed" : "Strategy leverage apply failed"}</strong>
      {result.code ? <> · <code>{result.code}</code></> : null}
      <div style={{ display: "grid", gap: "0.3rem", marginTop: "0.4rem", fontSize: "0.84rem" }}>
        {result.target_results.map((target) => (
          <div key={`${target.venue_id}-${target.market}-${target.symbol}`}>
            <code>{target.symbol}</code>{" "}<strong>{target.effective_leverage}x</strong>{" "}
            <span>{strategyLeverageSourceLabel(target.leverage_source)}</span>{" · "}<span>{target.status.replaceAll("_", " ")}</span>
            {target.current_leverage != null ? <span className="muted"> · Current: {target.current_leverage}x</span> : null}
            {target.error_code ? <span className="error"> · {target.error_code}: {target.error_message || "failed"}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResumeStrategyPreview({
  preview,
  loading,
  error,
}: {
  preview: PreviewRunStrategy | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !preview && !error) return <p className="muted">Checking resume preflight…</p>;
  if (error) return <p className="error">Resume start blocked: {error}</p>;
  if (!preview) return null;
  const facts = (preview.order_targets ?? preview.declared_order_targets ?? [])
    .map(strategyLeverageDisplayFact)
    .filter((fact) => fact !== null);
  return (
    <div className="card" style={{ marginTop: "0.75rem", borderLeft: `4px solid ${preview.ok ? "#16a34a" : "#eab308"}` }}>
      <p style={{ margin: 0, fontWeight: 600 }}>
        {preview.ok ? "Resume preflight ready" : "Resume start blocked"}
      </p>
      {facts.length > 0 ? (
        <div style={{ display: "grid", gap: "0.3rem", marginTop: "0.4rem", fontSize: "0.84rem" }}>
          {facts.map((fact, index) => (
            <div key={`${fact.symbol}-${index}`}>
              <code>{fact.symbol}</code>{" "}<strong>{fact.effective}</strong>{" "}
              <span>{fact.source}</span>{" · "}<span className="muted">{fact.current}</span>{" · "}<span>{fact.change}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ marginBottom: 0 }}>No Futures leverage targets. Spot targets do not use leverage.</p>
      )}
      {!preview.ok && preview.failures.length > 0 ? (
        <p className="error" style={{ marginBottom: 0 }}>
          {preview.failures[0].code ? `${preview.failures[0].code}: ` : ""}{preview.failures[0].reason}
        </p>
      ) : null}
    </div>
  );
}

const REASON_NAMES: Record<number, string> = {
  0: "initial_seed",
  1: "order_fill",
  2: "strategy_start",
  3: "strategy_end",
  4: "reconciliation_local",
  5: "reconciliation_exchange",
  6: "periodic_sample",
  7: "restart_recovery",
};

// Pagination (paginate-session-detail-lists): every audit list on this page
// uses offset-based paging with 20 items per page, ordered newest-first.
// Shared constant so all three lists stay in lockstep.
const PAGE_SIZE = 20;

type SessionDetailTab = "chart" | "snapshots" | "reconciliation" | "orders" | "lifecycle";

type SessionPnLSummary = {
  initialValue: number;
  finalValue: number;
  pnl: number;
  upnl: number | null;
};

type VenueReconciliationDiff = {
  venue_id?: number;
  exchange?: number | string;
  environment?: number | string;
  market?: number | string;
  hard_pass?: boolean;
  soft_pass?: boolean;
  field_diffs?: ReconciliationFieldDiff[];
  advisory_diffs?: ReconciliationFieldDiff[];
};

type ReconciliationRunCounts = {
  hardFail: number;
  softFail: number;
  advisory: number;
};

const sessionDetailTabs: Array<PageTab<SessionDetailTab>> = [
  { id: "chart", label: "Chart" },
  { id: "snapshots", label: "Snapshots" },
  { id: "reconciliation", label: "Reconciliation" },
  { id: "orders", label: "Orders" },
  { id: "lifecycle", label: "Lifecycle Events" },
];

function sessionStartedAtMs(session: Session): number {
  return Date.parse(session.started_at || session.completed_at || "") || 0;
}

function canResumeSession(session: Session, allSessions: Session[]): boolean {
  if (session.status !== "stopped" && session.status !== "recoverable") return false;
  const baseStartedAt = sessionStartedAtMs(session);
  return !allSessions.some((other) => (
    other.session_id !== session.session_id
    && other.portfolio_id === session.portfolio_id
    && other.strategy_id === session.strategy_id
    && other.environment === session.environment
    && other.interval === session.interval
    && (other.start_time_ms ?? 0) === (session.start_time_ms ?? 0)
    && (other.end_time_ms ?? 0) === (session.end_time_ms ?? 0)
    && sessionStartedAtMs(other) > baseStartedAt
  ));
}

// ── Shared paged-list state hook ─────────────────────────────────────────
//
// Keeps the repeated boilerplate (offset / has_more / loading / error)
// consistent across the three independent pagers.

type PagedFetcher<T> = (offset: number, limit: number) => Promise<{
  items: T[];
  next_offset: number;
  has_more: boolean;
  total: number;
}>;

type PagedState<T> = {
  items: T[];
  offset: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  jump: (newOffset: number) => void;
  reload: () => void;
};

function usePagedList<T>(
  fetcher: PagedFetcher<T>,
  deps: unknown[],
  enabled: boolean = true,
): PagedState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  // Loading is initially false when disabled; once enabled, the fetch effect
  // flips it to true. Eager (default) callers behave as before.
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  // Reset offset when the session / portfolio changes. We intentionally do NOT
  // depend on ``offset`` here — the separate effect below handles offset changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setOffset(0); }, deps);

  const reload = useCallback(() => {
    if (!enabled) return () => {};
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher(offset, PAGE_SIZE)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setHasMore(page.has_more);
        setTotal(page.total);
      })
      .catch((e) => {
        if (cancelled) return;
        setItems([]);
        setHasMore(false);
        setTotal(0);
        setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, enabled, ...deps]);

  // The fetch effect skips entirely when disabled. When ``enabled`` flips
  // ``false → true``, the effect's dep change fires the initial fetch with
  // the current offset (0 on first enable thanks to the reset effect above).
  // Subsequent disable/re-enable cycles preserve the loaded items, offset,
  // and total — they're never cleared by ``enabled`` alone.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [offset, enabled, ...deps]);

  const jump = useCallback((newOffset: number) => {
    setOffset(Math.max(0, newOffset));
  }, []);

  return { items, offset, total, hasMore, loading, error, jump, reload };
}

function badgeClass(status: string): string {
  switch (status) {
    case "running": return "status-badge status-badge--running";
    case "stopping": return "status-badge status-badge--stopping";
    case "finished": return "status-badge status-badge--completed";
    case "failed": return "status-badge status-badge--failed";
    case "recoverable": return "status-badge status-badge--recoverable";
    case "stop_failed": return "status-badge status-badge--stop-failed";
    case "stopped": return "status-badge status-badge--stopped";
    default: return "status-badge status-badge--idle";
  }
}

function sessionKindBadge(session: Session): React.ReactNode {
  if (!session.session_type) return null;
  return (
    <span className="status-badge status-badge--idle" style={{ marginLeft: "0.5rem" }}>
      {session.session_type}
    </span>
  );
}

function formatInputRoute(input: StrategyInputDeclaration): string {
  return `${input.symbol || "-"} ${input.interval || "-"}`;
}

function formatInputMeta(input: StrategyInputDeclaration): string {
  const kind = input.kind || "kline";
  return `${input.exchange || "-"} / ${input.market || "-"} / ${kind}`;
}

function formatOrderTarget(target: StrategyOrderTargetDeclaration): string {
  return `${target.exchange || "-"} / ${target.market || "-"} / ${target.symbol || "-"}`;
}

function formatRangeEndpoint(ms?: number): string {
  return ms ? formatUTCWithLocal(ms) : "-";
}

function withExactIntentDecimals(item: SessionOrderIntent): SessionOrderIntent {
  return {
    ...item,
    requested_qty_decimal: exactDecimalText(item.requested_qty_decimal),
    requested_price_decimal: exactDecimalText(item.requested_price_decimal),
  };
}

function withExactAttemptDecimals(item: SessionOrderAttempt): SessionOrderAttempt {
  return {
    ...item,
    requested_qty_decimal: exactDecimalText(item.requested_qty_decimal),
    requested_price_decimal: exactDecimalText(item.requested_price_decimal),
    mark_price_decimal: exactDecimalText(item.mark_price_decimal),
  };
}

function withExactOrderDecimals(item: SessionOrder): SessionOrder {
  return {
    ...item,
    orig_qty_decimal: exactDecimalText(item.orig_qty_decimal),
    executed_qty_decimal: exactDecimalText(item.executed_qty_decimal),
    remaining_qty_decimal: exactDecimalText(item.remaining_qty_decimal),
    avg_price_decimal: exactDecimalText(item.avg_price_decimal),
    price_decimal: exactDecimalText(item.price_decimal),
    cumulative_quote_qty_decimal: exactDecimalText(item.cumulative_quote_qty_decimal),
  };
}

function withExactFillDecimals(item: SessionOrderFill): SessionOrderFill {
  return {
    ...item,
    qty_decimal: exactDecimalText(item.qty_decimal),
    fill_price_decimal: exactDecimalText(item.fill_price_decimal),
    fee_decimal: exactDecimalText(item.fee_decimal),
    quote_qty_decimal: exactDecimalText(item.quote_qty_decimal),
    fee_asset: item.fee_asset || "-",
  };
}

type SessionFailureDetail = {
  code?: string;
  message?: string;
  environment?: number | string;
  retryable?: boolean;
  source?: string;
  filter_type?: string;
};

function hasMeaningfulSessionFailure(failure: SessionFailureDetail): boolean {
  return Boolean(
    failure.code
      || failure.message
      || failure.filter_type
      || failure.retryable !== undefined,
  );
}

function sessionFailureDetails(session: Session | null): SessionFailureDetail[] {
  if (!session) return [];
  let detail: unknown = session.error_detail;
  if (!detail && session.error_detail_json) {
    try {
      detail = JSON.parse(session.error_detail_json);
    } catch {
      detail = undefined;
    }
  }
  if (!detail || typeof detail !== "object") {
    return session.error_code
      ? [{
          code: session.error_code,
          message: session.error_message || session.error,
          environment: session.environment,
          source: session.runtime_source,
        }]
      : [];
  }
  const root = detail as Record<string, unknown>;
  const values = Array.isArray(root.failures) ? root.failures : [root];
  const failures = values
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
    .map((value) => ({
      code: typeof value.code === "string" ? value.code : undefined,
      message: typeof value.message === "string"
        ? value.message
        : typeof value.reason === "string"
          ? value.reason
          : typeof value.error === "string"
            ? value.error
            : undefined,
      environment: typeof value.environment === "number" || typeof value.environment === "string" ? value.environment : undefined,
      retryable: typeof value.retryable === "boolean" ? value.retryable : undefined,
      source: typeof value.source === "string" ? value.source : session.runtime_source,
      filter_type: typeof value.filter_type === "string" ? value.filter_type : undefined,
    }))
    .filter(hasMeaningfulSessionFailure);
  if (failures.length > 0) return failures;
  if (session.error_code || session.error_message || session.error) {
    return [{
      code: session.error_code,
      message: session.error_message || session.error,
      environment: session.environment,
      source: session.runtime_source,
    }];
  }
  return [];
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function snapshotUnrealizedPnl(snapshot: Pick<SnapshotEntry, "futures_json"> | null | undefined): number | null {
  if (!snapshot?.futures_json) return null;
  try {
    const futures = JSON.parse(snapshot.futures_json);
    if (!futures || typeof futures !== "object") return null;
    const aggregate = finiteNumber(futures.total_unrealized_pnl) ?? finiteNumber(futures.unrealized_pnl);
    if (aggregate !== null) return aggregate;
    if (!futures.positions || typeof futures.positions !== "object") return null;
    let sum = 0;
    let found = false;
    for (const position of Object.values(futures.positions)) {
      if (!position || typeof position !== "object") continue;
      const value = finiteNumber((position as { unrealized_pnl?: unknown }).unrealized_pnl);
      if (value === null) continue;
      sum += value;
      found = true;
    }
    return found ? sum : null;
  } catch {
    return null;
  }
}

function formatSignedNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function parseVenueDiffs(raw: string): VenueReconciliationDiff[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is VenueReconciliationDiff => item !== null && typeof item === "object");
  } catch {
    return [];
  }
}

const EXCHANGE_LABELS: Record<number, string> = {
  1: "binance",
  2: "okx",
};

const MARKET_LABELS: Record<number, string> = {
  1: "spot",
  2: "perpetual_futures",
  3: "delivery_futures",
};

function enumLabel(labels: Record<number, string>, value: number | string | undefined, fallback: string): string {
  if (value == null || value === "") return `${fallback}=?`;
  if (typeof value === "string" && Number.isNaN(Number(value))) return value;
  const numeric = Number(value);
  return labels[numeric] ?? `${fallback}=${value}`;
}

function venueScopeLabel(venue: VenueReconciliationDiff): string {
  const venueID = venue.venue_id ?? "-";
  const exchange = enumLabel(EXCHANGE_LABELS, venue.exchange, "exchange");
  const market = enumLabel(MARKET_LABELS, venue.market, "market");
  const environment = portfolioEnvironmentLabel(venue.environment);
  return `Venue ${venueID} · ${exchange} / ${market} / ${environment}`;
}

function reconciliationRunCounts(run: ReconciliationRun): ReconciliationRunCounts {
  const counts: ReconciliationRunCounts = { hardFail: 0, softFail: 0, advisory: 0 };
  for (const venue of parseVenueDiffs(run.venue_diffs_json || "[]")) {
    for (const diff of venue.field_diffs ?? []) {
      if (diff.passed) continue;
      if (diff.severity === "hard") counts.hardFail += 1;
      if (diff.severity === "soft") counts.softFail += 1;
    }
    counts.advisory += (venue.advisory_diffs ?? []).length;
  }
  return counts;
}

export default function SessionDetailPage() {
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedSnap, setExpandedSnap] = useState<number | null>(null);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);
  const [stopInfo, setStopInfo] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [portfolioSessions, setPortfolioSessions] = useState<Session[]>([]);
  const [deliveryHealth, setDeliveryHealth] = useState<SessionDeliveryHealth[]>([]);
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false);
  const [resumeRuntimeId, setResumeRuntimeId] = useState("");
  const [resumeMaxLossClosePercent, setResumeMaxLossClosePercent] = useState(String(DEFAULT_MAX_LOSS_CLOSE_PERCENT));
  const [resumeStartResult, setResumeStartResult] = useState<StrategySession | null>(null);
  const [resuming, setResuming] = useState(false);
  const resumeSubmissionInFlightRef = useRef(false);
  const resumeMaxLossClosePct = parseMaxLossClosePct(resumeMaxLossClosePercent);
  const resumePreview = useResumeStrategyPreview(
    resumeDialogOpen,
    session?.portfolio_id ?? Number(id ?? 0),
    session,
    resumeRuntimeId,
    resumeMaxLossClosePct,
  );
  const [navigationStartResult, setNavigationStartResult] = useState<StrategySession | null>(() => (
    strategyStartResultFromNavigationState(location.state, sessionId ?? "")
  ));

  useEffect(() => {
    setNavigationStartResult(strategyStartResultFromNavigationState(location.state, sessionId ?? ""));
  }, [location.state, sessionId]);

  // Orders stays the default tab. Audit tables and the chart load lazily when opened; the
  // headline PnL card has its own lightweight session-wide snapshot query.
  const [activeTab, setActiveTab] = useState<SessionDetailTab>("orders");
  const [chartLoaded, setChartLoaded] = useState(false);
  const [snapshotsLoaded, setSnapshotsLoaded] = useState(false);
  const [reconciliationLoaded, setReconciliationLoaded] = useState(false);
  const [lifecycleLoaded, setLifecycleLoaded] = useState(false);
  const [lifecycleEvents, setLifecycleEvents] = useState<OrderLifecycleEvent[]>([]);
  const [lifecycleCursor, setLifecycleCursor] = useState(0);
  const [lifecycleHasMore, setLifecycleHasMore] = useState(false);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [stopFailureAcknowledged, setStopFailureAcknowledged] = useState(false);
  const [pnlSummary, setPnlSummary] = useState<SessionPnLSummary | null>(null);
  const [pnlSummaryLoading, setPnlSummaryLoading] = useState(false);
  const [sessionStrategy, setSessionStrategy] = useState<Strategy | null>(null);
  const [strategyInputs, setStrategyInputs] = useState<StrategyInputDeclaration[]>([]);
  const [strategyOrderTargets, setStrategyOrderTargets] = useState<StrategyOrderTargetDeclaration[]>([]);
  const [strategyContextError, setStrategyContextError] = useState<string | null>(null);

  // Snapshots and Reconciliation are independent paged lists. The Orders
  // section is delegated to the shared <OrderTree> component below — it owns
  // its own top-level intents pager and lazy child loaders.
  const snapshotsState = usePagedList<SnapshotEntry>(
    (offset, limit) => getSessionSnapshots(sessionId ?? "", { limit, offset }),
    [sessionId],
    snapshotsLoaded,
  );
  const runsState = usePagedList<ReconciliationRun>(
    (offset, limit) => getSessionReconciliation(sessionId ?? "", { limit, offset }),
    [sessionId],
    reconciliationLoaded,
  );

  // Session-wide reconciliation aggregate. Drives the headline tiles so they
  // reflect total / hard fail / soft fail across the entire session, not just
  // the current page of runs. Loaded once per session change; pager
  // navigation does NOT refetch it.
  const [reconciliationSummary, setReconciliationSummary] = useState<SessionReconciliationSummary | null>(null);

  const stableSessionId = sessionId ?? "";
  const visibleNavigationStartResult = session?.session_id === stableSessionId && (session.target_leverage_facts?.length ?? 0) > 0
    ? null
    : navigationStartResult;

  useEffect(() => {
    if (session?.session_id === stableSessionId && (session.target_leverage_facts?.length ?? 0) > 0) {
      setNavigationStartResult(null);
    }
  }, [session?.session_id, session?.target_leverage_facts, stableSessionId]);

  const loadReconciliationSummary = useCallback(() => {
    if (!stableSessionId) return;
    let cancelled = false;
    setReconciliationSummary(null);
    getSessionReconciliationSummary(stableSessionId)
      .then((s) => { if (!cancelled) setReconciliationSummary(s); })
      .catch(() => { if (!cancelled) setReconciliationSummary(null); });
    return () => { cancelled = true; };
  }, [stableSessionId]);

  useEffect(() => {
    return loadReconciliationSummary();
  }, [loadReconciliationSummary]);

  useEffect(() => {
    if (!stableSessionId) return;
    let cancelled = false;
    setPnlSummary(null);
    setPnlSummaryLoading(true);

    getSessionSnapshots(stableSessionId, { limit: 1, offset: 0 })
      .then(async (summaryFirstPage) => {
        const finalSnap = summaryFirstPage.items[0] ?? null;
        let initialSnap = finalSnap;
        if (summaryFirstPage.total > 1) {
          const summaryLastPage = await getSessionSnapshots(stableSessionId, {
            limit: 1,
            offset: Math.max(summaryFirstPage.total - 1, 0),
          });
          initialSnap = summaryLastPage.items[0] ?? finalSnap;
        }
        if (cancelled) return;
        const initialValue = initialSnap?.total_value ?? 0;
        const finalValue = finalSnap?.total_value ?? initialValue;
        setPnlSummary({
          initialValue,
          finalValue,
          pnl: finalValue - initialValue,
          upnl: snapshotUnrealizedPnl(finalSnap),
        });
      })
      .catch(() => { if (!cancelled) setPnlSummary(null); })
      .finally(() => { if (!cancelled) setPnlSummaryLoading(false); });

    return () => { cancelled = true; };
  }, [stableSessionId]);

  // Re-apply default tab state on navigation between sessions.
  useEffect(() => {
    setActiveTab("orders");
    setChartLoaded(false);
    setSnapshotsLoaded(false);
    setReconciliationLoaded(false);
    setLifecycleLoaded(false);
    setLifecycleEvents([]);
    setLifecycleCursor(0);
    setLifecycleHasMore(false);
    setLifecycleError(null);
    setStopFailureAcknowledged(false);
  }, [stableSessionId]);

  function changeAuditTab(tab: SessionDetailTab) {
    setActiveTab(tab);
    if (tab === "chart") setChartLoaded(true);
    if (tab === "snapshots") {
      if (snapshotsLoaded) {
        snapshotsState.reload();
      } else {
        setSnapshotsLoaded(true);
      }
    }
    if (tab === "reconciliation") {
      if (reconciliationLoaded) {
        runsState.reload();
      } else {
        setReconciliationLoaded(true);
      }
      void loadReconciliationSummary();
    }
    if (tab === "lifecycle") setLifecycleLoaded(true);
  }

  useEffect(() => {
    setStopFailureAcknowledged(false);
  }, [stableSessionId, session?.status, session?.error]);

  const loadLifecycleEvents = useCallback(async (reset = false) => {
    if (!stableSessionId || lifecycleLoading) return;
    const after = reset ? 0 : lifecycleCursor;
    setLifecycleLoading(true);
    setLifecycleError(null);
    try {
      const page = await getSessionLifecycleEvents(stableSessionId, {
        limit: PAGE_SIZE,
        after_event_id: after,
      });
      setLifecycleEvents((prev) => (reset ? page.items : [...prev, ...page.items]));
      setLifecycleCursor(page.next_event_id ?? after);
      setLifecycleHasMore(page.has_more);
    } catch (err) {
      setLifecycleError(err instanceof Error ? err.message : "Failed to load lifecycle events");
      if (reset) {
        setLifecycleEvents([]);
        setLifecycleCursor(0);
        setLifecycleHasMore(false);
      }
    } finally {
      setLifecycleLoading(false);
    }
  }, [stableSessionId, lifecycleCursor, lifecycleLoading]);

  useEffect(() => {
    if (!lifecycleLoaded) return;
    void loadLifecycleEvents(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifecycleLoaded, stableSessionId]);

  useEffect(() => {
    if (!stableSessionId) return;
    let cancelled = false;
    let timer: number | undefined;
    const capturedSessionID = stableSessionId;
    const schedule = (delayMs: number) => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void loadSession();
      }, delayMs);
    };
    async function loadSession(): Promise<void> {
      try {
        const item = await getSession(capturedSessionID);
        if (cancelled || capturedSessionID !== stableSessionId) return;
        setSession(item);
        if (shouldPollSessionRecord(item)) schedule(3000);
      } catch {
        if (!cancelled && capturedSessionID === stableSessionId) {
          schedule(3000);
        }
      }
    }
    void loadSession();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [stableSessionId]);

  useEffect(() => {
    const strategyID = session?.strategy_id ?? 0;
    if (strategyID <= 0) {
      setSessionStrategy(null);
      setStrategyInputs([]);
      setStrategyOrderTargets([]);
      setStrategyContextError(null);
      return;
    }
    let cancelled = false;
    setSessionStrategy(null);
    setStrategyInputs([]);
    setStrategyOrderTargets([]);
    setStrategyContextError(null);
    getStrategy(strategyID)
      .then((strategy) => {
        if (cancelled) return;
        setSessionStrategy(strategy);
        setStrategyInputs(extractStrategyInputs(strategy.code));
        setStrategyOrderTargets(extractStrategyOrderTargets(strategy.code));
      })
      .catch((err) => {
        if (cancelled) return;
        setSessionStrategy(null);
        setStrategyInputs([]);
        setStrategyOrderTargets([]);
        setStrategyContextError(err instanceof Error ? err.message : "Failed to load strategy context");
      });
    return () => { cancelled = true; };
  }, [session?.strategy_id]);

  useEffect(() => {
    const portfolioId = session?.portfolio_id;
    if (typeof portfolioId !== "number" || portfolioId <= 0) return;
    const resolvedPortfolioId: number = portfolioId;
    let cancelled = false;
    async function loadSessions() {
      try {
        const items = await listSessions(resolvedPortfolioId, 0, 100);
        if (!cancelled) setPortfolioSessions(items);
      } catch {
        if (!cancelled) setPortfolioSessions([]);
      }
    }
    void loadSessions();
    return () => { cancelled = true; };
  }, [session?.portfolio_id]);

  useEffect(() => {
    if (!stableSessionId || !session?.runtime_id) {
      setDeliveryHealth([]);
      return;
    }
    const terminal = isSessionTerminal(session);
    let cancelled = false;
    let timer: number | undefined;
    const runtimeID = session.runtime_id;
    async function loadDeliveryHealth(): Promise<void> {
      try {
        const result = await listSessionDeliveryHealth({
          session_id: stableSessionId,
          runtime_id: runtimeID,
        });
        if (!cancelled) setDeliveryHealth(result.items);
      } catch {
        if (!cancelled) setDeliveryHealth([]);
      } finally {
        if (!cancelled && !terminal) {
          timer = window.setTimeout(() => {
            timer = undefined;
            void loadDeliveryHealth();
          }, 5000);
        }
      }
    }
    void loadDeliveryHealth();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [stableSessionId, session?.runtime_id, session?.status]);

  if (!sessionId) return <p className="error">Missing session id</p>;

  async function handleStopSession() {
    setStopping(true);
    setStopError(null);
    setStopInfo(null);
    try {
      const result = await stopSessionResult(stableSessionId, "STOP_ACTION_STOP_ONLY");
      if (!result.stopped) {
        setStopInfo(result.status ? `Stop was not accepted. Current status: ${result.status}.` : "Session is not running or has already been stopped.");
        return;
      }
      setStopDialogOpen(false);
      setStopInfo(result.status ? `Session stop request accepted. Current status: ${result.status}.` : "Session stop request accepted. This is a soft stop only and does not close positions.");
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Failed to stop session");
    } finally {
      setStopping(false);
    }
  }

  async function handleStopAndCloseSession() {
    setStopping(true);
    setStopError(null);
    setStopInfo(null);
    try {
      const result = await stopSessionResult(stableSessionId, "STOP_ACTION_STOP_AND_CLOSE_POSITIONS");
      if (!result.stopped) {
        setStopInfo(result.status ? `Stop-and-close was not accepted. Current status: ${result.status}.` : "Session stop-and-close was not accepted.");
        return;
      }
      setStopDialogOpen(false);
      setStopInfo(result.status ? `Stop-and-close request accepted. Current status: ${result.status}.` : "Session stop-and-close request accepted. The portfolio is exiting to a flat state.");
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Failed to stop and close session");
    } finally {
      setStopping(false);
    }
  }

  async function handleFinishSession() {
    setFinishing(true);
    setStopError(null);
    setStopInfo(null);
    try {
      const finished = await finishSession(stableSessionId);
      if (!finished) {
        setStopInfo("Session is not running or could not be finished.");
        return;
      }
      setStopInfo("Session finish request accepted.");
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Failed to finish session");
    } finally {
      setFinishing(false);
    }
  }

  async function handleResumeWithNewSession() {
    if (resumeSubmissionInFlightRef.current) return;
    if (!session) return;
    if (!resumeRuntimeId) {
      setStopError("Select a runtime before resuming.");
      return;
    }
    if (resumeMaxLossClosePct === null) {
      setStopError("Enter a max loss close value from 0.01 to 100.");
      return;
    }
    if (!resumePreview.ready) {
      setStopError(resumePreview.error || "Resume preflight is not ready yet.");
      return;
    }
    const currentSession = session;
    setStopError(null);
    setStopInfo(null);
    resumeSubmissionInFlightRef.current = true;
    setResuming(true);
    setResumeStartResult(null);
    try {
      const resumed = await resumeWithNewSession(currentSession.portfolio_id, currentSession, resumeRuntimeId, resumeMaxLossClosePct);
      setResumeStartResult(resumed);
      if (!resumed.session_id) {
        const failure = resumed.failures?.[0];
        setStopError(`${resumed.code || failure?.code || "STRATEGY_RESUME_FAILED"}: ${failure?.reason || "Session did not resume. Review the per-target results below."}`);
        return;
      }
      setResumeDialogOpen(false);
      setResumeRuntimeId("");
      setResumeMaxLossClosePercent(String(DEFAULT_MAX_LOSS_CLOSE_PERCENT));
      navigate(id ? `/portfolios/${id}/sessions/${resumed.session_id}` : `/portfolios/${currentSession.portfolio_id}/sessions/${resumed.session_id}`, {
        state: strategyStartNavigationState(resumed),
      });
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Failed to resume session");
    } finally {
      resumeSubmissionInFlightRef.current = false;
      setResuming(false);
    }
  }

  const snapshots = snapshotsState.items;
  const runs = runsState.items;

  const pnlReady = pnlSummary !== null;
  const initialValue = pnlSummary?.initialValue ?? 0;
  const finalValue = pnlSummary?.finalValue ?? initialValue;
  const pnl = pnlSummary?.pnl ?? 0;
  const upnl = pnlSummary?.upnl ?? null;
  // Headline reconciliation tiles read from the session-wide summary, not
  // from the current page of runs (which would silently under-report on any
  // session larger than one page). ``null`` while the summary fetch is in
  // flight — render a placeholder rather than the page slice.
  const summaryReady = reconciliationSummary !== null;

  const initialLoading = pnlSummaryLoading && !pnlReady && !session;
  const stopFailureStatus = (session?.status || "").toLowerCase();
  const showStopFailureModal = stopFailureStatus === "stop_failed"
    && !stopFailureAcknowledged;
  const structuredFailures = sessionFailureDetails(session);

  return (
    <div>
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        <Link to={id ? `/portfolios/${id}` : "/portfolios"}>← Back to portfolio</Link>
      </p>

      <h2 className="section-title" style={{ marginTop: 0 }}>
        Session <span style={{ fontFamily: "monospace", fontWeight: 500 }}>{sessionId}</span>
      </h2>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 600 }}>Session control</div>
            <div className="muted" style={{ fontSize: "0.85rem" }}>
              {session ? (
                <>
                  Current status: <span className={badgeClass(session.status)}>{session.status}</span>
                  {sessionKindBadge(session)}
                  {session.runtime_id ? (
                    <>
                      {" · Runtime: "}
                      <Link to={`/runtimes/${encodeURIComponent(session.runtime_id)}`}>
                        {session.runtime_name || session.runtime_id}
                      </Link>
                      {" · "}
                      <Link to="/runtimes">Runtime Management</Link>
                    </>
                  ) : (
                    " · Runtime: unbound"
                  )}
                  {session.status === "recoverable" && session.error ? ` · ${session.error}` : ""}
                </>
              ) : (
                "Loading current session state…"
              )}
            </div>
          </div>
          {session?.error ? (
            <p className="error" style={{ flexBasis: "100%", margin: "0.5rem 0 0" }}>
              {session.error}
            </p>
          ) : null}
          {structuredFailures.length > 0 ? (
            <div className="error" style={{ flexBasis: "100%", display: "grid", gap: "0.35rem" }}>
              {structuredFailures.map((failure, index) => (
                <div key={`${failure.code || "SESSION_FAILURE"}-${index}`}>
                  <code>{failure.code || "SESSION_FAILURE"}</code>
                  {failure.message ? `: ${failure.message}` : ""}
                  <div className="muted" style={{ fontSize: "0.78rem" }}>
                    environment {failure.environment ?? session?.environment ?? "-"}
                    {` · source ${failure.source || "-"}`}
                    {` · retryable ${failure.retryable == null ? "-" : String(failure.retryable)}`}
                    {failure.filter_type ? ` · filter ${failure.filter_type}` : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {session?.status === "running" ? (
            <>
              <button
                type="button"
                onClick={() => void handleFinishSession()}
                disabled={finishing || stopping}
              >
                {finishing ? "Finishing…" : "Finish"}
              </button>
              <button
                type="button"
                onClick={() => setStopDialogOpen(true)}
                disabled={stopping || finishing}
              >
                Stop Session
              </button>
            </>
          ) : null}
          {session?.status === "stopping" ? (
            <button type="button" disabled>
              Stopping…
            </button>
          ) : null}
        </div>
        {session ? (
          <div
            style={{
              marginTop: "0.85rem",
              paddingTop: "0.85rem",
              borderTop: "1px solid #e2e8f0",
              display: "grid",
              gap: "0.7rem",
            }}
          >
            <div style={{ fontWeight: 600 }}>Session context</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "0.75rem",
                fontSize: "0.88rem",
              }}
            >
              <div>
                <div className="muted" style={{ fontSize: "0.78rem" }}>Strategy</div>
                <div>
                  {session.strategy_id > 0 ? (
                    <>
                      <Link to={`/strategies/${session.strategy_id}`}>
                        {sessionStrategy ? `${sessionStrategy.name} v${sessionStrategy.version}` : `#${session.strategy_id}`}
                      </Link>
                      {sessionStrategy ? (
                        <span className="muted"> #{session.strategy_id}</span>
                      ) : null}
                    </>
                  ) : (
                    "-"
                  )}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.78rem" }}>Input range</div>
                <div style={{ display: "grid", gap: "0.18rem", lineHeight: 1.35 }}>
                  <div>
                    <span className="muted" style={{ marginRight: "0.35rem" }}>Start</span>
                    {" "}
                    <span>{formatRangeEndpoint(session.start_time_ms)}</span>
                  </div>
                  <div>
                    <span className="muted" style={{ marginRight: "0.35rem" }}>End</span>
                    {" "}
                    <span>{formatRangeEndpoint(session.end_time_ms)}</span>
                  </div>
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.78rem" }}>Progress</div>
                <div>{session.bars_processed ?? 0} bars processed</div>
              </div>
            </div>

            <div>
              <div className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.25rem" }}>Market inputs</div>
              {strategyInputs.length > 0 ? (
                <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                  {strategyInputs.map((input) => (
                    <span
                      key={strategyStreamKey(input)}
                      className="status-badge status-badge--idle"
                      style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}
                    >
                      <code>{formatInputRoute(input)}</code>
                      <span className="muted">{formatInputMeta(input)}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <span className="muted">{strategyContextError ? "Unable to load declared inputs." : "No declared inputs found."}</span>
              )}
            </div>

            {strategyOrderTargets.length > 0 ? (
              <div>
                <div className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.25rem" }}>Order targets</div>
                <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
                  {strategyOrderTargets.map((target) => (
                    <span
                      key={strategyStreamKey({ ...target, interval: "order" })}
                      className="status-badge status-badge--idle"
                    >
                      {formatOrderTarget(target)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <SessionLeverageFacts session={session} />
            <ResumeLeverageApplyResult result={visibleNavigationStartResult} applying={false} />
            {strategyContextError ? (
              <p className="error" style={{ marginTop: 0, marginBottom: 0 }}>{strategyContextError}</p>
            ) : null}
          </div>
        ) : null}
        {stopError ? <p className="error" style={{ marginTop: "0.75rem", marginBottom: 0 }}>{stopError}</p> : null}
        {stopInfo ? <p className="muted" style={{ marginTop: "0.75rem", marginBottom: 0 }}>{stopInfo}</p> : null}
        {session && canResumeSession(session, portfolioSessions) ? (
          <div style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              onClick={() => {
                setStopError(null);
                setStopInfo(null);
                setResumeRuntimeId("");
                setResumeMaxLossClosePercent(String(DEFAULT_MAX_LOSS_CLOSE_PERCENT));
                setResumeStartResult(null);
                setResumeDialogOpen(true);
              }}
            >
              Resume With New Session
            </button>
          </div>
        ) : null}
      </div>

      {initialLoading ? <p className="muted">Loading session…</p> : null}

      {!initialLoading ? (
        <>
          {deliveryHealth.length > 0 ? (
            <div className="card" style={{ marginBottom: "1rem" }}>
              <h3 className="section-title" style={{ marginTop: 0 }}>Live Delivery</h3>
              <table className="compact">
                <thead>
                  <tr>
                    <th>Stream</th>
                    <th>Health</th>
                    <th>Last delivery</th>
                    <th>Kafka</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveryHealth.map((item) => (
                    <tr key={item.subscription.subscription_id}>
                      <td>
                        {item.subscription.key.exchange}/{item.subscription.key.market}/{item.subscription.key.symbol}/{item.subscription.key.interval}
                      </td>
                      <td>{item.health_status}</td>
                      <td>{item.lease?.last_delivery_at ? formatUTCWithLocal(item.lease.last_delivery_at) : "-"}</td>
                      <td>
                        {item.lease?.last_topic ? `${item.lease.last_topic}#${item.lease.last_partition ?? 0}@${item.lease.last_offset ?? 0}` : "-"}
                      </td>
                      <td>{item.blocked_reason || item.latest_failure?.reason || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* ── PnL Summary ── */}
          <div className="card">
            <div
              style={{
                display: "flex",
                gap: "2rem",
                flexWrap: "wrap",
              }}
            >
              <div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>Initial</div>
                <div style={{ fontWeight: 600, fontSize: "1.2rem" }}>
                  {pnlReady ? initialValue.toFixed(2) : "—"}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>Final</div>
                <div style={{ fontWeight: 600, fontSize: "1.2rem" }}>
                  {pnlReady ? finalValue.toFixed(2) : "—"}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>PnL</div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "1.2rem",
                    color: pnlReady ? (pnl >= 0 ? "#16a34a" : "#dc2626") : undefined,
                  }}
                >
                  {pnlReady ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}` : "—"}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>UPnL</div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "1.2rem",
                    color: pnlReady && upnl !== null ? (upnl >= 0 ? "#16a34a" : "#dc2626") : undefined,
                  }}
                >
                  {pnlReady ? formatSignedNumber(upnl) : "—"}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>Reconciliation</div>
                <div style={{ fontWeight: 600, fontSize: "1.2rem" }}>
                  {summaryReady ? reconciliationSummary!.total_runs : "—"}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>Hard fail</div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "1.2rem",
                    color: summaryReady
                      ? (reconciliationSummary!.hard_fail_runs === 0 ? "#16a34a" : "#dc2626")
                      : undefined,
                  }}
                >
                  {summaryReady ? reconciliationSummary!.hard_fail_runs : "—"}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>Soft fail</div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "1.2rem",
                    color: summaryReady
                      ? (reconciliationSummary!.soft_fail_runs === 0 ? "#16a34a" : "#d97706")
                      : undefined,
                  }}
                >
                  {summaryReady ? reconciliationSummary!.soft_fail_runs : "—"}
                </div>
              </div>
            </div>
          </div>

          <PageTabs
            tabs={sessionDetailTabs}
            activeTab={activeTab}
            onChange={changeAuditTab}
            ariaLabel="Session audit sections"
          >
            {activeTab === "chart" ? (
              chartLoaded && session ? (
                <SessionChartPanel session={session} inputs={strategyInputs} />
              ) : (
                <p className="muted">Loading chart…</p>
              )
            ) : null}

            {activeTab === "snapshots" ? (
              snapshotsLoaded ? (
                <div>
                  {snapshotsState.error ? (
                    <p className="error">{snapshotsState.error}</p>
                  ) : snapshots.length === 0 ? (
                    <p className="muted">No snapshots.</p>
                  ) : (
                    snapshots.map((snap, idx) => (
                      <div
                        key={`${snapshotsState.offset}-${idx}`}
                        style={{ borderBottom: "1px solid #f1f5f9", padding: "0.4rem 0" }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            cursor: "pointer",
                            fontSize: "0.9rem",
                            flexWrap: "wrap",
                            gap: "0.5rem",
                          }}
                          onClick={() => setExpandedSnap(expandedSnap === idx ? null : idx)}
                        >
                          <span>
                            <span className="muted">
                              {REASON_NAMES[snap.snapshot_reason] ?? `reason=${snap.snapshot_reason}`}
                            </span>
                            <span style={{ marginLeft: "0.75rem" }}>TV: {snap.total_value.toFixed(2)}</span>
                            <span style={{ marginLeft: "0.5rem" }}>WB: {snap.wallet_balance.toFixed(2)}</span>
                            <span style={{ marginLeft: "0.5rem" }}>UPnL: {formatSignedNumber(snapshotUnrealizedPnl(snap))}</span>
                          </span>
                          <span className="muted" style={{ fontSize: "0.85rem" }}>
                            {formatUTCWithLocal(snap.time)}
                          </span>
                        </div>
                        {expandedSnap === idx ? (
                          <div
                            style={{
                              fontSize: "0.8rem",
                              padding: "0.5rem",
                              background: "#f8fafc",
                              borderRadius: "4px",
                              marginTop: "0.4rem",
                              overflowX: "auto",
                            }}
                          >
                            <p style={{ fontWeight: 600, margin: "0 0 0.25rem" }}>Futures:</p>
                            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>
                              {snap.futures_json}
                            </pre>
                            <p style={{ fontWeight: 600, margin: "0.5rem 0 0.25rem" }}>Spot:</p>
                            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>
                              {snap.spot_json}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                  <Pager
                    offset={snapshotsState.offset}
                    count={snapshots.length}
                    total={snapshotsState.total}
                    pageSize={PAGE_SIZE}
                    loading={snapshotsState.loading}
                    onJump={snapshotsState.jump}
                  />
                </div>
              ) : (
                <p className="muted">Loading snapshots…</p>
              )
            ) : null}

            {activeTab === "reconciliation" ? (
              reconciliationLoaded ? (
                <div>
                  {runsState.error ? (
                    <p className="error">{runsState.error}</p>
                  ) : runs.length === 0 ? (
                    <p className="muted">No reconciliation runs.</p>
                  ) : (
                    runs.map((run, idx) => {
                      const counts = reconciliationRunCounts(run);
                      return (
                        <div
                          key={run.run_id || `${runsState.offset}-${idx}`}
                          style={{ borderBottom: "1px solid #f1f5f9", padding: "0.5rem 0" }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              cursor: "pointer",
                              fontSize: "0.9rem",
                              flexWrap: "wrap",
                              gap: "0.5rem",
                            }}
                            onClick={() => setExpandedRun(expandedRun === idx ? null : idx)}
                          >
                            <span style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                              <span className="status-badge status-badge--idle">{run.run_type || "unknown"}</span>
                              <span className="muted">
                                {REASON_NAMES[run.snapshot_reason] ?? `reason=${run.snapshot_reason}`}
                              </span>
                              <span style={{ color: run.hard_pass ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                                hard {run.hard_pass ? "pass" : "fail"}
                              </span>
                              <span style={{ color: run.soft_pass ? "#16a34a" : "#d97706", fontWeight: 600 }}>
                                soft {run.soft_pass ? "pass" : "fail"}
                              </span>
                              <span className="muted">
                                H {counts.hardFail} · S {counts.softFail} · A {counts.advisory}
                              </span>
                            </span>
                            <span className="muted" style={{ fontSize: "0.85rem" }}>
                              {formatUTCWithLocal(run.time)}
                            </span>
                          </div>
                          {expandedRun === idx ? (
                            <div
                              style={{
                                fontSize: "0.8rem",
                                padding: "0.75rem",
                                background: "#f8fafc",
                                borderRadius: "4px",
                                marginTop: "0.4rem",
                                overflowX: "auto",
                              }}
                            >
                              <p style={{ margin: "0 0 0.5rem" }}>
                                <strong>Run ID:</strong> <span style={{ fontFamily: "monospace" }}>{run.run_id}</span>
                              </p>
                              <VenueDiffSections raw={run.venue_diffs_json || "[]"} />
                              <p style={{ fontWeight: 600, margin: "0.75rem 0 0.25rem" }}>Local snapshot:</p>
                              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>
                                {prettyJSON(run.local_snapshot_json)}
                              </pre>
                              <p style={{ fontWeight: 600, margin: "0.75rem 0 0.25rem" }}>Exchange snapshot:</p>
                              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>
                                {prettyJSON(run.exchange_snapshot_json)}
                              </pre>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                  <Pager
                    offset={runsState.offset}
                    count={runs.length}
                    total={runsState.total}
                    pageSize={PAGE_SIZE}
                    loading={runsState.loading}
                    onJump={runsState.jump}
                  />
                </div>
              ) : (
                <p className="muted">Loading reconciliation runs…</p>
              )
            ) : null}

            {activeTab === "orders" ? (
              <OrderTree
                fetchIntents={async (offset, limit) => {
                  const page = await getSessionIntents(stableSessionId, { limit, offset });
                  return { ...page, items: page.items.map(withExactIntentDecimals) };
                }}
                fetchAttempts={async (intentId, offset, limit) => {
                  const page = await getSessionAttempts(stableSessionId, { limit, offset, intent_id: intentId });
                  return { ...page, items: page.items.map(withExactAttemptDecimals) };
                }}
                fetchOrder={async (attemptId, offset, limit) => {
                  const page = await getSessionOrders(stableSessionId, { limit, offset, attempt_id: attemptId });
                  return { ...page, items: page.items.map(withExactOrderDecimals) };
                }}
                fetchFills={async (orderId, offset, limit) => {
                  const page = await getSessionFills(stableSessionId, { limit, offset, order_id: orderId });
                  return { ...page, items: page.items.map(withExactFillDecimals) };
                }}
                resetKey={stableSessionId}
              />
            ) : null}

            {activeTab === "lifecycle" ? (
              lifecycleLoaded ? (
                <div>
                  {lifecycleError ? <p className="error">{lifecycleError}</p> : null}
                  {lifecycleEvents.length === 0 && !lifecycleLoading && !lifecycleError ? (
                    <p className="muted">No lifecycle events.</p>
                  ) : null}
                  {lifecycleEvents.length > 0 ? (
                    <div className="table-scroll">
                      <table className="compact" style={{ width: "100%", minWidth: "980px" }}>
                        <thead>
                          <tr>
                            <th>Event</th>
                            <th>Order</th>
                            <th>Route</th>
                            <th>Fill</th>
                            <th>State</th>
                            <th>Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lifecycleEvents.map((event) => (
                            <tr key={event.event_id}>
                              <td>
                                <strong>{event.event_type || "-"}</strong>
                                <div className="muted">#{event.event_id} · {event.order_status || "-"}</div>
                              </td>
                              <td>
                                <code>{event.order_id || event.exchange_order_id || "-"}</code>
                                <div className="muted">
                                  {event.intent_id ? `intent ${event.intent_id}` : "intent -"}
                                  {event.attempt_id ? ` · attempt ${event.attempt_id}` : ""}
                                </div>
                              </td>
                              <td>
                                {event.exchange_label || event.exchange} · {event.market_label || event.market}
                                <div className="muted">
                                  venue {event.venue_id || "-"} · {event.position_side || "-"} · {event.side || "-"}
                                </div>
                              </td>
                              <td>
                                {event.fill_delta ? (
                                  <>
                                    {event.fill_delta.symbol} {exactDecimalText(event.fill_delta.qty_decimal)}
                                    <div className="muted">
                                      px {exactDecimalText(event.fill_delta.fill_price_decimal)}
                                      {" · "}quote {exactDecimalText(event.fill_delta.quote_qty_decimal)}
                                      {" · "}fee {exactDecimalText(event.fill_delta.fee_decimal)} {event.fill_delta.fee_asset || "-"}
                                    </div>
                                  </>
                                ) : "-"}
                              </td>
                              <td>
                                {event.order_state ? (
                                  <>
                                    {event.order_state.status || "-"}
                                    <div className="muted">
                                      filled {exactDecimalText(event.order_state.executed_qty_decimal)}
                                      {" / "}{exactDecimalText(event.order_state.orig_qty_decimal)}
                                      {" · "}remain {exactDecimalText(event.order_state.remaining_qty_decimal)}
                                      {" · "}avg {exactDecimalText(event.order_state.avg_price_decimal)}
                                      {" · "}price {exactDecimalText(event.order_state.price_decimal)}
                                    </div>
                                  </>
                                ) : "-"}
                              </td>
                              <td>{event.occurred_at ? formatUTCWithLocal(event.occurred_at) : "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => { void loadLifecycleEvents(true); }}
                      disabled={lifecycleLoading}
                    >
                      Refresh events
                    </button>
                    {lifecycleHasMore ? (
                      <button
                        type="button"
                        onClick={() => { void loadLifecycleEvents(false); }}
                        disabled={lifecycleLoading}
                      >
                        Load more
                      </button>
                    ) : null}
                    {lifecycleLoading ? <span className="muted">Loading…</span> : null}
                  </div>
                </div>
              ) : (
                <p className="muted">Loading lifecycle events…</p>
              )
            ) : null}
          </PageTabs>
        </>
      ) : null}
      {showStopFailureModal ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="stop-failed-title">
            <h3 id="stop-failed-title" style={{ marginTop: 0, marginBottom: "0.5rem" }}>
              Manual exchange check required
            </h3>
            <p className="muted" style={{ marginTop: 0 }}>
              The platform could not fully stop this session. Check the related exchange venue manually before continuing.
            </p>
            <p style={{ marginTop: "0.75rem" }}>
              Status: <span className={badgeClass(session?.status || "")}>{session?.status}</span>
            </p>
            {session?.error ? <p className="error">{session.error}</p> : null}
            <div className="dialog-action-list dialog-action-list--inline">
              <button type="button" className="danger" onClick={() => setStopFailureAcknowledged(true)} autoFocus>
                I have checked the exchange state
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <StopSessionDialog
        open={stopDialogOpen}
        sessionId={stableSessionId}
        busy={stopping}
        error={stopError}
        declaredTargets={strategyOrderTargets}
        stopAndCloseDisabled={Boolean(session?.strategy_id) && !sessionStrategy}
        stopAndCloseDisabledReason={Boolean(session?.strategy_id) && !sessionStrategy
          ? strategyContextError
            ? "Stop-and-close is unavailable because the strategy declarations could not be verified. Stop-only remains available."
            : "Loading declared order targets before stop-and-close can be selected."
          : null}
        onCancel={() => {
          if (stopping) return;
          setStopDialogOpen(false);
          setStopError(null);
        }}
        onStopOnly={() => { void handleStopSession(); }}
        onStopAndClose={() => { void handleStopAndCloseSession(); }}
      />
      <RuntimeSelectionDialog
        open={resumeDialogOpen}
        title="Resume With New Session"
        description={session ? <>Session <code>{session.session_id}</code></> : null}
        runtimeId={resumeRuntimeId}
        runtimeLabel={session?.environment === 0 ? "Backtest runtime" : "Executor runtime"}
        environment={session?.environment}
        role={runtimeRoleForSessionEnvironment(session?.environment)}
        busy={resuming}
        error={stopError}
        confirmLabel="Resume"
        confirmDisabled={resumeMaxLossClosePct === null || !resumeRuntimeId || !resumePreview.ready}
        onRuntimeChange={setResumeRuntimeId}
        onCancel={() => {
          if (resuming) return;
          setResumeDialogOpen(false);
          setResumeRuntimeId("");
          setResumeMaxLossClosePercent(String(DEFAULT_MAX_LOSS_CLOSE_PERCENT));
          setResumeStartResult(null);
          setStopError(null);
        }}
        onConfirm={() => { void handleResumeWithNewSession(); }}
      >
        <div style={{ marginTop: "0.85rem", display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
          <label style={{ display: "grid", gap: "0.35rem", fontSize: "0.88rem", fontWeight: 600 }}>
            <span>Max loss close (%)</span>
            <input
              type="number"
              min="0.01"
              max="100"
              step="any"
              value={resumeMaxLossClosePercent}
              onChange={(event) => setResumeMaxLossClosePercent(event.target.value)}
              disabled={resuming}
              style={{ maxWidth: "10rem" }}
            />
            {resumeMaxLossClosePct === null ? (
              <span className="error" style={{ fontSize: "0.82rem" }}>
                Enter a value from 0.01 to 100.
              </span>
            ) : null}
          </label>
        </div>
        <ResumeStrategyPreview
          preview={resumePreview.preview}
          loading={resumePreview.loading}
          error={resumePreview.error}
        />
        <ResumeLeverageApplyResult result={resumeStartResult} applying={resuming} />
      </RuntimeSelectionDialog>
    </div>
  );
}

function prettyJSON(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function VenueDiffSections({ raw }: { raw: string }) {
  const venues = parseVenueDiffs(raw);
  if (venues.length === 0) {
    return (
      <>
        <p style={{ fontWeight: 600, margin: "0.75rem 0 0.25rem" }}>Venue-scoped diffs:</p>
        <p className="muted" style={{ margin: 0 }}>None.</p>
      </>
    );
  }

  return (
    <>
      <p style={{ fontWeight: 600, margin: "0.75rem 0 0.25rem" }}>Venue-scoped diffs:</p>
      <div style={{ display: "grid", gap: "0.75rem" }}>
        {venues.map((venue, idx) => (
          <div
            key={`${venue.venue_id ?? "unknown"}-${idx}`}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: "4px",
              padding: "0.65rem",
              background: "#fff",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "0.75rem",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <strong>{venueScopeLabel(venue)}</strong>
              <span style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <span style={{ color: venue.hard_pass === false ? "#dc2626" : "#16a34a", fontWeight: 600 }}>
                  hard {venue.hard_pass === false ? "fail" : "pass"}
                </span>
                <span style={{ color: venue.soft_pass === false ? "#d97706" : "#16a34a", fontWeight: 600 }}>
                  soft {venue.soft_pass === false ? "fail" : "pass"}
                </span>
              </span>
            </div>
            <DiffTable title="Hard + Soft Diffs" diffs={venue.field_diffs ?? []} />
            <DiffTable title="Advisory Diffs" diffs={venue.advisory_diffs ?? []} />
          </div>
        ))}
      </div>
    </>
  );
}

function DiffTable({ title, diffs }: { title: string; diffs: ReconciliationFieldDiff[] }) {
  if (diffs.length === 0) {
    return (
      <>
        <p style={{ fontWeight: 600, margin: "0.75rem 0 0.25rem" }}>{title}:</p>
        <p className="muted" style={{ margin: 0 }}>None.</p>
      </>
    );
  }
  return (
    <>
      <p style={{ fontWeight: 600, margin: "0.75rem 0 0.25rem" }}>{title}:</p>
      <div className="table-scroll">
        <table className="compact" style={{ width: "100%", minWidth: "760px" }}>
          <thead>
            <tr>
              <th>Field</th>
              <th>Severity</th>
              <th>Exchange</th>
              <th>Local</th>
              <th>Diff</th>
              <th>Ratio</th>
              <th>Pass?</th>
            </tr>
          </thead>
          <tbody>
            {diffs.map((d) => (
              <tr key={`${d.field}-${d.severity}`}>
                <td>{d.field}</td>
                <td>{d.severity}</td>
                <td>{d.exchange.toFixed(6)}</td>
                <td>{d.local.toFixed(6)}</td>
                <td style={{ color: d.passed ? undefined : "#dc2626" }}>
                  {d.diff_abs.toFixed(6)}
                </td>
                <td>{d.diff_ratio.toFixed(6)}</td>
                <td style={{ color: d.passed ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                  {d.passed ? "✓" : "✗"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
