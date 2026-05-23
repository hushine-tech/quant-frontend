import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../src/index.css"), "utf8");
const component = readFileSync(join(here, "../src/components/FilterControls.tsx"), "utf8");

for (const token of [
  "FilterPanel",
  "FilterField",
  "filter-panel",
  "filter-field",
]) {
  assert.equal(component.includes(token), true, `FilterControls should include ${token}`);
}

for (const token of [
  ".filter-panel",
  "grid-template-columns: repeat(auto-fit",
  ".filter-field input",
  ".filter-field select",
  ".table-scroll th",
  "position: sticky",
]) {
  assert.equal(css.includes(token), true, `Shared layout CSS should include ${token}`);
}

const pages = {
  sessions: readFileSync(join(here, "../src/pages/SessionManagement.tsx"), "utf8"),
  orders: readFileSync(join(here, "../src/pages/OrderHistory.tsx"), "utf8"),
  marketData: readFileSync(join(here, "../src/pages/MarketData.tsx"), "utf8"),
  accountDetail: readFileSync(join(here, "../src/pages/AccountDetail.tsx"), "utf8"),
  runtimeManagement: readFileSync(join(here, "../src/pages/RuntimeManagement.tsx"), "utf8"),
};

for (const [name, source] of Object.entries(pages)) {
  assert.equal(
    source.includes("FilterField"),
    true,
    `${name} should use shared filter fields instead of page-local search styling`,
  );
}
