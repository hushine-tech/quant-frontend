import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runtimeRoleForSessionMode } from "../src/api/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const accountDetail = readFileSync(join(here, "../src/pages/AccountDetail.tsx"), "utf8");
const sessionDetail = readFileSync(join(here, "../src/pages/SessionDetailPage.tsx"), "utf8");

assert.equal(
  runtimeRoleForSessionMode(0),
  undefined,
  "mode=0 backtest/debug sessions must allow executor and debugger runtimes",
);

assert.equal(
  runtimeRoleForSessionMode(2),
  "executor",
  "mode=2 testnet sessions must select executor runtimes",
);

assert.equal(
  runtimeRoleForSessionMode(undefined),
  "executor",
  "unknown session mode should keep executor as the conservative default",
);

assert.equal(
  accountDetail.includes("role={runtimeRoleForSessionMode(pendingStart?.kind === \"testnet\" ? 2 : 0)}"),
  true,
  "Account detail start dialog must route testnet to executor while leaving backtest role-unfiltered",
);

assert.equal(
  accountDetail.includes("role={runtimeRoleForSessionMode(resumeDialogSession?.mode)}"),
  true,
  "Account detail resume dialog must route by session mode",
);

assert.equal(
  sessionDetail.includes("role={runtimeRoleForSessionMode(session?.mode)}"),
  true,
  "Session detail resume dialog must route by session mode",
);
