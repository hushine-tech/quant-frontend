import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/AccountDetail.tsx"), "utf8");

assert.equal(
  source.includes("isSessionTerminal"),
  true,
  "Account detail sessions should reuse the shared terminal-session predicate",
);

assert.equal(
  source.includes("const shouldPollSessions = loadedSessions.some((session) => !isSessionTerminal(session))"),
  true,
  "Account detail sessions should poll only when at least one session is non-terminal",
);

assert.equal(
  source.includes("if (!shouldPollSessions) return;"),
  true,
  "Account detail sessions should not start a polling interval for terminal-only lists",
);
