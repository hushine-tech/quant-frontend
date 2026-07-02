import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/AccountDetail.tsx"), "utf8");

assert.equal(
  source.includes("const demoStartPreflightReady ="),
  true,
  "AccountDetail should track whether demo start preflight has passed",
);

assert.equal(
  /pendingStart\?\.kind === "demo" && !demoStartPreflightReady/.test(source),
  true,
  "RuntimeSelectionDialog should disable demo start while preflight is not ready",
);

assert.equal(
  source.includes('pendingStart?.kind !== "demo"'),
  true,
  "AccountDetail should run demo preflight only for the demo start dialog",
);

assert.equal(
  /previewRunStrategy\(accountId,\s*\{[\s\S]*runtime_id: startRuntimeId/.test(source),
  true,
  "Demo preflight should call PreviewRunStrategy with the selected runtime",
);
