import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signup } from "@/api/client";

export default function Signup() {
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirmPassword) {
      setErr("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await signup(username, password);
      nav("/login", { replace: true });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420 }}>
      <h1>Create user</h1>
      <p className="muted">Usernames must use letters, numbers, `_` or `-`.</p>
      {err ? <p className="error">{err}</p> : null}
      <form onSubmit={onSubmit}>
        <label htmlFor="signup-username">Username</label>
        <input
          id="signup-username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <label htmlFor="signup-password">Password</label>
        <input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <label htmlFor="signup-confirm">Confirm password</label>
        <input
          id="signup-confirm"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        <p style={{ marginTop: "1rem" }}>
          <button type="submit" className="primary" disabled={loading}>
            {loading ? "Creating…" : "Create user"}
          </button>
        </p>
      </form>
      <p className="muted" style={{ marginTop: "1rem" }}>
        Already have a user? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
