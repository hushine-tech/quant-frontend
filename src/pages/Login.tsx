import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { login } from "@/api/client";

export default function Login() {
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await login(username, password);
      nav("/accounts", { replace: true });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420 }}>
      <h1>Sign in</h1>
      <p className="muted">Sign in with your username and password.</p>
      {err ? <p className="error">{err}</p> : null}
      <form onSubmit={onSubmit}>
        <label htmlFor="username">Username</label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <label htmlFor="pw">Password</label>
        <input
          id="pw"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p style={{ marginTop: "1rem" }}>
          <button type="submit" className="primary" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </p>
      </form>
      <p className="muted" style={{ marginTop: "1rem" }}>
        No account yet? <Link to="/signup">Create one</Link>
      </p>
    </div>
  );
}
