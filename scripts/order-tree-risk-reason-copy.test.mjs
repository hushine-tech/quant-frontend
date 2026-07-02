import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/components/OrderTree.tsx"), "utf8");

assert.equal(
  source.includes("Minimum notional must be at least"),
  true,
  "MIN_NOTIONAL_VIOLATION should explain the minimum notional in English",
);

assert.equal(
  source.includes("current order notional is"),
  true,
  "MIN_NOTIONAL_VIOLATION should include the current notional in English",
);

assert.equal(
  source.includes("Failure reason:"),
  true,
  "Order rows should label the failure reason in English",
);

assert.equal(
  source.includes("失败原因："),
  false,
  "Order rows should not label the failure reason in Chinese",
);

assert.equal(
  source.includes("最小成交名义金额"),
  false,
  "Risk reason copy should not include Chinese minimum-notional text",
);
