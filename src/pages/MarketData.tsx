import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatUTCWithLocal } from "@/utils/time";
import {
  cancelMarketDataRequest,
  createMarketDataRequest,
  listMarketDataRequests,
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

const SUPPORTED_EXCHANGES = ["binance"] as const;
const SUPPORTED_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
type MarketDataTab = "live" | "coverage" | "data" | "requests";

const MARKET_DATA_TABS: Array<{ id: MarketDataTab; label: string }> = [
  { id: "live", label: "Live Streams" },
  { id: "coverage", label: "Historical Coverage" },
  { id: "data", label: "Data Viewer" },
  { id: "requests", label: "Requests" },
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

export default function MarketDataPage() {
  const [entries, setEntries] = useState<MarketDataEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [activeTab, setActiveTab] = useState<MarketDataTab>("live");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const list = await listMarketDataRequests();
      list.sort((a, b) => b.request.request_id - a.request.request_id);
      setEntries(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = window.setInterval(load, 15_000);
    return () => window.clearInterval(id);
  }, []);

  async function handleCancel(id: number) {
    try {
      await cancelMarketDataRequest(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  const liveEntries = entries.filter((entry) => entry.request.scope === "live");
  const historicalEntries = entries.filter((entry) => entry.request.scope === "historical");

  return (
    <div>
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        <Link to="/accounts">← Back to accounts</Link>
      </p>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>Market Data</h1>
        <button className="primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Cancel" : "+ Request Market Data"}
        </button>
      </div>

      <div className="runtime-management-tabs" role="tablist" aria-label="Market data sections">
        {MARKET_DATA_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`runtime-management-tab ${activeTab === tab.id ? "runtime-management-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {showCreate || activeTab === "requests" ? (
        <CreateRequestForm
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      ) : null}

      {err ? <p className="error">{err}</p> : null}
      {loading && entries.length === 0 ? <p className="muted">Loading…</p> : null}

      {activeTab === "coverage" ? <HistoricalCoveragePanel onRequestCreated={load} /> : null}
      {activeTab === "data" ? <KlineDataViewerPanel /> : null}

      {activeTab === "live" ? (
        <RequestList
          entries={liveEntries}
          loading={loading}
          emptyText="No live streams yet."
          onCancel={handleCancel}
        />
      ) : null}

      {activeTab === "requests" ? (
        <RequestList
          entries={historicalEntries}
          loading={loading}
          emptyText="No historical requests yet."
          onCancel={handleCancel}
        />
      ) : null}
    </div>
  );
}

function RequestList({
  entries,
  loading,
  emptyText,
  onCancel,
}: {
  entries: MarketDataEntry[];
  loading: boolean;
  emptyText: string;
  onCancel: (id: number) => void;
}) {
  if (!loading && entries.length === 0) {
    return (
      <div className="card">
        <p className="muted">{emptyText}</p>
      </div>
    );
  }
  return (
    <>
      {entries.map((entry) => (
        <div key={entry.request.request_id} className="card" style={{ marginBottom: "0.75rem" }}>
          {entry.request.scope === "historical" ? (
            <HistoricalRequestCard entry={entry} onCancel={onCancel} />
          ) : (
            <LiveRequestCard entry={entry} onCancel={onCancel} />
          )}
        </div>
      ))}
    </>
  );
}

function HistoricalRequestCard({
  entry,
  onCancel,
}: {
  entry: MarketDataEntry;
  onCancel: (id: number) => void;
}) {
  const { request } = entry;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <strong>{request.key.symbol}</strong>
          <span className="muted">
            {request.key.exchange} · {request.key.market} · {request.key.kind} · {request.key.interval}
          </span>
          {statusBadge("historical", "idle")}
          {requestStatusBadge(request)}
          {request.ready ? statusBadge("ready", "good") : statusBadge("not ready", "warn")}
        </div>
        <p className="muted" style={{ fontSize: "0.82rem", margin: "0.5rem 0 0" }}>
          requested window:{" "}
          {request.requested_start_at ? formatUTCWithLocal(request.requested_start_at) : "—"}
          {" → "}
          {request.requested_end_at ? formatUTCWithLocal(request.requested_end_at) : "—"}
        </p>
        <p className="muted" style={{ fontSize: "0.82rem", margin: "0.25rem 0 0" }}>
          covered window:{" "}
          {request.covered_start_at ? formatUTCWithLocal(request.covered_start_at) : "—"}
          {" → "}
          {request.covered_end_at ? formatUTCWithLocal(request.covered_end_at) : "—"}
        </p>
        <p className="muted" style={{ fontSize: "0.82rem", margin: "0.25rem 0 0" }}>
          created: {formatUTCWithLocal(request.created_at)}
        </p>
        {request.last_error ? (
          <p className="error" style={{ fontSize: "0.82rem", margin: "0.5rem 0 0" }}>
            last error: {request.last_error}
          </p>
        ) : null}
      </div>
      {request.status !== "cancelled" && request.status !== "ready" ? (
        <button style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }} onClick={() => onCancel(request.request_id)}>
          Cancel
        </button>
      ) : null}
    </div>
  );
}

function LiveRequestCard({
  entry,
  onCancel,
}: {
  entry: MarketDataEntry;
  onCancel: (id: number) => void;
}) {
  const { request, stream } = entry;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <strong>{request.key.symbol}</strong>
          <span className="muted">
            {request.key.exchange} · {request.key.market} · {request.key.kind} · {request.key.interval}
          </span>
          {statusBadge("live", "idle")}
          {requestStatusBadge(request)}
        </div>
        {stream ? (
          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <span className="muted">collector</span>
            {streamStateBadge(stream)}
            {stream.effective_live_delivery ? statusBadge("live delivery", "good") : statusBadge("storage only", "idle")}
            <span className="muted">· freshness {freshnessHint(stream)}</span>
            <span className="muted">· {stream.active_lease_count} active lease(s)</span>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: "0.82rem", margin: "0.5rem 0 0" }}>
            stream not materialised yet
          </p>
        )}
        <p className="muted" style={{ fontSize: "0.82rem", margin: "0.25rem 0 0" }}>
          requested: {formatUTCWithLocal(request.created_at)}
          {request.needs_live_delivery ? " · kafka enabled" : " · kafka disabled"}
        </p>
        {stream?.last_error ? (
          <p className="error" style={{ fontSize: "0.82rem", margin: "0.5rem 0 0" }}>
            last error: {stream.last_error}
          </p>
        ) : null}
      </div>
      {request.status !== "cancelled" ? (
        <button style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }} onClick={() => onCancel(request.request_id)}>
          Cancel
        </button>
      ) : null}
    </div>
  );
}

function HistoricalCoveragePanel({ onRequestCreated }: { onRequestCreated: () => void | Promise<void> }) {
  const [exchange, setExchange] = useState<(typeof SUPPORTED_EXCHANGES)[number]>("binance");
  const [market, setMarket] = useState<"futures" | "spot">("futures");
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
      <form className="market-data-form" onSubmit={handleQuery}>
        <label className="field">
          <span>Exchange</span>
          <select value={exchange} onChange={(e) => setExchange(e.target.value as (typeof SUPPORTED_EXCHANGES)[number])}>
            {SUPPORTED_EXCHANGES.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Market</span>
          <select value={market} onChange={(e) => setMarket(e.target.value as "futures" | "spot")}>
            <option value="futures">futures</option>
            <option value="spot">spot</option>
          </select>
        </label>

        <SymbolPicker
          market={market === "futures" ? "usdm_futures" : "spot"}
          label="Symbol"
          onAdd={setSymbol}
          selected={symbol}
        />

        <label className="field" style={{ marginTop: "0.75rem" }}>
          <span>Interval</span>
          <select value={interval} onChange={(e) => setInterval(e.target.value)}>
            {SUPPORTED_INTERVALS.map((iv) => (
              <option key={iv} value={iv}>{iv}</option>
            ))}
          </select>
        </label>

        <label className="field" style={{ marginTop: "0.75rem" }}>
          <span>Start</span>
          <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </label>

        <label className="field" style={{ marginTop: "0.75rem" }}>
          <span>End</span>
          <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </label>

        <p style={{ marginTop: "0.75rem" }}>
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
  const [market, setMarket] = useState<"futures" | "spot">("futures");
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
      <form className="market-data-form" onSubmit={handleQuery}>
        <label className="field">
          <span>Exchange</span>
          <select value={exchange} onChange={(e) => setExchange(e.target.value as (typeof SUPPORTED_EXCHANGES)[number])}>
            {SUPPORTED_EXCHANGES.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Market</span>
          <select value={market} onChange={(e) => setMarket(e.target.value as "futures" | "spot")}>
            <option value="futures">futures</option>
            <option value="spot">spot</option>
          </select>
        </label>

        <SymbolPicker
          market={market === "futures" ? "usdm_futures" : "spot"}
          label="Symbol"
          onAdd={setSymbol}
          selected={symbol}
        />

        <label className="field" style={{ marginTop: "0.75rem" }}>
          <span>Interval</span>
          <select value={interval} onChange={(e) => setInterval(e.target.value)}>
            {SUPPORTED_INTERVALS.map((iv) => (
              <option key={iv} value={iv}>{iv}</option>
            ))}
          </select>
        </label>

        <label className="field" style={{ marginTop: "0.75rem" }}>
          <span>Start</span>
          <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </label>

        <label className="field" style={{ marginTop: "0.75rem" }}>
          <span>End</span>
          <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </label>

        <label className="field" style={{ marginTop: "0.75rem" }}>
          <span>Limit</span>
          <input
            type="number"
            min={1}
            max={500}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
          />
        </label>

        <p style={{ marginTop: "0.75rem" }}>
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

function CreateRequestForm({ onCreated }: { onCreated: () => void }) {
  const [scope, setScope] = useState<"live" | "historical">("live");
  const [exchange, setExchange] = useState<(typeof SUPPORTED_EXCHANGES)[number]>("binance");
  const [market, setMarket] = useState<"futures" | "spot">("futures");
  const [symbol, setSymbol] = useState("");
  const [interval, setInterval] = useState("1m");
  const [needsLive, setNeedsLive] = useState(true);
  const [startAt, setStartAt] = useState(() => toLocalInputValue(new Date(Date.now() - 24 * 60 * 60_000)));
  const [endAt, setEndAt] = useState(() => toLocalInputValue(new Date()));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setSymbol("");
  }, [market]);

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
      scope,
    };
    if (scope === "live") {
      payload.needs_live_delivery = needsLive;
    } else {
      const startMs = parseLocalInputMs(startAt);
      const endMs = parseLocalInputMs(endAt);
      if (startMs == null || endMs == null) {
        setErr("Historical requests require a valid start and end time.");
        return;
      }
      payload.start_time_ms = startMs;
      payload.end_time_ms = endMs;
      payload.needs_live_delivery = false;
    }

    setErr(null);
    setSubmitting(true);
    try {
      await createMarketDataRequest(payload);
      onCreated();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Create failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <p style={{ fontWeight: 600, marginBottom: "0.75rem" }}>New Market-Data Request</p>
      <form className="market-data-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Scope</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as "live" | "historical")}>
            <option value="live">live</option>
            <option value="historical">historical</option>
          </select>
        </label>

        <label className="field">
          <span>Exchange</span>
          <select value={exchange} onChange={(e) => setExchange(e.target.value as (typeof SUPPORTED_EXCHANGES)[number])}>
            {SUPPORTED_EXCHANGES.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Market</span>
          <select value={market} onChange={(e) => setMarket(e.target.value as "futures" | "spot")}>
            <option value="futures">futures</option>
            <option value="spot">spot</option>
          </select>
        </label>

        <SymbolPicker
          market={market === "futures" ? "usdm_futures" : "spot"}
          label="Symbol"
          onAdd={setSymbol}
          selected={symbol}
        />

        <label className="field" style={{ marginTop: "0.75rem" }}>
          <span>Interval</span>
          <select value={interval} onChange={(e) => setInterval(e.target.value)}>
            {SUPPORTED_INTERVALS.map((iv) => (
              <option key={iv} value={iv}>{iv}</option>
            ))}
          </select>
        </label>

        {scope === "historical" ? (
          <>
            <label className="field" style={{ marginTop: "0.75rem" }}>
              <span>Start</span>
              <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </label>
            <label className="field" style={{ marginTop: "0.75rem" }}>
              <span>End</span>
              <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </label>
          </>
        ) : (
          <label className="checkbox-row">
            <input type="checkbox" checked={needsLive} onChange={(e) => setNeedsLive(e.target.checked)} />
            Push finalized bars to Kafka live delivery
          </label>
        )}

        {err ? <p className="error" style={{ marginTop: "0.5rem" }}>{err}</p> : null}
        <p style={{ marginTop: "0.75rem" }}>
          <button type="submit" className="primary" disabled={submitting || !symbol}>
            {submitting ? "Requesting…" : scope === "historical" ? "Request Historical Data" : "Request Live Data"}
          </button>
        </p>
      </form>
    </div>
  );
}
