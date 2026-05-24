import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listAccountsPage,
  listRuntimes,
  listSessionsPage,
  listStrategiesPage,
  type Account,
  type Runtime,
  type Session,
  type Strategy,
} from "@/api/client";
import PageHeader from "@/components/PageHeader";
import { FilterField, FilterPanel } from "@/components/FilterControls";
import InfiniteTable from "@/components/InfiniteTable";
import AsyncSelect, { type AsyncSelectOption } from "@/components/AsyncSelect";
import { accountModeLabel } from "@/utils/accountMode";
import { formatUTCWithLocal } from "@/utils/time";

function fmtTime(value?: string): string {
  return value ? formatUTCWithLocal(value) : "-";
}

function parseLocalDateTime(value: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

export default function SessionManagement() {
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [accountFilter, setAccountFilter] = useState("");
  const [runtimeFilter, setRuntimeFilter] = useState("");
  const [strategyFilter, setStrategyFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sessionIdFilter, setSessionIdFilter] = useState("");
  const [startedAfterFilter, setStartedAfterFilter] = useState("");
  const [startedBeforeFilter, setStartedBeforeFilter] = useState("");

  const filterKey = useMemo(() => JSON.stringify({
    accountFilter,
    runtimeFilter,
    strategyFilter,
    modeFilter,
    statusFilter,
    sessionIdFilter,
    startedAfterFilter,
    startedBeforeFilter,
    refreshKey,
  }), [accountFilter, modeFilter, refreshKey, runtimeFilter, sessionIdFilter, startedAfterFilter, startedBeforeFilter, statusFilter, strategyFilter]);

  const loadSessions = useCallback(async (offset: number, limit: number) => {
    setLoading(true);
    try {
      return await listSessionsPage({
        offset,
        limit,
        account_id: accountFilter || undefined,
        runtime_id: runtimeFilter || undefined,
        strategy_id: strategyFilter || undefined,
        mode: modeFilter || undefined,
        status: statusFilter || undefined,
        session_id: sessionIdFilter || undefined,
        started_after_ms: parseLocalDateTime(startedAfterFilter),
        started_before_ms: parseLocalDateTime(startedBeforeFilter),
      });
    } finally {
      setLoading(false);
    }
  }, [accountFilter, modeFilter, runtimeFilter, sessionIdFilter, startedAfterFilter, startedBeforeFilter, statusFilter, strategyFilter]);

  return (
    <div>
      <PageHeader
        title="Session Management"
        description="Search all strategy sessions. Runtime operations remain under Account Management."
        loading={loading}
        onRefresh={() => setRefreshKey((v) => v + 1)}
      />
      <div className="card">
        <FilterPanel>
          <FilterField label="Account" wide>
            <AsyncSelect<Account>
              value={accountFilter}
              placeholder="All accounts"
              onChange={setAccountFilter}
              loadPage={async (offset, limit, query) => {
                const page = await listAccountsPage({ offset, limit });
                const items = page.items
                  .filter((a) => !query || a.name.toLowerCase().includes(query.toLowerCase()) || String(a.account_id).includes(query))
                  .map<AsyncSelectOption<Account>>((a) => ({
                    value: String(a.account_id),
                    label: a.name || String(a.account_id),
                    detail: `#${a.account_id}`,
                    item: a,
                  }));
                return { ...page, items };
              }}
            />
          </FilterField>
          <FilterField label="Runtime" wide>
            <AsyncSelect<Runtime>
              value={runtimeFilter}
              placeholder="All runtimes"
              onChange={setRuntimeFilter}
              loadPage={async (offset, limit, query) => {
                const result = await listRuntimes({ offset, limit });
                const items = result.runtimes
                  .filter((r) => !query || (r.name || r.runtime_id).toLowerCase().includes(query.toLowerCase()) || r.runtime_id.includes(query))
                  .map<AsyncSelectOption<Runtime>>((r) => ({
                    value: r.runtime_id,
                    label: r.name || r.runtime_id,
                    detail: `${r.source || "runtime"} · ${r.role || "role n/a"} · ${r.status || "unknown"}`,
                    item: r,
                  }));
                return { items, next_offset: offset + result.runtimes.length, has_more: result.has_more, total: result.total };
              }}
            />
          </FilterField>
          <FilterField label="Strategy" wide>
            <AsyncSelect<Strategy>
              value={strategyFilter}
              placeholder="All strategies"
              onChange={setStrategyFilter}
              loadPage={async (offset, limit, query) => {
                const page = await listStrategiesPage({ offset, limit, namePrefix: query || undefined });
                return {
                  ...page,
                  items: page.items.map<AsyncSelectOption<Strategy>>((s) => ({
                    value: String(s.strategy_id),
                    label: `${s.name} v${s.version}`,
                    detail: `#${s.strategy_id}`,
                    item: s,
                  })),
                };
              }}
            />
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
              <option value="running">running</option>
              <option value="stopping">stopping</option>
              <option value="finished">finished</option>
              <option value="completed">completed</option>
              <option value="stopped">stopped</option>
              <option value="failed">failed</option>
              <option value="recoverable">recoverable</option>
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

        <InfiniteTable<Session>
          columns={["Session", "Account", "Strategy", "Runtime", "Mode", "Type", "Status", "Started", "Completed", "Bars", "Error"]}
          loadPage={loadSessions}
          refreshKey={filterKey}
          emptyText="No sessions found."
          rowKey={(session) => session.session_id}
          renderRow={(session) => (
            <>
              <td><Link to={`/accounts/${session.account_id}/sessions/${session.session_id}`}>{session.session_id.slice(0, 12)}...</Link></td>
              <td><Link to={`/accounts/${session.account_id}`}>{session.account_id}</Link></td>
              <td>{session.strategy_id || "-"}</td>
              <td>
                {session.runtime_id ? (
                  <Link to={`/runtimes/${encodeURIComponent(session.runtime_id)}`}>{session.runtime_name || session.runtime_id}</Link>
                ) : "-"}
              </td>
              <td>{accountModeLabel(session.mode)}</td>
              <td>{session.session_type || "-"}</td>
              <td><span className="status-badge status-badge--idle">{session.status}</span></td>
              <td>{fmtTime(session.started_at)}</td>
              <td>{fmtTime(session.completed_at)}</td>
              <td>{session.bars_processed ?? 0}</td>
              <td>{session.error || "-"}</td>
            </>
          )}
        />
      </div>
    </div>
  );
}
