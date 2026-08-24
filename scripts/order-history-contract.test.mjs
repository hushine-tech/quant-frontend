import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { exactDecimalText } from "../src/api/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(here, "../src/api/client.ts"), "utf8");
const orderTree = readFileSync(join(here, "../src/components/OrderTree.tsx"), "utf8");

function exportedTypeBody(source, name) {
  const marker = `export type ${name} = {`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must remain an exported API contract`);
  const end = source.indexOf("\n};", start);
  assert.notEqual(end, -1, `${name} type declaration must be complete`);
  return source.slice(start, end + 3);
}

const intentExact = ["requested_qty_decimal", "requested_price_decimal"];
const intentLegacy = ["requested_qty", "requested_price"];
const attemptExact = ["requested_qty_decimal", "requested_price_decimal", "mark_price_decimal"];
const attemptLegacy = ["requested_qty", "requested_price", "mark_price"];
const orderExact = ["orig_qty_decimal", "executed_qty_decimal", "remaining_qty_decimal", "avg_price_decimal", "price_decimal", "cumulative_quote_qty_decimal"];
const orderLegacy = ["orig_qty", "executed_qty", "remaining_qty", "avg_price", "price"];
const fillExact = ["qty_decimal", "fill_price_decimal", "fee_decimal", "quote_qty_decimal"];
const fillLegacy = ["qty", "fill_price", "fee"];
const clientContracts = [
  { name: "SessionOrderIntent", exact: intentExact, legacy: intentLegacy },
  { name: "SessionOrderAttempt", exact: attemptExact, legacy: attemptLegacy },
  { name: "SessionOrder", exact: orderExact, legacy: orderLegacy },
  { name: "SessionOrderFill", exact: fillExact, legacy: fillLegacy },
  { name: "OrderLifecycleFillDelta", exact: fillExact, legacy: fillLegacy },
  { name: "OrderLifecycleState", exact: orderExact, legacy: ["orig_qty", "executed_qty", "remaining_qty", "avg_price"] },
  { name: "OrderIntentEntry", exact: intentExact, legacy: intentLegacy },
  { name: "OrderAttemptEntry", exact: attemptExact, legacy: attemptLegacy },
  { name: "OrderEntry", exact: orderExact, legacy: orderLegacy },
  { name: "OrderFillEntry", exact: fillExact, legacy: fillLegacy },
];
const orderTreeContracts = [
  { name: "TreeIntent", exact: intentExact, legacy: intentLegacy },
  { name: "TreeAttempt", exact: attemptExact, legacy: attemptLegacy },
  { name: "TreeOrder", exact: orderExact, legacy: orderLegacy },
  { name: "TreeFill", exact: fillExact, legacy: fillLegacy },
];

test("exactDecimalText renders only authoritative exact text", () => {
  const beyondBinaryFloat = "9007199254740993.00000000";

  assert.equal(exactDecimalText.length, 1, "the rendering contract accepts exact text only");
  assert.equal(exactDecimalText(beyondBinaryFloat), beyondBinaryFloat);
  assert.equal(
    exactDecimalText(undefined),
    "-",
    "missing exact text must render unavailable instead of a legacy float fallback",
  );
});

for (const contract of clientContracts) {
  test(`${contract.name} API contract uses exact identifiers only`, () => {
    const body = exportedTypeBody(client, contract.name);
    for (const field of contract.exact) {
      assert.match(body, new RegExp(`\\b${field}\\??:\\s*string\\b`), `${contract.name}.${field} must remain exact text`);
    }
    for (const field of contract.legacy) {
      assert.doesNotMatch(body, new RegExp(`\\b${field}\\b`), `${contract.name}.${field} legacy identifier must be absent`);
    }
  });
}

for (const contract of orderTreeContracts) {
  test(`${contract.name} transport contract uses exact identifiers only`, () => {
    const body = exportedTypeBody(orderTree, contract.name);
    for (const field of contract.exact) {
      assert.match(body, new RegExp(`\\b${field}\\??:\\s*string\\b`), `${contract.name}.${field} must remain exact text`);
    }
    for (const field of contract.legacy) {
      assert.doesNotMatch(body, new RegExp(`\\b${field}\\b`), `${contract.name}.${field} transport declaration must be absent`);
    }
  });
}

test("OrderTree renders order-history values without float fallback arguments", () => {
  assert.match(orderTree, /import \{ exactDecimalText, type Page \} from "@\/api\/client"/);

  for (const expression of [
    "intent.requested_qty_decimal",
    "intent.requested_price_decimal",
    "attempt.requested_qty_decimal",
    "attempt.requested_price_decimal",
    "attempt.mark_price_decimal",
    "order.orig_qty_decimal",
    "order.executed_qty_decimal",
    "order.remaining_qty_decimal",
    "order.avg_price_decimal",
    "order.price_decimal",
    "f.qty_decimal",
    "f.fill_price_decimal",
    "f.quote_qty_decimal",
    "f.fee_decimal",
  ]) {
    assert.match(
      orderTree,
      new RegExp(`exactDecimalText\\(${expression.replaceAll(".", "\\.")}\\)`),
      `${expression} must be rendered directly from exact text without a float fallback`,
    );
  }
});

test("OrderTree never accesses legacy transport values", () => {
  for (const field of [
    "requested_qty",
    "requested_price",
    "mark_price",
    "orig_qty",
    "executed_qty",
    "remaining_qty",
    "avg_price",
    "price",
    "qty",
    "fill_price",
    "fee",
  ]) {
    assert.doesNotMatch(
      orderTree,
      new RegExp(`\\.${field}(?![A-Za-z0-9_])`),
      `OrderTree must not access legacy transport field .${field}`,
    );
  }
});
