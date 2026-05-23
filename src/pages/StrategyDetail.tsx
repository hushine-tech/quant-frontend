import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatUTCWithLocal } from "@/utils/time";
import { getStrategy, type Strategy } from "@/api/client";

export default function StrategyDetail() {
  const { id } = useParams<{ id: string }>();
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    getStrategy(id)
      .then((s) => { if (!cancelled) setStrategy(s); })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : "Load failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  return (
    <div>
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        <Link to="/strategies">← Back to strategies</Link>
      </p>

      {loading ? <p className="muted">Loading…</p> : null}
      {err ? <p className="error">{err}</p> : null}

      {!loading && strategy ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
            <h1 style={{ margin: 0 }}>{strategy.name}</h1>
            <span className="muted" style={{ fontSize: "1rem" }}>v{strategy.version}</span>
            {strategy.archived ? (
              <span className="status-badge status-badge--stopped">archived</span>
            ) : (
              <span className="status-badge status-badge--completed">active</span>
            )}
          </div>

          <div className="card">
            <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
              ID: {strategy.strategy_id} · Created {formatUTCWithLocal(strategy.created_at)}
            </p>
            {strategy.description ? (
              <p style={{ marginTop: "0.5rem", marginBottom: 0 }}>{strategy.description}</p>
            ) : null}
          </div>

          <h2 className="section-title">Code</h2>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <pre
              style={{
                margin: 0,
                padding: "1rem",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.85rem",
                lineHeight: 1.5,
                overflowX: "auto",
                background: "#f8fafc",
                color: "#0f172a",
                whiteSpace: "pre",
              }}
            >
              {strategy.code ?? ""}
            </pre>
          </div>
        </>
      ) : null}
    </div>
  );
}
