import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => readFileSync(join(here, "..", relativePath), "utf8");

const componentPath = "src/components/QuickStartActionButton.tsx";
assert.equal(existsSync(join(here, "..", componentPath)), true, "Quick Start action button component should exist");
const component = read(componentPath);
const css = read("src/index.css");
const returnTo = read("src/utils/returnTo.ts");

assert.match(component, /Rocket/, "Quick Start action button should use a rocket icon");
assert.match(component, />Use</, "Quick Start action button should show the normal Use label");
assert.doesNotMatch(component, />Quick Start</, "Quick Start action button should not show Quick Start as visible label");
assert.match(component, /quick-start-action-button/, "Quick Start action button should use its own CSS class");
assert.match(css, /\.quick-start-action-button[\s\S]*background:\s*#dcfce7/, "Quick Start action button should have a light green background");
assert.match(css, /\.quick-start-action-button[\s\S]*color:\s*#166534/, "Quick Start action button should use dark green text");
assert.match(returnTo, /function isQuickStartReturnTo/, "returnTo utility should detect Quick Start return targets");

for (const file of [
  "src/pages/PortfolioManagement.tsx",
  "src/pages/VenueManagement.tsx",
  "src/pages/PortfolioDetail.tsx",
  "src/pages/RuntimeManagement.tsx",
]) {
  const source = read(file);
  assert.match(source, /QuickStartActionButton/, `${file} should render QuickStartActionButton in Quick Start selection mode`);
  assert.match(source, /isQuickStartReturnTo/, `${file} should only use the green CTA for Quick Start return targets`);
}

console.log("quick start return CTA checks passed");
