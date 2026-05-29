export type Account = {
  account_id: number;
  name: string;
  description?: string;
  mode: number;
  created_at: string;
};

export type AuthUser = {
  id: number;
  username: string;
  created_at: string;
};

/**
 * Shape of the `/api/accounts/:id/wallet` response.
 *
 * canonical-wallet-display-boundary: the backend exposes TWO clearly
 * separated views.
 *
 * 1. CANONICAL runtime fields — these feed trading / risk / reconciliation
 *    logic on the backend. The frontend should treat them as authoritative
 *    balances for the single-asset `USDT@-M` futures + USDT-mediated spot
 *    runtime.
 *
 *    - `mode`, `updated_at`
 *    - `wallet_balance`, `margin_balance`, `total_margin_balance`, `available_balance`
 *    - nested `spot` / `futures` sub-objects (full canonical detail)
 *
 * 2. DISPLAY values under `display.*` — provider-aligned UI explanations,
 *    most notably multi-asset USD sums that let users reconcile the
 *    platform view against the exchange's native wallet page. These must
 *    be rendered with a clear label so users understand they are display
 *    explanations, NOT the runtime balance.
 *
 *    - `display.total_value`
 *    - `display.spot_estimated_value`
 *    - `display.futures_position_equity`
 *    - `display.metrics_authoritative`
 *    - `display.futures_display_usd`
 *
 * Legacy flat display duplicates (`total_value`, `spot_estimated_value`,
 * ...) are still emitted for backward compatibility and will be removed
 * once all UI readers have moved to `display.*`.
 */

export type WalletDisplay = {
  total_value: number;
  spot_estimated_value: number;
  futures_position_equity: number;
  metrics_authoritative?: boolean;
  futures_display_usd?: {
    wallet_balance: number;
    margin_balance: number;
    unrealized_pnl: number;
  } | null;
};

export type WalletSnapshot = {
  // ── canonical (authoritative) ─────────────────────────────────────────
  mode: number;
  updated_at: string;
  wallet_balance: number;
  margin_balance: number;
  total_margin_balance: number;
  available_balance: number;
  spot: {
    free: number;
    locked: number;
    assets: Array<{
      symbol: string;
      qty: number;
      locked: number;
      avg_entry_price: number;
      price?: number;
    }>;
  } | null;
  futures: {
    margin_mode: string;
    position_mode: string;
    initial_balance: number;
    wallet_balance: number;
    margin_balance: number;
    total_margin_balance: number;
    available_balance: number;
    unrealized_pnl: number;
    total_unrealized_pnl: number;
    total_position_initial_margin: number;
    total_open_order_initial_margin: number;
    total_maint_margin: number;
    total_cross_wallet_balance: number;
    total_cross_un_pnl: number;
    multi_assets_mode: boolean;
    portfolio_margin: boolean;
    positions: Array<{
      symbol: string;
      direction: number;
      initial_balance: number;
      leverage: number;
      fee_rate: number;
      qty: number;
      entry_price: number;
      mark_price: number;
      unrealized_pnl: number;
      position_side: string;
      display_equity?: number;
    }>;
  } | null;
  // ── namespaced display (UI-explanation layer; not runtime-authoritative) ──
  display?: WalletDisplay;
  // ── legacy flat display duplicates (deprecated — prefer display.*) ──
  total_value: number;
  spot_estimated_value: number;
  futures_position_equity: number;
  metrics_authoritative?: boolean;
  futures_display_usd?: WalletDisplay["futures_display_usd"];
};

export type CreateAccountPayload = {
  name: string;
  description?: string;
  mode: number;
  api_key?: string;
  api_secret?: string;
  initial_balance?: number;
  spot?: {
    free: number;
    locked: number;
    assets: Array<{
      symbol: string;
      qty: number;
      locked?: number;
      avg_entry_price?: number;
      price?: number;
    }>;
  };
  futures?: {
    margin_mode: string;
    position_mode: string;
    initial_balance?: number;
    positions: Array<{
      symbol: string;
      direction?: number;
      initial_balance?: number;
      leverage?: number;
      fee_rate?: number;
    }>;
  };
};

export type Venue = {
  venue_id: number;
  user_id: number;
  account_id?: number;
  exchange: number;
  exchange_label?: string;
  market: number;
  market_label?: string;
  environment: number;
  environment_label?: string;
  status: number;
  status_label?: string;
  display_name: string;
  description?: string;
  api_key?: string;
  credential_fingerprint?: string;
  margin_mode: number;
  margin_mode_label?: string;
  position_mode: number;
  position_mode_label?: string;
  created_at?: string;
  updated_at?: string;
  last_used_at?: string;
  archived_at?: string;
  archived_reason?: string;
};

export type VenuePage = Page<Venue>;

export type CreateVenuePayload = {
  account_id?: number;
  exchange: "binance" | "okx";
  market: "spot" | "perpetual_futures" | "delivery_futures";
  environment: "demo" | "live";
  display_name: string;
  description?: string;
  api_key: string;
  credential_info: Record<string, unknown>;
  margin_mode?: "cross" | "isolated" | "none";
  position_mode?: "one_way" | "hedge" | "none";
};

function sameHostApiBase(): string {
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8090`;
  }
  return "http://localhost:8090";
}

function apiBase(): string {
  const v = import.meta.env.VITE_API_BASE_URL?.trim();
  if (v && v !== "auto" && v !== "same-host") return v.replace(/\/$/, "");
  return sameHostApiBase();
}

let tokenMem: string | null = null;
const tokenStorageKey = "quant_token";

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function setToken(t: string | null) {
  tokenMem = t;
  const storage = browserStorage();
  if (!storage) return;
  if (t) {
    storage.setItem(tokenStorageKey, t);
  } else {
    storage.removeItem(tokenStorageKey);
  }
}

export function getToken(): string | null {
  if (tokenMem) return tokenMem;
  const storage = browserStorage();
  if (storage) {
    tokenMem = storage.getItem(tokenStorageKey);
  }
  return tokenMem;
}

async function parseErr(res: Response): Promise<string> {
  // Auto-handle stale/expired sessions: when the backend rejects an
  // authenticated request with 401, wipe the local JWT so the next
  // render-pass through ``RequireAuth`` (or the next fetch) sees no
  // token and the user gets redirected to /login instead of looking at
  // an opaque "unauthorized" error forever.
  //
  // We deliberately only clear on 401 (not 403): 403 means "authenticated
  // but not allowed", which is a permission issue, not a session-expiry
  // issue. And we don't touch /api/auth/login itself because a 401 there
  // is "wrong password", not "session expired".
  if (res.status === 401) {
    const url = typeof res.url === "string" ? res.url : "";
    if (!url.includes("/api/auth/login") && !url.includes("/api/auth/signup")) {
      setToken(null);
    }
  }
  try {
    const j = (await res.json()) as { error?: string };
    const detail = j.error ?? res.statusText;
    if (res.status === 401) {
      return `Session expired — please log in again. (${detail})`;
    }
    return detail;
  } catch {
    return res.status === 401
      ? "Session expired — please log in again."
      : res.statusText;
  }
}

export async function signup(username: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${apiBase()}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  const j = (await res.json()) as { user: AuthUser };
  return j.user;
}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch(`${apiBase()}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  const j = (await res.json()) as { token: string };
  setToken(j.token);
}

export async function listAccounts(): Promise<Account[]> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/accounts`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as Account[];
}

function applyCollectionPageParams(u: URL, params?: PageParams): void {
  u.searchParams.set("page", "true");
  if (params?.limit != null) u.searchParams.set("limit", String(params.limit));
  if (params?.offset != null) u.searchParams.set("offset", String(params.offset));
}

export async function listAccountsPage(params?: PageParams): Promise<Page<Account>> {
  const u = new URL(`${apiBase()}/api/accounts`);
  applyCollectionPageParams(u, params);
  return fetchPage<Account>(u);
}

export async function createAccount(body: CreateAccountPayload): Promise<Account> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/accounts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as Account;
}

export async function getAccount(id: number | string): Promise<Account> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/accounts/${id}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as Account;
}

function venuePageURL(path: string, params?: Record<string, string | number | boolean | undefined>): URL {
  const u = new URL(`${apiBase()}${path}`);
  u.searchParams.set("page", "true");
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") {
      u.searchParams.set(key, String(value));
    }
  }
  return u;
}

export async function listVenues(params: Record<string, string | number | boolean | undefined> = {}): Promise<VenuePage> {
  return fetchPage<Venue>(venuePageURL("/api/venues", params));
}

export async function listAccountVenues(
  accountId: number | string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<VenuePage> {
  return fetchPage<Venue>(venuePageURL(`/api/accounts/${accountId}/venues`, params));
}

export async function createVenue(payload: CreateVenuePayload): Promise<Venue> {
  const t = authToken();
  const res = await fetch(`${apiBase()}/api/venues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as Venue;
}

export async function bindVenue(venueId: number | string, accountId: number | string, reason = ""): Promise<Venue> {
  const t = authToken();
  const res = await fetch(`${apiBase()}/api/venues/${venueId}/bind`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ account_id: Number(accountId), reason }),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as Venue;
}

export async function releaseVenue(venueId: number | string, reason = ""): Promise<Venue> {
  const t = authToken();
  const res = await fetch(`${apiBase()}/api/venues/${venueId}/release`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as Venue;
}

export async function archiveVenue(venueId: number | string, reason = ""): Promise<void> {
  const t = authToken();
  const res = await fetch(`${apiBase()}/api/venues/${venueId}/archive`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error(await parseErr(res));
}

export async function listSymbols(
  market: "spot" | "usdm_futures",
  q: string,
): Promise<{ symbols: string[]; stale: boolean }> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const u = new URL(`${apiBase()}/api/symbols`);
  u.searchParams.set("market", market);
  u.searchParams.set("q", q);
  u.searchParams.set("limit", "50");
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as { symbols: string[]; stale: boolean };
}

export async function getAccountWallet(id: number | string): Promise<WalletSnapshot> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/accounts/${id}/wallet`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as WalletSnapshot;
}

// ── Strategy execution ───────────────────────────────────────────────────────

export type RunStrategyParams = {
  strategy_path: string;
  interval: string;
  start_time_ms?: number;
  end_time_ms?: number;
  runtime_id?: string;
};

export type StrategySession = { session_id: string };

export type StrategyStatus = {
  status: string;         // "running" | "finished" | "failed" | "stopped" ("completed" = legacy)
  bars_processed: number;
  error: string;
};

export async function runStrategy(
  accountId: number | string,
  params: RunStrategyParams,
): Promise<StrategySession> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/accounts/${accountId}/run-strategy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as StrategySession;
}

export async function getStrategyStatus(sessionId: string): Promise<StrategyStatus> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/strategy-sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as StrategyStatus;
}

// ── PreviewRunStrategy (readiness dry-run) ──────────────────────────────────
//
// Mirrors strategy-service `PreviewRunStrategy`: resolves declared INPUTS,
// classifies the runtime profile, and reports failures without creating a
// session. UI surfaces call this to show "will it start?" feedback based on
// the same evaluator the backend actually runs.

export type PreflightFailure = {
  kind: string;          // "profile" | "invalid_request" | "historical_data" | "stream" | "declaration"
  reason: string;
  input_key?: { market: string; symbol: string; interval: string };
};

export type PreviewRunStrategy = {
  profile: string;       // "backtest" | "live" | "testnet" | "unknown" | ""
  supported: boolean;
  ok: boolean;
  failures: PreflightFailure[];
  required_streams: StreamKey[];
  declared_inputs?: StreamKey[];
};

export async function previewRunStrategy(
  accountId: number | string,
  params?: { start_time_ms?: number; end_time_ms?: number; strategy_path?: string; runtime_id?: string },
): Promise<PreviewRunStrategy> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/accounts/${accountId}/preview-run-strategy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params ?? {}),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as PreviewRunStrategy;
}

export type BacktestCoverageInput = {
  key: StreamKey;
  complete: boolean;
  expected_count: number;
  covered_count: number;
  missing_segments: MarketDataTimeRange[];
  non_downloadable_reason?: string;
};

export type BacktestCoveragePreview = {
  complete: boolean;
  can_auto_download: boolean;
  inputs: BacktestCoverageInput[];
};

export type DownloadRunJob = {
  job_id: string;
  status: "pending" | "running" | "ready" | "error" | string;
  progress: number;
  session_id?: string;
  error?: string;
  created_at: string;
  updated_at: string;
};

export async function previewBacktestCoverage(
  accountId: number | string,
  params: { start_time_ms: number; end_time_ms: number; strategy_path?: string; runtime_id?: string },
): Promise<BacktestCoveragePreview> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/accounts/${accountId}/strategy/coverage-preview`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as BacktestCoveragePreview;
}

export async function startDownloadAndRunBacktest(
  accountId: number | string,
  params: { interval: string; start_time_ms: number; end_time_ms: number; strategy_path?: string; runtime_id?: string },
): Promise<DownloadRunJob> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/accounts/${accountId}/strategy/download-and-run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as DownloadRunJob;
}

export async function getDownloadAndRunJob(jobId: string): Promise<DownloadRunJob> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/strategy/download-and-run-jobs/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as DownloadRunJob;
}

export type DebugPackageRequest = {
  market: "futures";
  symbol: string;
  interval: string;
  start_time_ms: number;
  end_time_ms: number;
  wallet_source: "manual" | "account_snapshot";
  initial_balance?: number;
};

export async function downloadDebugPackage(
  accountId: number | string,
  body: DebugPackageRequest,
): Promise<Blob> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/accounts/${accountId}/debug-package`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return await res.blob();
}

// ── Strategy management ──────────────────────────────────────────────────────

export type Strategy = {
  strategy_id: number;
  name: string;
  version: string;
  description: string;
  code?: string;
  archived: boolean;
  created_at: string;
  runtime_version?: string;
  runtime_profile?: string;
};

export type AccountStrategy = {
  strategy: Strategy;
  active: boolean;
  mounted_at: string;
};

export type CreateStrategyPayload = {
  name: string;
  version: string;
  description?: string;
  code: string;
};

export async function createStrategy(payload: CreateStrategyPayload): Promise<Strategy> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/strategies`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as Strategy;
}

export async function listStrategies(namePrefix?: string, activeOnly?: boolean): Promise<Strategy[]> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const u = new URL(`${apiBase()}/api/strategies`);
  if (namePrefix) u.searchParams.set("name_prefix", namePrefix);
  if (activeOnly) u.searchParams.set("active_only", "true");
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as Strategy[];
}

export async function listStrategiesPage(params?: PageParams & { namePrefix?: string; activeOnly?: boolean }): Promise<Page<Strategy>> {
  const u = new URL(`${apiBase()}/api/strategies`);
  if (params?.namePrefix) u.searchParams.set("name_prefix", params.namePrefix);
  if (params?.activeOnly) u.searchParams.set("active_only", "true");
  applyCollectionPageParams(u, params);
  return fetchPage<Strategy>(u);
}

export async function getStrategy(id: number | string): Promise<Strategy> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/strategies/${id}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as Strategy;
}

export async function archiveStrategy(id: number | string): Promise<void> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/strategies/${id}/archive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
}

// ── Account strategy mount management ───────────────────────────────────────

export async function listAccountStrategies(accountId: number | string): Promise<AccountStrategy[]> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/accounts/${accountId}/strategies`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as AccountStrategy[];
}

export async function mountStrategy(accountId: number | string, strategyId: number | string): Promise<void> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/accounts/${accountId}/strategies/${strategyId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
}

export async function unmountStrategy(accountId: number | string, strategyId: number | string): Promise<void> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/accounts/${accountId}/strategies/${strategyId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
}

export async function deactivateStrategy(accountId: number | string, strategyId: number | string): Promise<void> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/accounts/${accountId}/strategies/${strategyId}/deactivate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
}

export async function activateStrategy(accountId: number | string, strategyId: number | string): Promise<void> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/accounts/${accountId}/strategies/${strategyId}/activate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export type Session = {
  session_id: string;
  account_id: number;
  strategy_id: number;
  mode: number;
  status: string;
  interval: string;
  start_time_ms?: number;
  end_time_ms?: number;
  bars_processed: number;
  error?: string;
  runtime_id?: string;
  runtime_source?: string;
  runtime_name?: string;
  session_type?: string;
  runtime_version?: string;
  session_name?: string;
  started_at: string;
  completed_at?: string;
};

const terminalSessionStatuses = new Set(["completed", "finished", "stopped", "failed", "stop_failed", "recoverable"]);

export function isSessionTerminal(session: Pick<Session, "status"> | { status?: string }): boolean {
  return terminalSessionStatuses.has((session.status || "").toLowerCase());
}

export async function listSessions(accountId: number | string, offset?: number, limit?: number): Promise<Session[]> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const u = new URL(`${apiBase()}/api/sessions`);
  u.searchParams.set("account_id", String(accountId));
  if (offset) u.searchParams.set("offset", String(offset));
  if (limit) u.searchParams.set("limit", String(limit));
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as Session[];
}

export type SessionPageParams = PageParams & {
  account_id?: number | string;
  runtime_id?: string;
  strategy_id?: number | string;
  mode?: number | string;
  status?: string;
  session_id?: string;
  started_after_ms?: number;
  started_before_ms?: number;
};

export async function listSessionsPage(params?: SessionPageParams): Promise<Page<Session>> {
  const u = new URL(`${apiBase()}/api/sessions`);
  if (params?.account_id != null && params.account_id !== "") u.searchParams.set("account_id", String(params.account_id));
  if (params?.runtime_id) u.searchParams.set("runtime_id", params.runtime_id);
  if (params?.strategy_id != null && params.strategy_id !== "") u.searchParams.set("strategy_id", String(params.strategy_id));
  if (params?.mode != null && params.mode !== "") u.searchParams.set("mode", String(params.mode));
  if (params?.status) u.searchParams.set("status", params.status);
  if (params?.session_id) u.searchParams.set("session_id", params.session_id);
  if (params?.started_after_ms) u.searchParams.set("started_after_ms", String(params.started_after_ms));
  if (params?.started_before_ms) u.searchParams.set("started_before_ms", String(params.started_before_ms));
  applyCollectionPageParams(u, params);
  return fetchPage<Session>(u);
}

export async function getSession(sessionId: string): Promise<Session> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as Session;
}

export type SnapshotEntry = {
  time: string;
  account_id: number;
  snapshot_reason: number;
  total_value: number;
  wallet_balance: number;
  available_balance: number;
  futures_json: string;
  spot_json: string;
  strategy_id: number;
};

export type SessionOrderIntent = {
  time: string;
  intent_id: string;
  account_id: number;
  symbol: string;
  side: string;
  requested_qty: number;
  requested_price: number;
  strategy_id: number;
  market: string;
  session_id?: string;
};

export type SessionOrder = {
  time: string;
  order_id: string;
  exchange_order_id?: string;
  client_order_id?: string;
  attempt_id?: string;
  intent_id?: string;
  symbol: string;
  side: string;
  orig_qty: number;
  executed_qty: number;
  remaining_qty: number;
  avg_price: number;
  price: number;
  status: string;
  market: string;
  strategy_id: number;
  error_message?: string;
};

export type SessionOrderAttempt = {
  time: string;
  attempt_id: string;
  intent_id?: string;
  order_id?: string;
  exchange_order_id?: string;
  client_order_id?: string;
  symbol: string;
  side: string;
  requested_qty: number;
  requested_price: number;
  mark_price: number;
  status: string;
  market: string;
  strategy_id: number;
  error_message?: string;
  recovery_error?: string;
};

export type SessionOrderFill = {
  time: string;
  fill_id: string;
  exchange_trade_id?: string;
  order_id: string;
  exchange_order_id?: string;
  attempt_id?: string;
  intent_id?: string;
  symbol: string;
  side: string;
  qty: number;
  fill_price: number;
  fee: number;
  status: string;
  market: string;
  strategy_id: number;
};

export type ReconciliationFieldDiff = {
  field: string;
  severity: string;
  exchange: number;
  local: number;
  diff_abs: number;
  diff_ratio: number;
  threshold?: Record<string, unknown> | string | null;
  passed: boolean;
};

export type ReconciliationRun = {
  time: string;
  run_id: string;
  account_id: number;
  strategy_id: number;
  session_id: string;
  snapshot_reason: number;
  run_type: string;
  mode: number;
  hard_pass: boolean;
  soft_pass: boolean;
  hard_fail_count: number;
  soft_fail_count: number;
  advisory_count: number;
  field_diffs: ReconciliationFieldDiff[];
  advisory_diffs: ReconciliationFieldDiff[];
  local_snapshot_json: string;
  exchange_snapshot_json: string;
};

// ── Paged audit list contract (paginate-session-detail-lists) ──────────────
//
// Every session-scoped audit list endpoint returns this shape: the actual
// entries under `items`, plus pagination metadata. Using a dedicated type
// (rather than a bare array) matches the wire contract and lets TS catch
// accidental use of the pre-pagination flat-array shape at compile time.

export type Page<T> = {
  items: T[];
  next_offset: number;
  has_more: boolean;
  /** Session-wide row count for the current filter. Drives the pager's
   *  First / Last / jump-to-page controls. */
  total: number;
};

export type PageParams = {
  limit?: number;   // default 20 server-side; clamped to [1,200]
  offset?: number;  // default 0; must be >= 0
};

async function fetchPage<T>(url: URL): Promise<Page<T>> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as Page<T>;
}

// Ancestor-ID filters live on the leaf list endpoints to support the four-tier
// hierarchical view in SessionDetailPage. Each is optional and additive — empty
// values are skipped so existing callers keep their flat-list behavior.
export type AttemptsPageParams = PageParams & { intent_id?: string };
export type OrdersPageParams = PageParams & { intent_id?: string; attempt_id?: string };
export type FillsPageParams = PageParams & { intent_id?: string; attempt_id?: string; order_id?: string };

function buildSessionPageURL(
  sessionId: string,
  suffix: string,
  params?: PageParams,
  extra?: Record<string, string | undefined>,
): URL {
  const u = new URL(`${apiBase()}/api/sessions/${sessionId}/${suffix}`);
  if (params?.limit != null) u.searchParams.set("limit", String(params.limit));
  if (params?.offset != null) u.searchParams.set("offset", String(params.offset));
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v != null && v !== "") u.searchParams.set(k, v);
    }
  }
  return u;
}

export async function getSessionSnapshots(
  sessionId: string,
  params?: PageParams,
): Promise<Page<SnapshotEntry>> {
  return fetchPage<SnapshotEntry>(buildSessionPageURL(sessionId, "snapshots", params));
}

export async function getSessionIntents(
  sessionId: string,
  params?: PageParams,
): Promise<Page<SessionOrderIntent>> {
  return fetchPage<SessionOrderIntent>(buildSessionPageURL(sessionId, "intents", params));
}

export async function getSessionOrders(
  sessionId: string,
  params?: OrdersPageParams,
): Promise<Page<SessionOrder>> {
  return fetchPage<SessionOrder>(buildSessionPageURL(sessionId, "orders", params, {
    intent_id: params?.intent_id,
    attempt_id: params?.attempt_id,
  }));
}

export async function getSessionAttempts(
  sessionId: string,
  params?: AttemptsPageParams,
): Promise<Page<SessionOrderAttempt>> {
  return fetchPage<SessionOrderAttempt>(buildSessionPageURL(sessionId, "attempts", params, {
    intent_id: params?.intent_id,
  }));
}

export async function getSessionFills(
  sessionId: string,
  params?: FillsPageParams,
): Promise<Page<SessionOrderFill>> {
  return fetchPage<SessionOrderFill>(buildSessionPageURL(sessionId, "fills", params, {
    intent_id: params?.intent_id,
    attempt_id: params?.attempt_id,
    order_id: params?.order_id,
  }));
}

export async function getSessionReconciliation(
  sessionId: string,
  params?: PageParams,
): Promise<Page<ReconciliationRun>> {
  return fetchPage<ReconciliationRun>(buildSessionPageURL(sessionId, "reconciliation", params));
}

export type SessionReconciliationSummary = {
  total_runs: number;
  hard_fail_runs: number;
  soft_fail_runs: number;
};

// Session-wide reconciliation aggregate. Renders the SessionDetailPage tile
// (total / hard fail / soft fail) so the headline numbers reflect the whole
// session, not just the loaded page of runs.
export async function getSessionReconciliationSummary(
  sessionId: string,
): Promise<SessionReconciliationSummary> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const u = new URL(`${apiBase()}/api/sessions/${sessionId}/reconciliation/summary`);
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as SessionReconciliationSummary;
}

export type StopSessionAction =
  | "STOP_ACTION_FINISH"
  | "STOP_ACTION_STOP_ONLY"
  | "STOP_ACTION_STOP_AND_CLOSE_POSITIONS";

export async function stopSession(sessionId: string, action: StopSessionAction = "STOP_ACTION_STOP_ONLY"): Promise<boolean> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/strategy-sessions/${sessionId}/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ stop_action: action }),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  const json = await res.json() as { stopped?: boolean };
  return Boolean(json.stopped);
}

export async function finishSession(sessionId: string): Promise<boolean> {
  return stopSession(sessionId, "STOP_ACTION_FINISH");
}

// ── Order history ────────────────────────────────────────────────────────────

export type OrderIntentEntry = {
  time: string;
  intent_id: string;
  account_id: number;
  symbol: string;
  side: string;
  requested_qty: number;
  requested_price: number;
  strategy_id: number;
  market: string;
  session_id?: string;
};

export type OrderEntry = {
  time: string;
  order_id: string;
  exchange_order_id?: string;
  client_order_id?: string;
  attempt_id?: string;
  intent_id?: string;
  account_id: number;
  symbol: string;
  side: string;
  orig_qty: number;
  executed_qty: number;
  remaining_qty: number;
  avg_price: number;
  price: number;
  status: string;
  market: string;
  strategy_id: number;
  session_id?: string;
  error_message?: string;
};

export type OrderAttemptEntry = {
  time: string;
  attempt_id: string;
  intent_id?: string;
  order_id?: string;
  exchange_order_id?: string;
  client_order_id?: string;
  account_id: number;
  symbol: string;
  side: string;
  requested_qty: number;
  requested_price: number;
  mark_price: number;
  status: string;
  market: string;
  strategy_id: number;
  session_id?: string;
  error_message?: string;
  recovery_error?: string;
};

export type OrderFillEntry = {
  time: string;
  fill_id: string;
  exchange_trade_id?: string;
  order_id: string;
  exchange_order_id?: string;
  attempt_id?: string;
  intent_id?: string;
  account_id: number;
  symbol: string;
  side: string;
  qty: number;
  fill_price: number;
  fee: number;
  status: string;
  market: string;
  strategy_id: number;
  session_id?: string;
};

export type QueryOrdersParams = {
  /** Omit or pass 0/"" to scope the query to every account the user owns. */
  accountId?: number | string;
  strategyId?: number | string;
  /** Drill-down ancestor IDs. Empty/undefined means no ancestor filter. */
  intentId?: string;
  attemptId?: string;
  orderId?: string;
  limit?: number;
  /** 0-based offset for pagination. */
  offset?: number;
};

export type QueryOrderIntentsResult = {
  items: OrderIntentEntry[];
  total: number;
};

export type QueryOrdersResult = {
  items: OrderEntry[];
  total: number;
};

export type QueryOrderAttemptsResult = {
  items: OrderAttemptEntry[];
  total: number;
};

export type QueryOrderFillsResult = {
  items: OrderFillEntry[];
  total: number;
};

export async function queryOrderIntents(params: QueryOrdersParams = {}): Promise<QueryOrderIntentsResult> {
  return fetchOrderHistory<QueryOrderIntentsResult>("intents", params);
}

export async function queryOrders(params: QueryOrdersParams = {}): Promise<QueryOrdersResult> {
  return fetchOrderHistory<QueryOrdersResult>("", params);
}

export async function queryOrderAttempts(params: QueryOrdersParams = {}): Promise<QueryOrderAttemptsResult> {
  return fetchOrderHistory<QueryOrderAttemptsResult>("attempts", params);
}

export async function queryOrderFills(params: QueryOrdersParams = {}): Promise<QueryOrderFillsResult> {
  return fetchOrderHistory<QueryOrderFillsResult>("fills", params);
}

async function fetchOrderHistory<T>(suffix: string, params: QueryOrdersParams): Promise<T> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const base = suffix ? `${apiBase()}/api/orders/${suffix}` : `${apiBase()}/api/orders`;
  const u = new URL(base);
  // account_id: only set when meaningful. "", undefined, null, and 0 all mean
  // "All accounts" to the backend, and the backend happily accepts the param
  // being absent — keep the URL clean.
  const aid = params.accountId;
  if (aid !== undefined && aid !== "" && Number(aid) !== 0) {
    u.searchParams.set("account_id", String(aid));
  }
  if (params.strategyId) u.searchParams.set("strategy_id", String(params.strategyId));
  if (params.intentId) u.searchParams.set("intent_id", params.intentId);
  if (params.attemptId) u.searchParams.set("attempt_id", params.attemptId);
  if (params.orderId) u.searchParams.set("order_id", params.orderId);
  if (params.limit) u.searchParams.set("limit", String(params.limit));
  if (params.offset) u.searchParams.set("offset", String(params.offset));
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as T;
}

// ── Market-data control plane (demand-driven) ───────────────────────────────

export type StreamKey = {
  exchange: string;
  market: string;   // "spot" | "futures"
  kind: string;     // v1: "kline"
  symbol: string;   // canonical upper-case
  interval: string; // "1m" | "5m" | ...
};

export type MarketDataStream = {
  stream_id: number;
  key: StreamKey;
  desired_state: string;
  actual_state: string;              // pending/starting/running/draining/stopped/error
  effective_live_delivery: boolean;
  last_data_at?: string;
  last_error?: string;
  last_reconciled_at?: string;
  active_lease_count: number;
  created_at: string;
  updated_at: string;
};

export type MarketDataRequest = {
  request_id: number;
  user_id: number;
  account_id?: number;
  stream_id: number;
  key: StreamKey;
  needs_live_delivery: boolean;
  status: string;                    // live: pending/active/cancelled; historical: pending/running/verifying/ready/error/cancelled
  scope: "live" | "historical";
  requested_start_at?: string;
  requested_end_at?: string;
  covered_start_at?: string;
  covered_end_at?: string;
  last_error?: string;
  ready?: boolean;
  created_at: string;
  updated_at: string;
  cancelled_at?: string;
};

export type MarketDataEntry = {
  request: MarketDataRequest;
  stream?: MarketDataStream;
};

export type MarketDataTimeRange = {
  start_at: string;
  end_at: string;
  expected_count: number;
};

export type MarketDataCoverageSegment = {
  key: StreamKey;
  year: number;
  start_at: string;
  end_at: string;
  row_count: number;
  source: string;
};

export type MarketDataCoverage = {
  key: StreamKey;
  requested_start_at: string;
  requested_end_at: string;
  complete: boolean;
  expected_count: number;
  covered_count: number;
  covered_segments: MarketDataCoverageSegment[];
  missing_segments: MarketDataTimeRange[];
  non_downloadable_reason?: string;
};

export type MarketDataKline = {
  open_time: string;
  close_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketDataKlines = {
  key: StreamKey;
  requested_start_at: string;
  requested_end_at: string;
  rows: MarketDataKline[];
  row_count: number;
  truncated: boolean;
  limit: number;
};

export type SessionMarketDataSubscription = {
  subscription_id: number;
  user_id: number;
  session_id: string;
  runtime_id: string;
  key: StreamKey;
  mode: number;
  status: string;
  created_at?: string;
  updated_at?: string;
  released_at?: string;
};

export type StreamDeliveryLease = {
  lease_id: string;
  subscription_id: number;
  owner_instance_id: string;
  status: string;
  acquired_at?: string;
  last_heartbeat_at?: string;
  expires_at?: string;
  last_delivery_at?: string;
  last_topic?: string;
  last_partition?: number;
  last_offset?: number;
};

export type StreamDeliveryFailure = {
  failure_id: number;
  subscription_id: number;
  owner_instance_id?: string;
  topic?: string;
  stream_key?: string;
  failure_code: string;
  reason: string;
  first_seen_at?: string;
  last_seen_at?: string;
  attempt_count: number;
};

export type SessionDeliveryHealth = {
  subscription: SessionMarketDataSubscription;
  lease?: StreamDeliveryLease;
  latest_failure?: StreamDeliveryFailure;
  health_status: "delivering" | "warming_up" | "delivery_blocked" | string;
  blocked_reason?: string;
  observed_at?: string;
};

export type SessionDeliveryHealthResult = {
  items: SessionDeliveryHealth[];
};

export type CreateMarketDataRequestPayload = {
  exchange: string;
  market: string;
  kind?: string;         // defaults to "kline" server-side
  symbol: string;
  interval: string;
  scope?: "live" | "historical";
  needs_live_delivery?: boolean;
  account_id?: number;
  start_time_ms?: number;
  end_time_ms?: number;
};

export async function createMarketDataRequest(payload: CreateMarketDataRequestPayload): Promise<MarketDataEntry> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/market-data/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as MarketDataEntry;
}

export async function listMarketDataRequests(): Promise<MarketDataEntry[]> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/market-data/requests`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as MarketDataEntry[];
}

export async function listMarketDataRequestsPage(params?: PageParams): Promise<Page<MarketDataEntry>> {
  const u = new URL(`${apiBase()}/api/market-data/requests`);
  applyCollectionPageParams(u, params);
  return fetchPage<MarketDataEntry>(u);
}

export async function queryMarketDataCoverage(params: {
  exchange: string;
  market: string;
  kind?: string;
  symbol: string;
  interval: string;
  start_time_ms: number;
  end_time_ms: number;
}): Promise<MarketDataCoverage> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const u = new URL(`${apiBase()}/api/market-data/coverage`);
  u.searchParams.set("exchange", params.exchange);
  u.searchParams.set("market", params.market);
  u.searchParams.set("kind", params.kind || "kline");
  u.searchParams.set("symbol", params.symbol);
  u.searchParams.set("interval", params.interval);
  u.searchParams.set("start_time_ms", String(params.start_time_ms));
  u.searchParams.set("end_time_ms", String(params.end_time_ms));
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as MarketDataCoverage;
}

export async function queryMarketDataKlines(params: {
  exchange: string;
  market: string;
  kind?: string;
  symbol: string;
  interval: string;
  start_time_ms: number;
  end_time_ms: number;
  limit?: number;
}): Promise<MarketDataKlines> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const u = new URL(`${apiBase()}/api/market-data/klines`);
  u.searchParams.set("exchange", params.exchange);
  u.searchParams.set("market", params.market);
  u.searchParams.set("kind", params.kind || "kline");
  u.searchParams.set("symbol", params.symbol);
  u.searchParams.set("interval", params.interval);
  u.searchParams.set("start_time_ms", String(params.start_time_ms));
  u.searchParams.set("end_time_ms", String(params.end_time_ms));
  if (params.limit) u.searchParams.set("limit", String(params.limit));
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as MarketDataKlines;
}

export async function cancelMarketDataRequest(requestId: number | string): Promise<void> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/market-data/requests/${requestId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
}

// getMarketDataStreamByKey is used by live-start preflight paths (e.g. on
// AccountDetail) to check "is the stream my strategy needs actually live?"
export async function getMarketDataStreamByKey(key: StreamKey): Promise<MarketDataStream> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const u = new URL(`${apiBase()}/api/market-data/streams`);
  u.searchParams.set("exchange", key.exchange);
  u.searchParams.set("market", key.market);
  u.searchParams.set("kind", key.kind || "kline");
  u.searchParams.set("symbol", key.symbol);
  u.searchParams.set("interval", key.interval);
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as MarketDataStream;
}

export async function listSessionDeliveryHealth(params: {
  session_id?: string;
  runtime_id?: string;
} = {}): Promise<SessionDeliveryHealthResult> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const u = new URL(`${apiBase()}/api/market-data/delivery-health`);
  if (params.session_id) u.searchParams.set("session_id", params.session_id);
  if (params.runtime_id) u.searchParams.set("runtime_id", params.runtime_id);
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as SessionDeliveryHealthResult;
}

// ── Notification Management ────────────────────────────────────────────────

export type NotificationPreferences = {
  system_enabled: boolean;
  strategy_enabled: boolean;
  custom_enabled: boolean;
};

export type NotificationPlan = {
  plan_code: string;
  notification_enabled: boolean;
  allow_system: boolean;
  allow_strategy: boolean;
  allow_custom: boolean;
  custom_rate_limit_per_minute: number;
  custom_rate_limit_burst: number;
};

export type NotificationChannel = {
  channel: string;
  status: string;
  provider_username?: string;
  provider_display_name?: string;
  bound_at?: string;
  last_delivery_at?: string;
  last_delivery_status?: string;
  last_delivery_error?: string;
};

export type NotificationSettings = {
  preferences: NotificationPreferences;
  plan: NotificationPlan;
  telegram: NotificationChannel;
  bot_username: string;
};

export type NotificationBindCode = {
  bind_code: string;
  expires_at: string;
  bot_username: string;
};

function authToken(): string {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  return t;
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const t = authToken();
  const res = await fetch(`${apiBase()}/api/notifications/settings`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as NotificationSettings;
}

export async function updateNotificationPreferences(preferences: NotificationPreferences): Promise<NotificationSettings> {
  const t = authToken();
  const res = await fetch(`${apiBase()}/api/notifications/preferences`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(preferences),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as NotificationSettings;
}

export async function createNotificationBindCode(): Promise<NotificationBindCode> {
  const t = authToken();
  const res = await fetch(`${apiBase()}/api/notifications/telegram/bind-code`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as NotificationBindCode;
}

export async function confirmNotificationBinding(): Promise<NotificationSettings> {
  const t = authToken();
  const res = await fetch(`${apiBase()}/api/notifications/telegram/confirm`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as NotificationSettings;
}

export async function unbindNotificationTelegram(): Promise<NotificationSettings> {
  const t = authToken();
  const res = await fetch(`${apiBase()}/api/notifications/telegram`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as NotificationSettings;
}

export async function sendTestNotification(): Promise<{ accepted: boolean; settings: NotificationSettings }> {
  const t = authToken();
  const res = await fetch(`${apiBase()}/api/notifications/test`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as { accepted: boolean; settings: NotificationSettings };
}

// ── Runtime Management ──────────────────────────────────────────────────────

export type Runtime = {
  runtime_id: string;
  user_id: number;
  name: string;
  source: "hosted" | "self_hosted" | string;
  role?: "executor" | "debugger" | string;
  endpoint_host?: string;
  grpc_port?: number;
  debug_port?: number;
  capabilities?: string[];
  resource_profile: string;
  version?: string;
  status: string;
  credential_key_id?: string;
  paired_at?: string;
  heartbeat_at?: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  ended_at?: string;
  ended_reason?: string;
  cleanup_status?: string;
  cleanup_reason?: string;
  cleanup_at?: string;
  connection_owner_instance_id?: string;
  connection_owner_acquired_at?: string;
  connection_owner_heartbeat_at?: string;
  debug_workspace?: DebugWorkspaceState;
  debug_dataset?: DebugDatasetState;
};

export type DebugWorkspaceState = {
  host_path?: string;
  container_path?: string;
  template_path?: string;
  archived_template_path?: string;
  vscode_launch_created?: boolean;
  vscode_launch_preserved?: boolean;
  pycharm_doc_created?: boolean;
  pycharm_doc_preserved?: boolean;
  prepared_at?: string;
  last_error?: string;
};

export type DebugDatasetState = {
  dataset_id?: string;
  user_id?: number;
  account_id?: number;
  runtime_id?: string;
  market?: string;
  symbol?: string;
  interval?: string;
  start_time_ms?: number;
  end_time_ms?: number;
  bar_count?: number;
  coverage_status?: string;
  loaded_at?: string;
  state?: string;
  last_error?: string;
};

export type RuntimeListResult = {
  runtimes: Runtime[];
  has_more: boolean;
  total: number;
};

export type EnsureHostedRuntimeResult = {
  runtime: Runtime;
  provisioned: boolean;
};

export type RuntimeAdmissionFailure = {
  admission_failure_id: number;
  user_id: number;
  credential_key_id?: string;
  requested_runtime_id?: string;
  requested_name?: string;
  source?: string;
  role?: string;
  failure_code: string;
  reason: string;
  consumed_runtime_id?: string;
  first_seen_at?: string;
  last_seen_at?: string;
  attempt_count: number;
};

export type RuntimeAdmissionFailureResult = {
  failures: RuntimeAdmissionFailure[];
};

export type RuntimeSelectionOption = {
  runtime_id: string;
  label: string;
  detail: string;
  routeable: boolean;
  disabled_reason?: string;
  runtime: Runtime;
};

const routeableRuntimeStatuses = new Set(["active", "running", "ready", "healthy", "online"]);
const terminalRuntimeStatuses = new Set(["ended", "cancelled", "failed", "heartbeat_stale"]);

export function isRuntimeTerminal(rt: Pick<Runtime, "status">): boolean {
  return terminalRuntimeStatuses.has((rt.status || "").toLowerCase());
}

export function runtimeUnavailableReason(rt: Runtime): string | undefined {
  const status = (rt.status || "").toLowerCase();
  if (routeableRuntimeStatuses.has(status)) {
    if (!rt.heartbeat_at) return "missing heartbeat";
    if (!rt.connection_owner_instance_id) return "not connected";
    return undefined;
  }
  if (status === "paired") return rt.heartbeat_at ? undefined : "starting";
  if (isRuntimeTerminal(rt)) return rt.ended_reason || status;
  if (status === "disconnected") return "disconnected";
  if (status === "unhealthy") return "unhealthy";
  if (status === "error") return "error";
  if (!status) return "missing status";
  return status;
}

export function isRuntimeRouteable(rt: Runtime): boolean {
  return runtimeUnavailableReason(rt) === undefined;
}

export function runtimeRoleForSessionMode(_mode?: number): "executor" {
  return "executor";
}

export function runtimeSelectionOptions(runtimes: Runtime[]): RuntimeSelectionOption[] {
  return runtimes.map((rt) => {
    const disabled = runtimeUnavailableReason(rt);
    const source = rt.source === "self_hosted" ? "self-hosted" : rt.source || "runtime";
    const role = rt.role || "role n/a";
    return {
      runtime_id: rt.runtime_id,
      label: `${rt.name || rt.runtime_id} · ${source} · ${role} · ${rt.status || "unknown"}`,
      detail: `${rt.resource_profile || "profile n/a"} · ${rt.runtime_id}`,
      routeable: disabled === undefined,
      disabled_reason: disabled,
      runtime: rt,
    };
  });
}

export async function listRuntimes(params: {
  status?: string;
  source?: string;
  eligible?: string;
  eligible_for?: string;
  role?: string;
  mode?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<RuntimeListResult> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const u = new URL(`${apiBase()}/api/runtimes`);
  if (params.status) u.searchParams.set("status", params.status);
  if (params.source) u.searchParams.set("source", params.source);
  if (params.eligible) u.searchParams.set("eligible", params.eligible);
  if (params.eligible_for) u.searchParams.set("eligible_for", params.eligible_for);
  if (params.role) u.searchParams.set("role", params.role);
  if (params.mode != null) u.searchParams.set("mode", String(params.mode));
  if (params.limit) u.searchParams.set("limit", String(params.limit));
  if (params.offset) u.searchParams.set("offset", String(params.offset));
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as RuntimeListResult;
}

export async function getRuntime(runtimeId: string): Promise<Runtime> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/runtimes/${encodeURIComponent(runtimeId)}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as Runtime;
}

export async function cancelRuntime(runtimeId: string): Promise<Runtime> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/runtimes/${encodeURIComponent(runtimeId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as Runtime;
}

export async function ensureHostedRuntime(payload: {
  name?: string;
  resource_profile?: string;
} = {}): Promise<EnsureHostedRuntimeResult> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/runtimes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as EnsureHostedRuntimeResult;
}

export async function prepareDebugWorkspace(runtimeId: string, payload: {
  host_path?: string;
  container_path?: string;
} = {}): Promise<DebugWorkspaceState> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/runtimes/${encodeURIComponent(runtimeId)}/prepare-debugging`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as DebugWorkspaceState;
}

export async function getRuntimeDebugDataset(runtimeId: string): Promise<DebugDatasetState> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/runtimes/${encodeURIComponent(runtimeId)}/debug-dataset`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as DebugDatasetState;
}

export async function loadDebugDataset(accountId: number | string, params: {
  runtime_id: string;
  market: string;
  symbol: string;
  interval: string;
  start_time_ms: number;
  end_time_ms: number;
}): Promise<DebugDatasetState> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/accounts/${accountId}/debug-dataset`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as DebugDatasetState;
}

export async function listRuntimeAdmissionFailures(limit = 20): Promise<RuntimeAdmissionFailureResult> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const u = new URL(`${apiBase()}/api/runtime-admission-failures`);
  if (limit) u.searchParams.set("limit", String(limit));
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as RuntimeAdmissionFailureResult;
}

// ── Phase D3: Runtime credentials ──────────────────────────────────────────
//
// The Issue endpoint returns the private key EXACTLY ONCE. The frontend
// triggers a download immediately and clears the variable; it MUST NOT
// be persisted to localStorage / sessionStorage / IndexedDB.

export type RuntimeCredential = {
  key_id: string;
  user_id: number;
  label?: string;
  role: "executor" | "debugger";
  status: "active" | "downloaded" | "consumed" | "revoked" | "expired";
  public_key_pem: string;
  created_at: string;
  downloaded_at?: string;
  consumed_at?: string;
  consumed_runtime_id?: string;
  expires_at?: string;
  last_used_at?: string;
  revoked_at?: string;
  hosted_internal?: boolean;
};

export type IssuedRuntimeCredential = {
  key_id: string;
  private_key_pem: string;
  public_key_pem: string;
  created_at: string;
  role: "executor" | "debugger";
};

export type RevokedRuntimeCredential = {
  credential: RuntimeCredential;
  streams_closed: number;
  runtimes_ended: number;
};

export async function listRuntimeCredentials(includeInactive = false): Promise<RuntimeCredential[]> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const u = new URL(`${apiBase()}/api/runtime-credentials`);
  if (includeInactive) u.searchParams.set("include_inactive", "true");
  const res = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as RuntimeCredential[];
}

export async function listRuntimeCredentialsPage(
  includeInactive = false,
  params?: PageParams,
): Promise<Page<RuntimeCredential>> {
  const u = new URL(`${apiBase()}/api/runtime-credentials`);
  if (includeInactive) u.searchParams.set("include_inactive", "true");
  applyCollectionPageParams(u, params);
  return fetchPage<RuntimeCredential>(u);
}

export async function issueRuntimeCredential(
  label: string,
  role: "executor" | "debugger" = "executor",
): Promise<IssuedRuntimeCredential> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/runtime-credentials`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ label, role }),
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as IssuedRuntimeCredential;
}

export async function revokeRuntimeCredential(keyID: string): Promise<RevokedRuntimeCredential> {
  const t = getToken();
  if (!t) throw new Error("Not logged in");
  const res = await fetch(`${apiBase()}/api/runtime-credentials/${encodeURIComponent(keyID)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseErr(res));
  return (await res.json()) as RevokedRuntimeCredential;
}
