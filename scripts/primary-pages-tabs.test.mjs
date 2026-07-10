import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const files = {
  portfolio: readFileSync(join(here, "../src/pages/PortfolioManagement.tsx"), "utf8"),
  strategy: readFileSync(join(here, "../src/pages/StrategyList.tsx"), "utf8"),
  marketData: readFileSync(join(here, "../src/pages/MarketData.tsx"), "utf8"),
  runtime: readFileSync(join(here, "../src/pages/RuntimeManagement.tsx"), "utf8"),
  notification: readFileSync(join(here, "../src/pages/NotificationManagement.tsx"), "utf8"),
  pageTabs: readFileSync(join(here, "../src/components/PageTabs.tsx"), "utf8"),
  pageHeader: readFileSync(join(here, "../src/components/PageHeader.tsx"), "utf8"),
};

for (const [name, source] of Object.entries(files)) {
  if (name === "pageTabs" || name === "pageHeader") continue;
  assert.equal(source.includes("PageHeader"), true, `${name} should use PageHeader`);
}

for (const [name, source] of Object.entries(files)) {
  if (name === "pageHeader") continue;
  assert.equal(source.includes("PageTabs"), true, `${name} should use PageTabs`);
}

for (const token of [
  "primary-tabs",
  "primary-tabs__tab--active",
  "primary-tabs__panel",
]) {
  assert.equal(files.pageTabs.includes(token), true, `PageTabs should include ${token}`);
}

for (const token of [
  "Portfolios",
  "Create Portfolio",
]) {
  assert.equal(files.portfolio.includes(token), true, `Portfolio Management should include ${token}`);
}

for (const token of [
  "Strategies",
  "Create Strategy",
]) {
  assert.equal(files.strategy.includes(token), true, `Strategy Management should include ${token}`);
}

for (const token of [
  "All Runtimes",
  "Create Runtime",
  "Credentials",
  "Failure Overview",
]) {
  assert.equal(files.runtime.includes(token), true, `Runtime Management should include ${token}`);
}
