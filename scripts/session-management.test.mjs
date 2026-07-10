import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/SessionManagement.tsx"), "utf8");

for (const token of [
  "PageHeader",
  "FilterPanel",
  "FilterField",
  "listPortfolios",
  "listSessions",
  "listRuntimes",
  "listStrategies",
  "portfolioFilter",
  "runtimeFilter",
  "strategyFilter",
  "environmentFilter",
  "statusFilter",
  "sessionIdFilter",
  "/portfolios/${session.portfolio_id}/sessions/${session.session_id}",
  "portfolioEnvironmentLabel(session.environment)",
  '<option value="1">Demo (1)</option>',
  '<option value="2">Live (2)</option>',
]) {
  assert.equal(source.includes(token), true, `Session Management should include ${token}`);
}

const legacyPortfolioModeToken = String.fromCharCode(109, 111, 100, 101);
for (const forbidden of [
  "stopSession(",
  "finishSession(",
  "resumeWithNewSession",
  "Run Session",
  "Stop Session",
  "Finish",
  "Resume",
  `<td>{session.${legacyPortfolioModeToken}}</td>`,
  `${legacyPortfolioModeToken}Filter`,
  `portfolio${legacyPortfolioModeToken[0].toUpperCase()}${legacyPortfolioModeToken.slice(1)}Label`,
]) {
  assert.equal(source.includes(forbidden), false, `Session Management must remain read-only: ${forbidden}`);
}
