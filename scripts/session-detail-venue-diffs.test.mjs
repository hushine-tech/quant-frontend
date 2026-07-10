import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src/pages/SessionDetailPage.tsx"), "utf8");

assert.match(
  source,
  /type\s+VenueReconciliationDiff\s*=/,
  "Session detail should model venue-scoped reconciliation diffs.",
);
assert.match(
  source,
  /function\s+parseVenueDiffs\s*\(/,
  "Session detail should parse venue_diffs_json instead of rendering it only as raw JSON.",
);
assert.match(
  source,
  /function\s+VenueDiffSections\s*\(/,
  "Session detail should render venue diffs in grouped sections.",
);
assert.match(
  source,
  /function\s+reconciliationRunCounts\s*\(/,
  "Session detail should compute run counts from venue diffs.",
);
assert.match(
  source,
  /venueScopeLabel/,
  "Venue diff sections should show an explicit venue/exchange/market/environment scope.",
);
assert.doesNotMatch(
  source,
  /Portfolio aggregate hard \+ soft diffs/,
  "Session detail should not render portfolio aggregate reconciliation diffs.",
);
assert.doesNotMatch(
  source,
  /portfolioAggregateDiffs/,
  "Session detail should not keep portfolio aggregate diff filtering code once reconciliation is venue-only.",
);
assert.doesNotMatch(
  source,
  /run\.hard_fail_count|run\.soft_fail_count|run\.advisory_count/,
  "Session detail should not display portfolio-level diff counts.",
);
assert.match(
  source,
  /<VenueDiffSections raw=\{run\.venue_diffs_json \|\| "\[\]"\} \/>/,
  "Expanded reconciliation rows should include the venue-scoped diff sections.",
);

console.log("session detail venue diff display checks passed");
