import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const quickStart = readFileSync(join(here, "../src/pages/QuickStart.tsx"), "utf8");
const runtimeManagement = readFileSync(join(here, "../src/pages/RuntimeManagement.tsx"), "utf8");

assert.doesNotMatch(
  quickStart,
  /tab:\s*hasRouteableRuntime\s*===\s*false\s*\?\s*"create"\s*:\s*undefined/,
  "Quick Start should not jump straight to the Create Runtime tab.",
);
assert.doesNotMatch(
  quickStart,
  /Create Runtime in Runtime Management/,
  "Quick Start runtime action should send users to Runtime Management selection, not pre-label it as create.",
);
assert.match(quickStart, /routeWithParams\("\/runtimes"/, "Quick Start should still route to Runtime Management.");
assert.match(quickStart, /eligible:\s*"session_start"/, "Quick Start should keep the session-start eligibility filter.");
assert.match(quickStart, /role:\s*"executor"/, "Quick Start should keep the executor role filter.");
assert.match(runtimeManagement, /Select a routeable executor runtime for this session/, "Runtime Management should carry the selection guidance.");
assert.match(runtimeManagement, /changeTab\("create"\)/, "Runtime Management should provide the create action from the selection page.");

console.log("quick start runtime routing checks passed");
