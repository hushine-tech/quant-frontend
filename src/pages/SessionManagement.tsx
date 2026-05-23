import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listAccounts,
  listRuntimes,
  listSessions,
  listStrategies,
  type Account,
  type Runtime,
  type Session,
  type Strategy,
} from "@/api/client";
import PageHeader from "@/components/PageHeader";
import { FilterField, FilterPanel } from "@/components/FilterControls";
import { formatUTCWithLocal } from "@/utils/time";

type SessionRow = Session & {
  accountName?: string;
  runtimeName?: string;
  strategyName?: string;
};

function includesText(value: unknown, needle: string): boolean {
  if (!needle) return true;
  return String(value ?? "").toLowerCase().includes(needle.toLowerCase());
}

function fmtTime(value?: string): string {
  return value ? formatUTCWithLocal(value) : "-";
}

function parseLocalDateTime(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function sessionStartedMs(session: Session): number {
  return Date.parse(session.started_at || session.completed_at || "") || 0;
}

export default function SessionManagement() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [accountFilter, setAccountFilter] = useState("");
  const [runtimeFilter, setRuntimeFilter] = useState("");
  const [strategyFilter, setStrategyFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sessionIdFilter, setSessionIdFilter] = useState("");
  const [startedAfterFilter, setStartedAfterFilter] = useState("");
  const [startedBeforeFilter, setStartedBeforeFilter] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [accountList, runtimeResult, strategyList] = await Promise.all([
        listAccounts(),
        listRuntimes({ limit: 200 }).catch(() => ({ runtimes: [], has_more: false, total: 0 })),
        listStrategies().catch(() => []),
      ]);
      const sessionLists = await Promise.all(
        accountList.map((account) => listSessions(account.account_id, 0, 100).catch(() => [])),
      );
      const accountById = new Map(accountList.map((account) => [account.account_id, account]));
      const runtimeById = new Map(runtimeResult.runtimes.map((runtime) => [runtime.runtime_id, runtime]));
      const strategyById = new Map(strategyList.map((strategy) => [strategy.strategy_id, strategy]));
      const rows = sessionLists.flat().map((session) => ({
        ...session,
        accountName: accountById.get(session.account_id)?.name,
        runtimeName: session.runtime_id ? runtimeById.get(session.runtime_id)?.name : undefined,
        strategyName: strategyById.get(session.strategy_id)?.name,
      }));
      rows.sort((a, b) => sessionStartedMs(b) - sessionStartedMs(a));
      setAccounts(accountList);
      setRuntimes(runtimeResult.runtimes);
      setStrategies(strategyList);
      setSessions(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load sessions failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filteredSessions = useMemo(() => {
    const startedAfter = parseLocalDateTime(startedAfterFilter);
    const startedBefore = parseLocalDateTime(startedBeforeFilter);
    return sessions.filter((session) => {
      if (accountFilter && String(session.account_id) !== accountFilter) return false;
      if (runtimeFilter && session.runtime_id !== runtimeFilter) return false;
      if (strategyFilter && String(session.strategy_id) !== strategyFilter) return false;
      if (modeFilter && String(session.mode) !== modeFilter) return false;
      if (statusFilter && session.status !== statusFilter) return false;
      if (!includesText(session.session_id, sessionIdFilter)) return false;
      const startedAt = sessionStartedMs(session);
      if (startedAfter !== null && startedAt < startedAfter) return false;
      if (startedBefore !== null && startedAt > startedBefore) return false;
      return true;
    });
  }, [
    accountFilter,
    modeFilter,
    runtimeFilter,
    sessionIdFilter,
    sessions,
    startedAfterFilter,
    startedBeforeFilter,
    statusFilter,
    strategyFilter,
  ]);

  const statuses = Array.from(new Set(sessions.map((session) => session.status).filter(Boolean))).sort();

  return (
    <div>
      <PageHeader
        title="Session Management"
        description="Search all strategy sessions. Runtime operations remain under Account Management."
        loading={loading}
        onRefresh={load}
      />
      {error ? <p className="error">{error}</p> : null}
      <div className="card">
        <FilterPanel>
          <FilterField label="Account" wide>
            <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.account_id} value={account.account_id}>
                  {account.name || account.account_id}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Runtime" wide>
            <select value={runtimeFilter} onChange={(e) => setRuntimeFilter(e.target.value)}>
              <option value="">All runtimes</option>
              {runtimes.map((runtime) => (
                <option key={runtime.runtime_id} value={runtime.runtime_id}>
                  {runtime.name || runtime.runtime_id}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Strategy" wide>
            <select value={strategyFilter} onChange={(e) => setStrategyFilter(e.target.value)}>
              <option value="">All strategies</option>
              {strategies.map((strategy) => (
                <option key={strategy.strategy_id} value={strategy.strategy_id}>
                  {strategy.name} v{strategy.version}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Mode">
            <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
              <option value="">All modes</option>
              <option value="0">Backtest (0)</option>
              <option value="1">Live (1)</option>
              <option value="2">Testnet (2)</option>
            </select>
          </FilterField>
          <FilterField label="Status">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Started after">
            <input type="datetime-local" value={startedAfterFilter} onChange={(e) => setStartedAfterFilter(e.target.value)} />
          </FilterField>
          <FilterField label="Started before">
            <input type="datetime-local" value={startedBeforeFilter} onChange={(e) => setStartedBeforeFilter(e.target.value)} />
          </FilterField>
          <FilterField label="Session ID" wide>
            <input value={sessionIdFilter} onChange={(e) => setSessionIdFilter(e.target.value)} placeholder="Search session ID" />
          </FilterField>
        </FilterPanel>

        {loading ? <p className="muted">Loading sessions...</p> : null}
        {!loading && filteredSessions.length === 0 ? <p className="muted">No sessions found.</p> : null}
        {filteredSessions.length > 0 ? (
          <div className="table-scroll">
            <table className="compact full-width-table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Account</th>
                  <th>Strategy</th>
                  <th>Runtime</th>
                  <th>Mode</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Bars</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((session) => (
                  <tr key={session.session_id}>
                    <td>
                      <Link to={`/accounts/${session.account_id}/sessions/${session.session_id}`}>
                        {session.session_id.slice(0, 12)}...
                      </Link>
                    </td>
                    <td>
                      <Link to={`/accounts/${session.account_id}`}>
                        {session.accountName || session.account_id}
                      </Link>
                    </td>
                    <td>{session.strategyName || session.strategy_id || "-"}</td>
                    <td>
                      {session.runtime_id ? (
                        <Link to={`/runtimes/${encodeURIComponent(session.runtime_id)}`}>
                          {session.runtimeName || session.runtime_name || session.runtime_id}
                        </Link>
                      ) : "-"}
                    </td>
                    <td>{session.mode}</td>
                    <td>{session.session_type || "-"}</td>
                    <td><span className="status-badge status-badge--idle">{session.status}</span></td>
                    <td>{fmtTime(session.started_at)}</td>
                    <td>{fmtTime(session.completed_at)}</td>
                    <td>{session.bars_processed ?? 0}</td>
                    <td>{session.error || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
