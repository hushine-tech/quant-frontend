import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/PortfolioDetail.tsx"), "utf8");

assert.match(source, /placeholder="Select venue"/, "Portfolio detail should keep Select venue as the closed control placeholder");
assert.match(
  source,
  /placeholder="Select venue"[\s\S]*?searchPlaceholder="Search venue name, ID, or API key"[\s\S]*?allowClear=\{false\}/,
  "Portfolio detail venue selector should not render Select venue as a dropdown clear option",
);
assert.doesNotMatch(
  source,
  /placeholder="Select venue"[\s\S]*?searchPlaceholder="Search venue name, ID, or API key"[\s\S]*?\n\s*allowClear\s*\n/,
  "Portfolio detail venue selector must not use bare allowClear",
);

console.log("portfolio detail venue selector checks passed");
