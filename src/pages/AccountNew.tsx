import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  bindVenue,
  createAccount,
  createVenue,
  listVenues,
  type CreateAccountPayload,
  type CreateVenuePayload,
  type Venue,
} from "@/api/client";
import AsyncSelect, { type AsyncSelectOption } from "@/components/AsyncSelect";
import { collectFilteredPage } from "@/utils/asyncSelectPagination";

const initialVenueEnvironments = [
  { code: 0, label: "Backtest" },
  { code: 1, label: "Demo" },
  { code: 2, label: "Live" },
];

type VenueAttachPolicy = "none" | "create" | "bind";

type AccountNewProps = {
  embedded?: boolean;
  onCreated?: () => void;
};

function venueEnvironmentFromCode(environment: number): CreateVenuePayload["environment"] {
  if (environment === 2) return "live";
  if (environment === 1) return "demo";
  return "backtest";
}

function environmentLabel(environment: number): string {
  return initialVenueEnvironments.find((item) => item.code === environment)?.label || `Environment ${environment}`;
}

export default function AccountNew({ embedded = false, onCreated }: AccountNewProps = {}) {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [environment, setEnvironment] = useState(0);
  const [backtestInitialBalance, setBacktestInitialBalance] = useState("10000");
  const [venueAttachPolicy, setVenueAttachPolicy] = useState<VenueAttachPolicy>("none");
  const [selectedVenueID, setSelectedVenueID] = useState("");
  const [venueExchange, setVenueExchange] = useState<CreateVenuePayload["exchange"]>("binance");
  const [venueMarket, setVenueMarket] = useState<CreateVenuePayload["market"]>("perpetual_futures");
  const [venueDisplayName, setVenueDisplayName] = useState("");
  const [venueDescription, setVenueDescription] = useState("");
  const [venueAPIKey, setVenueAPIKey] = useState("");
  const [venueAPISecret, setVenueAPISecret] = useState("");
  const [venueMarginMode, setVenueMarginMode] = useState<NonNullable<CreateVenuePayload["margin_mode"]>>("cross");
  const [venuePositionMode, setVenuePositionMode] = useState<NonNullable<CreateVenuePayload["position_mode"]>>("one_way");
  const [step, setStep] = useState<"edit" | "preview">("edit");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const venueEnv = venueEnvironmentFromCode(environment);
  const isVenueSpot = venueMarket === "spot";
  const canAttachExchangeVenue = environment !== 0;

  function handleEnvironmentChange(value: number) {
    setEnvironment(value);
    setSelectedVenueID("");
    setErr(null);
    if (value === 0) {
      setVenueAttachPolicy("none");
    }
  }

  function buildPayload(): CreateAccountPayload {
    return {
      name,
      description: description.trim() || undefined,
      environment,
    };
  }

  function initialVenueSummary(): string {
    if (environment === 0) {
      return `Create simulated Binance perpetual_futures venue with ${backtestInitialBalance || "0"} USDT`;
    }
    if (venueAttachPolicy === "create") {
      return `Create and bind ${venueExchange} ${venueEnv} ${venueMarket}`;
    }
    if (venueAttachPolicy === "bind") {
      return `Bind existing venue ${selectedVenueID || "-"}`;
    }
    return "Create account only";
  }

  async function doCreate() {
    setErr(null);
    const parsedBacktestInitialBalance = parseFloat(backtestInitialBalance);
    if (environment === 0 && (!Number.isFinite(parsedBacktestInitialBalance) || parsedBacktestInitialBalance <= 0)) {
      setErr("Backtest initial USDT must be greater than 0.");
      return;
    }
    if (canAttachExchangeVenue && venueAttachPolicy === "create" && (!venueAPIKey.trim() || !venueAPISecret.trim())) {
      setErr("API key and secret are required to create a demo/live venue.");
      return;
    }
    if (canAttachExchangeVenue && venueAttachPolicy === "bind" && !selectedVenueID) {
      setErr("Select a venue to bind, or choose Create account only.");
      return;
    }

    setLoading(true);
    try {
      const acc = await createAccount(buildPayload());
      try {
        if (environment === 0) {
          await createVenue({
            account_id: acc.account_id,
            exchange: "binance",
            market: "perpetual_futures",
            environment: "backtest",
            display_name: `${name.trim()} binance backtest perpetual_futures`,
            description: "Backtest wallet venue",
            margin_mode: "cross",
            position_mode: "one_way",
            futures: {
              margin_mode: "cross",
              position_mode: "one_way",
              initial_balance: parsedBacktestInitialBalance,
              positions: [],
            },
          });
        }
        if (canAttachExchangeVenue && venueAttachPolicy === "create") {
          await createVenue({
            account_id: acc.account_id,
            exchange: venueExchange,
            market: venueMarket,
            environment: venueEnv,
            display_name: venueDisplayName.trim() || `${name.trim()} ${venueExchange} ${venueEnv} ${venueMarket}`,
            description: venueDescription.trim() || undefined,
            api_key: venueAPIKey.trim(),
            credential_info: { api_key: venueAPIKey.trim(), api_secret: venueAPISecret.trim() },
            margin_mode: isVenueSpot ? "none" : venueMarginMode,
            position_mode: isVenueSpot ? "none" : venuePositionMode,
          });
        }
        if (canAttachExchangeVenue && venueAttachPolicy === "bind") {
          await bindVenue(selectedVenueID, acc.account_id, `bound during account ${acc.account_id} creation`);
        }
      } catch (venueErr) {
        setErr(`Account ${acc.account_id} created, but venue binding failed: ${venueErr instanceof Error ? venueErr.message : "unknown error"}`);
        return;
      }
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

  if (step === "preview") {
    return (
      <div>
        {embedded ? null : <h1>Confirm Account</h1>}
        {embedded ? null : <p className="muted"><Link to="/accounts">Back to list</Link></p>}
        {err ? <p className="error">{err}</p> : null}

        <div className="card">
          <h2 className="section-title">Account meta</h2>
          <p><strong>{name}</strong></p>
          {description.trim() ? <p className="muted">{description.trim()}</p> : null}

          <h2 className="section-title">Initial venue</h2>
          <p className="muted">Environment: {environmentLabel(environment)}</p>
          <p className="muted">Venue: {initialVenueSummary()}</p>
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
      {embedded ? null : <h1>New account</h1>}
      {embedded ? null : <p className="muted"><Link to="/accounts">Back to list</Link></p>}
      <div className="card">
        {err ? <p className="error">{err}</p> : null}
        <form onSubmit={(e) => { e.preventDefault(); setStep("preview"); }}>
          <h2 className="section-title">Account meta</h2>
          <label htmlFor="name">Name</label>
          <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />

          <label htmlFor="description">Description</label>
          <input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional note for remembering this account"
          />

          <h2 className="section-title">Initial venue</h2>
          <label htmlFor="initial-venue-environment">Environment</label>
          <select id="initial-venue-environment" value={environment} onChange={(e) => handleEnvironmentChange(Number(e.target.value))}>
            {initialVenueEnvironments.map((item) => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </select>

          {environment === 0 ? (
            <>
              <p className="muted">Backtest creates a simulated Binance perpetual futures venue and wallet.</p>
              <label htmlFor="backtest-initial-balance">Initial USDT</label>
              <input
                id="backtest-initial-balance"
                type="number"
                min="0"
                step="0.0001"
                required
                value={backtestInitialBalance}
                onChange={(e) => setBacktestInitialBalance(e.target.value)}
              />
            </>
          ) : (
            <>
              <label htmlFor="venue-attach-policy">Venue binding</label>
              <select
                id="venue-attach-policy"
                value={venueAttachPolicy}
                onChange={(e) => {
                  setVenueAttachPolicy(e.target.value as VenueAttachPolicy);
                  setErr(null);
                }}
              >
                <option value="none">Create account only</option>
                <option value="create">Create venue and bind</option>
                <option value="bind">Bind existing venue</option>
              </select>

              {venueAttachPolicy === "create" ? (
                <details className="wallet-details" open>
                  <summary>Create and bind venue</summary>
                  <div className="wallet-details__body">
                    <label htmlFor="venue-display-name">Display name</label>
                    <input
                      id="venue-display-name"
                      value={venueDisplayName}
                      onChange={(e) => setVenueDisplayName(e.target.value)}
                      placeholder={`${name || "account"} binance ${venueEnv} perp`}
                    />

                    <label htmlFor="venue-description">Venue description</label>
                    <input
                      id="venue-description"
                      value={venueDescription}
                      onChange={(e) => setVenueDescription(e.target.value)}
                      placeholder="Optional note for this exchange credential"
                    />

                    <div className="strategy-new-form__row-2">
                      <label className="field">
                        <span>Exchange</span>
                        <select value={venueExchange} onChange={(e) => setVenueExchange(e.target.value as CreateVenuePayload["exchange"])}>
                          <option value="binance">Binance</option>
                          <option value="okx">OKX</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Market</span>
                        <select value={venueMarket} onChange={(e) => setVenueMarket(e.target.value as CreateVenuePayload["market"])}>
                          <option value="spot">Spot</option>
                          <option value="perpetual_futures">Perpetual futures</option>
                          <option value="delivery_futures">Delivery futures</option>
                        </select>
                      </label>
                    </div>

                    {!isVenueSpot ? (
                      <div className="strategy-new-form__row-2">
                        <label className="field">
                          <span>Margin mode</span>
                          <select value={venueMarginMode} onChange={(e) => setVenueMarginMode(e.target.value as NonNullable<CreateVenuePayload["margin_mode"]>)}>
                            <option value="cross">Cross</option>
                            <option value="isolated">Isolated</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>Position mode</span>
                          <select value={venuePositionMode} onChange={(e) => setVenuePositionMode(e.target.value as NonNullable<CreateVenuePayload["position_mode"]>)}>
                            <option value="one_way">One-way</option>
                            <option value="hedge">Hedge</option>
                          </select>
                        </label>
                      </div>
                    ) : null}

                    <label htmlFor="venue-api-key">API key</label>
                    <input id="venue-api-key" value={venueAPIKey} onChange={(e) => setVenueAPIKey(e.target.value)} />

                    <label htmlFor="venue-api-secret">API secret</label>
                    <input id="venue-api-secret" type="password" value={venueAPISecret} onChange={(e) => setVenueAPISecret(e.target.value)} />
                  </div>
                </details>
              ) : null}

              {venueAttachPolicy === "bind" ? (
                <details className="wallet-details" open>
                  <summary>Bind existing venue</summary>
                  <div className="wallet-details__body">
                    <label>Venue</label>
                    <AsyncSelect<Venue>
                      value={selectedVenueID}
                      placeholder="Select compatible venue"
                      onChange={setSelectedVenueID}
                      loadPage={async (offset, limit, query) => {
                        const normalizedQuery = query.trim().toLowerCase();
                        return collectFilteredPage<Venue, AsyncSelectOption<Venue>>({
                          offset,
                          limit,
                          loadSourcePage: (sourceOffset, sourceLimit) => listVenues({ offset: sourceOffset, limit: sourceLimit, include_unbound: true }),
                          matches: (venue) => venue.environment === environment
                            && (!normalizedQuery
                            || (venue.display_name || "").toLowerCase().includes(normalizedQuery)
                            || String(venue.venue_id).includes(normalizedQuery)
                            || (venue.api_key || "").toLowerCase().includes(normalizedQuery)),
                          map: (venue) => ({
                            value: String(venue.venue_id),
                            label: venue.display_name || `venue-${venue.venue_id}`,
                            detail: `${venue.exchange_label || venue.exchange} - ${venue.market_label || venue.market} - ${venue.environment_label || venue.environment} - ${venue.account_id ? `account ${venue.account_id}` : "unbound"}`,
                            item: venue,
                          }),
                        });
                      }}
                      searchPlaceholder="Search venue name, ID, or API key"
                    />
                  </div>
                </details>
              ) : null}
            </>
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
