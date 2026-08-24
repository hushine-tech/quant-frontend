import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  isRuntimeTerminal,
  isSessionTerminal,
  shouldPollSessionRecord,
} from "../src/api/client.ts";

const terminalStatuses = ["ended", "cancelled", "failed", "heartbeat_stale"];
for (const status of terminalStatuses) {
  assert.equal(
    isRuntimeTerminal({ status }),
    true,
    `${status} must be treated as a terminal runtime status`,
  );
}

const nonTerminalStatuses = ["active", "running", "ready", "healthy", "online", "paired", "unhealthy", "starting"];
for (const status of nonTerminalStatuses) {
  assert.equal(
    isRuntimeTerminal({ status }),
    false,
    `${status} must not be treated as a terminal runtime status`,
  );
}

const terminalSessionStatuses = [
  "finished",
  "stopped",
  "failed",
  "stop_failed",
  "recoverable",
  "preflight_failed",
];
for (const status of terminalSessionStatuses) {
  assert.equal(
    isSessionTerminal({ status }),
    true,
    `${status} must be treated as a terminal session status`,
  );
}

const activeSessionStatuses = ["running", "stopping", "starting", "pending", ""];
for (const status of activeSessionStatuses) {
  assert.equal(
    isSessionTerminal({ status }),
    false,
    `${status || "(empty)"} must not be treated as a terminal session status`,
  );
}

for (const removedStatus of ["completed", "stopping_failed"]) {
  assert.equal(
    isSessionTerminal({ status: removedStatus }),
    false,
    `${removedStatus} is not part of the current Session status contract`,
  );
}

assert.equal(
  shouldPollSessionRecord({ status: "running", indicator_finalization_pending: false }),
  true,
);
assert.equal(
  shouldPollSessionRecord({ status: "recoverable", indicator_finalization_pending: true }),
  true,
);
assert.equal(
  shouldPollSessionRecord({ status: "recoverable", indicator_finalization_pending: false }),
  false,
);

const sessionDetailSource = readFileSync(
  path.join(process.cwd(), "src/pages/SessionDetailPage.tsx"),
  "utf8",
);
assert.doesNotMatch(
  sessionDetailSource,
  /setInterval/,
  "Session detail polling must not overlap requests with setInterval",
);
assert.match(
  sessionDetailSource,
  /await getSession\(capturedSessionID\)[\s\S]*shouldPollSessionRecord\(item\)[\s\S]*schedule\(3000\)/,
  "the next Session read should be scheduled only after the prior response settles",
);
assert.match(
  sessionDetailSource,
  /cancelled \|\| capturedSessionID !== stableSessionId/,
  "superseded Session responses must not update state or schedule another read",
);
