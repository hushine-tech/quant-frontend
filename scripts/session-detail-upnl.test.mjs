import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/SessionDetailPage.tsx"), "utf8");

assert.match(
  source,
  /function\s+snapshotUnrealizedPnl\s*\(/,
  "Session detail should parse UPnL from snapshot futures JSON.",
);

assert.match(
  source,
  /total_unrealized_pnl/,
  "Session detail should prefer futures.total_unrealized_pnl when present.",
);

assert.match(
  source,
  /unrealized_pnl/,
  "Session detail should fall back to futures.unrealized_pnl.",
);

assert.match(
  source,
  /upnl:\s*snapshotUnrealizedPnl\(finalSnap\)/,
  "Headline PnL summary should carry latest-snapshot UPnL.",
);

assert.match(
  source,
  />UPnL</,
  "Session detail summary should render a UPnL tile.",
);

assert.match(
  source,
  /UPnL:\s*\{formatSignedNumber\(snapshotUnrealizedPnl\(snap\)\)\}/,
  "Snapshot rows should show UPnL beside TV and WB.",
);

console.log("session detail UPnL checks passed");
