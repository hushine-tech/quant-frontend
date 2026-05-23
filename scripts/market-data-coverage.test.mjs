import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/MarketData.tsx"), "utf8");

for (const token of [
  "Historical Coverage",
  "Live Streams",
  "Request Live Streams",
  "CoverageTimeline",
  "Coverage Timeline",
  "<svg",
  "queryMarketDataCoverage",
  "Download gap",
]) {
  assert.equal(source.includes(token), true, `Market Data page should include ${token}`);
}

assert.equal(
  source.includes("Request Market Data"),
  false,
  "Market Data should not render a duplicate header-level request entry",
);

assert.equal(
  source.includes("Push finalized bars to Kafka live delivery"),
  false,
  "Live stream requests should always enable Kafka delivery instead of exposing a checkbox",
);

assert.equal(
  source.includes("needs_live_delivery: true"),
  true,
  "Live stream requests should default to Kafka live delivery",
);
