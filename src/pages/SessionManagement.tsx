import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listPortfoliosPage,
  listRuntimes,
  listSessionsPage,
  listStrategiesPage,
  type Portfolio,
  type Runtime,
  type Session,
  type Strategy,
} from "@/api/client";
import PageHeader from "@/components/PageHeader";
import { FilterField, FilterPanel } from "@/components/FilterControls";
import InfiniteTable from "@/components/InfiniteTable";
import AsyncSelect, { type AsyncSelectOption } from "@/components/AsyncSelect";
import DateTimeRangePicker from "@/components/DateTimeRangePicker";
import { portfolioEnvironmentLabel } from "@/utils/portfolioEnvironment";
import { collectFilteredPage } from "@/utils/asyncSelectPagination";
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
  const [portfolioFilter, setPortfolioFilter] = useState("");
  const [runtimeFilter, setRuntimeFilter] = useState("");
  const [strategyFilter, setStrategyFilter] = useState("");
  const [environmentFilter, setEnvironmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sessionIdFilter, setSessionIdFilter] = useState("");
  const [startedAfterFilter, setStartedAfterFilter] = useState("");
  const [startedBeforeFilter, setStartedBeforeFilter] = useState("");

  const filterKey = useMemo(() => JSON.stringify({
    portfolioFilter,
    runtimeFilter,
    strategyFilter,
    environmentFilter,
    statusFilter,
    sessionIdFilter,
    startedAfterFilter,
    startedBeforeFilter,
    refreshKey,
  }), [portfolioFilter, environmentFilter, refreshKey, runtimeFilter, sessionIdFilter, startedAfterFilter, startedBeforeFilter, statusFilter, strategyFilter]);

  const loadSessions = useCallback(async (offset: number, limit: number) => {
    setLoading(true);
    try {
      return await listSessionsPage({
        offset,
        limit,
        portfolio_id: portfolioFilter || undefined,
        runtime_id: runtimeFilter || undefined,
        strategy_id: strategyFilter || undefined,
        environment: environmentFilter || undefined,
        status: statusFilter || undefined,
        session_id: sessionIdFilter || undefined,
        started_after_ms: parseLocalDateTime(startedAfterFilter),
        started_before_ms: parseLocalDateTime(startedBeforeFilter),
      });
    } finally {
      setLoading(false);
    }
  }, [portfolioFilter, environmentFilter, runtimeFilter, sessionIdFilter, startedAfterFilter, startedBeforeFilter, statusFilter, strategyFilter]);

  return (
    <div>
      <PageHeader
        title="Session Management"
        description="Search all strategy sessions. Runtime operations remain under Portfolio Management."
        loading={loading}
        onRefresh={() => setRefreshKey((v) => v + 1)}
      />
      <div className="card">
        <FilterPanel>
          <FilterField label="Portfolio" wide>
            <AsyncSelect<Portfolio>
              value={portfolioFilter}
              placeholder="All portfolios"
              onChange={setPortfolioFilter}
              loadPage={async (offset, limit, query) => {
                const normalizedQuery = query.trim().toLowerCase();
                return collectFilteredPage<Portfolio, AsyncSelectOption<Portfolio>>({
                  offset,
                  limit,
                  loadSourcePage: (sourceOffset, sourceLimit) => listPortfoliosPage({ offset: sourceOffset, limit: sourceLimit }),
                  matches: (a) => !normalizedQuery || a.name.toLowerCase().includes(normalizedQuery) || String(a.portfolio_id).includes(normalizedQuery),
                  map: (a) => ({
                    value: String(a.portfolio_id),
                    label: a.name || String(a.portfolio_id),
                    detail: `#${a.portfolio_id}`,
                    item: a,
                  }),
                });
              }}
            />
          </FilterField>
          <FilterField label="Runtime" wide>
            <AsyncSelect<Runtime>
              value={runtimeFilter}
              placeholder="All runtimes"
              onChange={setRuntimeFilter}
              loadPage={async (offset, limit, query) => {
                const normalizedQuery = query.trim().toLowerCase();
                return collectFilteredPage<Runtime, AsyncSelectOption<Runtime>>({
                  offset,
                  limit,
                  loadSourcePage: async (sourceOffset, sourceLimit) => {
                    const result = await listRuntimes({ offset: sourceOffset, limit: sourceLimit });
                    return { items: result.runtimes, next_offset: sourceOffset + result.runtimes.length, has_more: result.has_more, total: result.total };
                  },
                  matches: (r) => !normalizedQuery || (r.name || r.runtime_id).toLowerCase().includes(normalizedQuery) || r.runtime_id.toLowerCase().includes(normalizedQuery),
                  map: (r) => ({
                    value: r.runtime_id,
                    label: r.name || r.runtime_id,
                    detail: `${r.source || "runtime"} · ${r.role || "role n/a"} · ${r.status || "unknown"}`,
                    item: r,
                  }),
                });
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
          <FilterField label="Environment">
            <select name="session_environment_filter" value={environmentFilter} onChange={(e) => setEnvironmentFilter(e.target.value)}>
              <option value="">All environments</option>
              <option value="0">Backtest (0)</option>
              <option value="1">Demo (1)</option>
              <option value="2">Live (2)</option>
            </select>
          </FilterField>
          <FilterField label="Status">
            <select name="session_status_filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
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
          <DateTimeRangePicker
            label="Started range"
            startValue={startedAfterFilter}
            endValue={startedBeforeFilter}
            onStartChange={setStartedAfterFilter}
            onEndChange={setStartedBeforeFilter}
            className="filter-field--wide"
          />
          <FilterField label="Session ID" wide>
            <input name="session_id_filter" value={sessionIdFilter} onChange={(e) => setSessionIdFilter(e.target.value)} placeholder="Search session ID" />
          </FilterField>
        </FilterPanel>

        <InfiniteTable<Session>
          columns={["Session", "Portfolio", "Strategy", "Runtime", "Environment", "Type", "Status", "Started", "Completed", "Bars", "Error"]}
          loadPage={loadSessions}
          refreshKey={filterKey}
          emptyText="No sessions found."
          rowKey={(session) => session.session_id}
          renderRow={(session) => (
            <>
              <td><Link to={`/portfolios/${session.portfolio_id}/sessions/${session.session_id}`}>{session.session_id.slice(0, 12)}...</Link></td>
              <td><Link to={`/portfolios/${session.portfolio_id}`}>{session.portfolio_id}</Link></td>
              <td>{session.strategy_id || "-"}</td>
              <td>
                {session.runtime_id ? (
                  <Link to={`/runtimes/${encodeURIComponent(session.runtime_id)}`}>{session.runtime_name || session.runtime_id}</Link>
                ) : "-"}
              </td>
              <td>{portfolioEnvironmentLabel(session.environment)}</td>
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
