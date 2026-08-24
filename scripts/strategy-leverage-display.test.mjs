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
  activeStrategyMatchesSession,
  downloadRunJobStrategyResult,
  strategyStartNavigationState,
  strategyStartResultFromNavigationState,
} from "../src/api/client.ts";
import { createSingleFlightGuard } from "../src/utils/singleFlight.ts";

const here = dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(join(here, "../src/api/client.ts"), "utf8");
const portfolioDetail = readFileSync(join(here, "../src/pages/PortfolioDetail.tsx"), "utf8");
const sessionDetail = readFileSync(join(here, "../src/pages/SessionDetailPage.tsx"), "utf8");

assert.equal(clientSource.includes("withoutLegacyLeverage"), false);
assert.equal(clientSource.includes("Legacy session value"), false);
assert.equal(clientSource.includes("Historical session"), false);

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

assert.deepEqual(
  strategyLeverageDisplayFact({
    exchange: "binance",
    market: "perpetual_futures",
    symbol: "SOLUSDT",
    effective_leverage: 1,
    leverage_source: "platform_default",
    change_required: false,
    leverage_status: "not_applicable",
  }),
  {
    symbol: "SOLUSDT",
    effective: "1x",
    source: "Platform default",
    current: "Current: unavailable",
    change: "not applicable",
  },
  "Futures read/apply status should remain observable instead of being collapsed to no change",
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
});
assert.deepEqual(durable, [{ symbol: "BTCUSDT", leverage: "5x", source: "Strategy default" }]);
assert.deepEqual(sessionLeverageDisplayFacts({ target_leverage_facts: [] }), [], "sessions without target facts must not invent session-wide leverage");

const originalStrategy = { strategy: { strategy_id: 12 }, active: true };
assert.equal(activeStrategyMatchesSession([originalStrategy], 12), true);
assert.equal(activeStrategyMatchesSession([originalStrategy], 13), false, "resume preview must fail closed when the active strategy is not the Session strategy");

const terminalJob = {
  job_id: "job-1",
  status: "error",
  progress: 1,
  session_id: "",
  failures: [{ kind: "leverage", reason: "rollback mismatch", code: "LEVERAGE_ROLLBACK_FAILED", environment: 1, retryable: true }],
  target_results: [{ venue_id: 8, exchange: 1, market: 2, symbol: "ETHUSDT", effective_leverage: 10, leverage_source: "order_target", change_required: true, status: "rollback_failed", retryable: true }],
  code: "LEVERAGE_ROLLBACK_FAILED",
  rollback_failed: true,
  created_at: "2026-08-23T00:00:00Z",
  updated_at: "2026-08-23T00:00:01Z",
};
assert.deepEqual(downloadRunJobStrategyResult(terminalJob), {
  session_id: "",
  ok: false,
  failures: terminalJob.failures,
  target_results: terminalJob.target_results,
  code: "LEVERAGE_ROLLBACK_FAILED",
  rollback_failed: true,
}, "download job terminal details must remain displayable");

const resumed = { session_id: "new-session", ok: true, failures: [], target_results: terminalJob.target_results, code: "", rollback_failed: false };
const navigationState = strategyStartNavigationState(resumed);
assert.deepEqual(strategyStartResultFromNavigationState(navigationState, "new-session"), resumed);
assert.equal(strategyStartResultFromNavigationState(navigationState, "different-session"), null, "navigation result must not leak across Session identity changes");

const guard = createSingleFlightGuard();
assert.equal(guard.tryAcquire(), true);
assert.equal(guard.tryAcquire(), false, "same-tick duplicate download-and-run submission must be rejected synchronously");
assert.equal(guard.active(), true);
guard.release();
assert.equal(guard.tryAcquire(), true, "terminal completion should release the guard");
guard.release();

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
  await previewRunStrategy(7, { runtime_id: "rt-1", start_time_ms: 100, end_time_ms: 200, max_loss_close_pct: 0.3 });
  await runStrategy(7, { strategy_path: "", interval: "1m", runtime_id: "rt-1", max_loss_close_pct: 0.3 });
  await startDownloadAndRunBacktest(7, { interval: "1m", start_time_ms: 1, end_time_ms: 2, runtime_id: "rt-1", max_loss_close_pct: 0.3 });
} finally {
  globalThis.fetch = originalFetch;
  setToken(null);
}
for (const request of requests) {
  assert.equal("leverage" in request.body, false, `${request.input} must use the target-only request shape`);
  assert.equal(request.body.max_loss_close_pct, 0.3, `${request.input} must preserve max-loss semantics`);
}
assert.equal(requests[0].body.start_time_ms, 100, "read-only Backtest/Resume preview must preserve the Session time range");
assert.equal(requests[0].body.end_time_ms, 200, "read-only Backtest/Resume preview must preserve the Session time range");

for (const [name, source] of [["PortfolioDetail", portfolioDetail], ["SessionDetailPage", sessionDetail]]) {
  assert.equal(source.includes("<span>Leverage (x)</span>"), false, `${name} must have no editable leverage input`);
  assert.equal(source.includes("parseSessionLeverage"), false, `${name} must have no leverage parser`);
}
assert.equal(portfolioDetail.includes("strategyLeverageDisplayFact"), true, "Portfolio preview should render strategy-owned target facts");
assert.equal(portfolioDetail.includes("startSubmissionInFlightRef"), true, "start submission should be single-flight while leverage is applying");
assert.equal(portfolioDetail.includes("resumeSubmissionInFlightRef"), true, "Portfolio resume should be single-flight while leverage is applying");
assert.equal(sessionDetail.includes("resumeSubmissionInFlightRef"), true, "Session-detail resume should be single-flight while leverage is applying");
assert.equal(portfolioDetail.includes("useResumeStrategyPreview"), true, "Portfolio resume must use the read-only strategy preview lifecycle");
assert.equal(sessionDetail.includes("useResumeStrategyPreview"), true, "Session-detail resume must use the read-only strategy preview lifecycle");
assert.equal(portfolioDetail.includes("downloadSubmissionGuardRef"), true, "download-and-run must hold a synchronous guard through terminal completion");
assert.equal(sessionDetail.includes("strategyStartResultFromNavigationState"), true, "Session detail should render navigation-carried leverage results until durable facts load");
assert.equal(portfolioDetail.includes("rollback_failed"), true, "start result UI should preserve rollback failure state");
assert.equal(sessionDetail.includes("sessionLeverageDisplayFacts"), true, "Session detail should render durable target facts");

console.log("strategy-owned leverage display contract checks passed");
