import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/SessionDetailPage.tsx"), "utf8");

assert.equal(
  source.includes("Current status:"),
  true,
  "Session detail status label should be English",
);

assert.equal(
  source.includes("当前状态"),
  false,
  "Session detail should not render Chinese status copy in the English UI",
);
