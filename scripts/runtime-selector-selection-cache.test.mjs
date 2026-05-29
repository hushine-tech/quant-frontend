import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/components/RuntimeSelector.tsx"), "utf8");

assert.equal(
  source.includes("const rememberSelectedRuntime ="),
  true,
  "RuntimeSelector should cache a runtime selected from AsyncSelect's paged results",
);

assert.equal(
  source.includes("if (opt?.item) rememberSelectedRuntime(opt.item);"),
  true,
  "RuntimeSelector should remember the selected option before propagating onChange",
);
