import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/SessionDetailPage.tsx"), "utf8");

assert.equal(
  source.includes("const loadReconciliationSummary = useCallback"),
  true,
  "Session detail should expose an explicit reconciliation summary reload callback",
);

assert.equal(
  source.includes("if (tab === \"snapshots\") {") && source.includes("snapshotsState.reload();"),
  true,
  "Switching to the Snapshots tab should fetch a fresh current page, not just reuse cached lazy data",
);

assert.equal(
  source.includes("if (tab === \"reconciliation\") {") && source.includes("runsState.reload();"),
  true,
  "Switching to the Reconciliation tab should fetch a fresh current page, not just reuse cached lazy data",
);

assert.equal(
  source.includes("void loadReconciliationSummary();"),
  true,
  "Switching to the Reconciliation tab should refresh the session-wide reconciliation summary",
);
