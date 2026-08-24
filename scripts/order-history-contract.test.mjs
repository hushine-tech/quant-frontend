import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { exactDecimalText } from "../src/api/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(here, "../src/api/client.ts"), "utf8");
const orderTree = readFileSync(join(here, "../src/components/OrderTree.tsx"), "utf8");

function exportedTypeBody(name) {
  const marker = `export type ${name} = {`;
  const start = client.indexOf(marker);
  assert.notEqual(start, -1, `${name} must remain an exported API contract`);
  const end = client.indexOf("\n};", start);
  assert.notEqual(end, -1, `${name} type declaration must be complete`);
  return client.slice(start, end + 3);
}

test("exactDecimalText renders only authoritative exact text", () => {
  const beyondBinaryFloat = "9007199254740993.00000000";

  assert.equal(exactDecimalText(beyondBinaryFloat, 9007199254740992), beyondBinaryFloat);
  assert.equal(
    exactDecimalText(undefined, 12.5),
    "-",
    "missing exact text must render unavailable instead of a legacy float fallback",
  );
});

test("order-history API exports exact-only quantity price and fee fields", () => {
  const contracts = [
    {
      name: "OrderIntentEntry",
      exact: ["requested_qty_decimal", "requested_price_decimal"],
      legacy: ["requested_qty", "requested_price"],
    },
    {
      name: "OrderAttemptEntry",
      exact: ["requested_qty_decimal", "requested_price_decimal", "mark_price_decimal"],
      legacy: ["requested_qty", "requested_price", "mark_price"],
    },
    {
      name: "OrderEntry",
      exact: ["orig_qty_decimal", "executed_qty_decimal", "remaining_qty_decimal", "avg_price_decimal", "price_decimal", "cumulative_quote_qty_decimal"],
      legacy: ["orig_qty", "executed_qty", "remaining_qty", "avg_price", "price"],
    },
    {
      name: "OrderFillEntry",
      exact: ["qty_decimal", "fill_price_decimal", "fee_decimal", "quote_qty_decimal"],
      legacy: ["qty", "fill_price", "fee"],
    },
  ];

  for (const contract of contracts) {
    const body = exportedTypeBody(contract.name);
    for (const field of contract.exact) {
      assert.match(body, new RegExp(`\\b${field}\\??:\\s*string\\b`), `${contract.name}.${field} must remain exact text`);
    }
    for (const field of contract.legacy) {
      assert.doesNotMatch(body, new RegExp(`\\b${field}\\??:\\s*number\\b`), `${contract.name}.${field} must not expose a parallel float`);
    }
  }
});

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
