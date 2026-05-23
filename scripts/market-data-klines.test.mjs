import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const marketData = readFileSync(join(here, "../src/pages/MarketData.tsx"), "utf8");
const accountDetail = readFileSync(join(here, "../src/pages/AccountDetail.tsx"), "utf8");
const client = readFileSync(join(here, "../src/api/client.ts"), "utf8");

for (const token of [
  "Data Viewer",
  "queryMarketDataKlines",
  "KlinePriceChart",
  "Price Chart",
  "<svg",
  "Raw Klines",
  "Open Time",
  "Close",
  "Volume",
]) {
  assert.equal(
    marketData.includes(token) || client.includes(token),
    true,
    `Market Data raw Kline viewer should include ${token}`,
  );
}

for (const token of [
  "View sample data",
  "Sample Klines",
  "queryMarketDataKlines",
]) {
  assert.equal(accountDetail.includes(token) || client.includes(token), true, `Backtest start dialog should include ${token}`);
}
