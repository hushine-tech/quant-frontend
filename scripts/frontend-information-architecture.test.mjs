import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const files = {
  app: readFileSync(join(here, "../src/App.tsx"), "utf8"),
  portfolioList: readFileSync(join(here, "../src/pages/PortfolioManagement.tsx"), "utf8"),
  portfolioNew: readFileSync(join(here, "../src/pages/PortfolioNew.tsx"), "utf8"),
  portfolioDetail: readFileSync(join(here, "../src/pages/PortfolioDetail.tsx"), "utf8"),
  strategyList: readFileSync(join(here, "../src/pages/StrategyList.tsx"), "utf8"),
  runtime: readFileSync(join(here, "../src/pages/RuntimeManagement.tsx"), "utf8"),
  runtimeCredentials: readFileSync(join(here, "../src/pages/RuntimeCredentials.tsx"), "utf8"),
  marketData: readFileSync(join(here, "../src/pages/MarketData.tsx"), "utf8"),
  sessionDetail: readFileSync(join(here, "../src/pages/SessionDetailPage.tsx"), "utf8"),
  sessionManagement: readFileSync(join(here, "../src/pages/SessionManagement.tsx"), "utf8"),
  orderHistory: readFileSync(join(here, "../src/pages/OrderHistory.tsx"), "utf8"),
  runtimeSelector: readFileSync(join(here, "../src/components/RuntimeSelector.tsx"), "utf8"),
  runtimeInstallInstructions: readFileSync(join(here, "../src/components/RuntimeInstallInstructions.tsx"), "utf8"),
  infiniteTable: readFileSync(join(here, "../src/components/InfiniteTable.tsx"), "utf8"),
  asyncSelect: readFileSync(join(here, "../src/components/AsyncSelect.tsx"), "utf8"),
  orderTree: readFileSync(join(here, "../src/components/OrderTree.tsx"), "utf8"),
  api: readFileSync(join(here, "../src/api/client.ts"), "utf8"),
  venueManagement: readFileSync(join(here, "../src/pages/VenueManagement.tsx"), "utf8"),
  asyncSelectPagination: readFileSync(join(here, "../src/utils/asyncSelectPagination.ts"), "utf8"),
};

assert.equal(files.app.includes("UsersRound"), true, "Portfolio nav should use a multi-user icon");

const navOrder = [
  "Portfolio Management",
  "Strategy Management",
  "Market Data",
  "Runtime Management",
  "Session Management",
  "Order History",
  "Notification Management",
].map((label) => files.app.indexOf(label));
assert.equal(navOrder.every((idx) => idx >= 0), true, "All primary nav labels must exist");
assert.deepEqual([...navOrder].sort((a, b) => a - b), navOrder, "Primary nav should follow the product workflow order");

assert.equal(files.api.includes("description?: string"), true, "Portfolio API type should expose optional description");
assert.equal(files.portfolioNew.includes("Description"), true, "Create Portfolio should include a description field");
assert.equal(files.portfolioNew.includes("Portfolio environment"), true, "Create Portfolio should choose only the portfolio environment");
for (const token of [
  "Create simulated Binance",
  "Spot wallet",
  "Futures wallet",
  "body.spot",
  "body.futures",
  "Portfolio stores the environment",
]) {
  assert.equal(files.portfolioNew.includes(token), false, `Create Portfolio must not configure portfolio-level wallet or venue semantics: ${token}`);
}
assert.equal(files.portfolioList.includes("portfolioEnvironmentLabel"), true, "Portfolio list should render readable environment labels");
assert.equal(files.portfolioList.includes('"Description"'), true, "Portfolio list should show Description column");
assert.equal(files.portfolioList.includes("<th>Action</th>"), false, "Portfolio list should not show an Action column");
assert.equal(files.portfolioList.includes(">View</Link>"), false, "Portfolio list should not use a separate View link");

assert.equal(files.strategyList.includes(">View</Link>"), false, "Strategy list should not use a separate View link");

assert.equal(files.runtime.includes("runtime-create-section"), true, "Runtime create tab should use consistent create sections");
assert.equal(files.runtime.includes('createTitle="Self-hosted runtime"'), true, "Runtime create tab should name the self-hosted create section");
assert.equal(files.runtimeCredentials.includes("runtime-create-section"), true, "Self-hosted runtime title should live inside its own create section");
assert.equal(files.runtimeCredentials.includes("RuntimeInstallInstructions"), true, "Issued credential banner should show reusable runtime install instructions");
assert.equal(files.runtime.includes("RuntimeInstallInstructions"), true, "Runtime detail should expose reusable install instructions for self-hosted runtimes");
assert.equal(files.runtime.includes("Install instructions"), true, "Runtime detail should let users reopen install instructions");
for (const token of [
  'type RuntimeDetailTab = "overview" | "connection" | "debugging" | "sessions" | "live_delivery"',
  "runtimeDetailTabs",
  "Overview",
  "Connection",
  "Debugging",
  "Sessions",
  "Live Delivery",
]) {
  assert.equal(files.runtime.includes(token), true, `Runtime detail should use tabbed sections: ${token}`);
}
for (const token of ["Start container", "Run inside container", "hushine-debug replay", "--wait"]) {
  assert.equal(files.runtimeInstallInstructions.includes(token), true, `Runtime install instructions should include ${token}`);
}

assert.equal(files.orderTree.includes("portfolio_id?: number"), true, "Order tree should accept portfolio id metadata");
assert.equal(files.orderTree.includes("session_id?: string"), true, "Order tree should accept session id metadata");
assert.equal(files.orderTree.includes("/portfolios/${intent.portfolio_id}/sessions/${intent.session_id}"), true, "Order rows should link to source session");

for (const token of [
  'type PortfolioDetailTab = "portfolio" | "run" | "debug" | "sessions" | "venues"',
  "Portfolio",
  "Run Strategy",
  "Local Debug",
  "Sessions",
  "Venues",
]) {
  assert.equal(files.portfolioDetail.includes(token), true, `Portfolio detail should include ${token}`);
}
assert.equal(files.portfolioDetail.includes("SessionPanel portfolioId"), true, "Portfolio detail should keep session inspection as a tab panel");
assert.equal(files.portfolioDetail.includes("View reconciliation"), false, "Portfolio detail should not keep the old reconciliation shortcut panel");
assert.equal(files.venueManagement.includes("credential_info: requiresCredentials ?"), false, "Venue create payload must not send empty credential_info for backtest venues");
assert.equal(files.venueManagement.includes("api_key: requiresCredentials ?"), false, "Venue create payload must not send empty api_key for backtest venues");
assert.equal(files.venueManagement.includes('environment === "backtest" && !portfolioID'), false, "Venue create form must allow unbound backtest venues");
assert.equal(files.venueManagement.includes('placeholder="Leave unbound"'), true, "Venue create form should present venue binding as optional");
assert.equal(files.venueManagement.includes("applyBacktestWalletPayload"), true, "Venue create form must attach backtest wallet bootstrap to venue payload");
assert.equal(files.venueManagement.includes("Spot wallet"), true, "Venue create form must expose backtest spot wallet bootstrap");
assert.equal(files.venueManagement.includes("Futures wallet"), true, "Venue create form must expose backtest futures wallet bootstrap");
assert.equal(files.venueManagement.includes("Synthetic"), true, "Venue management should label synthetic backtest keys");
assert.equal(files.portfolioDetail.includes("Synthetic"), true, "Portfolio detail should label synthetic backtest keys");

for (const token of [
  'type SessionDetailTab = "chart" | "snapshots" | "reconciliation" | "orders" | "lifecycle"',
  "SessionDetailTab",
  "PageTabs",
  "Chart",
  "Lifecycle Events",
]) {
  assert.equal(files.sessionDetail.includes(token), true, `Session detail should use tabs: ${token}`);
}
assert.equal(files.sessionDetail.includes("SectionHeader"), false, "Session detail should not use collapsible section headers");

for (const [name, content] of [
  ["Session Management", files.sessionManagement],
  ["Order History", files.orderHistory],
  ["Runtime Selector", files.runtimeSelector],
]) {
  assert.equal(content.includes("AsyncSelect"), true, `${name} should use async paged select controls for large option sets`);
}
assert.equal(files.asyncSelectPagination.includes("collectFilteredPage"), true, "AsyncSelect client-side filtering should use a cross-page pagination helper");
for (const [name, content] of [
  ["Venue Management", files.venueManagement],
  ["Portfolio Detail", files.portfolioDetail],
  ["Session Management", files.sessionManagement],
  ["Order History", files.orderHistory],
  ["Runtime Selector", files.runtimeSelector],
]) {
  assert.equal(content.includes("collectFilteredPage"), true, `${name} should not filter only the current backend page in AsyncSelect loaders`);
}

for (const [name, content] of [
  ["Portfolio Management", files.portfolioList],
  ["Strategy Management", files.strategyList],
  ["Runtime Management", files.runtime],
  ["Runtime Credentials", files.runtimeCredentials],
  ["Session Management", files.sessionManagement],
  ["Market Data", files.marketData],
]) {
  assert.equal(content.includes("InfiniteTable"), true, `${name} should use infinite scroll table loading`);
}

for (const token of [
  "listPortfoliosPage",
  "listStrategiesPage",
  "listSessionsPage",
  "listRuntimeCredentialsPage",
  "listMarketDataRequestsPage",
]) {
  assert.equal(files.api.includes(token), true, `API client should expose ${token}`);
}

assert.equal(files.asyncSelect.includes("loadPage"), true, "AsyncSelect should load options page by page");
assert.equal(files.infiniteTable.includes("loadPage"), true, "InfiniteTable should load rows page by page");
