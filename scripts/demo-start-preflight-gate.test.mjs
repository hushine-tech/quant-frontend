import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/PortfolioDetail.tsx"), "utf8");

assert.equal(
  source.includes("const strategyStartPreflightReady ="),
  true,
  "PortfolioDetail should track whether the selected strategy start preflight has passed",
);

assert.equal(
  source.includes("!strategyStartPreflightReady"),
  true,
  "RuntimeSelectionDialog should disable both Demo and Backtest start while preflight is not ready",
);

assert.equal(
  source.includes("const strategyDownloadPreflightReady ="),
  true,
  "download-and-run should have a readiness gate separate from direct strategy start",
);

assert.equal(
  /strategyStartPreview\.failures\.length > 0[\s\S]*?every\(\(failure\) => failure\.kind === "historical_data"\)/.test(source),
  true,
  "download-and-run may bypass only historical-data preflight failures",
);

assert.equal(
  /<BacktestCoverageGate[\s\S]*?startReady=\{strategyDownloadPreflightReady\}/.test(source),
  true,
  "download-and-run must use its historical-download-specific preflight gate",
);

assert.equal(
  source.includes("pendingStart?.startTimeMs") && source.includes("pendingStart?.endTimeMs"),
  true,
  "Backtest preflight should include the selected historical range",
);

assert.equal(
  /previewRunStrategy\(portfolioId,\s*\{[\s\S]*runtime_id: startRuntimeId/.test(source),
  true,
  "Demo preflight should call PreviewRunStrategy with the selected runtime",
);

const previewCall = source.match(/previewRunStrategy\(portfolioId,\s*\{([\s\S]*?)\}\);/)?.[1] ?? "";
assert.equal(
  previewCall.includes("leverage"),
  false,
  "Demo preflight must not send an editable leverage override",
);
