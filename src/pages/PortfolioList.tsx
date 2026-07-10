import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listPortfolios, type Portfolio } from "@/api/client";
import { portfolioEnvironmentLabel } from "@/utils/portfolioEnvironment";

export default function PortfolioList() {
  const [rows, setRows] = useState<Portfolio[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const data = await listPortfolios();
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1>Portfolios</h1>
      <p className="muted">
        <Link to="/portfolios/new">Create portfolio</Link>
      </p>
      {loading ? <p className="muted">Loading…</p> : null}
      {err ? <p className="error">{err}</p> : null}
      {!loading && !err && rows && rows.length === 0 ? (
        <p className="muted">No portfolios yet.</p>
      ) : null}
      {!loading && rows && rows.length > 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>Environment</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.portfolio_id}>
                  <td>
                    <Link to={`/portfolios/${a.portfolio_id}`}>{a.name}</Link>
                  </td>
                  <td className="muted" style={{ fontSize: "0.85rem" }}>
                    {a.portfolio_id}
                  </td>
                  <td>{portfolioEnvironmentLabel(a.environment)}</td>
                  <td>{a.description?.trim() || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
