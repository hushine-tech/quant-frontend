import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { formatUTCWithLocal } from "@/utils/time";
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
  listSessionDeliveryHealth,
  activateStrategy,
  deactivateStrategy,
  finishSession,
  listAccountStrategies,
  listSessions,
  mountStrategy,
  runStrategy,
  stopSessionResult,
  unmountStrategy,
  isSessionTerminal,
  runtimeRoleForSessionEnvironment,
  type Session,
  type SessionReconciliationSummary,
  type SnapshotEntry,
  type ReconciliationRun,
  type ReconciliationFieldDiff,
  type SessionDeliveryHealth,
  type OrderLifecycleEvent,
} from "@/api/client";
import StopSessionDialog from "@/components/StopSessionDialog";
import OrderTree from "@/components/OrderTree";
import Pager from "@/components/Pager";
import RuntimeSelectionDialog from "@/components/RuntimeSelectionDialog";
import PageTabs, { type PageTab } from "@/components/PageTabs";

async function resumeWithNewSession(accountId: number, session: Session, runtimeId: string): Promise<{ session_id: string }> {
  const entries = await listAccountStrategies(accountId);
  const currentActiveId = entries.find((entry) => entry.active)?.strategy.strategy_id ?? null;
  const targetStrategyId = session.strategy_id;
  if (!targetStrategyId || targetStrategyId <= 0) {
    throw new Error("Cannot resume session: original strategy is missing");
  }
  const targetEntry = entries.find((entry) => entry.strategy.strategy_id === targetStrategyId) ?? null;
  const changedActive = currentActiveId !== targetStrategyId;
  let mountedForResume = false;

  try {
    if (!targetEntry) {
      await mountStrategy(accountId, targetStrategyId);
      mountedForResume = true;
    }
    if (changedActive || !targetEntry?.active) {
      await activateStrategy(accountId, targetStrategyId);
    }
    return await runStrategy(accountId, {
      strategy_path: "",
      interval: session.interval || "1m",
      start_time_ms: session.start_time_ms,
      end_time_ms: session.end_time_ms,
      runtime_id: runtimeId,
    });
  } catch (err) {
    if (changedActive) {
      try {
        if (currentActiveId !== null) {
          await activateStrategy(accountId, currentActiveId);
        } else {
          await deactivateStrategy(accountId, targetStrategyId);
        }
        if (mountedForResume) {
          await unmountStrategy(accountId, targetStrategyId);
        }
      } catch {
        // Best-effort rollback only; preserve original error.
      }
    } else if (mountedForResume) {
      try {
        await unmountStrategy(accountId, targetStrategyId);
      } catch {
        // Best-effort rollback only; preserve original error.
      }
    }
    throw err;
  }
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

type SessionDetailTab = "snapshots" | "reconciliation" | "orders" | "lifecycle";

const sessionDetailTabs: Array<PageTab<SessionDetailTab>> = [
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
    && other.account_id === session.account_id
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

  // Reset offset when the session / account changes. We intentionally do NOT
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
    case "completed":
    case "finished": return "status-badge status-badge--completed";
    case "failed": return "status-badge status-badge--failed";
    case "recoverable": return "status-badge status-badge--recoverable";
    case "stop_failed": return "status-badge status-badge--stop-failed";
    case "stopping_failed": return "status-badge status-badge--stop-failed";
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

export default function SessionDetailPage() {
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const navigate = useNavigate();
  const [expandedSnap, setExpandedSnap] = useState<number | null>(null);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);
  const [stopInfo, setStopInfo] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [accountSessions, setAccountSessions] = useState<Session[]>([]);
  const [deliveryHealth, setDeliveryHealth] = useState<SessionDeliveryHealth[]>([]);
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false);
  const [resumeRuntimeId, setResumeRuntimeId] = useState("");
  const [resuming, setResuming] = useState(false);

  // Tab loaded state is sticky once a tab has been opened. Snapshots and
  // reconciliation stay lazy so a session page does not fan out every audit
  // query before the user asks for it. Orders are the default tab.
  const [activeTab, setActiveTab] = useState<SessionDetailTab>("orders");
  const [snapshotsLoaded, setSnapshotsLoaded] = useState(false);
  const [reconciliationLoaded, setReconciliationLoaded] = useState(false);
  const [lifecycleLoaded, setLifecycleLoaded] = useState(false);
  const [lifecycleEvents, setLifecycleEvents] = useState<OrderLifecycleEvent[]>([]);
  const [lifecycleCursor, setLifecycleCursor] = useState(0);
  const [lifecycleHasMore, setLifecycleHasMore] = useState(false);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [stopFailureAcknowledged, setStopFailureAcknowledged] = useState(false);

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

  useEffect(() => {
    if (!stableSessionId) return;
    let cancelled = false;
    setReconciliationSummary(null);
    getSessionReconciliationSummary(stableSessionId)
      .then((s) => { if (!cancelled) setReconciliationSummary(s); })
      .catch(() => { if (!cancelled) setReconciliationSummary(null); });
    return () => { cancelled = true; };
  }, [stableSessionId]);

  // Re-apply default tab state on navigation between sessions.
  useEffect(() => {
    setActiveTab("orders");
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
    if (tab === "snapshots") setSnapshotsLoaded(true);
    if (tab === "reconciliation") setReconciliationLoaded(true);
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
    async function loadSession() {
      try {
        const item = await getSession(stableSessionId);
        if (!cancelled) {
          setSession(item);
          if (isSessionTerminal(item) && timer !== undefined) {
            window.clearInterval(timer);
            timer = undefined;
          }
        }
      } catch {
        if (!cancelled) setSession(null);
      }
    }
    void loadSession();
    timer = window.setInterval(() => { void loadSession(); }, 3000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [stableSessionId]);

  useEffect(() => {
    const accountId = session?.account_id;
    if (typeof accountId !== "number" || accountId <= 0) return;
    const resolvedAccountId: number = accountId;
    let cancelled = false;
    async function loadSessions() {
      try {
        const items = await listSessions(resolvedAccountId, 0, 100);
        if (!cancelled) setAccountSessions(items);
      } catch {
        if (!cancelled) setAccountSessions([]);
      }
    }
    void loadSessions();
    return () => { cancelled = true; };
  }, [session?.account_id]);

  useEffect(() => {
    if (!stableSessionId || !session?.runtime_id) {
      setDeliveryHealth([]);
      return;
    }
    const terminal = isSessionTerminal(session);
    let cancelled = false;
    async function loadDeliveryHealth() {
      try {
        const result = await listSessionDeliveryHealth({
          session_id: stableSessionId,
          runtime_id: session?.runtime_id,
        });
        if (!cancelled) setDeliveryHealth(result.items);
      } catch {
        if (!cancelled) setDeliveryHealth([]);
      }
    }
    void loadDeliveryHealth();
    if (terminal) {
      return () => { cancelled = true; };
    }
    const timer = window.setInterval(() => { void loadDeliveryHealth(); }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
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
      setStopInfo(result.status ? `Stop-and-close request accepted. Current status: ${result.status}.` : "Session stop-and-close request accepted. The account is exiting to a flat state.");
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
    if (!session) return;
    if (!resumeRuntimeId) {
      setStopError("Select a runtime before resuming.");
      return;
    }
    const currentSession = session;
    setStopError(null);
    setStopInfo(null);
    setResuming(true);
    try {
      const resumed = await resumeWithNewSession(currentSession.account_id, currentSession, resumeRuntimeId);
      setResumeDialogOpen(false);
      setResumeRuntimeId("");
      navigate(id ? `/accounts/${id}/sessions/${resumed.session_id}` : `/accounts/${currentSession.account_id}/sessions/${resumed.session_id}`);
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Failed to resume session");
    } finally {
      setResuming(false);
    }
  }

  const snapshots = snapshotsState.items;
  const runs = runsState.items;

  // PnL summary uses the CURRENT snapshots page. Because snapshots are
  // ordered newest-first and paginated 20/page, a long session's
  // strategy_start snapshot may live on a later page. We still try to find
  // strategy_start / strategy_end on the current page and fall back to
  // first/last in the page — but surface a hint when the session ran long.
  const startSnap = snapshots.find((s) => s.snapshot_reason === 2) ?? snapshots[snapshots.length - 1];
  const endSnap = snapshots.find((s) => s.snapshot_reason === 3) ?? snapshots[0];
  const initialValue = startSnap?.total_value ?? 0;
  const finalValue = endSnap?.total_value ?? initialValue;
  const pnl = finalValue - initialValue;
  const pnlIsApproximate = snapshotsState.hasMore || snapshotsState.offset > 0;
  // Headline reconciliation tiles read from the session-wide summary, not
  // from the current page of runs (which would silently under-report on any
  // session larger than one page). ``null`` while the summary fetch is in
  // flight — render a placeholder rather than the page slice.
  const summaryReady = reconciliationSummary !== null;

  const initialLoading = snapshotsState.loading && runsState.loading
    && snapshots.length === 0 && runs.length === 0;
  const stopFailureStatus = (session?.status || "").toLowerCase();
  const showStopFailureModal = (stopFailureStatus === "stop_failed" || stopFailureStatus === "stopping_failed")
    && !stopFailureAcknowledged;

  return (
    <div>
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        <Link to={id ? `/accounts/${id}` : "/accounts"}>← Back to account</Link>
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
        {stopError ? <p className="error" style={{ marginTop: "0.75rem", marginBottom: 0 }}>{stopError}</p> : null}
        {stopInfo ? <p className="muted" style={{ marginTop: "0.75rem", marginBottom: 0 }}>{stopInfo}</p> : null}
        {session && canResumeSession(session, accountSessions) ? (
          <div style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              onClick={() => {
                setStopError(null);
                setStopInfo(null);
                setResumeRuntimeId("");
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
                <div style={{ fontWeight: 600, fontSize: "1.2rem" }}>{initialValue.toFixed(2)}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>Final</div>
                <div style={{ fontWeight: 600, fontSize: "1.2rem" }}>{finalValue.toFixed(2)}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>PnL</div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "1.2rem",
                    color: pnl >= 0 ? "#16a34a" : "#dc2626",
                  }}
                >
                  {pnl >= 0 ? "+" : ""}
                  {pnl.toFixed(2)}
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
            {pnlIsApproximate ? (
              <p
                className="muted"
                style={{ fontSize: "0.78rem", marginTop: "0.75rem", marginBottom: 0 }}
              >
                PnL is derived from the currently-visible snapshots page. For long-running sessions
                the strategy_start / strategy_end markers may live on an earlier page — browse the
                Snapshots pager to confirm.
              </p>
            ) : null}
          </div>

          <PageTabs
            tabs={sessionDetailTabs}
            activeTab={activeTab}
            onChange={changeAuditTab}
            ariaLabel="Session audit sections"
          >
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
                    runs.map((run, idx) => (
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
                              H {run.hard_fail_count} · S {run.soft_fail_count} · A {run.advisory_count}
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
                            <DiffTable title="Hard + Soft Diffs" diffs={run.field_diffs} />
                            <DiffTable title="Advisory Diffs" diffs={run.advisory_diffs} />
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
                    ))
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
                fetchIntents={(offset, limit) => getSessionIntents(stableSessionId, { limit, offset })}
                fetchAttempts={(intentId, offset, limit) =>
                  getSessionAttempts(stableSessionId, { limit, offset, intent_id: intentId })
                }
                fetchOrder={(attemptId, offset, limit) =>
                  getSessionOrders(stableSessionId, { limit, offset, attempt_id: attemptId })
                }
                fetchFills={(orderId, offset, limit) =>
                  getSessionFills(stableSessionId, { limit, offset, order_id: orderId })
                }
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
                                    {event.fill_delta.symbol} {event.fill_delta.qty}
                                    <div className="muted">
                                      px {event.fill_delta.fill_price} · fee {event.fill_delta.fee} {event.fill_delta.fee_asset || ""}
                                    </div>
                                  </>
                                ) : "-"}
                              </td>
                              <td>
                                {event.order_state ? (
                                  <>
                                    {event.order_state.status || "-"}
                                    <div className="muted">
                                      filled {event.order_state.executed_qty} / {event.order_state.orig_qty}
                                      {" · "}remain {event.order_state.remaining_qty}
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
        onRuntimeChange={setResumeRuntimeId}
        onCancel={() => {
          if (resuming) return;
          setResumeDialogOpen(false);
          setResumeRuntimeId("");
          setStopError(null);
        }}
        onConfirm={() => { void handleResumeWithNewSession(); }}
      />
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
