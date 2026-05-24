import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { formatUTCWithLocal } from "@/utils/time";
import PageHeader from "@/components/PageHeader";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import InfiniteTable from "@/components/InfiniteTable";
import {
  listStrategiesPage,
  createStrategy,
  archiveStrategy,
  type Strategy,
} from "@/api/client";

type StrategyTab = "strategies" | "create";

const tabs: Array<PageTab<StrategyTab>> = [
  { id: "strategies", label: "Strategies" },
  { id: "create", label: "Create Strategy" },
];

export default function StrategyList() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StrategyTab>("strategies");
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async (offset: number, limit: number) => {
    setLoading(true);
    setErr(null);
    try {
      return await listStrategiesPage({ offset, limit });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleArchive(id: number) {
    try {
      await archiveStrategy(id);
      setRefreshKey((v) => v + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Archive failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Strategy Management"
        description="Create, archive, and inspect strategy definitions."
        loading={loading}
        onRefresh={activeTab === "strategies" ? () => setRefreshKey((v) => v + 1) : undefined}
      />

      {err ? <p className="error">{err}</p> : null}
      <PageTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} ariaLabel="Strategy sections">
        {activeTab === "strategies" ? (
          <InfiniteTable<Strategy>
            columns={["Name", "ID", "Version", "Status", "Description", "Created", "Action"]}
            loadPage={load}
            refreshKey={refreshKey}
            emptyText="No strategies yet."
            rowKey={(strategy) => String(strategy.strategy_id)}
            renderRow={(strategy) => (
              <>
                <td><Link to={`/strategies/${strategy.strategy_id}`}>{strategy.name}</Link></td>
                <td><code>{strategy.strategy_id}</code></td>
                <td>{strategy.version}</td>
                <td>
                  {strategy.archived ? (
                    <span className="status-badge status-badge--stopped">archived</span>
                  ) : (
                    <span className="status-badge status-badge--completed">active</span>
                  )}
                </td>
                <td>{strategy.description || "-"}</td>
                <td>{formatUTCWithLocal(strategy.created_at)}</td>
                <td>
                  {!strategy.archived ? (
                    <button type="button" onClick={() => void handleArchive(strategy.strategy_id)}>Archive</button>
                  ) : null}
                </td>
              </>
            )}
          />
        ) : (
          <CreateStrategyForm
            onCreated={() => {
              setActiveTab("strategies");
              setRefreshKey((v) => v + 1);
            }}
          />
        )}
      </PageTabs>
    </div>
  );
}

// ── Create Strategy Form ──────────────────────────────────────────────────────

function CreateStrategyForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState(
    `class MyStrategy:\n    def on_market_data(self, data, wallet):\n        return None\n`
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !version || !code) return;
    setSubmitting(true);
    setErr(null);
    try {
      await createStrategy({ name, version, description, code });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p style={{ fontWeight: 600, marginTop: 0, marginBottom: "0.75rem" }}>Create Strategy</p>
      <form className="strategy-new-form" onSubmit={handleSubmit}>
        <div className="strategy-new-form__row-2">
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-strategy"
              required
            />
          </label>
          <label className="field">
            <span>Version</span>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.0.0"
              pattern="\d+\.\d+\.\d+"
              required
            />
          </label>
        </div>
        <label className="field">
          <span>Description</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </label>
        <label className="field">
          <span>Code</span>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={10}
            required
          />
        </label>
        {err ? <p className="error" style={{ marginTop: "0.5rem" }}>{err}</p> : null}
        <p style={{ marginTop: "0.75rem" }}>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? "Creating…" : "Create Strategy"}
          </button>
        </p>
      </form>
    </div>
  );
}
