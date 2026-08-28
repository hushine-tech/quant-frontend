import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const client = readFileSync(resolve(root, "src/api/client.ts"), "utf8");
const venueManagement = readFileSync(resolve(root, "src/pages/VenueManagement.tsx"), "utf8");
const orderTree = readFileSync(resolve(root, "src/components/OrderTree.tsx"), "utf8");

assert.match(client, /export type FuturesPositionSide = "BOTH" \| "LONG" \| "SHORT";/, "the API must expose only canonical Futures position-side strings");
assert.doesNotMatch(client, /\bdirection\b/, "the API client must not retain legacy direction fields");
assert.match(client, /position_side: FuturesPositionSide;/, "Futures position payloads must use the canonical side type");

assert.match(venueManagement, /type FutRow = \{ symbol: string; position_side: FuturesPositionSide;/, "Futures form rows must store a canonical position side");
assert.doesNotMatch(venueManagement, /\bdirection\b/, "the Futures form must not retain numeric direction compatibility");
assert.match(venueManagement, /function transitionFuturesPositionMode\(/, "mode transitions must normalize rows explicitly");
assert.match(venueManagement, /key=\{futuresPositionRowKey\(r\)\}/, "Futures rows must be keyed by symbol and side");
assert.match(venueManagement, /row\.position_side === "BOTH" \? \{ \.\.\.row, position_side: "LONG" \} : row/, "switching to Hedge must retain existing LONG and SHORT legs");

assert.doesNotMatch(orderTree, /position_side\?: string \| number/, "order tree route facts must reject numeric position sides");
assert.doesNotMatch(orderTree, /value === 1|value === 2/, "order tree must not translate numeric position sides");

console.log("futures position-side contract checks passed");
