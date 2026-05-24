import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { formatUTCWithLocal } from "@/utils/time";
import PageHeader from "@/components/PageHeader";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import InfiniteTable from "@/components/InfiniteTable";
import RuntimeInstallInstructions from "@/components/RuntimeInstallInstructions";
import { FilterField, FilterPanel } from "@/components/FilterControls";
import { RuntimeCredentialsPanel } from "@/pages/RuntimeCredentials";
import {
  cancelRuntime,
  ensureHostedRuntime,
  getRuntime,
  listAccountsPage,
  prepareDebugWorkspace,
  isRuntimeTerminal,
  listSessionDeliveryHealth,
  listRuntimeAdmissionFailures,
  listRuntimes,
  listSessionsPage,
  runtimeUnavailableReason,
  type Account,
  type Runtime,
  type RuntimeAdmissionFailure,
  type Session,
  type SessionDeliveryHealth,
} from "@/api/client";

function fmtTime(value?: string): string {
  return value ? formatUTCWithLocal(value) : "-";
}

function sourceLabel(source: string): string {
  return source === "self_hosted" ? "self-hosted" : source || "-";
}

function roleLabel(role?: string): string {
  return role || "-";
}

function runtimeBadgeClass(rt: Runtime): string {
  return runtimeUnavailableReason(rt)
    ? "status-badge status-badge--stopped"
    : "status-badge status-badge--completed";
}

function healthLabel(rt: Runtime): string {
  return runtimeUnavailableReason(rt) || "routeable";
}

function cleanupLabel(rt: Runtime): string {
  if (rt.cleanup_status === "failed") {
    return rt.cleanup_reason ? `Cleanup failed: ${rt.cleanup_reason}` : "Cleanup failed";
  }
  if (rt.cleanup_status === "succeeded") {
    return rt.cleanup_at ? `Platform cleanup succeeded at ${fmtTime(rt.cleanup_at)}` : "Platform cleanup succeeded";
  }
  if (rt.cleanup_status === "user_owned") {
    return rt.cleanup_reason || "User-owned container may still exist on its Docker host.";
  }
  const source = (rt.source || "").toLowerCase();
  if (source === "self_hosted") {
    if (isRuntimeTerminal(rt)) {
      return "User-owned container may still exist on its Docker host.";
    }
    return "User-owned container; control-panel only owns the channel.";
  }
  if (isRuntimeTerminal(rt)) {
    return "Platform-owned container cleanup is handled by control-panel.";
  }
  return "Platform-owned container.";
}

function isActiveSessionStatus(status: string): boolean {
  return status === "running" || status === "stopping";
}

type RuntimeManagementTab = "runtimes" | "create" | "credentials" | "failures";

const runtimeTabs: Array<PageTab<RuntimeManagementTab>> = [
  { id: "runtimes", label: "All Runtimes" },
  { id: "create", label: "Create Runtime" },
  { id: "credentials", label: "Credentials" },
  { id: "failures", label: "Failure Overview" },
];

type RuntimeDetailTab = "overview" | "connection" | "debugging" | "sessions" | "live_delivery";

const runtimeDetailTabs: Array<PageTab<RuntimeDetailTab>> = [
  { id: "overview", label: "Overview" },
  { id: "connection", label: "Connection" },
  { id: "debugging", label: "Debugging" },
  { id: "sessions", label: "Sessions" },
  { id: "live_delivery", label: "Live Delivery" },
];

function normalizeRuntimeTab(value: string | null): RuntimeManagementTab {
  if (value === "create") return "create";
  if (value === "credentials") return "credentials";
  if (value === "failures") return "failures";
  return "runtimes";
}

export default function RuntimeManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [admissionFailures, setAdmissionFailures] = useState<RuntimeAdmissionFailure[]>([]);
  const [activeSessionCounts, setActiveSessionCounts] = useState<Map<string, number>>(new Map());
  const [activeSessionLinks, setActiveSessionLinks] = useState<Map<string, Session>>(new Map());
  const [activeTab, setActiveTab] = useState<RuntimeManagementTab>(() => normalizeRuntimeTab(searchParams.get("tab")));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [stoppingRuntimeId, setStoppingRuntimeId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [resourceProfile, setResourceProfile] = useState("small");
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const failureResult = await listRuntimeAdmissionFailures(5).catch(() => ({ failures: [] }));
      setAdmissionFailures(failureResult.failures);
      try {
        const sessionPage = await listSessionsPage({ status: "running", limit: 200, offset: 0 }).catch(() => ({ items: [], next_offset: 0, has_more: false, total: 0 }));
        const stoppingPage = await listSessionsPage({ status: "stopping", limit: 200, offset: 0 }).catch(() => ({ items: [], next_offset: 0, has_more: false, total: 0 }));
        const allSessions = [...sessionPage.items, ...stoppingPage.items];
        const counts = new Map<string, number>();
        const activeLinks = new Map<string, Session>();
        for (const session of allSessions) {
          if (!session.runtime_id) continue;
          if (!isActiveSessionStatus(session.status)) continue;
          counts.set(session.runtime_id, (counts.get(session.runtime_id) || 0) + 1);
          if (!activeLinks.has(session.runtime_id)) {
            activeLinks.set(session.runtime_id, session);
          }
        }
        setActiveSessionCounts(counts);
        setActiveSessionLinks(activeLinks);
      } catch {
        setActiveSessionCounts(new Map());
        setActiveSessionLinks(new Map());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load runtimes failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setActiveTab(normalizeRuntimeTab(searchParams.get("tab")));
  }, [searchParams]);

  function changeTab(tab: RuntimeManagementTab) {
    setActiveTab(tab);
    setSearchParams(tab === "runtimes" ? {} : { tab });
  }

  async function createHosted() {
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await ensureHostedRuntime({
        name: name.trim() || undefined,
        resource_profile: resourceProfile,
      });
      setNotice(result.provisioned ? "Hosted runtime created." : "Hosted runtime is already available.");
      setRefreshKey((v) => v + 1);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create hosted runtime failed");
    } finally {
      setCreating(false);
    }
  }

  async function stopRuntime(rt: Runtime) {
    if (isRuntimeTerminal(rt)) return;
    const ok = window.confirm(`End runtime ${rt.name || rt.runtime_id}?`);
    if (!ok) return;
    setStoppingRuntimeId(rt.runtime_id);
    setError(null);
    setNotice(null);
    try {
      const stopped = await cancelRuntime(rt.runtime_id);
      setNotice("Runtime ended.");
      void stopped;
      setRefreshKey((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "End runtime failed");
    } finally {
      setStoppingRuntimeId(null);
    }
  }

  const loadRuntimePage = useCallback(async (offset: number, limit: number) => {
    setLoading(true);
    try {
      const result = await listRuntimes({ limit, offset });
      return {
        items: result.runtimes,
        next_offset: offset + result.runtimes.length,
        has_more: result.has_more,
        total: result.total,
      };
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div>
      <PageHeader
        title="Runtime Management"
        description="Manage hosted and self-hosted runtimes for strategy execution and debugging."
        loading={loading}
        onRefresh={() => {
          setRefreshKey((v) => v + 1);
          void load();
        }}
      />

      {notice ? <p className="muted">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Loading runtimes...</p> : null}

      <PageTabs tabs={runtimeTabs} activeTab={activeTab} onChange={changeTab} ariaLabel="Runtime management sections">
        {activeTab === "runtimes" ? (
          <InfiniteTable<Runtime>
            columns={["Name", "Source", "Role", "Status", "Health", "Active sessions", "Started", "Ended", "End reason", "Cleanup", "Heartbeat", "Runtime ID", "Action"]}
            loadPage={loadRuntimePage}
            refreshKey={refreshKey}
            emptyText="No runtimes found."
            className="runtime-table"
            rowKey={(rt) => rt.runtime_id}
            renderRow={(rt) => {
              const activeCount = activeSessionCounts.get(rt.runtime_id) || 0;
              const activeSession = activeSessionLinks.get(rt.runtime_id);
              return (
                <>
                  <td><Link to={`/runtimes/${encodeURIComponent(rt.runtime_id)}`}>{rt.name || rt.runtime_id}</Link></td>
                  <td>{sourceLabel(rt.source)}</td>
                  <td>{roleLabel(rt.role)}</td>
                  <td><span className={runtimeBadgeClass(rt)}>{rt.status || "unknown"}</span></td>
                  <td>{healthLabel(rt)}</td>
                  <td>
                    {activeCount > 0 ? (
                      activeSession ? (
                        <Link to={`/accounts/${activeSession.account_id}/sessions/${activeSession.session_id}`}>{activeCount}</Link>
                      ) : (
                        <Link to={`/runtimes/${encodeURIComponent(rt.runtime_id)}`}>{activeCount}</Link>
                      )
                    ) : 0}
                  </td>
                  <td>{fmtTime(rt.started_at)}</td>
                  <td>{fmtTime(rt.ended_at)}</td>
                  <td>{rt.ended_reason || "-"}</td>
                  <td>{cleanupLabel(rt)}</td>
                  <td>{fmtTime(rt.heartbeat_at)}</td>
                  <td><code>{rt.runtime_id}</code></td>
                  <td>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => void stopRuntime(rt)}
                      disabled={isRuntimeTerminal(rt) || stoppingRuntimeId === rt.runtime_id}
                    >
                      {stoppingRuntimeId === rt.runtime_id ? "Ending..." : "End"}
                    </button>
                  </td>
                </>
              );
            }}
          />
        ) : null}

        {activeTab === "create" ? (
          <div className="runtime-create-stack">
            <section className="card runtime-create-section">
              <h2 className="section-title" style={{ marginTop: 0 }}>Hosted runtime</h2>
              <p className="muted">Create a platform-owned executor runtime for backtest and testnet sessions.</p>
              <FilterPanel>
                <FilterField label="Runtime name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={creating}
                    placeholder="hosted-brave-river"
                  />
                </FilterField>
                <FilterField label="Resource profile">
                  <select value={resourceProfile} onChange={(e) => setResourceProfile(e.target.value)} disabled={creating}>
                    <option value="small">small</option>
                    <option value="medium">medium</option>
                    <option value="large">large</option>
                  </select>
                </FilterField>
                <div className="filter-action">
                  <button type="button" className="primary" onClick={() => void createHosted()} disabled={creating}>
                    {creating ? "Starting..." : "Start hosted runtime"}
                  </button>
                </div>
              </FilterPanel>
            </section>
            <RuntimeCredentialsPanel
              variant="create"
              createTitle="Self-hosted runtime"
              showAdmissionFailures={false}
            />
          </div>
        ) : null}

        {activeTab === "credentials" ? (
          <RuntimeCredentialsPanel variant="list" showAdmissionFailures={false} />
        ) : null}

        {activeTab === "failures" ? (
          <>
              <h2 className="section-title" style={{ marginTop: 0 }}>Failure Overview</h2>
              <p className="muted">Latest 5 self-hosted runtime startup or admission failures.</p>
              {!loading && admissionFailures.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>No recent runtime startup failures.</p>
              ) : null}
              {!loading && admissionFailures.length > 0 ? (
                <div className="table-scroll">
                  <table className="compact">
                    <thead>
                      <tr>
                        <th>Last seen</th>
                        <th>Runtime</th>
                        <th>Credential</th>
                        <th>Reason</th>
                        <th>Attempts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {admissionFailures.map((f) => (
                        <tr key={f.admission_failure_id || `${f.credential_key_id}-${f.requested_runtime_id}`}>
                          <td>{fmtTime(f.last_seen_at)}</td>
                          <td>
                            {f.requested_runtime_id ? (
                              <Link to={`/runtimes/${encodeURIComponent(f.requested_runtime_id)}`}>
                                {f.requested_name || f.requested_runtime_id}
                              </Link>
                            ) : (
                              f.requested_name || "-"
                            )}
                          </td>
                          <td>
                            {f.credential_key_id ? <code>{f.credential_key_id}</code> : "-"}
                            {f.consumed_runtime_id ? (
                              <span className="muted">
                                {" "}used by{" "}
                                <Link to={`/runtimes/${encodeURIComponent(f.consumed_runtime_id)}`}>
                                  {f.consumed_runtime_id}
                                </Link>
                              </span>
                            ) : null}
                          </td>
                          <td>{f.reason || f.failure_code || "-"}</td>
                          <td>{f.attempt_count || 1}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
          </>
        ) : null}
      </PageTabs>
    </div>
  );
}

export function RuntimeDetailPage() {
  const { runtimeId } = useParams<{ runtimeId: string }>();
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [deliveryHealth, setDeliveryHealth] = useState<SessionDeliveryHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [preparingDebug, setPreparingDebug] = useState(false);
  const [showInstallInstructions, setShowInstallInstructions] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<RuntimeDetailTab>("overview");

  useEffect(() => {
    if (!runtimeId) return;
    const rid = runtimeId;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [rt, accountList] = await Promise.all([
          getRuntime(rid),
          listAccountsPage({ limit: 200 }).then((page) => page.items),
        ]);
        const [sessionLists, deliveryResult] = await Promise.all([
          listSessionsPage({ runtime_id: rid, limit: 200 }).then((page) => page.items).catch(() => []),
          listSessionDeliveryHealth({ runtime_id: rid }).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        setRuntime(rt);
        setAccounts(accountList);
        setSessions(sessionLists.filter((s) => s.runtime_id === rt.runtime_id));
        setDeliveryHealth(deliveryResult.items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load runtime failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [runtimeId]);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.account_id, a])), [accounts]);
  const activeSessionCount = useMemo(
    () => sessions.filter((s) => isActiveSessionStatus(s.status)).length,
    [sessions],
  );
  const isDebuggerRuntime = runtime?.source === "self_hosted" && runtime.role === "debugger";
  const visibleRuntimeDetailTabs = useMemo(
    () => runtimeDetailTabs.filter((tab) => tab.id !== "debugging" || isDebuggerRuntime),
    [isDebuggerRuntime],
  );

  useEffect(() => {
    if (activeDetailTab === "debugging" && !isDebuggerRuntime) {
      setActiveDetailTab("overview");
    }
  }, [activeDetailTab, isDebuggerRuntime]);

  async function stopRuntime() {
    if (!runtime || isRuntimeTerminal(runtime)) return;
    const ok = window.confirm(`End runtime ${runtime.name || runtime.runtime_id}?`);
    if (!ok) return;
    setStopping(true);
    setError(null);
    setNotice(null);
    try {
      const stopped = await cancelRuntime(runtime.runtime_id);
      setRuntime(stopped);
      setNotice("Runtime ended.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "End runtime failed");
    } finally {
      setStopping(false);
    }
  }

  async function prepareDebug() {
    if (!runtime) return;
    setPreparingDebug(true);
    setError(null);
    setNotice(null);
    try {
      const workspace = await prepareDebugWorkspace(runtime.runtime_id, { container_path: "/workspace" });
      setRuntime({ ...runtime, debug_workspace: workspace });
      setNotice("Debug workspace prepared.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prepare debugging failed");
    } finally {
      setPreparingDebug(false);
    }
  }

  return (
    <div>
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        <Link to="/runtimes">Back to Runtime Management</Link>
      </p>
      {loading ? <p className="muted">Loading runtime...</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && runtime ? (
        <>
          <h1>Runtime {runtime.name || runtime.runtime_id}</h1>
          <PageTabs
            tabs={visibleRuntimeDetailTabs}
            activeTab={activeDetailTab}
            onChange={setActiveDetailTab}
            ariaLabel="Runtime detail sections"
          >
            {activeDetailTab === "overview" ? (
              <div className="card">
                <h2 className="section-title" style={{ marginTop: 0 }}>Overview</h2>
                <div className="runtime-detail-grid">
                  <div>
                    <p><span className={runtimeBadgeClass(runtime)}>{runtime.status || "unknown"}</span></p>
                    <p className="muted">Name</p>
                    <p>{runtime.name || "-"}</p>
                    <p className="muted">Runtime ID</p>
                    <p><code>{runtime.runtime_id}</code></p>
                    <p className="muted">Source</p>
                    <p>{sourceLabel(runtime.source)}</p>
                    <p className="muted">Role</p>
                    <p>{roleLabel(runtime.role)}</p>
                    <p className="muted">Health</p>
                    <p>{healthLabel(runtime)}</p>
                  </div>
                  <div>
                    <p className="muted">Active sessions</p>
                    <p>{activeSessionCount}</p>
                    <p className="muted">Resource profile</p>
                    <p>{runtime.resource_profile || "-"}</p>
                    <p className="muted">Cleanup</p>
                    <p>{cleanupLabel(runtime)}</p>
                    {runtime.cleanup_status ? (
                      <>
                        <p className="muted">Cleanup status</p>
                        <p>{runtime.cleanup_status}</p>
                      </>
                    ) : null}
                    <p className="muted">Started</p>
                    <p>{fmtTime(runtime.started_at)}</p>
                    <p className="muted">Ended</p>
                    <p>{fmtTime(runtime.ended_at)}</p>
                    <p className="muted">End reason</p>
                    <p>{runtime.ended_reason || "-"}</p>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => void stopRuntime()}
                      disabled={isRuntimeTerminal(runtime) || stopping}
                    >
                      {stopping ? "Ending..." : "End runtime"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {activeDetailTab === "connection" ? (
              <div className="card">
                <h2 className="section-title" style={{ marginTop: 0 }}>Connection</h2>
                <p className="muted">Heartbeat</p>
                <p>{fmtTime(runtime.heartbeat_at)}</p>
                <p className="muted">Endpoint</p>
                <p>{runtime.endpoint_host ? `${runtime.endpoint_host}:${runtime.grpc_port || 0}` : "-"}</p>
                <p className="muted">Credential</p>
                <p>{runtime.credential_key_id ? <code>{runtime.credential_key_id}</code> : "-"}</p>
                {runtime.source === "self_hosted" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowInstallInstructions((v) => !v)}
                    >
                      Install instructions
                    </button>
                    {showInstallInstructions ? (
                      <RuntimeInstallInstructions runtime={runtime} />
                    ) : null}
                  </>
                ) : (
                  <p className="muted">Hosted runtimes are provisioned by the platform.</p>
                )}
              </div>
            ) : null}

            {activeDetailTab === "debugging" && isDebuggerRuntime ? (
              <div className="card">
                <h2 className="section-title" style={{ marginTop: 0 }}>Debugging</h2>
                <p className="muted">Template</p>
                <p>{runtime.debug_workspace?.template_path ? <code>{runtime.debug_workspace.template_path}</code> : "-"}</p>
                <p className="muted">Prepared</p>
                <p>{fmtTime(runtime.debug_workspace?.prepared_at)}</p>
                <p className="muted">Active dataset</p>
                <p>
                  {runtime.debug_dataset?.dataset_id
                    ? `${runtime.debug_dataset.symbol || "-"} ${runtime.debug_dataset.market || "-"} ${runtime.debug_dataset.interval || "-"} · ${runtime.debug_dataset.bar_count || 0} bars · ${runtime.debug_dataset.state || "-"}`
                    : "-"}
                </p>
                {runtime.debug_workspace?.last_error ? (
                  <p className="error">{runtime.debug_workspace.last_error}</p>
                ) : null}
                <p className="muted">Replay command is available in Connection → Install instructions.</p>
                <button
                  type="button"
                  onClick={() => void prepareDebug()}
                  disabled={preparingDebug || runtimeUnavailableReason(runtime) !== undefined}
                >
                  {preparingDebug ? "Preparing..." : "Prepare Debugging"}
                </button>
              </div>
            ) : null}

            {activeDetailTab === "sessions" ? (
              <div className="card">
                <h2 className="section-title" style={{ marginTop: 0 }}>Sessions</h2>
                {sessions.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>No recent sessions bound to this runtime.</p>
                ) : (
                  <table className="compact">
                    <thead>
                      <tr>
                        <th>Session</th>
                        <th>Type</th>
                        <th>Account</th>
                        <th>Status</th>
                        <th>Strategy</th>
                        <th>Started</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s) => (
                        <tr key={s.session_id}>
                          <td>
                            <Link to={`/accounts/${s.account_id}/sessions/${s.session_id}`}>
                              {s.session_id.slice(0, 12)}...
                            </Link>
                          </td>
                          <td>{s.session_type || "-"}</td>
                          <td>
                            <Link to={`/accounts/${s.account_id}`}>
                              {accountById.get(s.account_id)?.name || s.account_id}
                            </Link>
                          </td>
                          <td><span className="status-badge status-badge--idle">{s.status}</span></td>
                          <td>{s.strategy_id}</td>
                          <td>{fmtTime(s.started_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : null}

            {activeDetailTab === "live_delivery" ? (
              <div className="card">
                <h2 className="section-title" style={{ marginTop: 0 }}>Live Delivery</h2>
                {deliveryHealth.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>No active mode=2 delivery subscriptions for this runtime.</p>
                ) : (
                  <table className="compact">
                    <thead>
                      <tr>
                        <th>Session</th>
                        <th>Stream</th>
                        <th>Health</th>
                        <th>Last delivery</th>
                        <th>Kafka</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deliveryHealth.map((item) => {
                        const linkedSession = sessions.find((s) => s.session_id === item.subscription.session_id);
                        return (
                          <tr key={item.subscription.subscription_id}>
                            <td>
                              {linkedSession ? (
                                <Link to={`/accounts/${linkedSession.account_id}/sessions/${linkedSession.session_id}`}>
                                  {item.subscription.session_id.slice(0, 12)}...
                                </Link>
                              ) : (
                                <code>{item.subscription.session_id.slice(0, 12)}...</code>
                              )}
                            </td>
                            <td>
                              {item.subscription.key.exchange}/{item.subscription.key.market}/{item.subscription.key.symbol}/{item.subscription.key.interval}
                            </td>
                            <td>{item.health_status}</td>
                            <td>{fmtTime(item.lease?.last_delivery_at)}</td>
                            <td>
                              {item.lease?.last_topic ? `${item.lease.last_topic}#${item.lease.last_partition ?? 0}@${item.lease.last_offset ?? 0}` : "-"}
                            </td>
                            <td>{item.blocked_reason || item.latest_failure?.reason || "-"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            ) : null}
          </PageTabs>
        </>
      ) : null}
    </div>
  );
}
