import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createAccount, type CreateAccountPayload } from "@/api/client";
import SymbolPicker from "@/components/SymbolPicker";

const modes = [
  { v: 0, label: "Backtest (0)" },
  { v: 1, label: "Binance live (1)" },
  { v: 2, label: "Binance demo (2)" },
];

type SpotRow = { symbol: string; qty: string; price: string; avg: string };
type FutRow = { symbol: string; direction: string; initial_balance: string; leverage: string; fee_rate: string };

type AccountNewProps = {
  embedded?: boolean;
  onCreated?: () => void;
};

export default function AccountNew({ embedded = false, onCreated }: AccountNewProps = {}) {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");

  // Spot
  const [spotFree, setSpotFree] = useState("0");
  const [spotRows, setSpotRows] = useState<SpotRow[]>([]);
  const [showSpotAdd, setShowSpotAdd] = useState(false);

  // Futures
  const [marginMode, setMarginMode] = useState<"isolated" | "cross">("isolated");
  const [positionMode, setPositionMode] = useState<"one_way" | "hedge">("one_way");
  const [futInitial, setFutInitial] = useState("0");
  const [futRows, setFutRows] = useState<FutRow[]>([]);
  const [showFutAdd, setShowFutAdd] = useState(false);

  // UI state
  const [step, setStep] = useState<"edit" | "preview">("edit");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const wizard = mode === 0;

  // ── Computed total value ────────────────────────────────────────────────
  function computeTotalValue(): number {
    let total = 0;
    // Spot: free + sum(qty * price) for priced assets
    total += parseFloat(spotFree) || 0;
    for (const r of spotRows) {
      const qty = parseFloat(r.qty) || 0;
      const price = parseFloat(r.price) || 0;
      total += qty * price;
    }
    // Futures: cross pool or sum of isolated initial_balance
    if (marginMode === "cross") {
      total += parseFloat(futInitial) || 0;
    } else {
      for (const r of futRows) {
        total += parseFloat(r.initial_balance) || 0;
      }
    }
    return total;
  }

  // ── Add / Remove ───────────────────────────────────────────────────────
  function addSpot(sym: string) {
    const u = sym.toUpperCase();
    if (spotRows.some((r) => r.symbol === u)) return;
    setSpotRows((r) => [...r, { symbol: u, qty: "0", price: "", avg: "0" }]);
    setShowSpotAdd(false);
  }

  function addFut(sym: string) {
    const u = sym.toUpperCase();
    if (futRows.some((r) => r.symbol === u)) return;
    setFutRows((r) => [...r, { symbol: u, direction: "0", initial_balance: "1000", leverage: "10", fee_rate: "0.0004" }]);
    setShowFutAdd(false);
  }

  function removeSpot(sym: string) {
    setSpotRows((r) => r.filter((x) => x.symbol !== sym));
  }

  function removeFut(sym: string) {
    setFutRows((r) => r.filter((x) => x.symbol !== sym));
  }

  function updateSpotRow(sym: string, field: keyof SpotRow, val: string) {
    setSpotRows((rows) => rows.map((x) => (x.symbol === sym ? { ...x, [field]: val } : x)));
  }

  function updateFutRow(sym: string, field: keyof FutRow, val: string) {
    setFutRows((rows) => rows.map((x) => (x.symbol === sym ? { ...x, [field]: val } : x)));
  }

  // ── Build payload ──────────────────────────────────────────────────────
  function buildPayload(): CreateAccountPayload {
    const body: CreateAccountPayload = {
      name,
      description: description.trim() || undefined,
      mode,
      api_key: apiKey || undefined,
      api_secret: apiSecret || undefined,
      initial_balance: 0,
    };

    if (wizard && (spotRows.length > 0 || parseFloat(spotFree))) {
      body.spot = {
        free: parseFloat(spotFree) || 0,
        locked: 0,
        assets: spotRows.map((r) => {
          const asset: { symbol: string; qty: number; locked: number; avg_entry_price: number; price?: number } = {
            symbol: r.symbol,
            qty: parseFloat(r.qty) || 0,
            locked: 0,
            avg_entry_price: parseFloat(r.avg) || 0,
          };
          if (r.price.trim() !== "") {
            const p = parseFloat(r.price);
            if (!Number.isNaN(p)) asset.price = p;
          }
          return asset;
        }),
      };
    }

    if (wizard && (futRows.length > 0 || (marginMode === "cross" && parseFloat(futInitial)))) {
      body.futures = {
        margin_mode: marginMode,
        position_mode: positionMode,
        initial_balance: marginMode === "cross" ? (parseFloat(futInitial) || 0) : 0,
        positions: futRows.map((r) => {
          const dir = parseInt(r.direction, 10);
          return {
            symbol: r.symbol,
            direction: Number.isFinite(dir) ? dir : 0,
            initial_balance: marginMode === "isolated" ? (parseFloat(r.initial_balance) || 0) : undefined,
            leverage: parseFloat(r.leverage) || 10,
            fee_rate: parseFloat(r.fee_rate) || 0.0004,
          };
        }),
      };
    }

    return body;
  }

  async function doCreate() {
    setErr(null);
    setLoading(true);
    try {
      const acc = await createAccount(buildPayload());
      if (onCreated) {
        onCreated();
      } else {
        nav(`/accounts/${acc.account_id}`, { replace: true });
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Create failed");
    } finally {
      setLoading(false);
    }
  }

  const totalValue = wizard ? computeTotalValue() : 0;

  // ── Preview step ───────────────────────────────────────────────────────
  if (step === "preview") {
    return (
      <div>
        {embedded ? null : <h1>Confirm Account</h1>}
        {embedded ? null : <p className="muted"><Link to="/accounts">Back to list</Link></p>}
        {err ? <p className="error">{err}</p> : null}

        <div className="card">
          <h2 className="section-title">Meta</h2>
          <p><strong>{name}</strong></p>
          {description.trim() ? <p className="muted">{description.trim()}</p> : null}
          <p className="muted">Mode: {modes.find((m) => m.v === mode)?.label}</p>
          {wizard ? (
            <p><strong>Estimated Total Value: {totalValue.toFixed(2)} USDT</strong></p>
          ) : null}
        </div>

        {wizard ? (
          <>
            <details className="wallet-details" open>
              <summary>Spot wallet</summary>
              <div className="wallet-details__body">
                <p>Free: <strong>{parseFloat(spotFree) || 0} USDT</strong></p>
                {spotRows.length > 0 ? (
                  <table className="compact">
                    <thead>
                      <tr><th>Symbol</th><th>Qty</th><th>Avg Entry</th><th>Mark Price</th><th>Value</th></tr>
                    </thead>
                    <tbody>
                      {spotRows.map((r) => {
                        const qty = parseFloat(r.qty) || 0;
                        const price = parseFloat(r.price) || 0;
                        return (
                          <tr key={r.symbol}>
                            <td>{r.symbol}</td>
                            <td>{qty}</td>
                            <td>{parseFloat(r.avg) || 0}</td>
                            <td>{price || "—"}</td>
                            <td>{price ? (qty * price).toFixed(2) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : <p className="muted">No spot assets</p>}
              </div>
            </details>

            <details className="wallet-details" open>
              <summary>Futures wallet</summary>
              <div className="wallet-details__body">
                <p className="muted">
                  {marginMode === "cross" ? "Cross" : "Isolated"} · {positionMode}
                </p>
                {marginMode === "cross" ? (
                  <p>Cross Pool: <strong>{parseFloat(futInitial) || 0} USDT</strong></p>
                ) : null}
                {futRows.length > 0 ? (
                  <table className="compact">
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Direction</th>
                        <th>Leverage</th>
                        <th>Fee Rate</th>
                        {marginMode === "isolated" ? <th>Initial Balance</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {futRows.map((r) => (
                        <tr key={r.symbol}>
                          <td>{r.symbol}</td>
                          <td>{r.direction === "0" ? "One-way" : r.direction === "1" ? "Long" : "Short"}</td>
                          <td>{r.leverage}x</td>
                          <td>{r.fee_rate}</td>
                          {marginMode === "isolated" ? <td>{parseFloat(r.initial_balance) || 0} USDT</td> : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="muted">No futures positions</p>}
              </div>
            </details>
          </>
        ) : null}

        <p style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
          <button type="button" onClick={() => setStep("edit")}>Back to Edit</button>
          <button type="button" className="primary" disabled={loading} onClick={doCreate}>
            {loading ? "Creating…" : "Confirm & Create"}
          </button>
        </p>
      </div>
    );
  }

  // ── Edit step ──────────────────────────────────────────────────────────
  return (
    <div>
      {embedded ? null : <h1>New account</h1>}
      {embedded ? null : <p className="muted"><Link to="/accounts">Back to list</Link></p>}
      <div className="card">
        {err ? <p className="error">{err}</p> : null}
        <form onSubmit={(e) => { e.preventDefault(); setStep("preview"); }}>
          {/* ── Meta ──────────────────────────────────────── */}
          <h2 className="section-title">Meta</h2>
          <label htmlFor="name">Name</label>
          <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />

          <label htmlFor="description">Description</label>
          <input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional note for remembering this account"
          />

          <label htmlFor="mode">Mode</label>
          <select id="mode" value={mode} onChange={(e) => setMode(Number(e.target.value))}>
            {modes.map((m) => (
              <option key={m.v} value={m.v}>{m.label}</option>
            ))}
          </select>

          {mode !== 0 ? (
            <>
              <label htmlFor="ak">API Key</label>
              <input id="ak" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <label htmlFor="as">API Secret</label>
              <input id="as" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} />
            </>
          ) : null}

          {wizard ? (
            <p style={{ marginTop: "0.75rem" }}>
              <strong>Estimated Total Value: {totalValue.toFixed(2)} USDT</strong>
            </p>
          ) : null}

          {wizard ? (
            <>
              {/* ── Spot Wallet ────────────────────────────── */}
              <details className="wallet-details" open>
                <summary style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Spot wallet</span>
                  <button
                    type="button"
                    style={{ fontSize: "0.8rem", padding: "0.15rem 0.5rem" }}
                    onClick={(e) => { e.preventDefault(); setShowSpotAdd((v) => !v); }}
                  >
                    + Add Asset
                  </button>
                </summary>
                <div className="wallet-details__body">
                  <label htmlFor="sf">Free (USDT)</label>
                  <input id="sf" type="number" step="any" value={spotFree} onChange={(e) => setSpotFree(e.target.value)} />

                  {showSpotAdd ? (
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "0.75rem", margin: "0.5rem 0" }}>
                      <SymbolPicker market="spot" label="Search spot symbol" onAdd={addSpot} extraSymbols={["TESTUSDT"]} />
                    </div>
                  ) : null}

                  {spotRows.length > 0 ? (
                    <table className="compact">
                      <thead>
                        <tr><th>Symbol</th><th>Qty</th><th>Avg Entry</th><th>Mark Price</th><th></th></tr>
                      </thead>
                      <tbody>
                        {spotRows.map((r) => (
                          <tr key={r.symbol}>
                            <td>{r.symbol}</td>
                            <td><input className="table-input" value={r.qty} onChange={(e) => updateSpotRow(r.symbol, "qty", e.target.value)} /></td>
                            <td><input className="table-input" value={r.avg} onChange={(e) => updateSpotRow(r.symbol, "avg", e.target.value)} /></td>
                            <td><input className="table-input" placeholder="optional" value={r.price} onChange={(e) => updateSpotRow(r.symbol, "price", e.target.value)} /></td>
                            <td><button type="button" onClick={() => removeSpot(r.symbol)}>Remove</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="muted">No spot assets added yet</p>}
                </div>
              </details>

              {/* ── Futures Wallet ─────────────────────────── */}
              <details className="wallet-details" open>
                <summary style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Futures wallet (USDT-M)</span>
                  <button
                    type="button"
                    style={{ fontSize: "0.8rem", padding: "0.15rem 0.5rem" }}
                    onClick={(e) => { e.preventDefault(); setShowFutAdd((v) => !v); }}
                  >
                    + Add Position
                  </button>
                </summary>
                <div className="wallet-details__body">
                  <label htmlFor="mm">Margin mode</label>
                  <select id="mm" value={marginMode} onChange={(e) => setMarginMode(e.target.value as "isolated" | "cross")}>
                    <option value="isolated">Isolated</option>
                    <option value="cross">Cross</option>
                  </select>

                  <label htmlFor="pm">Position mode</label>
                  <select id="pm" value={positionMode} onChange={(e) => setPositionMode(e.target.value as "one_way" | "hedge")}>
                    <option value="one_way">One-way</option>
                    <option value="hedge">Hedge</option>
                  </select>

                  {marginMode === "cross" ? (
                    <>
                      <label htmlFor="fi">Cross pool initial balance</label>
                      <input id="fi" type="number" step="any" value={futInitial} onChange={(e) => setFutInitial(e.target.value)} />
                    </>
                  ) : null}

                  {showFutAdd ? (
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: "6px", padding: "0.75rem", margin: "0.5rem 0" }}>
                      <SymbolPicker market="usdm_futures" label="Search futures symbol" onAdd={addFut} extraSymbols={["TESTUSDT"]} />
                    </div>
                  ) : null}

                  {futRows.length > 0 ? (
                    <table className="compact">
                      <thead>
                        <tr>
                          <th>Symbol</th>
                          <th>Direction</th>
                          <th>Leverage</th>
                          <th>Fee Rate</th>
                          {marginMode === "isolated" ? <th>Initial Balance</th> : null}
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {futRows.map((r) => (
                          <tr key={r.symbol}>
                            <td>{r.symbol}</td>
                            <td>
                              <select className="table-input" value={r.direction} onChange={(e) => updateFutRow(r.symbol, "direction", e.target.value)}>
                                <option value="0">One-way (0)</option>
                                <option value="1">Long (+1)</option>
                                <option value="-1">Short (-1)</option>
                              </select>
                            </td>
                            <td><input className="table-input" type="number" step="any" value={r.leverage} onChange={(e) => updateFutRow(r.symbol, "leverage", e.target.value)} /></td>
                            <td><input className="table-input" type="number" step="any" value={r.fee_rate} onChange={(e) => updateFutRow(r.symbol, "fee_rate", e.target.value)} /></td>
                            {marginMode === "isolated" ? (
                              <td><input className="table-input" type="number" step="any" placeholder="1000" value={r.initial_balance} onChange={(e) => updateFutRow(r.symbol, "initial_balance", e.target.value)} /></td>
                            ) : null}
                            <td><button type="button" onClick={() => removeFut(r.symbol)}>Remove</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="muted">No futures positions added yet</p>}
                </div>
              </details>
            </>
          ) : (
            <p className="muted">
              Spot/futures wallet configuration is available for <strong>backtest</strong> mode only.
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
