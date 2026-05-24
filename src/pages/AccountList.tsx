import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listAccounts, type Account } from "@/api/client";
import { accountModeLabel } from "@/utils/accountMode";

export default function AccountList() {
  const [rows, setRows] = useState<Account[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const data = await listAccounts();
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
      <h1>Accounts</h1>
      <p className="muted">
        <Link to="/accounts/new">Create account</Link>
      </p>
      {loading ? <p className="muted">Loading…</p> : null}
      {err ? <p className="error">{err}</p> : null}
      {!loading && !err && rows && rows.length === 0 ? (
        <p className="muted">No accounts yet.</p>
      ) : null}
      {!loading && rows && rows.length > 0 ? (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>Mode</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.account_id}>
                  <td>
                    <Link to={`/accounts/${a.account_id}`}>{a.name}</Link>
                  </td>
                  <td className="muted" style={{ fontSize: "0.85rem" }}>
                    {a.account_id}
                  </td>
                  <td>{accountModeLabel(a.mode)}</td>
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
