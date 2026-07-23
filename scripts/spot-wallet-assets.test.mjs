import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendCanonicalSpotAsset,
  canonicalSpotWalletAsset,
  defaultSpotWalletAssets,
} from "../src/api/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const venueSource = readFileSync(join(here, "../src/pages/VenueManagement.tsx"), "utf8");
const pickerSource = readFileSync(join(here, "../src/components/SymbolPicker.tsx"), "utf8");

assert.deepEqual(defaultSpotWalletAssets(), [
  { asset: "USDT", free: "0", locked: "0" },
]);

const btcMetadata = {
  symbol: "BTCUSDT",
  base_asset: "BTC",
  quote_asset: "USDT",
  status: "TRADING",
  spot_trading_allowed: true,
};
const btc = canonicalSpotWalletAsset(btcMetadata, false);
assert.deepEqual(btc, {
  asset: "BTC",
  free: "0",
  locked: "0",
  avg_entry_price: "0",
});
assert.equal(canonicalSpotWalletAsset(btcMetadata, true), null, "stale metadata must fail closed");
assert.equal(canonicalSpotWalletAsset({ ...btcMetadata, quote_asset: "BTC" }, false), null, "only USDT quote is supported");
assert.equal(canonicalSpotWalletAsset({ ...btcMetadata, status: "BREAK" }, false), null, "non-trading symbols must fail closed");
assert.equal(canonicalSpotWalletAsset({ ...btcMetadata, spot_trading_allowed: false }, false), null, "Spot-disabled symbols must fail closed");
assert.deepEqual(
  appendCanonicalSpotAsset(defaultSpotWalletAssets(), btcMetadata, false),
  [defaultSpotWalletAssets()[0], btc],
);
assert.deepEqual(
  appendCanonicalSpotAsset([defaultSpotWalletAssets()[0], btc], btcMetadata, false),
  [defaultSpotWalletAssets()[0], btc],
  "base assets must not be duplicated",
);

assert.match(venueSource, /entry\.base_asset/, "Venue editor must add metadata.base_asset, not symbol text");
assert.match(venueSource, /defaultSpotWalletAssets\(\)/, "Spot Backtest must always start with the USDT row");
assert.doesNotMatch(venueSource, /replace\([^)]*USDT/, "Venue editor must not derive assets by stripping a suffix");
assert.doesNotMatch(venueSource, /asset:\s*selectedSymbol/, "Venue editor must not store a trading symbol as an asset");
assert.match(pickerSource, /entries/, "SymbolPicker must return authoritative catalog metadata");

console.log("spot wallet asset contracts passed");
