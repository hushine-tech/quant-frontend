import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { strategyStreamKey } from "../src/api/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const portfolio = readFileSync(join(here, "../src/pages/PortfolioDetail.tsx"), "utf8");
const session = readFileSync(join(here, "../src/pages/SessionDetailPage.tsx"), "utf8");

const spot = strategyStreamKey({ exchange: "binance", market: "spot", symbol: "BTCUSDT", interval: "1m" });
const futures = strategyStreamKey({ exchange: "binance", market: "perpetual_futures", symbol: "BTCUSDT", interval: "1m" });
const slower = strategyStreamKey({ exchange: "binance", market: "spot", symbol: "BTCUSDT", interval: "5m" });
assert.notEqual(spot, futures, "market must participate in route identity");
assert.notEqual(spot, slower, "interval must participate in stream identity");
assert.equal(spot, "binance:spot:BTCUSDT:1m");

assert.match(portfolio, /strategyStreamKey/, "Portfolio route rendering must use the canonical key helper");
assert.match(session, /strategyStreamKey/, "Session route rendering must use the canonical key helper");
assert.doesNotMatch(portfolio, /key=\{[^}]*symbol[^}]*\}/, "symbol alone must not key mixed-market rows");

console.log("spot mixed-route contracts passed");
