import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const infiniteTable = readFileSync(join(here, "../src/components/InfiniteTable.tsx"), "utf8");
const asyncSelect = readFileSync(join(here, "../src/components/AsyncSelect.tsx"), "utf8");

for (const [name, source] of Object.entries({ InfiniteTable: infiniteTable, AsyncSelect: asyncSelect })) {
  assert.equal(source.includes("const loadPageRef = useRef(loadPage)"), true, `${name} should keep loadPage in a ref`);
  assert.equal(source.includes("loadPageRef.current = loadPage"), true, `${name} should refresh loadPage ref after render`);
  assert.equal(source.includes("loadPageRef.current("), true, `${name} should call the ref-backed loader`);
}

assert.equal(
  /\}, \[loadPage,\s*pageSize/.test(infiniteTable),
  false,
  "InfiniteTable load callback must not depend on loadPage identity",
);

assert.equal(
  /\}, \[loadPage,\s*pageSize/.test(asyncSelect),
  false,
  "AsyncSelect load callback must not depend on loadPage identity",
);
