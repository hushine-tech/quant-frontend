import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { formatUTCWithLocal } from "@/utils/time";
import {
  getPortfolio,
  getPortfolioPortfolioSnapshot,
  getProductCapabilities,
  listSymbols,
  runStrategy,
  bindVenue,
  getStrategyStatus,
  getDownloadAndRunJob,
  listVenues,
  listStrategiesPage,
  getStrategy,
  listPortfolioStrategies,
  listPortfolioVenues,
  releaseVenue,
  mountStrategy,
  unmountStrategy,
  activateStrategy,
  deactivateStrategy,
  listSessionsPage,
  previewBacktestCoverage,
  previewRunStrategy,
  finishSession,
  stopSession,
  startDownloadAndRunBacktest,
  downloadDebugPackage,
  buildDebugPackageRequest,
  normalizeProductCapabilities,
  strategySpotCapabilityDecision,
  strategyStreamKey,
  queryMarketDataKlines,
  runtimeRoleForSessionEnvironment,
  isSessionTerminal,
  APIError,
  formatRuntimeDependencyError,
  type Portfolio,
  type WalletSnapshot,
  type PortfolioVenueWallets,
  type Strategy,
  type PortfolioStrategy,
  type Venue,
  type Session,
  type BacktestCoveragePreview,
  type DownloadRunJob,
  type MarketDataKlines,
  type StreamKey,
  type PreviewRunStrategy,
  type Runtime,
  type ProductCapabilities,
  type RequiredSnapshotSymbol,
  type StrategyOrderTargetDeclaration,
} from "@/api/client";
import StopSessionDialog from "@/components/StopSessionDialog";
import RuntimeSelectionDialog from "@/components/RuntimeSelectionDialog";
import RuntimeSelector from "@/components/RuntimeSelector";
import { FilterField, FilterPanel } from "@/components/FilterControls";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import InfiniteTable from "@/components/InfiniteTable";
import AsyncSelect, { type AsyncSelectOption } from "@/components/AsyncSelect";
import QuickStartActionButton from "@/components/QuickStartActionButton";
import DateTimeRangePicker from "@/components/DateTimeRangePicker";
import { portfolioEnvironmentLabel } from "@/utils/portfolioEnvironment";
import { collectFilteredPage } from "@/utils/asyncSelectPagination";
import { appendReturnParam, isQuickStartReturnTo, safeInternalReturnTo } from "@/utils/returnTo";
import { extractStrategyInputs, extractStrategyOrderTargets, strategyDeclaresSpot } from "@/utils/strategyDeclarations";

function envBannerClass(environment: number): string {
  switch (environment) {
    case 0:
      return "env-banner env-banner--backtest";
    case 1:
      return "env-banner env-banner--demo";
    case 2:
      return "env-banner env-banner--live";
    default:
      return "env-banner env-banner--other";
  }
}

type PortfolioDetailTab = "portfolio" | "run" | "debug" | "sessions" | "venues";

const portfolioDetailTabs: Array<PageTab<PortfolioDetailTab>> = [
  { id: "portfolio", label: "Portfolio" },
  { id: "run", label: "Run Strategy" },
  { id: "debug", label: "Local Debug" },
  { id: "sessions", label: "Sessions" },
  { id: "venues", label: "Venues" },
];

function normalizePortfolioDetailTab(value: string | null): PortfolioDetailTab {
  return value === "run" || value === "debug" || value === "sessions" || value === "venues" ? value : "portfolio";
}

const DEFAULT_MAX_LOSS_CLOSE_PERCENT = 30;
const DEFAULT_SESSION_LEVERAGE = 1;

function formatAPIError(error: unknown, fallback: string): string {
  if (error instanceof APIError) {
    const runtimeMessage = formatRuntimeDependencyError(error.runtime_error);
    if (runtimeMessage) return runtimeMessage;
    if (!error.code) return error.message;
    const facts = [
      error.environment == null ? "" : `environment=${error.environment}`,
      error.source ? `source=${error.source}` : "",
      error.retryable == null ? "" : `retryable=${String(error.retryable)}`,
      error.filter_type ? `filter=${error.filter_type}` : "",
      error.route ? `route=${error.route}` : "",
    ].filter(Boolean);
    return `${error.code}: ${error.message}${facts.length ? ` (${facts.join(", ")})` : ""}`;
  }
  return error instanceof Error ? error.message : fallback;
}

function parseMaxLossClosePct(percentText: string): number | null {
  const value = Number(percentText);
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null;
  return value / 100;
}

function parseSessionLeverage(leverageText: string): number | null {
  const value = Number(leverageText);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) return null;
  return value;
}

function formatRiskPercent(value: number | undefined): string {
  if (!Number.isFinite(value ?? NaN) || !value) return `${DEFAULT_MAX_LOSS_CLOSE_PERCENT}%`;
  return `${((value ?? 0) * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

function formatLeverage(value: number | undefined): string {
  if (!Number.isFinite(value ?? NaN) || !value) return `${DEFAULT_SESSION_LEVERAGE}x`;
  return `${(value ?? DEFAULT_SESSION_LEVERAGE).toFixed(2).replace(/\.?0+$/, "")}x`;
}

function sessionStartedAtMs(session: Session): number {
  return Date.parse(session.started_at || session.completed_at || "") || 0;
}

function canResumeSession(session: Session, allSessions: Session[]): boolean {
  if (session.status !== "stopped" && session.status !== "recoverable") return false;
  const baseStartedAt = sessionStartedAtMs(session)
  return !allSessions.some((other) => (
    other.session_id !== session.session_id
    && other.portfolio_id === session.portfolio_id
    && other.strategy_id === session.strategy_id
    && other.environment === session.environment
    && other.interval === session.interval
    && (other.start_time_ms ?? 0) === (session.start_time_ms ?? 0)
    && (other.end_time_ms ?? 0) === (session.end_time_ms ?? 0)
    && sessionStartedAtMs(other) > baseStartedAt
  ));
}

async function resumeWithNewSession(portfolioId: number, session: Session, runtimeId: string, maxLossClosePct: number, leverage: number): Promise<{ session_id: string }> {
  const entries = await listPortfolioStrategies(portfolioId);
  const currentActiveId = entries.find((entry) => entry.active)?.strategy.strategy_id ?? null;
  const targetStrategyId = session.strategy_id;
  if (!targetStrategyId || targetStrategyId <= 0) {
    throw new Error("Cannot resume session: original strategy is missing");
  }
  const targetEntry = entries.find((entry) => entry.strategy.strategy_id === targetStrategyId) ?? null;
  const changedActive = currentActiveId !== targetStrategyId;
  let mountedForResume = false;

  try {
    if (!targetEntry) {
      await mountStrategy(portfolioId, targetStrategyId);
      mountedForResume = true;
    }
    if (changedActive || !targetEntry?.active) {
      await activateStrategy(portfolioId, targetStrategyId);
    }
    return await runStrategy(portfolioId, {
      strategy_path: "",
      interval: session.interval || "1m",
      start_time_ms: session.start_time_ms,
      end_time_ms: session.end_time_ms,
      runtime_id: runtimeId,
      max_loss_close_pct: maxLossClosePct,
      leverage,
    });
  } catch (err) {
    if (changedActive) {
      try {
        if (currentActiveId !== null) {
          await activateStrategy(portfolioId, currentActiveId);
        } else {
          await deactivateStrategy(portfolioId, targetStrategyId);
        }
        if (mountedForResume) {
          await unmountStrategy(portfolioId, targetStrategyId);
        }
      } catch {
        // Best-effort rollback only; preserve the original error.
      }
    } else if (mountedForResume) {
      try {
        await unmountStrategy(portfolioId, targetStrategyId);
      } catch {
        // Best-effort rollback only; preserve the original error.
      }
    }
    throw err;
  }
}

async function requiredSpotSymbolsForSnapshot(summary: PortfolioVenueWallets): Promise<RequiredSnapshotSymbol[]> {
  const required: RequiredSnapshotSymbol[] = [];
  const seen = new Set<string>();
  for (const item of summary.items) {
    const market = (item.venue.market_label || "").trim().toLowerCase();
    const exchange = (item.venue.exchange_label || "").trim().toLowerCase();
    const isBinanceSpot = (item.venue.market === 1 || market === "spot")
      && (item.venue.exchange === 1 || exchange === "binance");
    if (!isBinanceSpot || !item.wallet?.spot) continue;
    for (const asset of item.wallet.spot.assets) {
      const assetCode = asset.asset.trim().toUpperCase();
      if (!assetCode || assetCode === "USDT") continue;
      const catalog = await listSymbols("spot", assetCode);
      if (catalog.stale) {
        throw new Error(`Binance symbol metadata for ${assetCode} is stale`);
      }
      const matches = catalog.entries.filter((entry) => (
        entry.base_asset.trim().toUpperCase() === assetCode
        && entry.quote_asset.trim().toUpperCase() === "USDT"
        && entry.status.trim().toUpperCase() === "TRADING"
        && entry.spot_trading_allowed
      ));
      if (matches.length !== 1) {
        throw new Error(`Expected one authoritative Binance Spot USDT symbol for asset ${assetCode}, found ${matches.length}`);
      }
      const symbol = matches[0].symbol.trim().toUpperCase();
      const key = `binance:spot:${symbol}`;
      if (!seen.has(key)) {
        seen.add(key);
        required.push({ exchange: "binance", market: "spot", symbol });
      }
    }
  }
  return required;
}

export default function PortfolioDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [acc, setAcc] = useState<Portfolio | null>(null);
  const [venueWallets, setVenueWallets] = useState<PortfolioVenueWallets | null>(null);
  const [sessionRefreshTick, setSessionRefreshTick] = useState(0);
  const [venueMutationTick, setVenueMutationTick] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [venueWalletErr, setVenueWalletErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [venueWalletLoading, setVenueWalletLoading] = useState(false);
  const [capabilities, setCapabilities] = useState<ProductCapabilities>(() => normalizeProductCapabilities(null, true));
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PortfolioDetailTab>(() => normalizePortfolioDetailTab(searchParams.get("tab")));
  const returnTo = safeInternalReturnTo(searchParams.get("return_to"));
  const initialRuntimeId = searchParams.get("runtime_id") || "";
  const initialStrategyId = searchParams.get("strategy_id") || "";

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const a = await getPortfolio(id);
        if (!cancelled) setAcc(a);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getProductCapabilities();
        if (!cancelled) {
          setCapabilities(result);
          setCapabilityError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setCapabilities(normalizeProductCapabilities(null, true));
          setCapabilityError(error instanceof Error ? error.message : "Capability discovery failed");
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!id || !acc) return;
    let cancelled = false;
    (async () => {
      setVenueWalletErr(null);
      setVenueWallets(null);
      setVenueWalletLoading(true);
      try {
        const initial = await getPortfolioPortfolioSnapshot(id);
        if (!cancelled) setVenueWallets(initial);
        try {
          const requiredSymbols = await requiredSpotSymbolsForSnapshot(initial);
          if (requiredSymbols.length > 0) {
            const valued = await getPortfolioPortfolioSnapshot(id, requiredSymbols);
            if (!cancelled) setVenueWallets(valued);
          }
        } catch (valuationError) {
          if (!cancelled) {
            setVenueWalletErr(`Spot valuation unavailable: ${valuationError instanceof Error ? valuationError.message : "metadata lookup failed"}`);
          }
        }
      } catch (e) {
        if (!cancelled) setVenueWalletErr(e instanceof Error ? e.message : "Venue wallet load failed");
      } finally {
        if (!cancelled) setVenueWalletLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, acc, venueMutationTick]);

  const portfolioWallet = walletFromPortfolioSnapshot(venueWallets);
  const environment = acc?.environment ?? portfolioWallet?.environment ?? 0;
  function bumpSessionRefreshTick() {
    setSessionRefreshTick((v) => v + 1);
  }

  function bumpVenueMutationTick() {
    setVenueMutationTick((v) => v + 1);
  }

  function changePortfolioTab(tab: PortfolioDetailTab) {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === "portfolio") {
      next.delete("tab");
    } else {
      next.set("tab", tab);
    }
    setSearchParams(next, { replace: true });
  }

  return (
    <div>
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        <Link to="/portfolios">← Back to list</Link>
      </p>
      {loading ? <p className="muted">Loading…</p> : null}
      {err ? <p className="error">{err}</p> : null}
      {!loading && acc ? (
        <>
        <div className={envBannerClass(environment)} role="status">
          {portfolioEnvironmentLabel(environment)}
        </div>
        <div className="card" style={{ marginBottom: "1rem" }}>
          <p><strong style={{ fontSize: "1.1rem" }}>{acc.name}</strong></p>
          {acc.description?.trim() ? <p className="muted">{acc.description.trim()}</p> : null}
          <p className="muted">
            ID: {acc.portfolio_id} · Environment: {portfolioEnvironmentLabel(environment)} · Created: {formatUTCWithLocal(acc.created_at)}
          </p>
        </div>
        <PageTabs
          tabs={portfolioDetailTabs}
          activeTab={activeTab}
          onChange={changePortfolioTab}
          ariaLabel="Portfolio detail sections"
        >
          {activeTab === "portfolio" ? (
            <>
              {venueWalletLoading ? <p className="muted">Loading venue wallets...</p> : null}
              {venueWalletErr ? <p className="error">{venueWalletErr}</p> : null}
              {!venueWalletLoading && venueWallets ? (
                <PortfolioVenuePortfolio portfolio={acc} summary={venueWallets} />
              ) : null}
            </>
          ) : null}

          {activeTab === "run" ? (
            <StrategyPanel
              portfolioId={acc.portfolio_id}
              environment={environment}
              initialRuntimeId={initialRuntimeId}
              initialStrategyId={initialStrategyId}
              returnTo={returnTo}
              capabilities={capabilities}
              capabilityError={capabilityError}
              onSessionsChanged={bumpSessionRefreshTick}
            />
          ) : null}

          {activeTab === "debug" ? (
            <LocalDebugPackagePanel portfolio={acc} capabilities={capabilities} capabilityError={capabilityError} />
          ) : null}

          {activeTab === "sessions" ? (
            <SessionPanel portfolioId={acc.portfolio_id} refreshTick={sessionRefreshTick} />
          ) : null}

          {activeTab === "venues" ? (
            <PortfolioVenuesPanel portfolio={acc} environment={environment} onChanged={bumpVenueMutationTick} />
          ) : null}
        </PageTabs>
        </>
      ) : null}
    </div>
  );
}

function walletFromPortfolioSnapshot(summary: PortfolioVenueWallets | null): WalletSnapshot | null {
  return summary?.wallet ?? summary?.items.find((item) => item.wallet)?.wallet ?? null;
}

function walletDisplayTotal(wallet: WalletSnapshot): number {
  return wallet.display?.total_value ?? 0;
}

function formatUSDT(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(4)} USDT` : "-";
}

function PortfolioVenuePortfolio({ portfolio, summary }: { portfolio: Portfolio; summary: PortfolioVenueWallets }) {
  const hasVenues = summary.items.length > 0;
  return (
    <>
      <div className="card">
        <div className="portfolio-grid">
          <div className="portfolio-panel">
            <div className="portfolio-panel__title">Portfolio aggregate</div>
            <p className="muted" style={{ fontSize: "0.75rem", marginTop: "-0.25rem", marginBottom: "0.75rem" }}>
              Sum of successfully loaded exchange venue wallets. Failed venues are excluded and shown below.
            </p>
            <div>
              <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                Total Value
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, lineHeight: 1.2 }}>
                {formatUSDT(summary.total_value)}
              </div>
            </div>
            <div className="portfolio-metric">
              <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                Loaded / Failed
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.2 }}>
                {summary.successful} / {summary.failed}
              </div>
            </div>
            <div className="portfolio-metric">
              <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                Updated
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.2 }}>
                {summary.updated_at ? formatUTCWithLocal(summary.updated_at) : "-"}
              </div>
            </div>
          </div>
          <div className="portfolio-panel portfolio-panel--secondary">
            <div className="portfolio-panel__title">Bound venues</div>
            <p className="muted" style={{ fontSize: "0.75rem", marginTop: "-0.25rem", marginBottom: "0.75rem" }}>
              This portfolio can route strategies only through bound venues with matching environment and market.
            </p>
            <div>
              <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                Portfolio
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.2 }}>
                {portfolio.name} <span className="muted">#{portfolio.portfolio_id}</span>
              </div>
            </div>
            <div className="portfolio-metric">
              <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                Active venues
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.2 }}>
                {summary.venue_count}
              </div>
            </div>
          </div>
        </div>
        {!hasVenues ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            No active venues are bound to this portfolio. Open the Venues tab to bind one.
          </p>
        ) : null}
      </div>

      {hasVenues ? (
        <div className="card">
          <h2 className="section-title" style={{ marginTop: 0 }}>Venue wallets</h2>
          <table className="compact">
            <thead>
              <tr>
                <th>Venue</th>
                <th>Route</th>
                <th>Total value</th>
                <th>Spot assets</th>
                <th>Futures wallet</th>
                <th>Available</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {summary.items.map((item) => {
                const wallet = item.wallet;
                const venue = item.venue;
                return (
                  <tr key={venue.venue_id}>
                    <td>
                      <strong>{venue.display_name || `venue-${venue.venue_id}`}</strong>
                      <div className="muted"><code>{venue.api_key ? venueAPIKeyLabel(venue.api_key) : venue.credential_fingerprint || venue.venue_id}</code></div>
                    </td>
                    <td>
                      {venueRouteLabel(venue.exchange_label, venue.exchange)} · {venueRouteLabel(venue.market_label, venue.market)}
                      <div className="muted">{venueRouteLabel(venue.environment_label, venue.environment)}</div>
                    </td>
                    <td>{wallet ? formatUSDT(walletDisplayTotal(wallet)) : "-"}</td>
                    <td>
                      {wallet?.spot?.assets.length ? (
                        <div style={{ display: "grid", gap: "0.2rem" }}>
                          {wallet.spot.assets.map((asset) => (
                            <div key={asset.asset} style={{ whiteSpace: "nowrap" }}>
                              <strong>{asset.asset}</strong>{" "}
                              <span className="muted">free {asset.free} · locked {asset.locked}</span>
                              {asset.price ? <span className="muted"> · price {asset.price}</span> : null}
                            </div>
                          ))}
                        </div>
                      ) : "-"}
                    </td>
                    <td>{wallet ? formatUSDT(wallet.futures?.wallet_balance) : "-"}</td>
                    <td>{wallet ? formatUSDT(wallet.futures?.available_balance) : "-"}</td>
                    <td>
                      {item.error ? (
                        <span className="error">{item.error}</span>
                      ) : (
                        <span className="status-badge status-badge--completed">loaded</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function venueRouteLabel(labelValue?: string, code?: number): string {
  return labelValue || (code == null ? "-" : String(code));
}

function isSyntheticBacktestKey(value?: string): boolean {
  return /^sim_btv_[0-9a-f]{32}$/.test(value || "");
}

function venueAPIKeyLabel(value?: string): string {
  if (!value) return "-";
  const masked = value.length <= 8 ? value : `${value.slice(0, 4)}…${value.slice(-4)}`;
  return isSyntheticBacktestKey(value) ? `Synthetic ${masked}` : masked;
}

function PortfolioVenuesPanel({
  portfolio,
  environment,
  onChanged,
}: {
  portfolio: Portfolio;
  environment: number;
  onChanged: () => void;
}) {
  const portfolioId = portfolio.portfolio_id;
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedVenueID, setSelectedVenueID] = useState("");
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [binding, setBinding] = useState(false);

  async function loadPortfolioVenues(offset: number, limit: number) {
    setLoading(true);
    setError(null);
    try {
      return await listPortfolioVenues(portfolioId, {
        include_inactive: true,
        offset,
        limit,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load portfolio venues failed");
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function handleBindVenue(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedVenueID || !selectedVenue) return;
    setError(null);
    setNotice(null);
    setBinding(true);
    try {
      if (selectedVenue.portfolio_id === portfolioId) {
        setNotice("Venue is already bound to this portfolio.");
        return;
      }
      await bindVenue(selectedVenue.venue_id, portfolioId, `bound from portfolio ${portfolioId}`);
      setNotice(selectedVenue.portfolio_id ? "Venue rebound to this portfolio." : "Venue bound to this portfolio.");
      setSelectedVenueID("");
      setSelectedVenue(null);
      setRefreshKey((v) => v + 1);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bind venue failed");
    } finally {
      setBinding(false);
    }
  }

  async function handleReleaseVenue(venue: Venue) {
    setError(null);
    setNotice(null);
    try {
      await releaseVenue(venue.venue_id, `released from portfolio ${portfolioId}`);
      setNotice("Venue released from this portfolio.");
      setRefreshKey((v) => v + 1);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Release venue failed");
    }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "0.75rem" }}>
        <div>
          <h2 className="section-title" style={{ marginBottom: "0.25rem" }}>Venues</h2>
          <p className="muted" style={{ margin: 0 }}>Exchange venues bound to this portfolio.</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" onClick={() => setRefreshKey((v) => v + 1)} disabled={loading}>Refresh</button>
          <Link to={`/venues?portfolio_id=${portfolioId}&tab=create&environment=${String(portfolioEnvironmentLabel(environment)).toLowerCase()}`}>Create venue</Link>
        </div>
      </div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <form onSubmit={handleBindVenue}>
          <h3 className="section-title" style={{ marginBottom: "0.5rem" }}>Bind venue</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Select an active {portfolioEnvironmentLabel(environment)} venue. If it is bound to another portfolio, it will be handed off to this portfolio.
          </p>
          <label>Venue</label>
          <AsyncSelect<Venue>
            value={selectedVenueID}
            placeholder="Select venue"
            onChange={(value, option) => {
              setSelectedVenueID(value);
              setSelectedVenue(option?.item ?? null);
            }}
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
                  detail: `${venue.exchange_label || venue.exchange} · ${venue.market_label || venue.market} · ${venue.portfolio_id ? `portfolio ${venue.portfolio_id}` : "unbound"}`,
                  item: venue,
                }),
              });
            }}
            searchPlaceholder="Search venue name, ID, or API key"
            allowClear={false}
          />
          <p style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button type="submit" className="primary" disabled={binding || !selectedVenueID}>
              {binding ? "Binding..." : selectedVenue?.portfolio_id && selectedVenue.portfolio_id !== portfolioId ? "Rebind to this portfolio" : "Bind to this portfolio"}
            </button>
          </p>
        </form>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}
      <InfiniteTable<Venue>
        columns={["Name", "Exchange", "Market", "Environment", "Status", "API Key", "Updated", "Action"]}
        loadPage={loadPortfolioVenues}
        refreshKey={`${portfolioId}-${refreshKey}`}
        emptyText="No venues bound to this portfolio."
        rowKey={(venue) => String(venue.venue_id)}
        renderRow={(venue) => (
          <>
            <td>
              <strong>{venue.display_name || `venue-${venue.venue_id}`}</strong>
              <div className="muted"><code>{venue.venue_id}</code></div>
            </td>
            <td>{venueRouteLabel(venue.exchange_label, venue.exchange)}</td>
            <td>{venueRouteLabel(venue.market_label, venue.market)}</td>
            <td>{venueRouteLabel(venue.environment_label, venue.environment)}</td>
            <td>
              <span className={venue.status_label === "active" ? "status-badge status-badge--completed" : "status-badge status-badge--stopped"}>
                {venueRouteLabel(venue.status_label, venue.status)}
              </span>
            </td>
            <td><code>{venueAPIKeyLabel(venue.api_key)}</code></td>
            <td>{venue.updated_at ? formatUTCWithLocal(venue.updated_at) : "-"}</td>
            <td>
              <button type="button" onClick={() => void handleReleaseVenue(venue)}>Release</button>
            </td>
          </>
        )}
      />
    </>
  );
}

// ── Strategy execution panel ─────────────────────────────────────────────────

function portfolioRunStrategyReturnPath(portfolioId: number, returnTo?: string | null, runtimeId?: string): string {
  const params = new URLSearchParams();
  params.set("tab", "run");
  if (runtimeId) params.set("runtime_id", runtimeId);
  if (returnTo) params.set("return_to", returnTo);
  return `/portfolios/${portfolioId}?${params.toString()}`;
}

type SessionRecord = {
  sessionId: string;
  statusLabel: string;
  barsProcessed: number;
  error: string;
  statusNote?: string;
};

const MAX_STATUS_POLL_ERRORS = 5;

function isRunPanelActiveStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === "running" || normalized === "stopping";
}

function sessionRecordFromSession(session: Session): SessionRecord {
  return {
    sessionId: session.session_id,
    statusLabel: session.status || "running",
    barsProcessed: session.bars_processed || 0,
    error: session.error || "",
    statusNote: "",
  };
}

function badgeClass(status: string): string {
  switch (status) {
    case "running": return "status-badge status-badge--running";
    case "stopping": return "status-badge status-badge--stopping";
    case "completed":
    case "finished": return "status-badge status-badge--completed";
    case "failed": return "status-badge status-badge--failed";
    case "recoverable": return "status-badge status-badge--recoverable";
    case "stop_failed": return "status-badge status-badge--stop-failed";
    case "stopping_failed": return "status-badge status-badge--stop-failed";
    case "stopped": return "status-badge status-badge--stopped";
    default: return "status-badge status-badge--idle";
  }
}

function parseDateTimeLocalMs(value: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

function sessionKindBadge(session: Session): React.ReactNode {
  if (!session.session_type) return null;
  return (
    <span className="status-badge status-badge--idle" style={{ marginLeft: "0.5rem" }}>
      {session.session_type}
    </span>
  );
}

function declarationText(item: { exchange?: string; market?: string; symbol?: string; interval?: string }): string {
  const route = `${item.exchange || "binance"} / ${item.market || "-"}`;
  const symbol = item.symbol ? ` · ${item.symbol}` : "";
  const interval = item.interval ? ` · ${item.interval}` : "";
  return `${route}${symbol}${interval}`;
}

function previewInputs(preview: PreviewRunStrategy): NonNullable<PreviewRunStrategy["inputs"]> {
  return preview.inputs ?? preview.declared_inputs ?? [];
}

function previewOrderTargets(preview: PreviewRunStrategy): NonNullable<PreviewRunStrategy["order_targets"]> {
  return preview.order_targets ?? preview.declared_order_targets ?? [];
}

function previewRoutes(preview: PreviewRunStrategy): NonNullable<PreviewRunStrategy["required_routes"]> {
  return preview.required_routes ?? [];
}

// Demo-start readiness hint.
//
// Asks strategy-service's PreviewRunStrategy — the same evaluator the real
// start uses — so the hint is byte-for-byte consistent with what the user
// will see when they click "Start Demo Session". This replaced an earlier
// heuristic that looked at every market-data request on the user's portfolio
// (including streams unrelated to the current strategy), which could show
// green on the wrong symbol/interval/portfolio.
function LiveStartReadinessHint({
  preview,
  loading,
  error,
}: {
  preview: PreviewRunStrategy | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !preview && !error) {
    return (
      <div className="card" style={{ marginBottom: "0.75rem", borderLeft: "4px solid #3b82f6" }}>
        <p style={{ margin: 0, fontSize: "0.9rem" }}>
          <strong>Checking demo preflight...</strong>
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="card" style={{ marginBottom: "0.75rem", borderLeft: "4px solid #eab308" }}>
        <p style={{ margin: 0, fontSize: "0.9rem" }}>
          <strong>Demo start blocked:</strong>{" "}
          <span className="muted">{error}</span>
        </p>
      </div>
    );
  }
  if (!preview) return null;
  const inputs = previewInputs(preview);
  const orderTargets = previewOrderTargets(preview);
  const routes = previewRoutes(preview);

  // Unsupported profile (e.g. live not yet wired) — surface the same
  // profile-level failure backend would report on click.
  if (!preview.supported) {
    return (
      <div className="card" style={{ marginBottom: "0.75rem", borderLeft: "4px solid #ef4444" }}>
        <p style={{ margin: 0, fontSize: "0.9rem" }}>
          <strong>Runtime profile unsupported:</strong>{" "}
          profile <code>{preview.profile || "unknown"}</code> is not wired up for this portfolio environment.
          {preview.failures.length > 0 ? ` ${preview.failures[0].reason}` : ""}
        </p>
      </div>
    );
  }

  if (preview.ok) {
    return (
      <div className="card" style={{ marginBottom: "0.75rem", borderLeft: "4px solid #16a34a" }}>
        <p style={{ margin: 0, fontSize: "0.9rem" }}>
          <strong>Declarations ready:</strong>{" "}
          {inputs.length} input(s), {orderTargets.length} order target(s), {routes.length} route(s).{" "}
          <Link to="/market-data">Details</Link>
        </p>
        <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.5rem", fontSize: "0.82rem" }}>
          <div>
            <span className="muted">Max loss close:</span>{" "}
            {formatRiskPercent(preview.risk_controls?.max_loss_close_pct)}
            {preview.risk_controls?.max_loss_close_source ? (
              <span className="muted"> · {preview.risk_controls.max_loss_close_source}</span>
            ) : null}
          </div>
          <div>
            <span className="muted">Leverage:</span>{" "}
            {formatLeverage(preview.risk_controls?.leverage)}
            {preview.risk_controls?.leverage_source ? (
              <span className="muted"> · {preview.risk_controls.leverage_source}</span>
            ) : null}
          </div>
          {inputs.length > 0 ? (
            <div><span className="muted">Inputs:</span> {inputs.slice(0, 3).map(declarationText).join("; ")}{inputs.length > 3 ? " …" : ""}</div>
          ) : null}
          {orderTargets.length > 0 ? (
            <div><span className="muted">Order targets:</span> {orderTargets.slice(0, 3).map(declarationText).join("; ")}{orderTargets.length > 3 ? " …" : ""}</div>
          ) : (
            <div><span className="muted">Order targets:</span> read-only strategy</div>
          )}
        </div>
      </div>
    );
  }

  // Not-ok — enumerate failures per declared input.
  return (
      <div className="card" style={{ marginBottom: "0.75rem", borderLeft: "4px solid #eab308" }}>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>
        <strong>Demo start blocked:</strong>{" "}
        {preview.failures.length} declared input(s) not ready.
      </p>
      <div style={{ display: "grid", gap: "0.35rem", marginBottom: "0.5rem", fontSize: "0.82rem" }}>
        <div>
          <span className="muted">Max loss close:</span>{" "}
          {formatRiskPercent(preview.risk_controls?.max_loss_close_pct)}
          {preview.risk_controls?.max_loss_close_source ? (
            <span className="muted"> · {preview.risk_controls.max_loss_close_source}</span>
          ) : null}
        </div>
        <div>
          <span className="muted">Leverage:</span>{" "}
          {formatLeverage(preview.risk_controls?.leverage)}
          {preview.risk_controls?.leverage_source ? (
            <span className="muted"> · {preview.risk_controls.leverage_source}</span>
          ) : null}
        </div>
        {inputs.length > 0 ? (
          <div><span className="muted">Inputs:</span> {inputs.slice(0, 3).map(declarationText).join("; ")}{inputs.length > 3 ? " …" : ""}</div>
        ) : null}
        {orderTargets.length > 0 ? (
          <div><span className="muted">Order targets:</span> {orderTargets.slice(0, 3).map(declarationText).join("; ")}{orderTargets.length > 3 ? " …" : ""}</div>
        ) : null}
      </div>
      <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.85rem" }}>
        {preview.failures.map((f, i) => (
          <li key={`${f.kind}-${i}`} className="muted">
            {f.input_key ? (
              <>
                <code>{f.input_key.symbol} {f.input_key.market} {f.input_key.interval}</code>
                {" — "}
              </>
            ) : null}
            {f.code ? <code>{f.code}</code> : <span style={{ opacity: 0.75 }}>[{f.kind}]</span>}{" "}
            {f.reason}
            <div style={{ fontSize: "0.78rem" }}>
              route {f.route || `${f.exchange_label || f.exchange || "-"}/${f.market_label || f.market || "-"}/${f.symbol || "-"}`}
              {` · environment ${f.environment}`}
              {` · source ${f.source || "-"}`}
              {` · retryable ${String(f.retryable)}`}
              {f.filter_type ? ` · filter ${f.filter_type}` : ""}
              {f.venue_id ? ` · venue ${f.venue_id}` : ""}
            </div>
          </li>
        ))}
      </ul>
      <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
        <Link to="/market-data">Manage streams →</Link>
      </p>
    </div>
  );
}

function BacktestCoverageGate({
  preview,
  loading,
  error,
  job,
  startTimeMs,
  endTimeMs,
  runtimeSelected,
  busy,
  onRefresh,
  onDownloadAndRun,
}: {
  preview: BacktestCoveragePreview | null;
  loading: boolean;
  error: string | null;
  job: DownloadRunJob | null;
  startTimeMs?: number;
  endTimeMs?: number;
  runtimeSelected: boolean;
  busy: boolean;
  onRefresh: () => void;
  onDownloadAndRun: () => void;
}) {
  const [sampleKey, setSampleKey] = useState("");
  const [sampleData, setSampleData] = useState<MarketDataKlines | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  async function loadSampleData(key: StreamKey) {
    if (!startTimeMs || !endTimeMs) return;
    const id = strategyStreamKey(key);
    setSampleKey(id);
    setSampleLoading(true);
    setSampleError(null);
    try {
      const rows = await queryMarketDataKlines({
        exchange: key.exchange,
        market: key.market,
        kind: key.kind || "kline",
        symbol: key.symbol,
        interval: key.interval,
        start_time_ms: startTimeMs,
        end_time_ms: endTimeMs,
        limit: 20,
      });
      setSampleData(rows);
    } catch (err) {
      setSampleData(null);
      setSampleError(err instanceof Error ? err.message : "Sample Kline query failed");
    } finally {
      setSampleLoading(false);
    }
  }

  if (!runtimeSelected) {
    return (
      <div className="card" style={{ marginTop: "0.75rem", marginBottom: "0.75rem", borderLeft: "4px solid #eab308" }}>
        <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
          Select a runtime to check historical coverage.
        </p>
      </div>
    );
  }

  const blocked = !preview?.complete;
  const canDownloadAndRun = Boolean(preview && !preview.complete && preview.can_auto_download && !busy);
  const jobRuntimeError = job ? formatRuntimeDependencyError(job.runtime_error) : null;
  const jobError = jobRuntimeError ?? job?.error;

  return (
    <div className="card" style={{ marginTop: "0.75rem", marginBottom: "0.75rem", borderLeft: blocked ? "4px solid #eab308" : "4px solid #16a34a" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontWeight: 600 }}>Historical coverage</p>
        <button type="button" onClick={onRefresh} disabled={loading || busy}>
          {loading ? "Checking…" : "Check Coverage"}
        </button>
      </div>

      {error ? <p className="error" style={{ marginTop: "0.5rem" }}>{error}</p> : null}
      {loading && !preview ? <p className="muted" style={{ marginTop: "0.5rem" }}>Checking historical data…</p> : null}

      {preview ? (
        <>
          <p style={{ marginTop: "0.5rem", marginBottom: "0.5rem" }}>
            {preview.complete ? (
              <span className="status-badge status-badge--completed">complete</span>
            ) : (
              <span className="status-badge status-badge--running">missing data</span>
            )}
            <span className="muted" style={{ marginLeft: "0.5rem" }}>
              {preview.inputs.length} declared input(s)
            </span>
          </p>

          <div className="table-scroll">
            <table className="compact" style={{ width: "100%", minWidth: "620px" }}>
              <thead>
                <tr>
                  <th>Input</th>
                  <th>Bars</th>
                  <th>Missing</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {preview.inputs.map((input) => {
                  const id = strategyStreamKey(input.key);
                  return (
                    <tr key={id}>
                      <td>
                        <code>{input.key.symbol}</code>{" "}
                        <span className="muted">{input.key.market} {input.key.interval}</span>
                      </td>
                      <td>{input.covered_count}/{input.expected_count}</td>
                      <td>
                        {input.complete ? (
                          <span className="status-badge status-badge--completed">ok</span>
                        ) : input.non_downloadable_reason ? (
                          <span className="error">{input.non_downloadable_reason}</span>
                        ) : (
                          input.missing_segments.slice(0, 3).map((gap) => (
                            <div key={`${gap.start_at}-${gap.end_at}`} className="muted" style={{ fontSize: "0.8rem" }}>
                              {formatUTCWithLocal(gap.start_at)} → {formatUTCWithLocal(gap.end_at)}
                            </div>
                          ))
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => { void loadSampleData(input.key); }}
                          disabled={sampleLoading || !startTimeMs || !endTimeMs}
                        >
                          {sampleLoading && sampleKey === id ? "Loading…" : "View sample data"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {sampleError ? <p className="error" style={{ marginTop: "0.5rem" }}>{sampleError}</p> : null}
          {sampleData ? <BacktestSampleKlines result={sampleData} /> : null}

          {!preview.complete ? (
            <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="primary" onClick={onDownloadAndRun} disabled={!canDownloadAndRun}>
                Download data and run backtest
              </button>
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                Direct run is disabled until the full range is available.
              </span>
            </div>
          ) : null}
        </>
      ) : null}

      {job ? (
        <div style={{ marginTop: "0.75rem" }}>
          <p className="muted" style={{ margin: 0 }}>
            download job: {job.status} · {Math.round((job.progress || 0) * 100)}%
            {job.updated_at ? ` · last checked ${formatUTCWithLocal(job.updated_at)}` : ""}
            {jobError ? ` · ${jobError}` : ""}
          </p>
          {job.message ? (
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
              {job.message}
            </p>
          ) : null}
          {job.requests?.length ? (
            <div className="table-scroll" style={{ marginTop: "0.5rem" }}>
              <table className="compact" style={{ width: "100%", minWidth: "560px" }}>
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Status</th>
                    <th>Range</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {job.requests.map((request) => (
                    <tr key={request.request_id}>
                      <td>
                        #{request.request_id}{" "}
                        <span className="muted">{request.key.symbol} {request.key.interval}</span>
                      </td>
                      <td>
                        <span className={`status-badge ${request.status === "error" ? "status-badge--failed" : request.status === "ready" ? "status-badge--completed" : "status-badge--running"}`}>
                          {request.status}
                        </span>
                        {request.last_error ? (
                          <div className="error" style={{ fontSize: "0.78rem" }}>{request.last_error}</div>
                        ) : null}
                      </td>
                      <td className="muted" style={{ fontSize: "0.78rem" }}>
                        {request.requested_start_at ? formatUTCWithLocal(request.requested_start_at) : "-"}
                        {" → "}
                        {request.requested_end_at ? formatUTCWithLocal(request.requested_end_at) : "-"}
                      </td>
                      <td className="muted" style={{ fontSize: "0.78rem" }}>
                        {request.updated_at ? formatUTCWithLocal(request.updated_at) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
        <Link to="/market-data">Open Market Data</Link>
      </p>
    </div>
  );
}

function BacktestSampleKlines({ result }: { result: MarketDataKlines }) {
  return (
    <div style={{ marginTop: "0.75rem" }}>
      <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Sample Klines</p>
      {result.rows.length === 0 ? (
        <p className="muted">No raw Kline rows in this range.</p>
      ) : (
        <div className="table-scroll">
          <table className="compact" style={{ width: "100%", minWidth: "720px" }}>
            <thead>
              <tr>
                <th>Open Time</th>
                <th>Open</th>
                <th>High</th>
                <th>Low</th>
                <th>Close</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={`${row.open_time}-${row.close_time}`}>
                  <td>{formatUTCWithLocal(row.open_time)}</td>
                  <td>{row.open}</td>
                  <td>{row.high}</td>
                  <td>{row.low}</td>
                  <td>{row.close}</td>
                  <td>{row.volume}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadSafeName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "portfolio";
}

function LocalDebugPackagePanel({
  portfolio,
  capabilities,
  capabilityError,
}: {
  portfolio: Portfolio;
  capabilities: ProductCapabilities;
  capabilityError: string | null;
}) {
  const [activeStrategy, setActiveStrategy] = useState<PortfolioStrategy | null>(null);
  const [runtimeId, setRuntimeId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const declaresSpot = strategyDeclaresSpot(activeStrategy?.strategy.code);
  const offlineSpotCapability = capabilities.states.offline_spot_usdt;
  const spotOfflineBlocked = declaresSpot && (capabilities.discovery_failed || !offlineSpotCapability.effective);
  const spotOfflineCode = capabilities.discovery_failed
    ? "SPOT_CAPABILITY_DISCOVERY_UNAVAILABLE"
    : "SPOT_CAPABILITY_DISABLED";
  const spotOfflineReason = capabilities.discovery_failed
    ? "Spot capability discovery failed; offline Spot package export is disabled."
    : offlineSpotCapability.reason || "Offline Spot package export is disabled.";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = await listPortfolioStrategies(portfolio.portfolio_id);
        const active = items.find((item) => item.active) ?? null;
        if (!active) {
          if (!cancelled) setActiveStrategy(null);
          return;
        }
        const detail = await getStrategy(active.strategy.strategy_id);
        if (!cancelled) setActiveStrategy({ ...active, strategy: detail });
      } catch (loadError) {
        if (!cancelled) {
          setActiveStrategy(null);
          setError(loadError instanceof Error ? loadError.message : "Load active strategy failed");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [portfolio.portfolio_id]);

  async function handleGenerateDebugPackage() {
    const startTimeMs = parseDateTimeLocalMs(startTime);
    const endTimeMs = parseDateTimeLocalMs(endTime);
    if (!startTimeMs || !endTimeMs || startTimeMs >= endTimeMs) {
      setError("Select a valid start and end time.");
      return;
    }
    if (!activeStrategy) {
      setError("Activate a strategy before generating a debug package.");
      return;
    }
    if (!runtimeId) {
      setError("Select a debugger runtime.");
      return;
    }
    if (spotOfflineBlocked) {
      setError(`${spotOfflineCode}: ${spotOfflineReason}`);
      return;
    }

    setDownloading(true);
    setError(null);
    setNotice(null);
    try {
      const body = buildDebugPackageRequest(
        activeStrategy.strategy.strategy_id,
        runtimeId,
        startTimeMs,
        endTimeMs,
      );
      const blob = await downloadDebugPackage(portfolio.portfolio_id, body);
      const filename = `debug-package-${downloadSafeName(portfolio.name)}-strategy-${activeStrategy.strategy.strategy_id}.zip`;
      downloadBlob(blob, filename);
      setNotice("Debug package generated. Import it in the local strategy debugger workspace.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Debug package generation failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <h2 className="section-title">Local Debug</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Generate an offline package for the local strategy debugger CLI. The package contains
          every declared strategy input (Spot and/or Futures), the authoritative Venue wallet and risk
          facts, and the exact active strategy source. Routes cannot be overridden from this form.
        </p>
        <p>
          Active strategy: {activeStrategy
            ? <><strong>{activeStrategy.strategy.name}</strong> v{activeStrategy.strategy.version} · #{activeStrategy.strategy.strategy_id}</>
            : <span className="error">None</span>}
        </p>
        <FilterPanel>
          <RuntimeSelector
            value={runtimeId}
            onChange={(value) => setRuntimeId(value)}
            environment={0}
            role="debugger"
            label="Debugger runtime"
          />
          <DateTimeRangePicker
            label="Time range"
            startValue={startTime}
            endValue={endTime}
            onStartChange={setStartTime}
            onEndChange={setEndTime}
            className="filter-field--wide"
          />
          <div className="filter-action">
            <button
              type="button"
              className="primary"
              onClick={() => { void handleGenerateDebugPackage(); }}
              disabled={downloading || !startTime || !endTime || !runtimeId || !activeStrategy || spotOfflineBlocked}
            >
              {downloading ? "Generating..." : "Generate Debug Package"}
            </button>
          </div>
        </FilterPanel>

        {spotOfflineBlocked ? (
          <p className="error" style={{ marginTop: "0.75rem" }}>
            <code>{spotOfflineCode}</code>: {spotOfflineReason}
            {capabilityError ? ` Discovery error: ${capabilityError}` : ""}
          </p>
        ) : null}

        {error ? <p className="error" style={{ marginTop: "0.75rem" }}>{error}</p> : null}
        {notice ? <p className="muted" style={{ marginTop: "0.75rem" }}>{notice}</p> : null}

        <div
          style={{
            marginTop: "1rem",
            border: "1px solid #dbe4f0",
            borderRadius: "6px",
            padding: "0.9rem 1rem",
            background: "#f8fafc",
          }}
        >
          <p style={{ fontWeight: 600, marginTop: 0 }}>Local CLI flow</p>
          <pre style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
{`# One-time setup in the strategy-debugger-cli repository
python init.py

# Import this package into the generated workspace
cd ~/hushine-debug-workspace
.venv/bin/hushine-debug import ~/Downloads/debug-package.zip
.venv/bin/hushine-debug replay`}
          </pre>
        </div>
      </div>
    </>
  );
}

function StrategyPanel({
  portfolioId,
  environment,
  initialRuntimeId = "",
  initialStrategyId = "",
  returnTo,
  capabilities,
  capabilityError,
  onSessionsChanged,
}: {
  portfolioId: number;
  environment: number;
  initialRuntimeId?: string;
  initialStrategyId?: string;
  returnTo?: string | null;
  capabilities: ProductCapabilities;
  capabilityError: string | null;
  onSessionsChanged: () => void;
}) {
  // Interval is no longer user-selectable: the strategy's declared INPUTS
  // are the authoritative universe, so a UI-level interval override would
  // only appear in session metadata without affecting the actual run.
  // Keep a fixed fallback for the RunStrategy proto's still-present
  // ``interval`` field (used as session metadata only).
  const sessionMetadataInterval = "1m";
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [activePollSession, setActivePollSession] = useState<SessionRecord | null>(null);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusPollInFlightRef = useRef(false);
  const statusPollErrorCountRef = useRef(0);
  const downloadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const navigate = useNavigate();
  const [startRuntimeId, setStartRuntimeId] = useState(initialRuntimeId);
  const [startRuntime, setStartRuntime] = useState<Runtime | null>(null);
  const quickStartMode = isQuickStartReturnTo(returnTo);
  const [maxLossClosePercent, setMaxLossClosePercent] = useState(String(DEFAULT_MAX_LOSS_CLOSE_PERCENT));
  const [sessionLeverageText, setSessionLeverageText] = useState(String(DEFAULT_SESSION_LEVERAGE));
  const [pendingStart, setPendingStart] = useState<{
    kind: "backtest" | "demo";
    interval: string;
    startTimeMs?: number;
    endTimeMs?: number;
  } | null>(null);
  const [coveragePreview, setCoveragePreview] = useState<BacktestCoveragePreview | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [downloadJob, setDownloadJob] = useState<DownloadRunJob | null>(null);
  const [demoPreview, setDemoPreview] = useState<PreviewRunStrategy | null>(null);
  const [demoPreviewLoading, setDemoPreviewLoading] = useState(false);
  const [demoPreviewError, setDemoPreviewError] = useState<string | null>(null);
  const [activeRunDeclaredTargets, setActiveRunDeclaredTargets] = useState<StrategyOrderTargetDeclaration[]>([]);

  // Portfolio strategies (mounting panel)
  const [portfolioStrats, setPortfolioStrats] = useState<PortfolioStrategy[]>([]);
  const [activeStrategyCode, setActiveStrategyCode] = useState<string | undefined>(undefined);
  const [activeStrategyContextLoading, setActiveStrategyContextLoading] = useState(false);
  const [activeStrategyContextError, setActiveStrategyContextError] = useState<string | null>(null);
  const [mountErr, setMountErr] = useState<string | null>(null);
  const [selectedMountId, setSelectedMountId] = useState<number | "">("");
  const activeStrat = portfolioStrats.find((item) => item.active);
  const mountedIds = new Set(portfolioStrats.map((item) => item.strategy.strategy_id));
  const maxLossClosePct = parseMaxLossClosePct(maxLossClosePercent);
  const sessionLeverage = parseSessionLeverage(sessionLeverageText);
  const sourceDeclaredInputs = extractStrategyInputs(activeStrategyCode ?? activeStrat?.strategy.code);
  const sourceDeclaredTargets = extractStrategyOrderTargets(activeStrategyCode ?? activeStrat?.strategy.code);
  const activeStrategyDeclaresSpot = [...sourceDeclaredInputs, ...sourceDeclaredTargets]
    .some((declaration) => declaration.market.trim().toLowerCase() === "spot");
  const sourceDeclarationPreview: PreviewRunStrategy | null = activeStrat
    ? {
        profile: environment === 0 ? "backtest" : environment === 1 ? "demo" : environment === 2 ? "live" : "unknown",
        supported: true,
        ok: true,
        failures: [],
        required_streams: [],
        declared_inputs: sourceDeclaredInputs,
        declared_order_targets: sourceDeclaredTargets,
      }
    : null;
  const coverageSpotPreview: PreviewRunStrategy | null = coveragePreview
    ? {
        profile: "backtest",
        supported: true,
        ok: coveragePreview.complete,
        failures: [],
        required_streams: coveragePreview.inputs.map((input) => input.key),
        declared_inputs: sourceDeclaredInputs,
        declared_order_targets: sourceDeclaredTargets,
      }
    : null;
  const selectedCapabilityPreview = pendingStart?.kind === "demo"
    ? demoPreview ?? sourceDeclarationPreview
    : pendingStart?.kind === "backtest"
      ? coverageSpotPreview ?? sourceDeclarationPreview
      : sourceDeclarationPreview;
  const runCapabilityDecision = strategySpotCapabilityDecision(
    selectedCapabilityPreview,
    environment,
    "run",
    capabilities,
  );
  const activeStrategyDeclaredTargets = activeRunDeclaredTargets.length > 0
    ? activeRunDeclaredTargets
    : sourceDeclaredTargets;
  const demoStartPreflightReady = pendingStart?.kind !== "demo" || (
    Boolean(demoPreview?.ok) && !demoPreviewLoading && !demoPreviewError && runCapabilityDecision.enabled
  );
  const activeSessionInRunPanel = Boolean(activePollSession && isRunPanelActiveStatus(activePollSession.statusLabel));

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (downloadPollRef.current) clearInterval(downloadPollRef.current);
      statusPollInFlightRef.current = false;
      statusPollErrorCountRef.current = 0;
    };
  }, []);

  useEffect(() => {
    loadPortfolioStrats();
  }, [portfolioId]);

  useEffect(() => {
    const strategyID = activeStrat?.strategy.strategy_id;
    setActiveStrategyCode(undefined);
    setActiveStrategyContextLoading(Boolean(strategyID));
    setActiveStrategyContextError(null);
    if (!strategyID) return;
    let cancelled = false;
    getStrategy(strategyID)
      .then((strategy) => {
        if (!cancelled) setActiveStrategyCode(strategy.code);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setActiveStrategyContextError(loadError instanceof Error ? loadError.message : "Load active strategy declarations failed");
        }
      })
      .finally(() => {
        if (!cancelled) setActiveStrategyContextLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeStrat?.strategy.strategy_id]);

  useEffect(() => {
    setActiveRunDeclaredTargets([]);
  }, [activeStrat?.strategy.strategy_id]);

  useEffect(() => {
    let cancelled = false;
    if (activeSessionInRunPanel || running) return;

    async function restoreActiveRunPanelSession() {
      try {
        const page = await listSessionsPage({ portfolio_id: portfolioId, environment, runtime_id: startRuntimeId || undefined, limit: 20, offset: 0 });
        if (cancelled) return;
        const session = page.items.find((session) => isRunPanelActiveStatus(session.status));
        if (!session) return;
        if (!startRuntimeId && session.runtime_id) {
          setStartRuntimeId(session.runtime_id);
        }
        beginSessionPoll(session.session_id, sessionRecordFromSession(session));
      } catch {
        // The Sessions tab remains the fallback source of truth; do not block
        // the run panel if a restore probe fails during page load.
      }
    }

    void restoreActiveRunPanelSession();
    return () => {
      cancelled = true;
    };
  }, [portfolioId, environment, startRuntimeId, activeSessionInRunPanel, running]);

  useEffect(() => {
    setStartRuntimeId(initialRuntimeId);
  }, [initialRuntimeId]);

  useEffect(() => {
    if (!initialStrategyId) return;
    const parsed = Number(initialStrategyId);
    if (Number.isFinite(parsed) && parsed > 0) {
      setSelectedMountId(parsed);
    }
  }, [initialStrategyId]);

  useEffect(() => {
    setCoveragePreview(null);
    setCoverageError(null);
    setDownloadJob(null);
    if (!pendingStart || pendingStart.kind !== "backtest" || !startRuntimeId) return;
    void loadBacktestCoverage(pendingStart, startRuntimeId);
  }, [pendingStart, startRuntimeId, startRuntime]);

  useEffect(() => {
    setDemoPreview(null);
    setDemoPreviewError(null);
    setDemoPreviewLoading(false);
    if (
      !startDialogOpen ||
      pendingStart?.kind !== "demo" ||
      !startRuntimeId ||
      maxLossClosePct === null ||
      sessionLeverage === null
    ) {
      return;
    }

    const preflightMaxLossClosePct = maxLossClosePct;
    const preflightLeverage = sessionLeverage;
    let cancelled = false;
    let timer: number | null = null;
    async function loadDemoPreflight() {
      setDemoPreviewLoading(true);
      try {
        const preview = await previewRunStrategy(portfolioId, {
          runtime_id: startRuntimeId,
          max_loss_close_pct: preflightMaxLossClosePct,
          leverage: preflightLeverage,
        });
        if (!cancelled) {
          setDemoPreview(preview);
          setActiveRunDeclaredTargets(previewOrderTargets(preview));
          setDemoPreviewError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setDemoPreview(null);
          setDemoPreviewError(formatAPIError(err, "Demo preflight failed"));
        }
      } finally {
        if (!cancelled) {
          setDemoPreviewLoading(false);
          timer = window.setTimeout(loadDemoPreflight, 15_000);
        }
      }
    }
    void loadDemoPreflight();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [portfolioId, startDialogOpen, pendingStart?.kind, startRuntimeId, maxLossClosePct, sessionLeverage]);

  async function loadPortfolioStrats() {
    try {
      const list = await listPortfolioStrategies(portfolioId);
      setPortfolioStrats(list);
    } catch {
      // ignore
    }
  }

  async function handleMount() {
    if (!selectedMountId) return;
    setMountErr(null);
    try {
      await mountStrategy(portfolioId, selectedMountId);
      if (returnTo) {
        await activateStrategy(portfolioId, selectedMountId);
        navigate(appendReturnParam(returnTo, "strategy_id", selectedMountId), { replace: true });
        return;
      }
      await loadPortfolioStrats();
      setSelectedMountId("");
    } catch (e) {
      setMountErr(e instanceof Error ? e.message : "Mount failed");
    }
  }

  async function handleUnmount(sid: number) {
    setMountErr(null);
    try {
      await unmountStrategy(portfolioId, sid);
      await loadPortfolioStrats();
    } catch (e) {
      setMountErr(e instanceof Error ? e.message : "Unmount failed");
    }
  }

  async function handleActivate(sid: number) {
    setMountErr(null);
    try {
      await activateStrategy(portfolioId, sid);
      if (returnTo) {
        navigate(appendReturnParam(returnTo, "strategy_id", sid), { replace: true });
        return;
      }
      await loadPortfolioStrats();
    } catch (e) {
      setMountErr(e instanceof Error ? e.message : "Activate failed");
    }
  }

  function handleUseActiveStrategy(sid: number) {
    if (!returnTo) return;
    navigate(appendReturnParam(returnTo, "strategy_id", sid), { replace: true });
  }

  async function handleDeactivate(sid: number) {
    setMountErr(null);
    try {
      await deactivateStrategy(portfolioId, sid);
      await loadPortfolioStrats();
    } catch (e) {
      setMountErr(e instanceof Error ? e.message : "Deactivate failed");
    }
  }

  function beginSessionPoll(sessionId: string, initial?: SessionRecord) {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    statusPollInFlightRef.current = false;
    statusPollErrorCountRef.current = 0;
    onSessionsChanged();
    setActivePollSession(initial ?? { sessionId, statusLabel: "running", barsProcessed: 0, error: "", statusNote: "" });

    async function pollSession() {
      if (statusPollInFlightRef.current) return;
      statusPollInFlightRef.current = true;
      try {
        const st = await getStrategyStatus(sessionId);
        statusPollErrorCountRef.current = 0;
        setActivePollSession((prev) =>
          prev
            ? {
                ...prev,
                statusLabel: st.status,
                barsProcessed: st.bars_processed,
                error: st.error,
                statusNote: "",
              }
            : prev
        );
        if (st.status !== "running" && st.status !== "stopping") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setRunning(false);
          setActivePollSession(null);
          onSessionsChanged();
        }
      } catch (pollErr) {
        statusPollErrorCountRef.current += 1;
        const message = pollErr instanceof Error ? pollErr.message : "Poll failed";
        if (statusPollErrorCountRef.current < MAX_STATUS_POLL_ERRORS) {
          return;
        }
        setActivePollSession((prev) =>
          prev
            ? {
                ...prev,
                statusNote: `Status updates are delayed; still polling. Last error: ${message}`,
              }
            : prev
        );
      } finally {
        statusPollInFlightRef.current = false;
      }
    }

    void pollSession();
    pollRef.current = setInterval(() => {
      void pollSession();
    }, 2000);
  }

  async function startStrategyRun(
    params: { interval: string; startTimeMs?: number; endTimeMs?: number },
    runtimeId: string,
  ) {
    if (!runCapabilityDecision.enabled) {
      setError(`${runCapabilityDecision.code}: ${runCapabilityDecision.reason}`);
      return;
    }
    if (maxLossClosePct === null) {
      setError("Max loss close must be greater than 0 and no more than 100%.");
      return;
    }
    if (sessionLeverage === null) {
      setError("Leverage must be a positive whole number.");
      return;
    }
    if (!runtimeId) {
      setError("Select a runtime before starting the session.");
      return;
    }
    setRunning(true);
    setError(null);

    try {
      const sess = await runStrategy(portfolioId, {
        strategy_path: "",
        interval: params.interval,
        start_time_ms: params.startTimeMs,
        end_time_ms: params.endTimeMs,
        runtime_id: runtimeId,
        max_loss_close_pct: maxLossClosePct,
        leverage: sessionLeverage,
      });
      setStartDialogOpen(false);
      setPendingStart(null);
      beginSessionPoll(sess.session_id);
      setRunning(false);
    } catch (err) {
      setError(formatAPIError(err, "Failed to start"));
      setRunning(false);
    }
  }

  async function loadBacktestCoverage(
    params: { interval: string; startTimeMs?: number; endTimeMs?: number },
    runtimeId: string,
  ) {
    if (!params.startTimeMs || !params.endTimeMs || !runtimeId) return;
    setCoverageLoading(true);
    setCoverageError(null);
    try {
      const result = await previewBacktestCoverage(portfolioId, {
        strategy_path: "",
        start_time_ms: params.startTimeMs,
        end_time_ms: params.endTimeMs,
        runtime_id: runtimeId,
      });
      setCoveragePreview(result);
    } catch (err) {
      setCoveragePreview(null);
      setCoverageError(err instanceof Error ? err.message : "Coverage preview failed");
    } finally {
      setCoverageLoading(false);
    }
  }

  function clearDownloadPoll() {
    if (downloadPollRef.current) {
      clearInterval(downloadPollRef.current);
      downloadPollRef.current = null;
    }
  }

  function handleDownloadJobUpdate(job: DownloadRunJob) {
    setDownloadJob(job);
    if (job.status === "ready" && job.session_id) {
      clearDownloadPoll();
      setStartDialogOpen(false);
      setPendingStart(null);
      setDownloadJob(null);
      setCoveragePreview(null);
      beginSessionPoll(job.session_id);
      setRunning(false);
      return;
    }
    if (job.status === "error") {
      clearDownloadPoll();
      setError(formatRuntimeDependencyError(job.runtime_error) ?? job.error ?? "Download data and run backtest failed");
      setRunning(false);
    }
  }

  function pollDownloadAndRunJob(jobId: string) {
    clearDownloadPoll();
    downloadPollRef.current = setInterval(async () => {
      try {
        handleDownloadJobUpdate(await getDownloadAndRunJob(jobId));
      } catch (err) {
        clearDownloadPoll();
        setError(err instanceof Error ? err.message : "Download job polling failed");
        setRunning(false);
      }
    }, 2000);
  }

  async function handleDownloadDataAndRun() {
    if (!pendingStart || pendingStart.kind !== "backtest" || !pendingStart.startTimeMs || !pendingStart.endTimeMs) return;
    if (maxLossClosePct === null) {
      setError("Max loss close must be greater than 0 and no more than 100%.");
      return;
    }
    if (sessionLeverage === null) {
      setError("Leverage must be a positive whole number.");
      return;
    }
    if (!startRuntimeId) {
      setError("Select a runtime before starting the session.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const job = await startDownloadAndRunBacktest(portfolioId, {
        strategy_path: "",
        interval: pendingStart.interval,
        start_time_ms: pendingStart.startTimeMs,
        end_time_ms: pendingStart.endTimeMs,
        runtime_id: startRuntimeId,
        max_loss_close_pct: maxLossClosePct,
        leverage: sessionLeverage,
      });
      handleDownloadJobUpdate(job);
      if (job.status !== "ready" && job.status !== "error") {
        pollDownloadAndRunJob(job.job_id);
      }
    } catch (err) {
      setError(formatAPIError(err, "Download data and run backtest failed"));
      setRunning(false);
    }
  }

  function openStartDialog(params: { kind: "backtest" | "demo"; interval: string; startTimeMs?: number; endTimeMs?: number }) {
    setError(null);
    setPendingStart(params);
    setStartDialogOpen(true);
  }

  async function handleConfirmStart() {
    if (!pendingStart) return;
    if (!runCapabilityDecision.enabled) {
      setError(`${runCapabilityDecision.code}: ${runCapabilityDecision.reason}`);
      return;
    }
    if (maxLossClosePct === null) {
      setError("Max loss close must be greater than 0 and no more than 100%.");
      return;
    }
    if (sessionLeverage === null) {
      setError("Leverage must be a positive whole number.");
      return;
    }
    if (pendingStart.kind === "backtest" && !coveragePreview?.complete) {
      setError("Historical data coverage is incomplete. Download missing data before running this backtest.");
      return;
    }
    if (pendingStart.kind === "backtest" && !activeStrat) {
      setError("Activate a strategy before running a backtest.");
      return;
    }
    if (pendingStart.kind === "demo" && !demoStartPreflightReady) {
      setError(demoPreviewError || "Demo preflight is not ready yet.");
      return;
    }
    await startStrategyRun(pendingStart, startRuntimeId);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!startTime || !endTime) return;
    const startTimeMs = parseDateTimeLocalMs(startTime);
    const endTimeMs = parseDateTimeLocalMs(endTime);
    if (!startTimeMs || !endTimeMs) {
      setError("Invalid start or end time.");
      return;
    }
    openStartDialog({
      kind: "backtest",
      interval: sessionMetadataInterval,
      startTimeMs,
      endTimeMs,
    });
  }

  async function handleLiveStart() {
    openStartDialog({ kind: "demo", interval: sessionMetadataInterval });
  }

  async function handleStopCurrentSession() {
    if (!activePollSession) return;
    setStopping(true);
    setStopError(null);
    try {
      const stopped = await stopSession(activePollSession.sessionId, "STOP_ACTION_STOP_ONLY");
      if (!stopped) {
        setStopError("Session is not running or has already been stopped.");
        return;
      }
      setStopDialogOpen(false);
      onSessionsChanged();
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Failed to stop session");
    } finally {
      setStopping(false);
    }
  }

  async function handleFinishCurrentSession() {
    if (!activePollSession) return;
    setFinishing(true);
    setStopError(null);
    try {
      const stopped = await finishSession(activePollSession.sessionId);
      if (!stopped) {
        setStopError("Session is not running or could not be finished.");
        return;
      }
      onSessionsChanged();
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Failed to finish session");
    } finally {
      setFinishing(false);
    }
  }

  async function handleStopAndCloseCurrentSession() {
    if (!activePollSession) return;
    setStopping(true);
    setStopError(null);
    try {
      const stopped = await stopSession(activePollSession.sessionId, "STOP_ACTION_STOP_AND_CLOSE_POSITIONS");
      if (!stopped) {
        setStopError("Session stop-and-close was not accepted.");
        return;
      }
      setStopDialogOpen(false);
      onSessionsChanged();
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Failed to stop and close session");
    } finally {
      setStopping(false);
    }
  }

  return (
    <>
      <h2 className="section-title">Strategy</h2>

      {/* ── Mounted strategies ── */}
      <div className="card" style={{ marginBottom: "1rem" }}>
        <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Mounted strategies</p>
        {portfolioStrats.length === 0 ? (
          <p className="muted">No strategies mounted.</p>
        ) : (
          portfolioStrats.map((as) => (
            <div
              key={as.strategy.strategy_id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.4rem 0",
                borderBottom: "1px solid #f1f5f9",
              }}
            >
              <div>
                <span style={{ fontWeight: 500 }}>{as.strategy.name}</span>{" "}
                <span className="muted">v{as.strategy.version}</span>
                {as.active ? (
                  <span className="status-badge status-badge--completed" style={{ marginLeft: "0.5rem" }}>active</span>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {!as.active ? (
                  <>
                    <button style={{ fontSize: "0.8rem" }} onClick={() => handleActivate(as.strategy.strategy_id)}>
                      Activate
                    </button>
                    <button style={{ fontSize: "0.8rem" }} onClick={() => handleUnmount(as.strategy.strategy_id)}>
                      Unmount
                    </button>
                  </>
                ) : (
	                  <>
	                    {returnTo ? (
	                      quickStartMode ? (
	                        <QuickStartActionButton onClick={() => handleUseActiveStrategy(as.strategy.strategy_id)} />
	                      ) : (
	                        <button style={{ fontSize: "0.8rem" }} onClick={() => handleUseActiveStrategy(as.strategy.strategy_id)}>
	                          Use
	                        </button>
	                      )
	                    ) : null}
                    <button style={{ fontSize: "0.8rem" }} onClick={() => handleDeactivate(as.strategy.strategy_id)}>
                      Deactivate
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
        {mountErr ? <p className="error" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>{mountErr}</p> : null}
        {activeStrategyContextError ? (
          <p className="error" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
            Strategy declaration preview unavailable: {activeStrategyContextError}. Server preflight remains authoritative.
          </p>
        ) : null}

        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <AsyncSelect<Strategy>
              value={selectedMountId === "" ? "" : String(selectedMountId)}
              placeholder="Mount a strategy"
              onChange={(value) => setSelectedMountId(value === "" ? "" : Number(value))}
              loadPage={async (offset, limit, query) => {
                return collectFilteredPage<Strategy, AsyncSelectOption<Strategy>>({
                  offset,
                  limit,
                  loadSourcePage: (sourceOffset, sourceLimit) => listStrategiesPage({ offset: sourceOffset, limit: sourceLimit, namePrefix: query || undefined, activeOnly: true }),
                  matches: (s) => !mountedIds.has(s.strategy_id),
                  map: (s) => ({
                    value: String(s.strategy_id),
                    label: `${s.name} v${s.version}`,
                    detail: `#${s.strategy_id}`,
                    item: s,
                  }),
                });
              }}
            />
            <button onClick={handleMount} disabled={!selectedMountId}>Mount</button>
            <Link
              className="button-link"
              to={`/strategies?tab=create&return_to=${encodeURIComponent(portfolioRunStrategyReturnPath(portfolioId, returnTo, startRuntimeId))}`}
            >
              Create Strategy in Strategy Management
            </Link>
          </div>
      </div>

      {/* ── Active poll session ── */}
      {activePollSession ? (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Running</p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <div>
              <span className="muted" style={{ fontSize: "0.85rem" }}>{activePollSession.sessionId.slice(0, 8)}…</span>
              {activePollSession.barsProcessed > 0 ? (
                <span className="muted" style={{ marginLeft: "0.5rem" }}>{activePollSession.barsProcessed} bars</span>
              ) : null}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className={badgeClass(activePollSession.statusLabel)}>{activePollSession.statusLabel}</span>
              {activePollSession.statusLabel === "running" ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleFinishCurrentSession()}
                    disabled={finishing || stopping}
                  >
                    {finishing ? "Finishing…" : "Finish"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStopDialogOpen(true)}
                    disabled={stopping || finishing}
                  >
                    Stop Session
                  </button>
                </>
              ) : null}
              {activePollSession.statusLabel === "stopping" ? (
                <button type="button" disabled>
                  Stopping…
                </button>
              ) : null}
            </div>
          </div>
          {activePollSession.error ? (
            <p className="error" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>{activePollSession.error}</p>
          ) : null}
          {activePollSession.statusNote ? (
            <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>{activePollSession.statusNote}</p>
          ) : null}
          {stopError ? (
            <p className="error" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>{stopError}</p>
          ) : null}
          <p className="muted" style={{ marginTop: "0.5rem", marginBottom: 0, fontSize: "0.8rem" }}>
            `仅停止 session` 是 soft stop。`先清仓后停止 session` 会尝试把账户风险敞口清到空状态。
          </p>
        </div>
      ) : null}

      {/* ── Run backtest ── */}
      {environment === 0 ? (
      <div className="card">
        {!activeStrat ? (
          <p className="muted">Activate a strategy above to run a backtest.</p>
        ) : (
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            Active: <strong>{activeStrat.strategy.name} v{activeStrat.strategy.version}</strong>
          </p>
        )}
        {activeStrat && !runCapabilityDecision.enabled ? (
          <p className="error" style={{ marginTop: "0.5rem" }}>
            <code>{runCapabilityDecision.code}</code>: {runCapabilityDecision.reason}
            {capabilityError ? ` Capability discovery: ${capabilityError}` : ""}
          </p>
        ) : null}
        <form onSubmit={handleSubmit}>
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: 0, marginBottom: "0.75rem" }}>
            Intervals are read from the active strategy's declared <code>INPUTS</code> —
            the backtest replays every declared <code>(market, symbol, interval)</code>.
          </p>
          <RuntimeSelector
            value={startRuntimeId}
            onChange={(runtimeId, runtime) => {
              setStartRuntimeId(runtimeId);
              setStartRuntime(runtime ?? null);
              setCoveragePreview(null);
              setCoverageError(null);
            }}
            environment={0}
            role="executor"
            label="Runtime"
          />
          <FilterPanel>
            <DateTimeRangePicker
              label="Time range"
              startValue={startTime}
              endValue={endTime}
              onStartChange={setStartTime}
              onEndChange={setEndTime}
              className="filter-field--wide"
            />
          </FilterPanel>

          {error ? <p className="error" style={{ marginTop: "0.5rem" }}>{error}</p> : null}

          <p style={{ marginTop: "0.75rem" }}>
            <button type="submit" className="primary" disabled={running || activeSessionInRunPanel || !startTime || !endTime || !startRuntimeId || !activeStrat || !runCapabilityDecision.enabled}>
              {running ? "Starting…" : activeSessionInRunPanel ? "Session running" : "Run backtest"}
            </button>
          </p>
        </form>
      </div>
      ) : null}

      {/* ── Start demo session ── */}
      {environment === 1 ? (
      <div className="card">
        {!activeStrat ? (
          <p className="muted">Activate a strategy above to start a demo session.</p>
        ) : (
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            Active: <strong>{activeStrat.strategy.name} v{activeStrat.strategy.version}</strong>
          </p>
        )}

        {activeStrat && !runCapabilityDecision.enabled ? (
          <p className="error" style={{ marginTop: "0.5rem" }}>
            <code>{runCapabilityDecision.code}</code>: {runCapabilityDecision.reason}
            {capabilityError ? ` Capability discovery: ${capabilityError}` : ""}
          </p>
        ) : null}

        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
          This starts a demo session using the active strategy's
          declared <code>INPUTS</code> — each <code>(market, symbol, interval)</code> is
          subscribed independently; the UI no longer picks an interval here.
        </p>
        <RuntimeSelector
          value={startRuntimeId}
          onChange={(runtimeId, runtime) => {
            setStartRuntimeId(runtimeId);
            setStartRuntime(runtime ?? null);
          }}
          environment={1}
          role="executor"
          label="Executor runtime"
        />

        {error ? <p className="error" style={{ marginTop: "0.5rem" }}>{error}</p> : null}

        <p style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          <button
            type="button"
            className="primary"
            disabled={running || activeSessionInRunPanel || !activeStrat || !startRuntimeId || !runCapabilityDecision.enabled}
            onClick={() => { void handleLiveStart(); }}
          >
            {running ? "Starting…" : activeSessionInRunPanel ? "Session running" : "Start Demo Session"}
          </button>
        </p>
      </div>
      ) : null}

      {environment === 2 ? (
        <div className="card">
          <p style={{ fontWeight: 600, marginTop: 0 }}>Live strategy start</p>
          {activeStrategyDeclaresSpot ? (
            <p className="error" style={{ marginBottom: "0.75rem" }}>
              <code>SPOT_LIVE_ROLLOUT_GUARD</code>: Live Spot remains rollout-guarded. Existing Session history
              and stop/drain controls remain available.
            </p>
          ) : (
            <p className="muted" style={{ marginBottom: "0.75rem" }}>
              Live start is not exposed by the current runtime profile. Existing Session history and stop/drain controls remain available.
            </p>
          )}
          <button type="button" className="primary" disabled>
            Start Live Session
          </button>
        </div>
      ) : null}

      <StopSessionDialog
        open={stopDialogOpen}
        sessionId={activePollSession?.sessionId}
        busy={stopping}
        error={stopError}
        declaredTargets={activeStrategyDeclaredTargets}
        stopAndCloseDisabled={activeRunDeclaredTargets.length === 0 && (!activeStrat || activeStrategyContextLoading || Boolean(activeStrategyContextError))}
        stopAndCloseDisabledReason={activeRunDeclaredTargets.length > 0
          ? null
          : !activeStrat
            ? "Stop-and-close is unavailable because the running Session's strategy declarations could not be identified. Stop-only remains available."
            : activeStrategyContextLoading
            ? "Loading declared order targets before stop-and-close can be selected."
            : activeStrategyContextError
              ? "Stop-and-close is unavailable because the strategy declarations could not be verified. Stop-only remains available."
              : null}
        onCancel={() => {
          if (stopping) return;
          setStopDialogOpen(false);
          setStopError(null);
        }}
        onStopOnly={() => { void handleStopCurrentSession(); }}
        onStopAndClose={() => { void handleStopAndCloseCurrentSession(); }}
      />
      <RuntimeSelectionDialog
        open={startDialogOpen}
        title={pendingStart?.kind === "demo" ? "Start Demo Session" : "Run Backtest"}
        description={pendingStart?.kind === "demo"
          ? <>Choose where the active strategy will run.</>
          : <>Choose where the backtest session will run.</>}
        runtimeId={startRuntimeId}
        runtimeLabel={pendingStart?.kind === "demo" ? "Executor runtime" : "Runtime"}
        environment={pendingStart?.kind === "demo" ? 1 : 0}
        role={runtimeRoleForSessionEnvironment(pendingStart?.kind === "demo" ? 1 : 0)}
        busy={running}
        error={error}
        confirmLabel={pendingStart?.kind === "demo" ? "Start Session" : "Run Backtest"}
        confirmDisabled={
          maxLossClosePct === null ||
          sessionLeverage === null ||
          !runCapabilityDecision.enabled ||
          (pendingStart?.kind === "demo" && !demoStartPreflightReady) ||
          (pendingStart?.kind === "backtest" && (!coveragePreview?.complete || coverageLoading || Boolean(downloadJob && downloadJob.status !== "error")))
        }
        onRuntimeChange={(runtimeId, runtime) => {
          setStartRuntimeId(runtimeId);
          setStartRuntime(runtime ?? null);
        }}
        onCancel={() => {
          if (running) return;
          setStartDialogOpen(false);
          setPendingStart(null);
          setError(null);
        }}
        onConfirm={() => { void handleConfirmStart(); }}
      >
        <div style={{ marginTop: "0.85rem", display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
          <label style={{ display: "grid", gap: "0.35rem", fontSize: "0.88rem", fontWeight: 600 }}>
            <span>Max loss close (%)</span>
            <input
              type="number"
              min="0.01"
              max="100"
              step="any"
              value={maxLossClosePercent}
              onChange={(event) => setMaxLossClosePercent(event.target.value)}
              disabled={running}
              style={{ maxWidth: "10rem" }}
            />
            {maxLossClosePct === null ? (
              <span className="error" style={{ fontSize: "0.82rem" }}>
                Enter a value from 0.01 to 100.
              </span>
            ) : null}
          </label>
          <label style={{ display: "grid", gap: "0.35rem", fontSize: "0.88rem", fontWeight: 600 }}>
            <span>Leverage (x)</span>
            <input
              type="number"
              min="1"
              step="1"
              value={sessionLeverageText}
              onChange={(event) => setSessionLeverageText(event.target.value)}
              disabled={running}
              style={{ maxWidth: "10rem" }}
            />
            {sessionLeverage === null ? (
              <span className="error" style={{ fontSize: "0.82rem" }}>
                Enter a positive whole number.
              </span>
            ) : null}
          </label>
        </div>
        {pendingStart?.kind === "backtest" ? (
          <BacktestCoverageGate
            preview={coveragePreview}
            loading={coverageLoading}
            error={coverageError}
            job={downloadJob}
            startTimeMs={pendingStart.startTimeMs}
            endTimeMs={pendingStart.endTimeMs}
            runtimeSelected={Boolean(startRuntimeId)}
            busy={running}
            onRefresh={() => {
              if (pendingStart && startRuntimeId) void loadBacktestCoverage(pendingStart, startRuntimeId);
            }}
            onDownloadAndRun={() => { void handleDownloadDataAndRun(); }}
          />
        ) : pendingStart?.kind === "demo" && startRuntimeId && maxLossClosePct !== null && sessionLeverage !== null ? (
          <>
            {!runCapabilityDecision.enabled ? (
              <p className="error">
                <code>{runCapabilityDecision.code}</code>: {runCapabilityDecision.reason}
              </p>
            ) : null}
            <LiveStartReadinessHint preview={demoPreview} loading={demoPreviewLoading} error={demoPreviewError} />
          </>
        ) : null}
      </RuntimeSelectionDialog>
    </>
  );
}

// ── Session Panel (pagination + search, click → session detail page) ───────

function SessionPanel({ portfolioId, refreshTick }: { portfolioId: number; refreshTick: number }) {
  const navigate = useNavigate();
  const [loadedSessions, setLoadedSessions] = useState<Session[]>([]);
  const [search, setSearch] = useState("");
  const [tableRefresh, setTableRefresh] = useState(0);
  const [stopError, setStopError] = useState<string | null>(null);
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null);
  const [finishingSessionId, setFinishingSessionId] = useState<string | null>(null);
  const [stopDialogSessionId, setStopDialogSessionId] = useState<string | null>(null);
  const [stopDialogTargets, setStopDialogTargets] = useState<StrategyOrderTargetDeclaration[]>([]);
  const [stopDialogTargetsLoading, setStopDialogTargetsLoading] = useState(false);
  const [stopDialogTargetsUnavailable, setStopDialogTargetsUnavailable] = useState(false);
  const stopTargetRequestRef = useRef(0);
  const [resumeDialogSession, setResumeDialogSession] = useState<Session | null>(null);
  const [resumeRuntimeId, setResumeRuntimeId] = useState("");
  const [resumeMaxLossClosePercent, setResumeMaxLossClosePercent] = useState(String(DEFAULT_MAX_LOSS_CLOSE_PERCENT));
  const [resumeLeverageText, setResumeLeverageText] = useState(String(DEFAULT_SESSION_LEVERAGE));
  const [resuming, setResuming] = useState(false);
  const resumeMaxLossClosePct = parseMaxLossClosePct(resumeMaxLossClosePercent);
  const resumeLeverage = parseSessionLeverage(resumeLeverageText);

  useEffect(() => {
    setTableRefresh((v) => v + 1);
  }, [portfolioId, refreshTick]);

  const shouldPollSessions = loadedSessions.some((session) => !isSessionTerminal(session));

  useEffect(() => {
    if (!shouldPollSessions) return;
    const id = window.setInterval(() => setTableRefresh((v) => v + 1), 3000);
    return () => window.clearInterval(id);
  }, [shouldPollSessions]);

  const loadSessionsForTable = async (offset: number, limit: number) => {
    const page = await listSessionsPage({ portfolio_id: portfolioId, session_id: search || undefined, offset, limit });
    setLoadedSessions((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
    return page;
  };

  async function handleStopListedSession(sessionId: string) {
    setStoppingSessionId(sessionId);
    setStopError(null);
    try {
      const stopped = await stopSession(sessionId, "STOP_ACTION_STOP_ONLY");
      if (!stopped) {
        setStopError("Session is not running or has already been stopped.");
        return;
      }
      stopTargetRequestRef.current += 1;
      setStopDialogSessionId(null);
      setStopDialogTargets([]);
      setStopError(null);
      setTableRefresh((v) => v + 1);
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Failed to stop session");
    } finally {
      setStoppingSessionId(null);
    }
  }

  async function handleStopAndCloseListedSession(sessionId: string) {
    setStoppingSessionId(sessionId);
    setStopError(null);
    try {
      const stopped = await stopSession(sessionId, "STOP_ACTION_STOP_AND_CLOSE_POSITIONS");
      if (!stopped) {
        setStopError("Session stop-and-close was not accepted.");
        return;
      }
      stopTargetRequestRef.current += 1;
      setStopDialogSessionId(null);
      setStopDialogTargets([]);
      setTableRefresh((v) => v + 1);
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Failed to stop and close session");
    } finally {
      setStoppingSessionId(null);
    }
  }

  async function handleFinishListedSession(session: Session) {
    setFinishingSessionId(session.session_id);
    setStopError(null);
    try {
      const finished = await finishSession(session.session_id);
      if (!finished) {
        setStopError("Session is not running or could not be finished.");
        return;
      }
      setStopDialogSessionId(null);
      setTableRefresh((v) => v + 1);
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Failed to finish session");
    } finally {
      setFinishingSessionId(null);
    }
  }

  async function handleResumeWithNewSession(session: Session) {
    setStopError(null);
    if (!resumeRuntimeId) {
      setStopError("Select a runtime before resuming.");
      return;
    }
    if (resumeMaxLossClosePct === null) {
      setStopError("Enter a max loss close value from 0.01 to 100.");
      return;
    }
    if (resumeLeverage === null) {
      setStopError("Enter a positive whole-number leverage value.");
      return;
    }
    setResuming(true);
    try {
      const resumed = await resumeWithNewSession(portfolioId, session, resumeRuntimeId, resumeMaxLossClosePct, resumeLeverage);
      setTableRefresh((v) => v + 1);
      setResumeDialogSession(null);
      setResumeRuntimeId("");
      setResumeMaxLossClosePercent(String(DEFAULT_MAX_LOSS_CLOSE_PERCENT));
      setResumeLeverageText(String(DEFAULT_SESSION_LEVERAGE));
      navigate(`/portfolios/${portfolioId}/sessions/${resumed.session_id}`);
    } catch (err) {
      setStopError(formatAPIError(err, "Failed to resume session"));
    } finally {
      setResuming(false);
    }
  }

  function openResumeDialog(session: Session) {
    setStopError(null);
    setResumeRuntimeId("");
    setResumeMaxLossClosePercent(String(DEFAULT_MAX_LOSS_CLOSE_PERCENT));
    setResumeLeverageText(String(DEFAULT_SESSION_LEVERAGE));
    setResumeDialogSession(session);
  }

  async function openStopDialogForSession(session: Session) {
    const requestID = stopTargetRequestRef.current + 1;
    stopTargetRequestRef.current = requestID;
    setStopError(null);
    setStopDialogTargets([]);
    setStopDialogTargetsLoading(false);
    setStopDialogTargetsUnavailable(false);
    setStopDialogSessionId(session.session_id);
    if (!session.strategy_id) {
      setStopDialogTargetsUnavailable(true);
      return;
    }
    setStopDialogTargetsLoading(true);
    try {
      const strategy = await getStrategy(session.strategy_id);
      if (stopTargetRequestRef.current !== requestID) return;
      setStopDialogTargets(extractStrategyOrderTargets(strategy.code));
    } catch (err) {
      if (stopTargetRequestRef.current !== requestID) return;
      setStopDialogTargetsUnavailable(true);
      setStopError(err instanceof Error ? err.message : "Failed to load declared order targets");
    } finally {
      if (stopTargetRequestRef.current === requestID) setStopDialogTargetsLoading(false);
    }
  }

  return (
    <>
    <h2 className="section-title">Sessions</h2>
    <div className="card" style={{ marginBottom: "1rem" }}>
      <FilterPanel>
        <FilterField label="Session ID" wide>
          <input
            type="text"
            placeholder="Search session ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </FilterField>
      </FilterPanel>

      {stopError ? <p className="error" style={{ marginBottom: "0.75rem" }}>{stopError}</p> : null}

      <InfiniteTable<Session>
        columns={["Session", "Runtime", "Status", "Bars", "Action"]}
        loadPage={loadSessionsForTable}
        refreshKey={`${portfolioId}-${search}-${tableRefresh}`}
        emptyText="No sessions found."
        rowKey={(s) => s.session_id}
        renderRow={(s) => (
          <>
            <td>
              <Link to={`/portfolios/${portfolioId}/sessions/${s.session_id}`}>{s.session_id.slice(0, 10)}…</Link>
              <span className="muted" style={{ marginLeft: "0.5rem" }}>{s.interval}</span>
              {sessionKindBadge(s)}
            </td>
            <td>
              {s.runtime_id ? (
                <Link to={`/runtimes/${encodeURIComponent(s.runtime_id)}`}>{s.runtime_name || s.runtime_id}</Link>
              ) : "unbound"}
            </td>
            <td><span className={badgeClass(s.status)}>{s.status}</span></td>
            <td>{s.bars_processed || 0}</td>
            <td>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <button type="button" onClick={() => navigate(`/portfolios/${portfolioId}/sessions/${s.session_id}`)}>Open</button>
                {s.status === "running" ? (
                  <>
                    <button type="button" onClick={() => void handleFinishListedSession(s)} disabled={finishingSessionId === s.session_id || stoppingSessionId === s.session_id}>
                      {finishingSessionId === s.session_id ? "Finishing…" : "Finish"}
                    </button>
                    <button type="button" onClick={() => { void openStopDialogForSession(s); }} disabled={stoppingSessionId === s.session_id || finishingSessionId === s.session_id}>
                      {stoppingSessionId === s.session_id ? "Stopping…" : "Stop"}
                    </button>
                  </>
                ) : null}
                {s.status === "stopping" ? <button type="button" disabled>Stopping…</button> : null}
                {canResumeSession(s, loadedSessions) ? (
                  <button type="button" onClick={() => openResumeDialog(s)}>Resume With New Session</button>
                ) : null}
              </div>
            </td>
          </>
        )}
      />
    </div>
    <StopSessionDialog
      open={stopDialogSessionId !== null}
      sessionId={stopDialogSessionId ?? undefined}
      busy={stoppingSessionId === stopDialogSessionId}
      error={stopError}
      declaredTargets={stopDialogTargets}
      stopAndCloseDisabled={stopDialogTargetsLoading || stopDialogTargetsUnavailable}
      stopAndCloseDisabledReason={stopDialogTargetsLoading
        ? "Loading declared order targets before stop-and-close can be selected."
        : stopDialogTargetsUnavailable
          ? "Stop-and-close is unavailable because the strategy declarations could not be verified. Stop-only remains available."
          : null}
      onCancel={() => {
        if (stoppingSessionId === stopDialogSessionId) return;
        stopTargetRequestRef.current += 1;
        setStopDialogSessionId(null);
        setStopDialogTargets([]);
        setStopDialogTargetsLoading(false);
        setStopDialogTargetsUnavailable(false);
        setStopError(null);
      }}
      onStopOnly={() => {
        if (!stopDialogSessionId) return;
        void handleStopListedSession(stopDialogSessionId);
      }}
      onStopAndClose={() => {
        if (!stopDialogSessionId) return;
        void handleStopAndCloseListedSession(stopDialogSessionId);
      }}
    />
    <RuntimeSelectionDialog
      open={resumeDialogSession !== null}
      title="Resume With New Session"
      description={resumeDialogSession ? <>Session <code>{resumeDialogSession.session_id}</code></> : null}
      runtimeId={resumeRuntimeId}
      runtimeLabel={resumeDialogSession?.environment === 0 ? "Backtest runtime" : "Executor runtime"}
      environment={resumeDialogSession?.environment}
      role={runtimeRoleForSessionEnvironment(resumeDialogSession?.environment)}
      busy={resuming}
      error={stopError}
      confirmLabel="Resume"
      confirmDisabled={resumeMaxLossClosePct === null || resumeLeverage === null}
      onRuntimeChange={setResumeRuntimeId}
      onCancel={() => {
        if (resuming) return;
        setResumeDialogSession(null);
        setResumeRuntimeId("");
        setResumeMaxLossClosePercent(String(DEFAULT_MAX_LOSS_CLOSE_PERCENT));
        setResumeLeverageText(String(DEFAULT_SESSION_LEVERAGE));
        setStopError(null);
      }}
      onConfirm={() => {
        if (resumeDialogSession) void handleResumeWithNewSession(resumeDialogSession);
      }}
    >
      <div style={{ marginTop: "0.85rem", display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
        <label style={{ display: "grid", gap: "0.35rem", fontSize: "0.88rem", fontWeight: 600 }}>
          <span>Max loss close (%)</span>
          <input
            type="number"
            min="0.01"
            max="100"
            step="any"
            value={resumeMaxLossClosePercent}
            onChange={(event) => setResumeMaxLossClosePercent(event.target.value)}
            disabled={resuming}
            style={{ maxWidth: "10rem" }}
          />
          {resumeMaxLossClosePct === null ? (
            <span className="error" style={{ fontSize: "0.82rem" }}>
              Enter a value from 0.01 to 100.
            </span>
          ) : null}
        </label>
        <label style={{ display: "grid", gap: "0.35rem", fontSize: "0.88rem", fontWeight: 600 }}>
          <span>Leverage (x)</span>
          <input
            type="number"
            min="1"
            step="1"
            value={resumeLeverageText}
            onChange={(event) => setResumeLeverageText(event.target.value)}
            disabled={resuming}
            style={{ maxWidth: "10rem" }}
          />
          {resumeLeverage === null ? (
            <span className="error" style={{ fontSize: "0.82rem" }}>
              Enter a positive whole number.
            </span>
          ) : null}
        </label>
      </div>
    </RuntimeSelectionDialog>
    </>
  );
}
