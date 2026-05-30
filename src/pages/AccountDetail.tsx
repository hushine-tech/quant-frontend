import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { formatUTCWithLocal } from "@/utils/time";
import {
  getAccount,
  getAccountPortfolioSnapshot,
  getAccountWallet,
  runStrategy,
  bindVenue,
  getStrategyStatus,
  getDownloadAndRunJob,
  listVenues,
  listStrategiesPage,
  listAccountStrategies,
  listAccountVenues,
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
  queryMarketDataKlines,
  runtimeRoleForSessionMode,
  isSessionTerminal,
  type Account,
  type WalletSnapshot,
  type AccountVenueWallets,
  type Strategy,
  type AccountStrategy,
  type Venue,
  type Session,
  type BacktestCoveragePreview,
  type DownloadRunJob,
  type MarketDataKlines,
  type StreamKey,
  type PreviewRunStrategy,
  type Runtime,
} from "@/api/client";
import StopSessionDialog from "@/components/StopSessionDialog";
import RuntimeSelectionDialog from "@/components/RuntimeSelectionDialog";
import RuntimeSelector from "@/components/RuntimeSelector";
import { FilterField, FilterPanel } from "@/components/FilterControls";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import InfiniteTable from "@/components/InfiniteTable";
import AsyncSelect, { type AsyncSelectOption } from "@/components/AsyncSelect";
import SymbolPicker from "@/components/SymbolPicker";
import DateTimeRangePicker from "@/components/DateTimeRangePicker";
import { accountEnvironmentLabel } from "@/utils/accountMode";

function envBannerClass(environment: number): string {
  switch (environment) {
    case 0:
      return "env-banner env-banner--backtest";
    case 1:
      return "env-banner env-banner--testnet";
    case 2:
      return "env-banner env-banner--live";
    default:
      return "env-banner env-banner--other";
  }
}

function accountEnvironmentFromLegacyMode(mode: number): number {
  if (mode === 2) return 1;
  if (mode === 1) return 2;
  return 0;
}

type AccountDetailTab = "portfolio" | "run" | "debug" | "sessions" | "venues";

const accountDetailTabs: Array<PageTab<AccountDetailTab>> = [
  { id: "portfolio", label: "Portfolio" },
  { id: "run", label: "Run Strategy" },
  { id: "debug", label: "Local Debug" },
  { id: "sessions", label: "Sessions" },
  { id: "venues", label: "Venues" },
];

function normalizeAccountDetailTab(value: string | null): AccountDetailTab {
  return value === "run" || value === "debug" || value === "sessions" || value === "venues" ? value : "portfolio";
}

const LOCAL_DEBUG_INTERVALS = ["1m", "3m", "5m", "15m", "1h", "4h", "1d"];

function localDebugInitialBalance(wallet: WalletSnapshot | null): number {
  const balance = wallet?.futures?.wallet_balance ?? wallet?.wallet_balance ?? 1000;
  return Number.isFinite(balance) && balance > 0 ? balance : 1000;
}

function formatLocalDebugBalance(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function localDebugDefaultSymbol(wallet: WalletSnapshot | null): string {
  const positionSymbol = wallet?.futures?.positions?.find((p) => p.symbol?.trim())?.symbol;
  return (positionSymbol || "BTCUSDT").trim().toUpperCase();
}

function sessionStartedAtMs(session: Session): number {
  return Date.parse(session.started_at || session.completed_at || "") || 0;
}

function canResumeSession(session: Session, allSessions: Session[]): boolean {
  if (session.status !== "stopped" && session.status !== "recoverable") return false;
  const baseStartedAt = sessionStartedAtMs(session)
  return !allSessions.some((other) => (
    other.session_id !== session.session_id
    && other.account_id === session.account_id
    && other.strategy_id === session.strategy_id
    && other.mode === session.mode
    && other.interval === session.interval
    && (other.start_time_ms ?? 0) === (session.start_time_ms ?? 0)
    && (other.end_time_ms ?? 0) === (session.end_time_ms ?? 0)
    && sessionStartedAtMs(other) > baseStartedAt
  ));
}

async function resumeWithNewSession(accountId: number, session: Session, runtimeId: string): Promise<{ session_id: string }> {
  const entries = await listAccountStrategies(accountId);
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
      await mountStrategy(accountId, targetStrategyId);
      mountedForResume = true;
    }
    if (changedActive || !targetEntry?.active) {
      await activateStrategy(accountId, targetStrategyId);
    }
    return await runStrategy(accountId, {
      strategy_path: "",
      interval: session.interval || "1m",
      start_time_ms: session.start_time_ms,
      end_time_ms: session.end_time_ms,
      runtime_id: runtimeId,
    });
  } catch (err) {
    if (changedActive) {
      try {
        if (currentActiveId !== null) {
          await activateStrategy(accountId, currentActiveId);
        } else {
          await deactivateStrategy(accountId, targetStrategyId);
        }
        if (mountedForResume) {
          await unmountStrategy(accountId, targetStrategyId);
        }
      } catch {
        // Best-effort rollback only; preserve the original error.
      }
    } else if (mountedForResume) {
      try {
        await unmountStrategy(accountId, targetStrategyId);
      } catch {
        // Best-effort rollback only; preserve the original error.
      }
    }
    throw err;
  }
}

export default function AccountDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [acc, setAcc] = useState<Account | null>(null);
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [venueWallets, setVenueWallets] = useState<AccountVenueWallets | null>(null);
  const [sessionRefreshTick, setSessionRefreshTick] = useState(0);
  const [venueMutationTick, setVenueMutationTick] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [wErr, setWErr] = useState<string | null>(null);
  const [venueWalletErr, setVenueWalletErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wLoading, setWLoading] = useState(false);
  const [venueWalletLoading, setVenueWalletLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<AccountDetailTab>(() => normalizeAccountDetailTab(searchParams.get("tab")));

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const a = await getAccount(id);
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
    if (!id || !acc) return;
    let cancelled = false;
    (async () => {
      setWErr(null);
      setVenueWalletErr(null);
      setWallet(null);
      setVenueWallets(null);
      const accountEnvironment = acc.environment ?? accountEnvironmentFromLegacyMode(acc.mode);
      if (accountEnvironment === 0) {
        setWLoading(true);
        setVenueWalletLoading(false);
        try {
          const w = await getAccountWallet(id);
          if (!cancelled) setWallet(w);
        } catch (e) {
          if (!cancelled) setWErr(e instanceof Error ? e.message : "Wallet load failed");
        } finally {
          if (!cancelled) setWLoading(false);
        }
        return;
      }
      setVenueWalletLoading(true);
      setWLoading(false);
      try {
        const summary = await getAccountPortfolioSnapshot(id);
        if (!cancelled) setVenueWallets(summary);
      } catch (e) {
        if (!cancelled) setVenueWalletErr(e instanceof Error ? e.message : "Venue wallet load failed");
      } finally {
        if (!cancelled) setVenueWalletLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, acc, venueMutationTick]);

  const mode = acc?.mode ?? wallet?.mode ?? 0;
  const environment = acc?.environment ?? accountEnvironmentFromLegacyMode(mode);
  function bumpSessionRefreshTick() {
    setSessionRefreshTick((v) => v + 1);
  }

  function bumpVenueMutationTick() {
    setVenueMutationTick((v) => v + 1);
  }

  function changeAccountTab(tab: AccountDetailTab) {
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
        <Link to="/accounts">← Back to list</Link>
      </p>
      {loading ? <p className="muted">Loading…</p> : null}
      {err ? <p className="error">{err}</p> : null}
      {!loading && acc ? (
        <>
        <div className={envBannerClass(environment)} role="status">
          {accountEnvironmentLabel(environment)}
        </div>
        <div className="card" style={{ marginBottom: "1rem" }}>
          <p><strong style={{ fontSize: "1.1rem" }}>{acc.name}</strong></p>
          {acc.description?.trim() ? <p className="muted">{acc.description.trim()}</p> : null}
          <p className="muted">
            ID: {acc.account_id} · Environment: {accountEnvironmentLabel(environment)} · Created: {formatUTCWithLocal(acc.created_at)}
          </p>
        </div>
        <PageTabs
          tabs={accountDetailTabs}
          activeTab={activeTab}
          onChange={changeAccountTab}
          ariaLabel="Account detail sections"
        >
          {activeTab === "portfolio" ? (
            environment !== 0 ? (
              <>
                {venueWalletLoading ? <p className="muted">Loading venue wallets...</p> : null}
                {venueWalletErr ? <p className="error">{venueWalletErr}</p> : null}
                {!venueWalletLoading && venueWallets ? (
                  <AccountVenuePortfolio account={acc} summary={venueWallets} />
                ) : null}
              </>
            ) : (
            <>
            {wLoading ? <p className="muted">Loading wallet…</p> : null}
            {wErr ? <p className="error">{wErr}</p> : null}
            {!wLoading && wallet ? (
              <>
                {/*
                  canonical-wallet-display-boundary: left panel shows the
                  canonical runtime balances (authoritative trading values);
                  right panel shows provider-aligned USD display values —
                  those match the exchange's wallet page but are NOT the
                  numbers the strategy/risk engine uses. The card header
                  wording makes that distinction explicit.
                */}
                {(() => {
                  // Prefer the namespaced `display.*` surface, fall back to
                  // the deprecated flat fields for pre-cutover backends.
                  const display = wallet.display ?? {
                    total_value: wallet.total_value,
                    spot_estimated_value: wallet.spot_estimated_value,
                    futures_position_equity: wallet.futures_position_equity,
                    metrics_authoritative: wallet.metrics_authoritative,
                    futures_display_usd: wallet.futures_display_usd ?? null,
                  };
                  return (
                <div className="card">
                  <div className="portfolio-grid">
                    <div className="portfolio-panel">
                      <div className="portfolio-panel__title">
                        Canonical runtime (USDT)
                      </div>
                      <p className="muted" style={{ fontSize: "0.75rem", marginTop: "-0.25rem", marginBottom: "0.75rem" }}>
                        Authoritative balances used by strategy execution, risk checks and reconciliation.
                      </p>
                      <div>
                        <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                          Total Value (USDT)
                        </div>
                        <div style={{ fontSize: "1.5rem", fontWeight: 700, lineHeight: 1.2 }}>
                          {display.total_value.toFixed(4)}
                        </div>
                      </div>
                      <div className="portfolio-metric">
                        <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                          Spot (est.)
                        </div>
                        <div style={{ fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.2 }}>
                          {display.spot_estimated_value.toFixed(4)}
                        </div>
                      </div>
                      <div className="portfolio-metric">
                        <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                          Futures Margin Balance (USDT)
                        </div>
                        <div style={{ fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.2 }}>
                          {wallet.margin_balance.toFixed(4)}
                        </div>
                      </div>
                      <div className="portfolio-metric">
                        <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                          Unrealized PnL (USDT)
                        </div>
                        <div style={{ fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.2 }}>
                          {wallet.futures?.total_unrealized_pnl.toFixed(4) ?? "0.0000"}
                        </div>
                      </div>
                      <div className="portfolio-metric">
                        <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                          Wallet Balance (USDT)
                        </div>
                        <div style={{ fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.2 }}>
                          {wallet.futures?.wallet_balance.toFixed(4) ?? wallet.wallet_balance.toFixed(4)}
                        </div>
                      </div>
                    </div>

                    {display.futures_display_usd ? (
                      <div className="portfolio-panel portfolio-panel--secondary">
                        <div className="portfolio-panel__title">
                          Exchange-aligned display (USD)
                        </div>
                        <p className="muted" style={{ fontSize: "0.75rem", marginTop: "-0.25rem", marginBottom: "0.75rem" }}>
                          Matches the exchange wallet page. Display-only — not used for risk or order sizing.
                        </p>
                        <div>
                          <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                            Futures Margin Balance (USD)
                          </div>
                          <div style={{ fontSize: "1.2rem", fontWeight: 700, lineHeight: 1.2 }}>
                            {display.futures_display_usd.margin_balance.toFixed(4)}
                          </div>
                        </div>
                        <div className="portfolio-metric">
                          <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                            Unrealized PnL (USD)
                          </div>
                          <div style={{ fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.2 }}>
                            {display.futures_display_usd.unrealized_pnl.toFixed(4)}
                          </div>
                        </div>
                        <div className="portfolio-metric">
                          <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                            Wallet Balance (USD)
                          </div>
                          <div style={{ fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.2 }}>
                            {display.futures_display_usd.wallet_balance.toFixed(4)}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {display.metrics_authoritative === false ? (
                    <p className="error" role="status">
                      Display estimates may not reconcile to canonical total value; expand sections for raw balances.
                    </p>
                  ) : null}
                  <p className="muted">Updated: {formatUTCWithLocal(wallet.updated_at)}</p>
                </div>
                  );
                })()}

                <details className="wallet-details">
                  <summary>
                    Spot details<span className="muted"> — click to expand</span>
                  </summary>
                  <div className="wallet-details__body">
                    {wallet.spot ? (
                      <>
                        <ul className="wallet-stats">
                          <li className="wallet-stats__item">
                            <span className="wallet-stats__label">Free (USDT)</span>
                            <span className="wallet-stats__value">
                              {wallet.spot.free.toFixed(2)}
                            </span>
                          </li>
                          <li className="wallet-stats__item">
                            <span className="wallet-stats__label">Locked (USDT)</span>
                            <span className="wallet-stats__value">
                              {wallet.spot.locked.toFixed(2)}
                            </span>
                          </li>
                        </ul>
                        {(wallet.spot.assets ?? []).length === 0 ? (
                          <p className="muted">No spot assets.</p>
                        ) : (
                          <table className="compact">
                            <thead>
                              <tr>
                                <th>Symbol</th><th>Qty</th><th>Locked</th><th>Avg entry</th><th>Mark</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(wallet.spot.assets ?? []).map((a) => (
                                <tr key={a.symbol}>
                                  <td>{a.symbol}</td>
                                  <td>{a.qty}</td>
                                  <td>{a.locked}</td>
                                  <td>{a.avg_entry_price}</td>
                                  <td>{a.price ?? "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </>
                    ) : <p className="muted">No spot wallet on snapshot.</p>}
                  </div>
                </details>

                <details className="wallet-details">
                  <summary>
                    Futures details<span className="muted"> — click to expand</span>
                  </summary>
                  <div className="wallet-details__body">
                    {wallet.futures ? (
                      <>
                        <ul className="wallet-stats">
                          {wallet.futures.margin_mode ? (
                            <li className="wallet-stats__item">
                              <span className="wallet-stats__label">Margin mode</span>
                              <span className="wallet-stats__value wallet-stats__value--muted">
                                {wallet.futures.margin_mode}
                              </span>
                            </li>
                          ) : null}
                          {wallet.futures.position_mode ? (
                            <li className="wallet-stats__item">
                              <span className="wallet-stats__label">Position mode</span>
                              <span className="wallet-stats__value wallet-stats__value--muted">
                                {wallet.futures.position_mode.replace(/_/g, " ")}
                              </span>
                            </li>
                          ) : null}
                          <li className="wallet-stats__item">
                            <span className="wallet-stats__label">Wallet balance</span>
                            <span className="wallet-stats__value">
                              {wallet.futures.wallet_balance.toFixed(2)}
                            </span>
                          </li>
                          <li className="wallet-stats__item">
                            <span className="wallet-stats__label">Margin balance</span>
                            <span className="wallet-stats__value">
                              {wallet.futures.margin_balance.toFixed(2)}
                            </span>
                          </li>
                          <li className="wallet-stats__item">
                            <span className="wallet-stats__label">Available</span>
                            <span className="wallet-stats__value">
                              {wallet.futures.available_balance.toFixed(2)}
                            </span>
                          </li>
                          <li className="wallet-stats__item">
                            <span className="wallet-stats__label">Unrealized PnL</span>
                            <span className="wallet-stats__value">
                              {wallet.futures.total_unrealized_pnl.toFixed(2)}
                            </span>
                          </li>
                        </ul>
                        {(wallet.futures.positions ?? []).length === 0 ? (
                          <p className="muted">No open positions.</p>
                        ) : (
                          <table className="compact">
                            <thead>
                              <tr>
                                <th>Symbol</th><th>Qty</th><th>Lev.</th><th>Entry</th><th>Mark</th>
                                <th>uPnL</th><th>Side</th><th>Row est.</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(wallet.futures.positions ?? []).map((p, idx) => (
                                <tr key={`${idx}-${p.symbol}-${p.position_side || "both"}`}>
                                  <td>{p.symbol}</td>
                                  <td>{p.qty}</td>
                                  <td>{p.leverage ? `${p.leverage}x` : "—"}</td>
                                  <td>{p.entry_price.toFixed(2)}</td>
                                  <td>{p.mark_price.toFixed(2)}</td>
                                  <td>{p.unrealized_pnl.toFixed(2)}</td>
                                  <td>{p.position_side || "—"}</td>
                                  <td>{p.display_equity != null ? p.display_equity.toFixed(2) : "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </>
                    ) : <p className="muted">No futures wallet on snapshot.</p>}
                  </div>
                </details>
              </>
            ) : null}
            </>
            )
          ) : null}

          {activeTab === "run" ? (
            <StrategyPanel accountId={acc.account_id} mode={mode} onSessionsChanged={bumpSessionRefreshTick} />
          ) : null}

          {activeTab === "debug" ? (
            <LocalDebugPackagePanel account={acc} wallet={wallet} />
          ) : null}

          {activeTab === "sessions" ? (
            <SessionPanel accountId={acc.account_id} refreshTick={sessionRefreshTick} />
          ) : null}

          {activeTab === "venues" ? (
            <AccountVenuesPanel account={acc} environment={environment} onChanged={bumpVenueMutationTick} />
          ) : null}
        </PageTabs>
        </>
      ) : null}
    </div>
  );
}

function walletDisplayTotal(wallet: WalletSnapshot): number {
  return wallet.display?.total_value ?? wallet.total_value ?? 0;
}

function formatUSDT(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(4)} USDT` : "-";
}

function AccountVenuePortfolio({ account, summary }: { account: Account; summary: AccountVenueWallets }) {
  const hasVenues = summary.items.length > 0;
  return (
    <>
      <div className="card">
        <div className="portfolio-grid">
          <div className="portfolio-panel">
            <div className="portfolio-panel__title">Account aggregate</div>
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
              This account can route strategies only through bound venues with matching environment and market.
            </p>
            <div>
              <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.15rem" }}>
                Account
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.2 }}>
                {account.name} <span className="muted">#{account.account_id}</span>
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
            No active venues are bound to this account. Open the Venues tab to bind one.
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

function venueAPIKeyLabel(value?: string): string {
  if (!value) return "-";
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function AccountVenuesPanel({
  account,
  environment,
  onChanged,
}: {
  account: Account;
  environment: number;
  onChanged: () => void;
}) {
  const accountId = account.account_id;
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedVenueID, setSelectedVenueID] = useState("");
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [binding, setBinding] = useState(false);

  async function loadAccountVenues(offset: number, limit: number) {
    setLoading(true);
    setError(null);
    try {
      return await listAccountVenues(accountId, {
        include_inactive: true,
        offset,
        limit,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load account venues failed");
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
      if (selectedVenue.account_id === accountId) {
        setNotice("Venue is already bound to this account.");
        return;
      }
      await bindVenue(selectedVenue.venue_id, accountId, `bound from account ${accountId}`);
      setNotice(selectedVenue.account_id ? "Venue rebound to this account." : "Venue bound to this account.");
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
      await releaseVenue(venue.venue_id, `released from account ${accountId}`);
      setNotice("Venue released from this account.");
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
          <p className="muted" style={{ margin: 0 }}>Exchange venues bound to this account.</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" onClick={() => setRefreshKey((v) => v + 1)} disabled={loading}>Refresh</button>
          <Link to={`/venues?account_id=${accountId}&tab=create`}>Create venue</Link>
        </div>
      </div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <form onSubmit={handleBindVenue}>
          <h3 className="section-title" style={{ marginBottom: "0.5rem" }}>Bind venue</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Select an active {accountEnvironmentLabel(environment)} venue. If it is bound to another account, it will be handed off to this account.
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
              const page = await listVenues({ offset, limit, include_unbound: true });
              const normalizedQuery = query.trim().toLowerCase();
              const items = page.items
                .filter((venue) => venue.environment === environment)
                .filter((venue) => !normalizedQuery
                  || (venue.display_name || "").toLowerCase().includes(normalizedQuery)
                  || String(venue.venue_id).includes(normalizedQuery)
                  || (venue.api_key || "").toLowerCase().includes(normalizedQuery))
                .map<AsyncSelectOption<Venue>>((venue) => ({
                  value: String(venue.venue_id),
                  label: venue.display_name || `venue-${venue.venue_id}`,
                  detail: `${venue.exchange_label || venue.exchange} · ${venue.market_label || venue.market} · ${venue.account_id ? `account ${venue.account_id}` : "unbound"}`,
                  item: venue,
                }));
              return { ...page, items };
            }}
            searchPlaceholder="Search venue name, ID, or API key"
            allowClear
          />
          <p style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button type="submit" className="primary" disabled={binding || !selectedVenueID}>
              {binding ? "Binding..." : selectedVenue?.account_id && selectedVenue.account_id !== accountId ? "Rebind to this account" : "Bind to this account"}
            </button>
          </p>
        </form>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}
      <InfiniteTable<Venue>
        columns={["Name", "Exchange", "Market", "Environment", "Status", "API Key", "Updated", "Action"]}
        loadPage={loadAccountVenues}
        refreshKey={`${accountId}-${refreshKey}`}
        emptyText="No venues bound to this account."
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

type SessionRecord = {
  sessionId: string;
  statusLabel: string;
  barsProcessed: number;
  error: string;
};

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

// Live-start readiness hint for mode=2 accounts.
//
// Asks strategy-service's PreviewRunStrategy — the same evaluator the real
// start uses — so the hint is byte-for-byte consistent with what the user
// will see when they click "Start Demo Session". This replaced an earlier
// heuristic that looked at every market-data request on the user's account
// (including streams unrelated to the current strategy), which could show
// green on the wrong symbol/interval/account.
function LiveStartReadinessHint({ accountId, runtimeId }: { accountId: number; runtimeId: string }) {
  const [preview, setPreview] = useState<PreviewRunStrategy | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!runtimeId) {
        setPreview(null);
        setErr(null);
        return;
      }
      try {
        // No start/end — live/demo profile ignores them. Backend picks the
        // declared strategy source from the active-strategy record.
        const p = await previewRunStrategy(accountId, { runtime_id: runtimeId });
        if (!cancelled) {
          setPreview(p);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) {
          setPreview(null);
          setErr(e instanceof Error ? e.message : "Preflight failed");
        }
      }
    }
    load();
    const id = window.setInterval(load, 15_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [accountId, runtimeId]);

  if (err) {
    return (
      <div className="card" style={{ marginBottom: "0.75rem", borderLeft: "4px solid #eab308" }}>
        <p style={{ margin: 0, fontSize: "0.9rem" }}>
          <strong>Live start blocked:</strong>{" "}
          <span className="muted">{err}</span>
        </p>
      </div>
    );
  }
  if (!preview) return null;

  // Unsupported profile (e.g. mode=1 live not yet wired) — surface the same
  // profile-level failure backend would report on click.
  if (!preview.supported) {
    return (
      <div className="card" style={{ marginBottom: "0.75rem", borderLeft: "4px solid #ef4444" }}>
        <p style={{ margin: 0, fontSize: "0.9rem" }}>
          <strong>Runtime profile unsupported:</strong>{" "}
          profile <code>{preview.profile || "unknown"}</code> is not wired up for this account mode.
          {preview.failures.length > 0 ? ` ${preview.failures[0].reason}` : ""}
        </p>
      </div>
    );
  }

  if (preview.ok) {
    return (
      <div className="card" style={{ marginBottom: "0.75rem", borderLeft: "4px solid #16a34a" }}>
        <p style={{ margin: 0, fontSize: "0.9rem" }}>
          <strong>Streams ready:</strong>{" "}
          {preview.required_streams.length} declared input(s) resolved and running.{" "}
          <Link to="/market-data">Details</Link>
        </p>
      </div>
    );
  }

  // Not-ok — enumerate failures per declared input.
  return (
    <div className="card" style={{ marginBottom: "0.75rem", borderLeft: "4px solid #eab308" }}>
      <p style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>
        <strong>Live start may be blocked:</strong>{" "}
        {preview.failures.length} declared input(s) not ready.
      </p>
      <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.85rem" }}>
        {preview.failures.map((f, i) => (
          <li key={`${f.kind}-${i}`} className="muted">
            {f.input_key ? (
              <>
                <code>{f.input_key.symbol} {f.input_key.market} {f.input_key.interval}</code>
                {" — "}
              </>
            ) : null}
            <span style={{ opacity: 0.75 }}>[{f.kind}]</span>{" "}
            {f.reason}
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
    const id = `${key.exchange}-${key.market}-${key.symbol}-${key.interval}`;
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
                  const id = `${input.key.exchange}-${input.key.market}-${input.key.symbol}-${input.key.interval}`;
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
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          download job: {job.status} · {Math.round((job.progress || 0) * 100)}%
          {job.error ? ` · ${job.error}` : ""}
        </p>
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
  return slug || "account";
}

function LocalDebugPackagePanel({
  account,
  wallet,
}: {
  account: Account;
  wallet: WalletSnapshot | null;
}) {
  const defaultSymbol = localDebugDefaultSymbol(wallet);
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [symbolTouched, setSymbolTouched] = useState(false);
  const [interval, setInterval] = useState("1m");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const initialBalance = localDebugInitialBalance(wallet);
  const initialBalanceDisplay = `${formatLocalDebugBalance(initialBalance)} USDT`;

  useEffect(() => {
    if (!symbolTouched) {
      setSymbol(defaultSymbol);
    }
  }, [defaultSymbol, symbolTouched]);

  async function handleGenerateDebugPackage() {
    const startTimeMs = parseDateTimeLocalMs(startTime);
    const endTimeMs = parseDateTimeLocalMs(endTime);
    if (!startTimeMs || !endTimeMs || startTimeMs >= endTimeMs) {
      setError("Select a valid start and end time.");
      return;
    }
    if (!symbol.trim()) {
      setError("Symbol is required.");
      return;
    }
    if (!Number.isFinite(initialBalance) || initialBalance <= 0) {
      setError("Initial balance must be greater than zero.");
      return;
    }

    setDownloading(true);
    setError(null);
    setNotice(null);
    try {
      const blob = await downloadDebugPackage(account.account_id, {
        market: "futures",
        symbol: symbol.trim().toUpperCase(),
        interval: interval.trim() || "1m",
        start_time_ms: startTimeMs,
        end_time_ms: endTimeMs,
        wallet_source: "account_snapshot",
        initial_balance: initialBalance,
      });
      const filename = `debug-package-${downloadSafeName(account.name)}-${symbol.trim().toUpperCase()}-${interval.trim() || "1m"}.zip`;
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
          historical futures bars, a wallet snapshot, and a strategy template; it does not require a
          platform-connected debugger runtime.
        </p>
        <FilterPanel>
          <SymbolPicker
            market="usdm_futures"
            label="Symbol"
            onAdd={(value) => {
              setSymbol(value);
              setSymbolTouched(true);
            }}
            selected={symbol}
            className="filter-field"
          />
          <FilterField label="Interval">
            <select value={interval} onChange={(e) => setInterval(e.target.value)}>
              {LOCAL_DEBUG_INTERVALS.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Initial balance">
            <input
              type="text"
              value={initialBalanceDisplay}
              disabled
              title="Loaded from the current account wallet snapshot"
            />
          </FilterField>
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
              disabled={downloading || !startTime || !endTime || !symbol.trim()}
            >
              {downloading ? "Generating..." : "Generate Debug Package"}
            </button>
          </div>
        </FilterPanel>

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
  accountId,
  mode,
  onSessionsChanged,
}: {
  accountId: number;
  mode: number;
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
  const downloadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [startRuntimeId, setStartRuntimeId] = useState("");
  const [startRuntime, setStartRuntime] = useState<Runtime | null>(null);
  const [pendingStart, setPendingStart] = useState<{
    kind: "backtest" | "testnet";
    interval: string;
    startTimeMs?: number;
    endTimeMs?: number;
  } | null>(null);
  const [coveragePreview, setCoveragePreview] = useState<BacktestCoveragePreview | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [downloadJob, setDownloadJob] = useState<DownloadRunJob | null>(null);

  // Account strategies (mounting panel)
  const [accountStrats, setAccountStrats] = useState<AccountStrategy[]>([]);
  const [mountErr, setMountErr] = useState<string | null>(null);
  const [selectedMountId, setSelectedMountId] = useState<number | "">("");

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (downloadPollRef.current) clearInterval(downloadPollRef.current);
    };
  }, []);

  useEffect(() => {
    loadAccountStrats();
  }, [accountId]);

  useEffect(() => {
    setCoveragePreview(null);
    setCoverageError(null);
    setDownloadJob(null);
    if (!pendingStart || pendingStart.kind !== "backtest" || !startRuntimeId) return;
    void loadBacktestCoverage(pendingStart, startRuntimeId);
  }, [pendingStart, startRuntimeId, startRuntime]);

  async function loadAccountStrats() {
    try {
      const list = await listAccountStrategies(accountId);
      setAccountStrats(list);
    } catch {
      // ignore
    }
  }

  async function handleMount() {
    if (!selectedMountId) return;
    setMountErr(null);
    try {
      await mountStrategy(accountId, selectedMountId);
      await loadAccountStrats();
      setSelectedMountId("");
    } catch (e) {
      setMountErr(e instanceof Error ? e.message : "Mount failed");
    }
  }

  async function handleUnmount(sid: number) {
    setMountErr(null);
    try {
      await unmountStrategy(accountId, sid);
      await loadAccountStrats();
    } catch (e) {
      setMountErr(e instanceof Error ? e.message : "Unmount failed");
    }
  }

  async function handleActivate(sid: number) {
    setMountErr(null);
    try {
      await activateStrategy(accountId, sid);
      await loadAccountStrats();
    } catch (e) {
      setMountErr(e instanceof Error ? e.message : "Activate failed");
    }
  }

  async function handleDeactivate(sid: number) {
    setMountErr(null);
    try {
      await deactivateStrategy(accountId, sid);
      await loadAccountStrats();
    } catch (e) {
      setMountErr(e instanceof Error ? e.message : "Deactivate failed");
    }
  }

  function beginSessionPoll(sessionId: string) {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    onSessionsChanged();
    setActivePollSession({ sessionId, statusLabel: "running", barsProcessed: 0, error: "" });

    pollRef.current = setInterval(async () => {
      try {
        const st = await getStrategyStatus(sessionId);
        setActivePollSession((prev) =>
          prev ? { ...prev, statusLabel: st.status, barsProcessed: st.bars_processed, error: st.error } : prev
        );
        if (st.status !== "running" && st.status !== "stopping") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setRunning(false);
          setActivePollSession(null);
          onSessionsChanged();
        }
      } catch (pollErr) {
        setActivePollSession((prev) =>
          prev ? { ...prev, statusLabel: "failed", error: pollErr instanceof Error ? pollErr.message : "Poll failed" } : prev
        );
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setRunning(false);
        setActivePollSession(null);
        onSessionsChanged();
      }
    }, 2000);
  }

  async function startStrategyRun(
    params: { interval: string; startTimeMs?: number; endTimeMs?: number },
    runtimeId: string,
  ) {
    if (!runtimeId) {
      setError("Select a runtime before starting the session.");
      return;
    }
    setRunning(true);
    setError(null);

    try {
      const sess = await runStrategy(accountId, {
        strategy_path: "",
        interval: params.interval,
        start_time_ms: params.startTimeMs,
        end_time_ms: params.endTimeMs,
        runtime_id: runtimeId,
      });
      setStartDialogOpen(false);
      setPendingStart(null);
      beginSessionPoll(sess.session_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
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
      const result = await previewBacktestCoverage(accountId, {
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
      return;
    }
    if (job.status === "error") {
      clearDownloadPoll();
      setError(job.error || "Download data and run backtest failed");
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
    if (!startRuntimeId) {
      setError("Select a runtime before starting the session.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const job = await startDownloadAndRunBacktest(accountId, {
        strategy_path: "",
        interval: pendingStart.interval,
        start_time_ms: pendingStart.startTimeMs,
        end_time_ms: pendingStart.endTimeMs,
        runtime_id: startRuntimeId,
      });
      handleDownloadJobUpdate(job);
      if (job.status !== "ready" && job.status !== "error") {
        pollDownloadAndRunJob(job.job_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download data and run backtest failed");
      setRunning(false);
    }
  }

  function openStartDialog(params: { kind: "backtest" | "testnet"; interval: string; startTimeMs?: number; endTimeMs?: number }) {
    setError(null);
    setPendingStart(params);
    setStartDialogOpen(true);
  }

  async function handleConfirmStart() {
    if (!pendingStart) return;
    if (pendingStart.kind === "backtest" && !coveragePreview?.complete) {
      setError("Historical data coverage is incomplete. Download missing data before running this backtest.");
      return;
    }
    if (pendingStart.kind === "backtest" && !activeStrat) {
      setError("Activate a strategy before running a backtest.");
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
    openStartDialog({ kind: "testnet", interval: sessionMetadataInterval });
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

  const activeStrat = accountStrats.find((s) => s.active);
  const mountedIds = new Set(accountStrats.map((s) => s.strategy.strategy_id));

  return (
    <>
      <h2 className="section-title">Strategy</h2>

      {/* ── Mounted strategies ── */}
      <div className="card" style={{ marginBottom: "1rem" }}>
        <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Mounted strategies</p>
        {accountStrats.length === 0 ? (
          <p className="muted">No strategies mounted.</p>
        ) : (
          accountStrats.map((as) => (
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
                  <button style={{ fontSize: "0.8rem" }} onClick={() => handleDeactivate(as.strategy.strategy_id)}>
                    Deactivate
                  </button>
                )}
              </div>
            </div>
          ))
        )}
        {mountErr ? <p className="error" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>{mountErr}</p> : null}

        <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <AsyncSelect<Strategy>
              value={selectedMountId === "" ? "" : String(selectedMountId)}
              placeholder="Mount a strategy"
              onChange={(value) => setSelectedMountId(value === "" ? "" : Number(value))}
              loadPage={async (offset, limit, query) => {
                const page = await listStrategiesPage({ offset, limit, namePrefix: query || undefined, activeOnly: true });
                return {
                  ...page,
                  items: page.items
                    .filter((s) => !mountedIds.has(s.strategy_id))
                    .map<AsyncSelectOption<Strategy>>((s) => ({
                      value: String(s.strategy_id),
                      label: `${s.name} v${s.version}`,
                      detail: `#${s.strategy_id}`,
                      item: s,
                    })),
                };
              }}
            />
            <button onClick={handleMount} disabled={!selectedMountId}>Mount</button>
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
          {stopError ? (
            <p className="error" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>{stopError}</p>
          ) : null}
          <p className="muted" style={{ marginTop: "0.5rem", marginBottom: 0, fontSize: "0.8rem" }}>
            `仅停止 session` 是 soft stop。`先清仓后停止 session` 会尝试把账户风险敞口清到空状态。
          </p>
        </div>
      ) : null}

      {/* ── Run backtest (mode=0 only) ── */}
      {mode === 0 ? (
      <div className="card">
        {!activeStrat ? (
          <p className="muted">Activate a strategy above to run a backtest.</p>
        ) : (
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            Active: <strong>{activeStrat.strategy.name} v{activeStrat.strategy.version}</strong>
          </p>
        )}
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
            mode={0}
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
            <button type="submit" className="primary" disabled={running || !startTime || !endTime || !startRuntimeId || !activeStrat}>
              {running ? "Running…" : "Run backtest"}
            </button>
          </p>
        </form>
      </div>
      ) : null}

      {/* ── Start mode=2 session ── */}
      {mode === 2 ? (
      <div className="card">
        {!activeStrat ? (
          <p className="muted">Activate a strategy above to start a demo session.</p>
        ) : (
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            Active: <strong>{activeStrat.strategy.name} v{activeStrat.strategy.version}</strong>
          </p>
        )}

        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
          This starts a live <code>mode=2</code> demo session using the active strategy's
          declared <code>INPUTS</code> — each <code>(market, symbol, interval)</code> is
          subscribed independently; the UI no longer picks an interval here.
        </p>
        <RuntimeSelector
          value={startRuntimeId}
          onChange={(runtimeId, runtime) => {
            setStartRuntimeId(runtimeId);
            setStartRuntime(runtime ?? null);
          }}
          mode={2}
          role="executor"
          label="Executor runtime"
        />

        {error ? <p className="error" style={{ marginTop: "0.5rem" }}>{error}</p> : null}

        <p style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          <button
            type="button"
            className="primary"
            disabled={running || !activeStrat || !startRuntimeId}
            onClick={() => { void handleLiveStart(); }}
          >
            {running ? "Starting…" : "Start Demo Session"}
          </button>
        </p>
      </div>
      ) : null}

      <StopSessionDialog
        open={stopDialogOpen}
        sessionId={activePollSession?.sessionId}
        busy={stopping}
        error={stopError}
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
        title={pendingStart?.kind === "testnet" ? "Start Demo Session" : "Run Backtest"}
        description={pendingStart?.kind === "testnet"
          ? <>Choose where the active strategy will run.</>
          : <>Choose where the backtest session will run.</>}
        runtimeId={startRuntimeId}
        runtimeLabel={pendingStart?.kind === "testnet" ? "Executor runtime" : "Runtime"}
        mode={pendingStart?.kind === "testnet" ? 2 : 0}
        role={runtimeRoleForSessionMode(pendingStart?.kind === "testnet" ? 2 : 0)}
        busy={running}
        error={error}
        confirmLabel={pendingStart?.kind === "testnet" ? "Start Session" : "Run Backtest"}
        confirmDisabled={pendingStart?.kind === "backtest" && (!coveragePreview?.complete || coverageLoading || Boolean(downloadJob && downloadJob.status !== "error"))}
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
        ) : pendingStart?.kind === "testnet" && startRuntimeId ? (
          <LiveStartReadinessHint accountId={accountId} runtimeId={startRuntimeId} />
        ) : null}
      </RuntimeSelectionDialog>
    </>
  );
}

// ── Session Panel (pagination + search, click → session detail page) ───────

function SessionPanel({ accountId, refreshTick }: { accountId: number; refreshTick: number }) {
  const navigate = useNavigate();
  const [loadedSessions, setLoadedSessions] = useState<Session[]>([]);
  const [search, setSearch] = useState("");
  const [tableRefresh, setTableRefresh] = useState(0);
  const [stopError, setStopError] = useState<string | null>(null);
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null);
  const [finishingSessionId, setFinishingSessionId] = useState<string | null>(null);
  const [stopDialogSessionId, setStopDialogSessionId] = useState<string | null>(null);
  const [resumeDialogSession, setResumeDialogSession] = useState<Session | null>(null);
  const [resumeRuntimeId, setResumeRuntimeId] = useState("");
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    setTableRefresh((v) => v + 1);
  }, [accountId, refreshTick]);

  const shouldPollSessions = loadedSessions.some((session) => !isSessionTerminal(session));

  useEffect(() => {
    if (!shouldPollSessions) return;
    const id = window.setInterval(() => setTableRefresh((v) => v + 1), 3000);
    return () => window.clearInterval(id);
  }, [shouldPollSessions]);

  const loadSessionsForTable = async (offset: number, limit: number) => {
    const page = await listSessionsPage({ account_id: accountId, session_id: search || undefined, offset, limit });
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
      setStopDialogSessionId(null);
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
      setStopDialogSessionId(null);
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
    setResuming(true);
    try {
      const resumed = await resumeWithNewSession(accountId, session, resumeRuntimeId);
      setTableRefresh((v) => v + 1);
      setResumeDialogSession(null);
      setResumeRuntimeId("");
      navigate(`/accounts/${accountId}/sessions/${resumed.session_id}`);
    } catch (err) {
      setStopError(err instanceof Error ? err.message : "Failed to resume session");
    } finally {
      setResuming(false);
    }
  }

  function openResumeDialog(session: Session) {
    setStopError(null);
    setResumeRuntimeId("");
    setResumeDialogSession(session);
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
        refreshKey={`${accountId}-${search}-${tableRefresh}`}
        emptyText="No sessions found."
        rowKey={(s) => s.session_id}
        renderRow={(s) => (
          <>
            <td>
              <Link to={`/accounts/${accountId}/sessions/${s.session_id}`}>{s.session_id.slice(0, 10)}…</Link>
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
                <button type="button" onClick={() => navigate(`/accounts/${accountId}/sessions/${s.session_id}`)}>Open</button>
                {s.status === "running" ? (
                  <>
                    <button type="button" onClick={() => void handleFinishListedSession(s)} disabled={finishingSessionId === s.session_id || stoppingSessionId === s.session_id}>
                      {finishingSessionId === s.session_id ? "Finishing…" : "Finish"}
                    </button>
                    <button type="button" onClick={() => setStopDialogSessionId(s.session_id)} disabled={stoppingSessionId === s.session_id || finishingSessionId === s.session_id}>
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
      onCancel={() => {
        if (stoppingSessionId === stopDialogSessionId) return;
        setStopDialogSessionId(null);
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
      runtimeLabel={resumeDialogSession?.mode === 0 ? "Backtest runtime" : "Executor runtime"}
      mode={resumeDialogSession?.mode}
      role={runtimeRoleForSessionMode(resumeDialogSession?.mode)}
      busy={resuming}
      error={stopError}
      confirmLabel="Resume"
      onRuntimeChange={setResumeRuntimeId}
      onCancel={() => {
        if (resuming) return;
        setResumeDialogSession(null);
        setResumeRuntimeId("");
        setStopError(null);
      }}
      onConfirm={() => {
        if (resumeDialogSession) void handleResumeWithNewSession(resumeDialogSession);
      }}
    />
    </>
  );
}
