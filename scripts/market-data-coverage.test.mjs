import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/MarketData.tsx"), "utf8");

for (const token of [
  "Historical Coverage",
  "Live Streams",
  "Requests",
  "CoverageTimeline",
  "Coverage Timeline",
  "<svg",
  "queryMarketDataCoverage",
  "Download gap",
]) {
  assert.equal(source.includes(token), true, `Market Data page should include ${token}`);
}
