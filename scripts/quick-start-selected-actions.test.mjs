import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/QuickStart.tsx"), "utf8");
const css = readFileSync(join(here, "../src/index.css"), "utf8");

assert.match(source, /function SelectedAction/, "Quick Start should render selected setup steps as a non-link status action");
assert.match(source, /button-link--selected/, "Selected setup action should use a dedicated selected button style");

for (const [step, label] of [
  ["portfolioReady", "Portfolio Selected"],
  ["ready.venue", "Venue Selected"],
  ["ready.strategy", "Strategy Selected"],
  ["ready.runtime", "Runtime Selected"],
]) {
  assert.match(
    source,
    new RegExp(`${step} \\? <SelectedAction>${label}</SelectedAction>`),
    `${label} should replace the management link once that step has been selected`,
  );
}

assert.match(css, /\.button-link--selected/, "Selected action should have a green visual state");
assert.match(css, /\.button-link--selected[\s\S]*color:\s*#166534/, "Selected action should use the ready-step green text color");

console.log("quick start selected action checks passed");
