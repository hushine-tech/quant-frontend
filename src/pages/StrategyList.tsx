import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatUTCWithLocal } from "@/utils/time";
import {
  listStrategies,
  createStrategy,
  archiveStrategy,
  type Strategy,
} from "@/api/client";

export default function StrategyList() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const list = await listStrategies();
      setStrategies(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleArchive(id: number) {
    try {
      await archiveStrategy(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Archive failed");
    }
  }

  return (
    <div>
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        <Link to="/accounts">← Back to accounts</Link>
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>Strategies</h1>
        <button className="primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Cancel" : "+ New Strategy"}
        </button>
      </div>

      {showCreate && (
        <CreateStrategyForm
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}

      {err ? <p className="error">{err}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && strategies.length === 0 ? (
        <div className="card"><p className="muted">No strategies yet. Create one above.</p></div>
      ) : null}

      {strategies.map((s) => (
        <div key={s.strategy_id} className="card" style={{ marginBottom: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <Link to={`/strategies/${s.strategy_id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <strong>{s.name}</strong>{" "}
                <span className="muted">v{s.version}</span>
              </Link>
              {s.archived ? (
                <span className="status-badge status-badge--stopped" style={{ marginLeft: "0.5rem" }}>archived</span>
              ) : (
                <span className="status-badge status-badge--completed" style={{ marginLeft: "0.5rem" }}>active</span>
              )}
              {s.description ? <p className="muted" style={{ margin: "0.25rem 0 0" }}>{s.description}</p> : null}
              <p className="muted" style={{ fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
                ID: {s.strategy_id} · Created {formatUTCWithLocal(s.created_at)}
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <Link
                to={`/strategies/${s.strategy_id}`}
                style={{ fontSize: "0.8rem" }}
              >
                View
              </Link>
              {!s.archived ? (
                <button
                  style={{ fontSize: "0.8rem" }}
                  onClick={() => handleArchive(s.strategy_id)}
                >
                  Archive
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ))}
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
    <div className="card" style={{ marginBottom: "1rem" }}>
      <p style={{ fontWeight: 600, marginBottom: "0.75rem" }}>New Strategy</p>
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
