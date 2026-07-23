import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractStrategyOrderTargets } from "../src/utils/strategyDeclarations.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dialog = readFileSync(join(here, "../src/components/StopSessionDialog.tsx"), "utf8");
const client = readFileSync(join(here, "../src/api/client.ts"), "utf8");
const portfolio = readFileSync(join(here, "../src/pages/PortfolioDetail.tsx"), "utf8");
const session = readFileSync(join(here, "../src/pages/SessionDetailPage.tsx"), "utf8");

assert.deepEqual(extractStrategyOrderTargets(`
ORDER_TARGETS = [
  {"exchange": Exchange.BINANCE, "market": Market.SPOT, "symbol": "BTCUSDT"},
  {"exchange": "binance", "market": "perpetual_futures", "symbol": "ETHUSDT"},
]
`), [
  { exchange: "binance", market: "spot", symbol: "BTCUSDT" },
  { exchange: "binance", market: "perpetual_futures", symbol: "ETHUSDT" },
]);

assert.match(client, /STOP_ACTION_STOP_ONLY/);
assert.match(client, /STOP_ACTION_STOP_AND_CLOSE_POSITIONS/);
assert.match(dialog, /declaredTargets/, "dialog must receive the strategy's declared order targets");
assert.match(dialog, /target\.exchange/);
assert.match(dialog, /target\.market/);
assert.match(dialog, /target\.symbol/);
assert.match(dialog, /pre-existing|existing\/manual/i, "Spot close warning must include pre-existing/manual holdings");
assert.match(dialog, /\bfree\b/i, "Spot close warning must identify free base-asset holdings");
assert.match(dialog, /open order/i);
assert.match(dialog, /locked/i);
assert.match(dialog, /dust/i);
assert.match(dialog, /abort.*entire batch|entire batch.*abort/i, "warning must explain fail-closed batch semantics");
assert.match(portfolio, /declaredTargets=/, "Portfolio stop dialog must receive declared targets");
assert.match(session, /declaredTargets=/, "Session detail stop dialog must receive declared targets");

console.log("spot stop dialog contracts passed");
