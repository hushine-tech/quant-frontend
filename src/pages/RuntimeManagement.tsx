import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { formatUTCWithLocal } from "@/utils/time";
import PageHeader from "@/components/PageHeader";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import { RuntimeCredentialsPanel } from "@/pages/RuntimeCredentials";
import {
  cancelRuntime,
  ensureHostedRuntime,
  getRuntime,
  prepareDebugWorkspace,
  isRuntimeTerminal,
  listAccounts,
  listSessionDeliveryHealth,
  listRuntimeAdmissionFailures,
  listRuntimes,
  listSessions,
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

type RuntimeManagementTab = "runtimes" | "credentials" | "failures";

const runtimeTabs: Array<PageTab<RuntimeManagementTab>> = [
  { id: "runtimes", label: "All Runtimes" },
  { id: "credentials", label: "Credentials" },
  { id: "failures", label: "Failure Overview" },
];

function normalizeRuntimeTab(value: string | null): RuntimeManagementTab {
  if (value === "credentials") return "credentials";
  if (value === "failures") return "failures";
  return "runtimes";
}

export default function RuntimeManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
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

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [result, failureResult] = await Promise.all([
        listRuntimes({ limit: 100 }),
        listRuntimeAdmissionFailures(5).catch(() => ({ failures: [] })),
      ]);
      setRuntimes(result.runtimes);
      setAdmissionFailures(failureResult.failures);
      try {
        const accounts = await listAccounts();
        const sessionLists = await Promise.all(
          accounts.map((a) => listSessions(a.account_id, 0, 100).catch(() => [])),
        );
        const allSessions = sessionLists.flat();
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
      setRuntimes((items) => items.map((item) => (item.runtime_id === stopped.runtime_id ? stopped : item)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "End runtime failed");
    } finally {
      setStoppingRuntimeId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Runtime Management"
        description="Manage hosted and self-hosted runtimes for strategy execution and debugging."
        loading={loading}
        onRefresh={load}
      />

      {notice ? <p className="muted">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Loading runtimes...</p> : null}

      <PageTabs tabs={runtimeTabs} activeTab={activeTab} onChange={changeTab} ariaLabel="Runtime management sections">
        {activeTab === "runtimes" ? (
          <>
            <div className="primary-toolbar">
              <div className="runtime-create-card">
                <label>
                  <span>Runtime name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={creating}
                    placeholder="hosted-brave-river"
                  />
                </label>
                <label>
                  <span>Resource profile</span>
                  <select value={resourceProfile} onChange={(e) => setResourceProfile(e.target.value)} disabled={creating}>
                    <option value="small">small</option>
                    <option value="medium">medium</option>
                    <option value="large">large</option>
                  </select>
                </label>
                <button type="button" className="primary" onClick={() => void createHosted()} disabled={creating}>
                  {creating ? "Starting..." : "Start hosted runtime"}
                </button>
              </div>
              <button type="button" onClick={() => changeTab("credentials")}>
                New self-hosted runtime
              </button>
            </div>
              {!loading && runtimes.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>No runtimes found.</p>
              ) : null}
              {!loading && runtimes.length > 0 ? (
                <div className="table-scroll">
                  <table className="compact runtime-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Source</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Health</th>
                        <th>Active sessions</th>
                        <th>Started</th>
                        <th>Ended</th>
                        <th>End reason</th>
                        <th>Cleanup</th>
                        <th>Heartbeat</th>
                        <th>Runtime ID</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runtimes.map((rt) => {
                        const activeCount = activeSessionCounts.get(rt.runtime_id) || 0;
                        const activeSession = activeSessionLinks.get(rt.runtime_id);
                        return (
                          <tr key={rt.runtime_id}>
                            <td>
                              <Link to={`/runtimes/${encodeURIComponent(rt.runtime_id)}`}>
                                {rt.name || rt.runtime_id}
                              </Link>
                            </td>
                            <td>{sourceLabel(rt.source)}</td>
                            <td>{roleLabel(rt.role)}</td>
                            <td><span className={runtimeBadgeClass(rt)}>{rt.status || "unknown"}</span></td>
                            <td>{healthLabel(rt)}</td>
                            <td>
                              {activeCount > 0 ? (
                                activeSession ? (
                                  <Link to={`/accounts/${activeSession.account_id}/sessions/${activeSession.session_id}`}>
                                    {activeCount}
                                  </Link>
                                ) : (
                                  <Link to={`/runtimes/${encodeURIComponent(rt.runtime_id)}`}>
                                    {activeCount}
                                  </Link>
                                )
                              ) : (
                                0
                              )}
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
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
          </>
        ) : null}

        {activeTab === "credentials" ? (
          <RuntimeCredentialsPanel />
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
          listAccounts(),
        ]);
        const [sessionLists, deliveryResult] = await Promise.all([
          Promise.all(
          accountList.map((a) => listSessions(a.account_id, 0, 20).catch(() => [])),
          ),
          listSessionDeliveryHealth({ runtime_id: rid }).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        setRuntime(rt);
        setAccounts(accountList);
        setSessions(sessionLists.flat().filter((s) => s.runtime_id === rt.runtime_id));
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
          <div className="runtime-detail-grid">
            <div className="card">
              <h2 className="section-title" style={{ marginTop: 0 }}>Status</h2>
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
            <div className="card">
              <h2 className="section-title" style={{ marginTop: 0 }}>Connection</h2>
              <p className="muted">Heartbeat</p>
              <p>{fmtTime(runtime.heartbeat_at)}</p>
              <p className="muted">Endpoint</p>
              <p>{runtime.endpoint_host ? `${runtime.endpoint_host}:${runtime.grpc_port || 0}` : "-"}</p>
              <p className="muted">Credential</p>
              <p>{runtime.credential_key_id ? <code>{runtime.credential_key_id}</code> : "-"}</p>
            </div>
          </div>

          {runtime.source === "self_hosted" && runtime.role === "debugger" ? (
            <>
              <h2 className="section-title">Debugger Workspace</h2>
              <div className="card">
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
                <button
                  type="button"
                  onClick={() => void prepareDebug()}
                  disabled={preparingDebug || runtimeUnavailableReason(runtime) !== undefined}
                >
                  {preparingDebug ? "Preparing..." : "Prepare Debugging"}
                </button>
              </div>
            </>
          ) : null}

          <h2 className="section-title">Live Delivery</h2>
          <div className="card">
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

          <h2 className="section-title">Related Sessions</h2>
          <div className="card">
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
        </>
      ) : null}
    </div>
  );
}
