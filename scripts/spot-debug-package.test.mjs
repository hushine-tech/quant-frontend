import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDebugPackageRequest } from "../src/api/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(here, "../src/api/client.ts"), "utf8");
const portfolio = readFileSync(join(here, "../src/pages/PortfolioDetail.tsx"), "utf8");

assert.deepEqual(buildDebugPackageRequest(42, "rt-debug", 1000, 2000), {
  strategy_id: 42,
  runtime_id: "rt-debug",
  start_time_ms: 1000,
  end_time_ms: 2000,
});

const requestType = client.match(/export type DebugPackageRequest = \{([\s\S]*?)\n\};/)?.[1] ?? "";
for (const field of ["strategy_id", "runtime_id", "start_time_ms", "end_time_ms"]) {
  assert.match(requestType, new RegExp(`\\b${field}\\b`));
}
for (const forbidden of ["market", "symbol", "interval", "wallet_source", "initial_balance", "api_key", "credential"] ) {
  assert.doesNotMatch(requestType, new RegExp(`\\b${forbidden}\\b`), `caller must not author ${forbidden}`);
}
assert.match(portfolio, /activeStrategy/, "debug package UI must use the selected active strategy");
assert.match(portfolio, /getStrategy\(active\.strategy\.strategy_id\)/, "debug package UI must load the full active strategy because mounted-list rows omit source");
assert.match(portfolio, /RuntimeSelector/, "debug package UI must select a runtime");
assert.match(portfolio, /buildDebugPackageRequest/, "debug package body must be built from the four-field contract");
assert.doesNotMatch(portfolio, /market:\s*["']perpetual_futures["']/, "debug package UI must not hardcode Futures routes");

console.log("spot debug package contracts passed");
