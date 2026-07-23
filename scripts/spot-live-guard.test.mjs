import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PRODUCT_CAPABILITY_NAMES,
  normalizeProductCapabilities,
  strategySpotCapabilityDecision,
} from "../src/api/client.ts";
import { strategyDeclaresSpot } from "../src/utils/strategyDeclarations.ts";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/PortfolioDetail.tsx"), "utf8");

const allFalse = normalizeProductCapabilities([]);
for (const name of PRODUCT_CAPABILITY_NAMES) {
  assert.equal(allFalse.states[name].configured, false);
  assert.equal(allFalse.states[name].effective, false);
}

for (const enabledName of PRODUCT_CAPABILITY_NAMES) {
  const capabilities = normalizeProductCapabilities([{
    name: enabledName,
    configured: true,
    effective: true,
    reason: "",
  }]);
  for (const name of PRODUCT_CAPABILITY_NAMES) {
    assert.equal(capabilities.states[name].effective, name === enabledName, `${enabledName} must not enable ${name}`);
  }
}

const discoveryFailure = normalizeProductCapabilities(null, true);
assert.equal(discoveryFailure.discovery_failed, true);
for (const name of PRODUCT_CAPABILITY_NAMES) {
  assert.equal(discoveryFailure.states[name].effective, false, "discovery failure must fail closed");
}

const spotPreview = {
  profile: "demo",
  supported: true,
  ok: true,
  failures: [],
  required_streams: [],
  declared_inputs: [{ exchange: "binance", market: "spot", symbol: "BTCUSDT", interval: "1m" }],
};
const futuresPreview = {
  ...spotPreview,
  declared_inputs: [{ exchange: "binance", market: "perpetual_futures", symbol: "BTCUSDT", interval: "1m" }],
};

assert.equal(strategyDeclaresSpot(`INPUTS = [{"exchange": Exchange.BINANCE, "market": Market.SPOT, "symbol": "BTCUSDT", "interval": "1m"}]`), true);
assert.equal(strategyDeclaresSpot(`INPUTS = [{"exchange": "binance", "market": "perpetual_futures", "symbol": "BTCUSDT", "interval": "1m"}]`), false);

assert.equal(strategySpotCapabilityDecision(futuresPreview, 1, "run", allFalse).enabled, true, "Futures ignores Spot flags");
assert.equal(strategySpotCapabilityDecision(spotPreview, 1, "run", allFalse).enabled, false);
const liveConfigured = normalizeProductCapabilities([{
  name: "live_spot_usdt",
  configured: true,
  effective: false,
  reason: "SPOT_LIVE_ROLLOUT_GUARD",
}]);
const liveDecision = strategySpotCapabilityDecision(spotPreview, 2, "run", liveConfigured);
assert.equal(liveDecision.enabled, false);
assert.equal(liveDecision.code, "SPOT_LIVE_ROLLOUT_GUARD");

assert.match(source, /getProductCapabilities/, "Portfolio page must load effective capabilities");
assert.match(source, /SPOT_LIVE_ROLLOUT_GUARD/, "Live Spot must show the rollout guard");
assert.match(source, /environment\s*===\s*2/, "Live environment must be guarded explicitly");
assert.match(source, /Stop Session/, "running Sessions must retain drain controls when start is disabled");

console.log("spot capability guard contracts passed");
