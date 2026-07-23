import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { exactDecimalText } from "../src/api/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(here, "../src/api/client.ts"), "utf8");
const session = readFileSync(join(here, "../src/pages/SessionDetailPage.tsx"), "utf8");

const beyondBinaryFloat = "9007199254740993.00000000";
assert.equal(exactDecimalText(beyondBinaryFloat, 9007199254740992), beyondBinaryFloat);
assert.equal(exactDecimalText("0.00000001", 1e-8), "0.00000001");
assert.equal(exactDecimalText(undefined, 12.5), "12.5");

for (const field of [
  "requested_qty_decimal",
  "requested_price_decimal",
  "orig_qty_decimal",
  "executed_qty_decimal",
  "remaining_qty_decimal",
  "avg_price_decimal",
  "price_decimal",
  "qty_decimal",
  "fill_price_decimal",
  "fee_decimal",
  "quote_qty_decimal",
  "fee_asset",
]) {
  assert.match(client, new RegExp(`\\b${field}\\??:\\s*string`), `${field} must remain a string in the client contract`);
  assert.match(session, new RegExp(`\\.${field}\\b`), `${field} must be rendered from the exact API field`);
}

for (const field of ["code", "environment", "retryable", "source", "filter_type"]) {
  assert.match(client, new RegExp(`\\b${field}\\??:`), `structured failure must retain ${field}`);
  assert.match(session, new RegExp(`\\.${field}\\b`), `Session detail must render ${field}`);
}

assert.doesNotMatch(session, /(?:Number|parseFloat)\([^)]*_(?:qty|price|fee)_decimal/, "exact decimals must never be coerced to Number");

console.log("spot exact decimal contracts passed");
