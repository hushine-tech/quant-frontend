import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const accountDetail = readFileSync(join(here, "../src/pages/AccountDetail.tsx"), "utf8");
const dialog = readFileSync(join(here, "../src/components/RuntimeSelectionDialog.tsx"), "utf8");
const client = readFileSync(join(here, "../src/api/client.ts"), "utf8");

for (const token of [
  "previewBacktestCoverage",
  "COVERAGE_PREVIEW_TIMEOUT_MS",
  "AbortController",
  "Download data and run backtest",
  "Direct run is disabled until the full range is available.",
  "confirmDisabled",
  "startDownloadAndRunBacktest",
  "parseDateTimeLocalMs",
]) {
  assert.equal(
    accountDetail.includes(token) || dialog.includes(token) || client.includes(token),
    true,
    `Backtest coverage gate should include ${token}`,
  );
}

assert.equal(
  accountDetail.includes('new Date(startTime + ":00Z")'),
  false,
  "datetime-local inputs must be interpreted as the user's local time, not forced to UTC",
);
