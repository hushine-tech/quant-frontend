import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  previewRunStrategy,
  runStrategy,
  setToken,
  startDownloadAndRunBacktest,
  strategyLeverageDisplayFact,
  sessionLeverageDisplayFacts,
} from "../src/api/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const portfolioDetail = readFileSync(join(here, "../src/pages/PortfolioDetail.tsx"), "utf8");
const sessionDetail = readFileSync(join(here, "../src/pages/SessionDetailPage.tsx"), "utf8");

assert.deepEqual(
  strategyLeverageDisplayFact({
    exchange: "binance",
    market: "perpetual_futures",
    symbol: "BTCUSDT",
    effective_leverage: 5,
    leverage_source: "strategy_default",
    current_leverage: 3,
    change_required: true,
    leverage_status: "change_required",
  }),
  {
    symbol: "BTCUSDT",
    effective: "5x",
    source: "Strategy default",
    current: "Current: 3x",
    change: "Will change on start",
  },
  "Futures preview presentation should preserve target facts and label their source",
);

assert.deepEqual(
  strategyLeverageDisplayFact({
    exchange: "binance",
    market: "perpetual_futures",
    symbol: "ETHUSDT",
    effective_leverage: 10,
    leverage_source: "order_target",
    current_leverage: 10,
    change_required: false,
    leverage_status: "unchanged",
  }),
  {
    symbol: "ETHUSDT",
    effective: "10x",
    source: "Target override",
    current: "Current: 10x",
    change: "No change",
  },
  "unchanged Futures targets should be explicit",
);

assert.equal(
  strategyLeverageDisplayFact({
    exchange: "binance",
    market: "spot",
    symbol: "ZECUSDT",
    effective_leverage: 99,
    leverage_source: "order_target",
    current_leverage: 1,
    change_required: true,
    leverage_status: "change_required",
  }),
  null,
  "Spot targets must never produce a leverage display",
);

const durable = sessionLeverageDisplayFacts({
  target_leverage_facts: [{
    venue_id: 8,
    exchange: 1,
    environment: 1,
    market: 2,
    symbol: "BTCUSDT",
    effective_leverage: 5,
    leverage_source: "strategy_default",
    previous_leverage: 3,
    confirmed_leverage: 5,
    confirmed_at: "2026-08-23T01:02:03Z",
    created_at: "2026-08-23T01:02:03Z",
  }],
  leverage: 99,
});
assert.deepEqual(durable, [{ symbol: "BTCUSDT", leverage: "5x", source: "Strategy default", historical: false }]);

const historical = sessionLeverageDisplayFacts({ target_leverage_facts: [], leverage: 7 });
assert.deepEqual(historical, [{ symbol: "Historical session", leverage: "7x", source: "Legacy session value", historical: true }]);

setToken("strategy-leverage-test-token");
const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (input, init = {}) => {
  requests.push({ input: String(input), body: JSON.parse(init.body ?? "{}") });
  return new Response(JSON.stringify({ session_id: "session-1", ok: true, target_results: [], failures: [], code: "", rollback_failed: false, job_id: "job-1", status: "ready" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
try {
  await previewRunStrategy(7, { runtime_id: "rt-1", max_loss_close_pct: 0.3, leverage: 25 });
  await runStrategy(7, { strategy_path: "", interval: "1m", runtime_id: "rt-1", max_loss_close_pct: 0.3, leverage: 25 });
  await startDownloadAndRunBacktest(7, { interval: "1m", start_time_ms: 1, end_time_ms: 2, runtime_id: "rt-1", max_loss_close_pct: 0.3, leverage: 25 });
} finally {
  globalThis.fetch = originalFetch;
  setToken(null);
}
for (const request of requests) {
  assert.equal("leverage" in request.body, false, `${request.input} must strip legacy leverage from new frontend requests`);
  assert.equal(request.body.max_loss_close_pct, 0.3, `${request.input} must preserve max-loss semantics`);
}

for (const [name, source] of [["PortfolioDetail", portfolioDetail], ["SessionDetailPage", sessionDetail]]) {
  assert.equal(source.includes("<span>Leverage (x)</span>"), false, `${name} must have no editable leverage input`);
  assert.equal(source.includes("parseSessionLeverage"), false, `${name} must have no leverage parser`);
}
assert.equal(portfolioDetail.includes("strategyLeverageDisplayFact"), true, "Portfolio preview should render strategy-owned target facts");
assert.equal(portfolioDetail.includes("startSubmissionInFlightRef"), true, "start submission should be single-flight while leverage is applying");
assert.equal(portfolioDetail.includes("resumeSubmissionInFlightRef"), true, "Portfolio resume should be single-flight while leverage is applying");
assert.equal(sessionDetail.includes("resumeSubmissionInFlightRef"), true, "Session-detail resume should be single-flight while leverage is applying");
assert.equal(portfolioDetail.includes("rollback_failed"), true, "start result UI should preserve rollback failure state");
assert.equal(sessionDetail.includes("sessionLeverageDisplayFacts"), true, "Session detail should prefer durable target facts and use historical fallback only when absent");

console.log("strategy-owned leverage display contract checks passed");
