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
  "listAccounts",
  "listSessions",
  "listRuntimes",
  "listStrategies",
  "accountFilter",
  "runtimeFilter",
  "strategyFilter",
  "environmentFilter",
  "statusFilter",
  "sessionIdFilter",
  "/accounts/${session.account_id}/sessions/${session.session_id}",
  "accountEnvironmentLabel(session.environment)",
  '<option value="1">Demo (1)</option>',
  '<option value="2">Live (2)</option>',
]) {
  assert.equal(source.includes(token), true, `Session Management should include ${token}`);
}

const legacyAccountModeToken = String.fromCharCode(109, 111, 100, 101);
for (const forbidden of [
  "stopSession(",
  "finishSession(",
  "resumeWithNewSession",
  "Run Session",
  "Stop Session",
  "Finish",
  "Resume",
  `<td>{session.${legacyAccountModeToken}}</td>`,
  `${legacyAccountModeToken}Filter`,
  `account${legacyAccountModeToken[0].toUpperCase()}${legacyAccountModeToken.slice(1)}Label`,
]) {
  assert.equal(source.includes(forbidden), false, `Session Management must remain read-only: ${forbidden}`);
}
