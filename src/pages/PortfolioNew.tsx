import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createPortfolio,
  type Portfolio,
  type CreatePortfolioPayload,
} from "@/api/client";

const portfolioEnvironments = [
  { code: 0, label: "Backtest" },
  { code: 1, label: "Demo" },
  { code: 2, label: "Live" },
];

type PortfolioNewProps = {
  embedded?: boolean;
  onCreated?: (portfolio: Portfolio) => void;
};

function environmentLabel(environment: number): string {
  return portfolioEnvironments.find((item) => item.code === environment)?.label || `Environment ${environment}`;
}

export default function PortfolioNew({ embedded = false, onCreated }: PortfolioNewProps = {}) {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [environment, setEnvironment] = useState(0);
  const [step, setStep] = useState<"edit" | "preview">("edit");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleEnvironmentChange(value: number) {
    setEnvironment(value);
    setErr(null);
  }

  function buildPayload(): CreatePortfolioPayload {
    return {
      name,
      description: description.trim() || undefined,
      environment,
    };
  }

  async function doCreate() {
    setErr(null);
    setLoading(true);
    try {
      const acc = await createPortfolio(buildPayload());
      if (onCreated) {
        onCreated(acc);
      } else {
        nav(`/portfolios/${acc.portfolio_id}`, { replace: true });
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Create failed");
    } finally {
      setLoading(false);
    }
  }

  if (step === "preview") {
    return (
      <div>
        {embedded ? null : <h1>Confirm Portfolio</h1>}
        {embedded ? null : <p className="muted"><Link to="/portfolios">Back to list</Link></p>}
        {err ? <p className="error">{err}</p> : null}

        <div className="card">
          <h2 className="section-title">Portfolio meta</h2>
          <p><strong>{name}</strong></p>
          {description.trim() ? <p className="muted">{description.trim()}</p> : null}

          <h2 className="section-title">Portfolio environment</h2>
          <p className="muted">Environment: {environmentLabel(environment)}</p>
          <p className="muted">Venue is created separately in Venue Management after the portfolio exists.</p>
        </div>

        <p style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
          <button type="button" onClick={() => setStep("edit")}>Back to Edit</button>
          <button type="button" className="primary" disabled={loading} onClick={doCreate}>
            {loading ? "Creating..." : "Confirm & Create"}
          </button>
        </p>
      </div>
    );
  }

  return (
    <div>
      {embedded ? null : <h1>New portfolio</h1>}
      {embedded ? null : <p className="muted"><Link to="/portfolios">Back to list</Link></p>}
      <div className="card">
        {err ? <p className="error">{err}</p> : null}
        <form onSubmit={(e) => { e.preventDefault(); setStep("preview"); }}>
          <h2 className="section-title">Portfolio meta</h2>
          <label htmlFor="name">Name</label>
          <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />

          <label htmlFor="description">Description</label>
          <input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional note for remembering this portfolio"
          />

          <h2 className="section-title">Portfolio environment</h2>
          <label htmlFor="portfolio-environment">Environment</label>
          <select id="portfolio-environment" value={environment} onChange={(e) => handleEnvironmentChange(Number(e.target.value))}>
            {portfolioEnvironments.map((item) => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </select>

          {environment === 0 ? (
            <p className="muted">Backtest venues are created separately in Venue Management.</p>
          ) : (
            <p className="muted">
              Exchange credentials are created in Venue Management after the portfolio exists.
              Quick Start will send you there when a venue is required.
            </p>
          )}

          <p style={{ marginTop: "1rem" }}>
            <button type="submit" className="primary">
              Preview & Create
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
