import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/SessionManagement.tsx"), "utf8");
const portfolioDetail = readFileSync(join(here, "../src/pages/PortfolioDetail.tsx"), "utf8");
const sessionDetail = readFileSync(join(here, "../src/pages/SessionDetailPage.tsx"), "utf8");

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

for (const [name, detailSource] of [["Portfolio session list", portfolioDetail], ["Session detail", sessionDetail]]) {
  assert.equal(detailSource.includes("resumeLeverageText"), false, `${name} resume must not own leverage input state`);
  assert.equal(detailSource.includes("parseSessionLeverage"), false, `${name} resume must not validate a leverage override`);
  assert.equal(
    detailSource.includes("resume_session_id: session.session_id"),
    true,
    `${name} Resume must explicitly bind the recoverable/stopped predecessor Session`,
  );
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
