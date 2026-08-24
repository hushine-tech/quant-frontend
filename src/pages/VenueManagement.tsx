import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Building2 } from "lucide-react";
import {
  archiveVenue,
  bindVenue,
  createVenue,
  getVenueWallet,
  listPortfoliosPage,
  listVenues,
  releaseVenue,
  canonicalSpotWalletAsset,
  defaultSpotWalletAssets,
  type Portfolio,
  type CreateVenuePayload,
  type SpotAsset,
  type SpotSymbolCatalogEntry,
  type Venue,
  type VenueWallet,
} from "@/api/client";
import AsyncSelect, { type AsyncSelectOption } from "@/components/AsyncSelect";
import InfiniteTable from "@/components/InfiniteTable";
import PageHeader from "@/components/PageHeader";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import QuickStartActionButton from "@/components/QuickStartActionButton";
import SymbolPicker from "@/components/SymbolPicker";
import { collectFilteredPage } from "@/utils/asyncSelectPagination";
import { formatUTCWithLocal } from "@/utils/time";
import { appendReturnParam, isQuickStartReturnTo, safeInternalReturnTo } from "@/utils/returnTo";

type VenueTab = "venues" | "create";
type SpotRow = SpotAsset & { symbol?: string };
type FutRow = { symbol: string; direction: string; initial_balance: string; fee_rate: string };
type VenueCreatedResult = { reusedExisting?: boolean };

const tabs: Array<PageTab<VenueTab>> = [
  { id: "venues", label: "Venues" },
  { id: "create", label: "Create Venue" },
];

const duplicateVenueRouteMessage = "venue already exists for portfolio route or api key scope";

function normalizeVenueTab(value: string | null): VenueTab {
  return value === "create" ? "create" : "venues";
}

function label(value?: string, fallback?: number): string {
  return value || (fallback == null ? "-" : String(fallback));
}

function maskAPIKey(value?: string): string {
  if (!value) return "-";
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function isSyntheticBacktestKey(value?: string): boolean {
  return /^sim_btv_[0-9a-f]{32}$/.test(value || "");
}

function venueKeyLabel(value?: string): string {
  if (!value) return "-";
  const masked = maskAPIKey(value);
  return isSyntheticBacktestKey(value) ? `Synthetic ${masked}` : masked;
}

function portfolioEnvLabel(value?: number): string {
  switch (value) {
    case 1:
      return "demo";
    case 2:
      return "live";
    case 0:
      return "backtest";
    default:
      return "-";
  }
}

function portfolioEnvCode(portfolio: Portfolio): number {
  return typeof portfolio.environment === "number" ? portfolio.environment : 0;
}

function normalizeCreateEnvironment(value: string | null): CreateVenuePayload["environment"] {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "backtest") return "backtest";
  if (raw === "live") return "live";
  return "demo";
}

function createEnvironmentCode(environment: CreateVenuePayload["environment"]): number {
  if (environment === "backtest") return 0;
  if (environment === "live") return 2;
  return 1;
}

function createExchangeCode(exchange: CreateVenuePayload["exchange"]): number {
  return exchange === "okx" ? 2 : 1;
}

function createMarketCode(market: CreateVenuePayload["market"]): number {
  if (market === "spot") return 1;
  if (market === "delivery_futures") return 3;
  return 2;
}

function normalizedRouteLabel(value?: string): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function sameRouteValue(actualCode: number | undefined, actualLabel: string | undefined, expectedCode: number, expectedLabel: string): boolean {
  return actualCode === expectedCode || normalizedRouteLabel(actualLabel) === expectedLabel;
}

function isActiveVenue(venue: Venue): boolean {
  return venue.status === 1 || normalizedRouteLabel(venue.status_label) === "active";
}

function isDuplicateVenueRouteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(duplicateVenueRouteMessage);
}

export default function VenueManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<VenueTab>(() => normalizeVenueTab(searchParams.get("tab")));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [bindTargetVenue, setBindTargetVenue] = useState<Venue | null>(null);
  const [viewTargetVenue, setViewTargetVenue] = useState<Venue | null>(null);
  const [venueWallet, setVenueWallet] = useState<VenueWallet | null>(null);
  const [venueWalletError, setVenueWalletError] = useState<string | null>(null);
  const [venueWalletLoading, setVenueWalletLoading] = useState(false);
  const [bindPortfolioID, setBindPortfolioID] = useState("");
  const [binding, setBinding] = useState(false);
  const returnTo = safeInternalReturnTo(searchParams.get("return_to"));
  const quickStartMode = isQuickStartReturnTo(returnTo);

  function changeTab(tab: VenueTab) {
    setActiveTab(tab);
    const next: Record<string, string> = {};
    if (tab !== "venues") next.tab = tab;
    const portfolioID = searchParams.get("portfolio_id");
    if (portfolioID) next.portfolio_id = portfolioID;
    const environment = searchParams.get("environment");
    if (environment) next.environment = environment;
    const rawReturnTo = searchParams.get("return_to");
    if (rawReturnTo) next.return_to = rawReturnTo;
    setSearchParams(next);
  }

  const portfolioFilter = searchParams.get("portfolio_id") || undefined;

  const loadVenues = useCallback(async (offset: number, limit: number) => {
    setLoading(true);
    setError(null);
    try {
      return await listVenues({
        offset,
        limit,
        include_inactive: true,
        include_unbound: portfolioFilter ? false : true,
        portfolio_id: portfolioFilter,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load venues failed");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [portfolioFilter]);

  async function handleRelease(venue: Venue) {
    setError(null);
    setNotice(null);
    try {
      await releaseVenue(venue.venue_id, "released from venue management");
      setNotice("Venue released.");
      setRefreshKey((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Release venue failed");
    }
  }

  async function handleArchive(venue: Venue) {
    setError(null);
    setNotice(null);
    try {
      await archiveVenue(venue.venue_id, "archived from venue management");
      setNotice("Venue archived.");
      setRefreshKey((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Archive venue failed");
    }
  }

  async function loadVenueWallet(venue: Venue) {
    setVenueWalletLoading(true);
    setVenueWalletError(null);
    setVenueWallet(null);
    try {
      const result = await getVenueWallet(venue.venue_id);
      setVenueWallet(result);
    } catch (e) {
      setVenueWalletError(e instanceof Error ? e.message : "Load venue wallet failed");
    } finally {
      setVenueWalletLoading(false);
    }
  }

  function openVenueDetail(venue: Venue) {
    setViewTargetVenue(venue);
    void loadVenueWallet(venue);
  }

  async function handleBindSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bindTargetVenue || !bindPortfolioID) return;
    setError(null);
    setNotice(null);
    setBinding(true);
    try {
      const nextPortfolioID = Number(bindPortfolioID);
      await bindVenue(bindTargetVenue.venue_id, nextPortfolioID, `bound from venue management`);
      setNotice(bindTargetVenue.portfolio_id && bindTargetVenue.portfolio_id !== nextPortfolioID ? "Venue rebound." : "Venue bound.");
      setViewTargetVenue(null);
      setBindTargetVenue(null);
      setBindPortfolioID("");
      setRefreshKey((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bind venue failed");
    } finally {
      setBinding(false);
    }
  }

  const description = useMemo(() => {
    return activeTab === "venues"
      ? "Manage exchange venues, credentials, and portfolio bindings."
      : "Create a concrete exchange venue and bind it to an portfolio.";
  }, [activeTab]);

  return (
    <div>
      <PageHeader
        title="Venue Management"
        description={description}
        loading={loading}
        onRefresh={activeTab === "venues" ? () => setRefreshKey((v) => v + 1) : undefined}
      />
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}
      {viewTargetVenue ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
            <div>
              <h2 className="section-title" style={{ marginBottom: "0.5rem" }}>Venue detail</h2>
              <p style={{ margin: 0 }}><strong>{viewTargetVenue.display_name || `venue-${viewTargetVenue.venue_id}`}</strong></p>
              <p className="muted" style={{ marginTop: "0.25rem" }}>
                <code>{viewTargetVenue.venue_id}</code> · {label(viewTargetVenue.exchange_label, viewTargetVenue.exchange)} · {label(viewTargetVenue.market_label, viewTargetVenue.market)} · {label(viewTargetVenue.environment_label, viewTargetVenue.environment)}
              </p>
            </div>
            <button type="button" onClick={() => setViewTargetVenue(null)}>Close</button>
          </div>
          <div className="strategy-new-form__row-2" style={{ marginTop: "0.75rem" }}>
            <div>
              <p className="muted" style={{ marginBottom: "0.25rem" }}>Bound portfolio</p>
              {viewTargetVenue.portfolio_id ? (
                <Link to={`/portfolios/${viewTargetVenue.portfolio_id}?tab=venues`}>Portfolio {viewTargetVenue.portfolio_id}</Link>
              ) : (
                <p style={{ margin: 0 }}>Unbound</p>
              )}
            </div>
            <div>
              <p className="muted" style={{ marginBottom: "0.25rem" }}>Credential</p>
              <p style={{ margin: 0 }}><code>{venueKeyLabel(viewTargetVenue.api_key)}</code></p>
            </div>
            <div>
              <p className="muted" style={{ marginBottom: "0.25rem" }}>Modes</p>
              <p style={{ margin: 0 }}>
                {label(viewTargetVenue.margin_mode_label, viewTargetVenue.margin_mode)} · {label(viewTargetVenue.position_mode_label, viewTargetVenue.position_mode)}
              </p>
            </div>
            <div>
              <p className="muted" style={{ marginBottom: "0.25rem" }}>Updated</p>
              <p style={{ margin: 0 }}>{viewTargetVenue.updated_at ? formatUTCWithLocal(viewTargetVenue.updated_at) : "-"}</p>
            </div>
          </div>
          <div className="card" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
              <h3 className="section-title" style={{ marginBottom: 0 }}>Venue wallet</h3>
              <button type="button" onClick={() => void loadVenueWallet(viewTargetVenue)} disabled={venueWalletLoading}>
                {venueWalletLoading ? "Refreshing..." : "Refresh value"}
              </button>
            </div>
            {venueWalletError ? <p className="error">{venueWalletError}</p> : null}
            {!venueWalletError && venueWalletLoading ? <p className="muted">Loading venue wallet...</p> : null}
            {!venueWalletError && venueWallet?.wallet ? (
              <div className="strategy-new-form__row-2" style={{ marginTop: "0.75rem" }}>
                <div>
                  <p className="muted" style={{ marginBottom: "0.25rem" }}>Total value</p>
                  <p style={{ margin: 0, fontWeight: 700 }}>{venueWallet.wallet.display.total_value.toFixed(4)} USDT</p>
                </div>
                <div>
                  <p className="muted" style={{ marginBottom: "0.25rem" }}>Futures wallet</p>
                  <p style={{ margin: 0 }}>{venueWallet.wallet.futures?.wallet_balance?.toFixed(4) ?? "-"} USDT</p>
                </div>
                <div>
                  <p className="muted" style={{ marginBottom: "0.25rem" }}>Available</p>
                  <p style={{ margin: 0 }}>{venueWallet.wallet.futures?.available_balance?.toFixed(4) ?? "-"} USDT</p>
                </div>
                <div>
                  <p className="muted" style={{ marginBottom: "0.25rem" }}>Updated</p>
                  <p style={{ margin: 0 }}>{venueWallet.wallet.updated_at ? formatUTCWithLocal(venueWallet.wallet.updated_at) : "-"}</p>
                </div>
              </div>
            ) : null}
          </div>
          <p style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: 0 }}>
            {!viewTargetVenue.archived_at && viewTargetVenue.status_label === "active" ? (
              <button
                type="button"
                onClick={() => {
                  setBindTargetVenue(viewTargetVenue);
                  setBindPortfolioID(viewTargetVenue.portfolio_id ? String(viewTargetVenue.portfolio_id) : "");
                  setError(null);
                  setNotice(null);
                }}
              >
                {viewTargetVenue.portfolio_id ? "Rebind portfolio" : "Bind portfolio"}
              </button>
            ) : null}
            {viewTargetVenue.portfolio_id ? (
              <button type="button" onClick={() => void handleRelease(viewTargetVenue)}>Release portfolio</button>
            ) : null}
          </p>
        </div>
      ) : null}
      {bindTargetVenue ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <form onSubmit={handleBindSubmit}>
            <h2 className="section-title" style={{ marginBottom: "0.5rem" }}>
              {bindTargetVenue.portfolio_id ? "Rebind venue" : "Bind venue"}
            </h2>
            <p className="muted">
              {bindTargetVenue.display_name || `venue-${bindTargetVenue.venue_id}`} · {label(bindTargetVenue.exchange_label, bindTargetVenue.exchange)} · {label(bindTargetVenue.market_label, bindTargetVenue.market)} · {label(bindTargetVenue.environment_label, bindTargetVenue.environment)}
            </p>
            <label>Target portfolio</label>
            <AsyncSelect<Portfolio>
              value={bindPortfolioID}
              placeholder="Select target portfolio"
              onChange={setBindPortfolioID}
              loadPage={async (offset, limit, query) => {
                const normalizedQuery = query.trim().toLowerCase();
                return collectFilteredPage<Portfolio, AsyncSelectOption<Portfolio>>({
                  offset,
                  limit,
                  loadSourcePage: (sourceOffset, sourceLimit) => listPortfoliosPage({ offset: sourceOffset, limit: sourceLimit }),
                  matches: (portfolio) => portfolioEnvCode(portfolio) === bindTargetVenue.environment
                    && (!normalizedQuery
                    || portfolio.name.toLowerCase().includes(normalizedQuery)
                    || String(portfolio.portfolio_id).includes(normalizedQuery)),
                  map: (portfolio) => ({
                    value: String(portfolio.portfolio_id),
                    label: portfolio.name || String(portfolio.portfolio_id),
                    detail: `#${portfolio.portfolio_id} · ${portfolioEnvLabel(portfolioEnvCode(portfolio))}`,
                    item: portfolio,
                  }),
                });
              }}
              searchPlaceholder="Search portfolio name or ID"
              allowClear={false}
            />
            {bindTargetVenue.portfolio_id ? (
              <p className="muted">
                Current portfolio: {bindTargetVenue.portfolio_id}. Rebinding hands the venue off to the selected portfolio in one backend transaction.
              </p>
            ) : null}
            <p style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
              <button type="submit" className="primary" disabled={binding || !bindPortfolioID}>
                {binding ? "Binding..." : bindTargetVenue.portfolio_id ? "Rebind venue" : "Bind venue"}
              </button>
              <button type="button" onClick={() => { setBindTargetVenue(null); setBindPortfolioID(""); }} disabled={binding}>Cancel</button>
            </p>
          </form>
        </div>
      ) : null}
      <PageTabs tabs={tabs} activeTab={activeTab} onChange={changeTab} ariaLabel="Venue sections">
        {activeTab === "venues" ? (
          <InfiniteTable<Venue>
            columns={["Name", "Portfolio", "Exchange", "Market", "Environment", "Status", "API Key", "Created", "Action"]}
            refreshKey={`${refreshKey}:${portfolioFilter || ""}`}
            emptyText="No venues yet."
            loadPage={loadVenues}
            rowKey={(venue) => String(venue.venue_id)}
            renderRow={(venue) => (
              <>
                <td>
                  <button
                    type="button"
                    onClick={() => openVenueDetail(venue)}
                    style={{
                      background: "none",
                      border: 0,
                      color: "#2563eb",
                      cursor: "pointer",
                      font: "inherit",
                      fontWeight: 700,
                      padding: 0,
                      textDecoration: "underline",
                    }}
                  >
                    {venue.display_name || `venue-${venue.venue_id}`}
                  </button>
                  <div className="muted"><code>{venue.venue_id}</code></div>
                </td>
                <td>
                  {venue.portfolio_id ? <Link to={`/portfolios/${venue.portfolio_id}?tab=venues`}>{venue.portfolio_id}</Link> : "-"}
                </td>
                <td>{label(venue.exchange_label, venue.exchange)}</td>
                <td>{label(venue.market_label, venue.market)}</td>
                <td>{label(venue.environment_label, venue.environment)}</td>
                <td>
                  <span className={venue.status_label === "active" ? "status-badge status-badge--completed" : "status-badge status-badge--stopped"}>
                    {label(venue.status_label, venue.status)}
                  </span>
                </td>
                <td><code>{venueKeyLabel(venue.api_key)}</code></td>
                <td>{venue.created_at ? formatUTCWithLocal(venue.created_at) : "-"}</td>
                <td>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {!venue.archived_at && venue.status_label === "active" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setBindTargetVenue(venue);
                          setBindPortfolioID(venue.portfolio_id ? String(venue.portfolio_id) : "");
                          setError(null);
                          setNotice(null);
                        }}
                      >
                        {venue.portfolio_id ? "Rebind" : "Bind"}
                      </button>
                    ) : null}
                    {returnTo && venue.portfolio_id ? (
                      quickStartMode ? (
                        <QuickStartActionButton onClick={() => navigate(appendReturnParam(returnTo, "venue_id", venue.venue_id), { replace: true })} />
                      ) : (
                        <button
                          type="button"
                          onClick={() => navigate(appendReturnParam(returnTo, "venue_id", venue.venue_id), { replace: true })}
                        >
                          Use
                        </button>
                      )
                    ) : null}
                    {venue.portfolio_id ? (
                      <button type="button" onClick={() => void handleRelease(venue)}>Release</button>
                    ) : null}
                    <button type="button" onClick={() => openVenueDetail(venue)}>View</button>
                    {!venue.archived_at ? (
                      <button type="button" onClick={() => void handleArchive(venue)}>Archive</button>
                    ) : null}
                  </div>
                </td>
              </>
            )}
          />
        ) : (
          <CreateVenueForm
            defaultPortfolioID={portfolioFilter || ""}
            defaultEnvironment={normalizeCreateEnvironment(searchParams.get("environment"))}
            onCreated={(venue, result) => {
              if (returnTo) {
                navigate(appendReturnParam(returnTo, "venue_id", venue.venue_id), { replace: true });
                return;
              }
              setNotice(result?.reusedExisting ? "Venue already exists; using existing venue." : "Venue created.");
              setRefreshKey((v) => v + 1);
              changeTab("venues");
            }}
          />
        )}
      </PageTabs>
    </div>
  );
}

function CreateVenueForm({
  defaultPortfolioID,
  defaultEnvironment,
  onCreated,
}: {
  defaultPortfolioID: string;
  defaultEnvironment: CreateVenuePayload["environment"];
  onCreated: (venue: Venue, result?: VenueCreatedResult) => void;
}) {
  const [portfolioID, setPortfolioID] = useState(defaultPortfolioID);
  const [exchange, setExchange] = useState<CreateVenuePayload["exchange"]>("binance");
  const [market, setMarket] = useState<CreateVenuePayload["market"]>("perpetual_futures");
  const [environment, setEnvironment] = useState<CreateVenuePayload["environment"]>(defaultEnvironment);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [apiKey, setAPIKey] = useState("");
  const [apiSecret, setAPISecret] = useState("");
  const [marginMode, setMarginMode] = useState<NonNullable<CreateVenuePayload["margin_mode"]>>("cross");
  const [positionMode, setPositionMode] = useState<NonNullable<CreateVenuePayload["position_mode"]>>("one_way");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spotRows, setSpotRows] = useState<SpotRow[]>(() => defaultSpotWalletAssets());
  const [showSpotAdd, setShowSpotAdd] = useState(false);
  const [futInitial, setFutInitial] = useState("0");
  const [futRows, setFutRows] = useState<FutRow[]>([]);
  const [showFutAdd, setShowFutAdd] = useState(false);

  useEffect(() => {
    setPortfolioID(defaultPortfolioID);
  }, [defaultPortfolioID]);

  useEffect(() => {
    setEnvironment(defaultEnvironment);
  }, [defaultEnvironment]);

  const isSpot = market === "spot";
  const requiresCredentials = environment !== "backtest";
  const isBacktest = environment === "backtest";

  function addSpot(_symbol: string, entry?: SpotSymbolCatalogEntry, stale = false) {
    if (!entry || stale) {
      setError("Fresh Binance Spot symbol metadata is required before adding an asset.");
      return;
    }
    const candidate = canonicalSpotWalletAsset(entry, false);
    if (!candidate) {
      setError("Only fresh, TRADING, Spot-enabled USDT symbols can add wallet assets.");
      return;
    }
    const assetCode = entry.base_asset.trim().toUpperCase();
    if (spotRows.some((row) => row.asset === assetCode)) return;
    setSpotRows((rows) => [...rows, { ...candidate, asset: entry.base_asset.trim().toUpperCase(), symbol: entry.symbol }]);
    setShowSpotAdd(false);
  }

  function addFut(sym: string) {
    const u = sym.toUpperCase();
    if (futRows.some((r) => r.symbol === u)) return;
    setFutRows((r) => [...r, { symbol: u, direction: "0", initial_balance: "1000", fee_rate: "0.0004" }]);
    setShowFutAdd(false);
  }

  function updateSpotRow(asset: string, field: "free" | "locked" | "avg_entry_price" | "price", val: string) {
    setSpotRows((rows) => rows.map((row) => (row.asset === asset ? { ...row, [field]: val } : row)));
  }

  function updateFutRow(sym: string, field: keyof FutRow, val: string) {
    setFutRows((rows) => rows.map((x) => (x.symbol === sym ? { ...x, [field]: val } : x)));
  }

  function applyBacktestWalletPayload(payload: CreateVenuePayload) {
    if (!isBacktest) return;
    if (isSpot) {
      payload.spot = {
        assets: spotRows.map((row) => ({
          asset: row.asset,
          free: row.free,
          locked: row.locked,
          ...(row.avg_entry_price?.trim() ? { avg_entry_price: row.avg_entry_price } : {}),
          ...(row.price?.trim() ? { price: row.price } : {}),
        })),
      };
      return;
    }
    payload.futures = {
      margin_mode: marginMode === "isolated" ? "isolated" : "cross",
      position_mode: positionMode === "hedge" ? "hedge" : "one_way",
      initial_balance: marginMode === "cross" ? (parseFloat(futInitial) || 0) : 0,
      positions: futRows.map((r) => {
        const dir = parseInt(r.direction, 10);
        return {
          symbol: r.symbol,
          direction: Number.isFinite(dir) ? dir : 0,
          initial_balance: marginMode === "isolated" ? (parseFloat(r.initial_balance) || 0) : undefined,
          fee_rate: parseFloat(r.fee_rate) || 0.0004,
        };
      }),
    };
  }

  async function findReusableVenue(): Promise<Venue | null> {
    if (!portfolioID) return null;
    const page = await listVenues({
      portfolio_id: portfolioID,
      include_inactive: true,
      include_unbound: false,
      limit: 100,
    });
    const expectedExchange = createExchangeCode(exchange);
    const expectedMarket = createMarketCode(market);
    const expectedEnvironment = createEnvironmentCode(environment);
    return (page.items ?? []).find((venue) => (
      isActiveVenue(venue)
      && sameRouteValue(venue.exchange, venue.exchange_label, expectedExchange, exchange)
      && sameRouteValue(venue.market, venue.market_label, expectedMarket, market)
      && sameRouteValue(venue.environment, venue.environment_label, expectedEnvironment, environment)
    )) ?? null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (requiresCredentials && (!apiKey.trim() || !apiSecret.trim())) return;
    if (isBacktest && isSpot) {
      const decimalPattern = /^[0-9]+(?:\.[0-9]{1,8})?$/;
      const invalid = spotRows.find((row) => (
        !decimalPattern.test(row.free)
        || !decimalPattern.test(row.locked)
        || (Boolean(row.avg_entry_price) && !decimalPattern.test(row.avg_entry_price ?? ""))
        || (Boolean(row.price) && !decimalPattern.test(row.price ?? ""))
      ));
      if (invalid) {
        setError(`Spot asset ${invalid.asset} must use non-negative decimal strings with at most 8 fractional digits.`);
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload: CreateVenuePayload = {
        portfolio_id: portfolioID ? Number(portfolioID) : undefined,
        exchange,
        market,
        environment,
        display_name: displayName.trim() || `${exchange}-${environment}-${market}`,
        description: description.trim(),
        margin_mode: isSpot ? "none" : marginMode,
        position_mode: isSpot ? "none" : positionMode,
      };
      if (requiresCredentials) {
        payload.api_key = apiKey.trim();
        payload.credential_info = { api_key: apiKey.trim(), api_secret: apiSecret.trim() };
      }
      applyBacktestWalletPayload(payload);
      const venue = await createVenue(payload);
      onCreated(venue);
    } catch (e) {
      if (isDuplicateVenueRouteError(e)) {
        try {
          const existingVenue = await findReusableVenue();
          if (existingVenue) {
            onCreated(existingVenue, { reusedExisting: true });
            return;
          }
        } catch (lookupErr) {
          const createMessage = e instanceof Error ? e.message : "Create venue failed";
          const lookupMessage = lookupErr instanceof Error ? lookupErr.message : "lookup existing venue failed";
          setError(`${createMessage}; ${lookupMessage}`);
          return;
        }
      }
      setError(e instanceof Error ? e.message : "Create venue failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
        <Building2 size={18} aria-hidden="true" />
        <p style={{ fontWeight: 600, margin: 0 }}>Create Venue</p>
      </div>
      <form className="strategy-new-form" onSubmit={handleSubmit}>
        <div className="strategy-new-form__row-2">
          <label className="field">
            <span>Bind portfolio</span>
            <AsyncSelect<Portfolio>
              value={portfolioID}
              placeholder="Leave unbound"
              onChange={setPortfolioID}
              loadPage={async (offset, limit, query) => {
                const normalizedQuery = query.trim().toLowerCase();
                const envCode = createEnvironmentCode(environment);
                return collectFilteredPage<Portfolio, AsyncSelectOption<Portfolio>>({
                  offset,
                  limit,
                  loadSourcePage: (sourceOffset, sourceLimit) => listPortfoliosPage({ offset: sourceOffset, limit: sourceLimit }),
                  matches: (portfolio) => portfolioEnvCode(portfolio) === envCode
                    && (!normalizedQuery
                    || portfolio.name.toLowerCase().includes(normalizedQuery)
                    || String(portfolio.portfolio_id).includes(normalizedQuery)),
                  map: (portfolio) => ({
                    value: String(portfolio.portfolio_id),
                    label: portfolio.name || String(portfolio.portfolio_id),
                    detail: `#${portfolio.portfolio_id} · ${portfolioEnvLabel(portfolioEnvCode(portfolio))}`,
                    item: portfolio,
                  }),
                });
              }}
              searchPlaceholder="Search portfolio name or ID"
            />
          </label>
          <label className="field">
            <span>Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="binance demo perp"
            />
          </label>
        </div>
        <div className="strategy-new-form__row-2">
          <label className="field">
            <span>Exchange</span>
            <select value={exchange} onChange={(e) => setExchange(e.target.value as CreateVenuePayload["exchange"])}>
              <option value="binance">Binance</option>
              <option value="okx">OKX</option>
            </select>
          </label>
          <label className="field">
            <span>Environment</span>
            <select value={environment} onChange={(e) => setEnvironment(e.target.value as CreateVenuePayload["environment"])}>
              <option value="backtest">Backtest</option>
              <option value="demo">Demo</option>
              <option value="live">Live</option>
            </select>
          </label>
        </div>
        <div className="strategy-new-form__row-2">
          <label className="field">
            <span>Market</span>
            <select value={market} onChange={(e) => setMarket(e.target.value as CreateVenuePayload["market"])}>
              <option value="spot">Spot</option>
              <option value="perpetual_futures">Perpetual futures</option>
              <option value="delivery_futures">Delivery futures</option>
            </select>
          </label>
          <label className="field">
            <span>Description</span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional note"
            />
          </label>
        </div>
        {!isSpot ? (
          <div className="strategy-new-form__row-2">
            <label className="field">
              <span>Margin mode</span>
              <select value={marginMode} onChange={(e) => setMarginMode(e.target.value as NonNullable<CreateVenuePayload["margin_mode"]>)}>
                <option value="cross">Cross</option>
                <option value="isolated">Isolated</option>
              </select>
            </label>
            <label className="field">
              <span>Position mode</span>
              <select value={positionMode} onChange={(e) => setPositionMode(e.target.value as NonNullable<CreateVenuePayload["position_mode"]>)}>
                <option value="one_way">One-way</option>
                <option value="hedge">Hedge</option>
              </select>
            </label>
          </div>
        ) : null}
        {isBacktest && isSpot ? (
          <details className="wallet-details" open>
            <summary>Spot wallet</summary>
            <div className="wallet-details__body">
              <button type="button" onClick={() => setShowSpotAdd((v) => !v)}>
                {showSpotAdd ? "Hide symbol search" : "Add spot asset"}
              </button>
              {showSpotAdd ? (
                <SymbolPicker market="spot" label="Spot symbol" onAdd={addSpot} />
              ) : null}
              <table className="compact">
                <thead>
                  <tr><th>Asset</th><th>Trading pair</th><th>Free</th><th>Locked</th><th>Avg entry</th><th>Mark price</th><th></th></tr>
                </thead>
                <tbody>
                  {spotRows.map((row) => (
                      <tr key={row.asset}>
                        <td><strong>{row.asset}</strong></td>
                        <td>{row.symbol ?? "Quote asset"}</td>
                        <td><input type="text" inputMode="decimal" value={row.free} onChange={(e) => updateSpotRow(row.asset, "free", e.target.value)} /></td>
                        <td><input type="text" inputMode="decimal" value={row.locked} onChange={(e) => updateSpotRow(row.asset, "locked", e.target.value)} /></td>
                        <td><input type="text" inputMode="decimal" value={row.avg_entry_price ?? ""} disabled={row.asset === "USDT"} onChange={(e) => updateSpotRow(row.asset, "avg_entry_price", e.target.value)} /></td>
                        <td><input type="text" inputMode="decimal" value={row.price ?? ""} disabled={row.asset === "USDT"} onChange={(e) => updateSpotRow(row.asset, "price", e.target.value)} /></td>
                        <td>{row.asset === "USDT" ? null : <button type="button" onClick={() => setSpotRows((rows) => rows.filter((item) => item.asset !== row.asset))}>Remove</button>}</td>
                      </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
        {isBacktest && !isSpot ? (
          <details className="wallet-details" open>
            <summary>Futures wallet</summary>
            <div className="wallet-details__body">
              {marginMode === "cross" ? (
                <label className="field">
                  <span>Cross wallet balance</span>
                  <input type="number" step="0.0001" value={futInitial} onChange={(e) => setFutInitial(e.target.value)} />
                </label>
              ) : null}
              <button type="button" onClick={() => setShowFutAdd((v) => !v)}>
                {showFutAdd ? "Hide symbol search" : "Add futures position"}
              </button>
              {showFutAdd ? (
                <SymbolPicker market="usdm_futures" label="Futures symbol" onAdd={addFut} />
              ) : null}
              {futRows.length > 0 ? (
                <table className="compact">
                  <thead>
                    <tr><th>Symbol</th><th>Direction</th><th>Initial balance</th><th>Fee rate</th><th></th></tr>
                  </thead>
                  <tbody>
                    {futRows.map((r) => (
                      <tr key={r.symbol}>
                        <td><strong>{r.symbol}</strong></td>
                        <td>
                          <select value={r.direction} onChange={(e) => updateFutRow(r.symbol, "direction", e.target.value)}>
                            <option value="0">Flat</option>
                            <option value="1">Long</option>
                            <option value="-1">Short</option>
                          </select>
                        </td>
                        <td><input type="number" step="0.0001" value={r.initial_balance} disabled={marginMode === "cross"} onChange={(e) => updateFutRow(r.symbol, "initial_balance", e.target.value)} /></td>
                        <td><input type="number" step="0.0001" value={r.fee_rate} onChange={(e) => updateFutRow(r.symbol, "fee_rate", e.target.value)} /></td>
                        <td><button type="button" onClick={() => setFutRows((rows) => rows.filter((x) => x.symbol !== r.symbol))}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </details>
        ) : null}
        {requiresCredentials ? (
          <div className="strategy-new-form__row-2">
            <label className="field">
              <span>API key</span>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setAPIKey(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>API secret</span>
              <input
                type="password"
                value={apiSecret}
                onChange={(e) => setAPISecret(e.target.value)}
                required
              />
            </label>
          </div>
        ) : (
          <p className="muted">
            Backtest venues are simulated and do not require exchange credentials.
          </p>
        )}
        {error ? <p className="error">{error}</p> : null}
        <p style={{ marginTop: "0.75rem" }}>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? "Creating…" : "Create Venue"}
          </button>
        </p>
      </form>
    </div>
  );
}
