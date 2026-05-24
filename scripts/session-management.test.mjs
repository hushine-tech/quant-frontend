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
  "modeFilter",
  "statusFilter",
  "sessionIdFilter",
  "/accounts/${session.account_id}/sessions/${session.session_id}",
  "accountModeLabel(session.mode)",
]) {
  assert.equal(source.includes(token), true, `Session Management should include ${token}`);
}

for (const forbidden of [
  "stopSession(",
  "finishSession(",
  "resumeWithNewSession",
  "Run Session",
  "Stop Session",
  "Finish",
  "Resume",
  "<td>{session.mode}</td>",
]) {
  assert.equal(source.includes(forbidden), false, `Session Management must remain read-only: ${forbidden}`);
}
