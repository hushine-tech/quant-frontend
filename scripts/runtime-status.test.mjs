import assert from "node:assert/strict";

import { isRuntimeTerminal, isSessionTerminal } from "../src/api/client.ts";

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

const terminalSessionStatuses = ["completed", "finished", "stopped", "failed", "stop_failed", "recoverable"];
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
