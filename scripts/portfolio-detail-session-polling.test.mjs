import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/PortfolioDetail.tsx"), "utf8");

assert.equal(
  source.includes("isSessionTerminal"),
  true,
  "Portfolio detail sessions should reuse the shared terminal-session predicate",
);

assert.equal(
  source.includes("const shouldPollSessions = loadedSessions.some((session) => !isSessionTerminal(session))"),
  true,
  "Portfolio detail sessions should poll only when at least one session is non-terminal",
);

assert.equal(
  source.includes("if (!shouldPollSessions) return;"),
  true,
  "Portfolio detail sessions should not start a polling interval for terminal-only lists",
);

assert.equal(
  source.includes("const statusPollInFlightRef = useRef(false);"),
  true,
  "Portfolio detail run-session polling should track an in-flight request",
);

assert.equal(
  source.includes("function isRunPanelActiveStatus(status: string): boolean") &&
    source.includes("const activeSessionInRunPanel = Boolean(activePollSession && isRunPanelActiveStatus(activePollSession.statusLabel));") &&
    source.includes("restoreActiveRunPanelSession") &&
    source.includes("listSessionsPage({ portfolio_id: portfolioId, environment, runtime_id: startRuntimeId || undefined, limit: 20, offset: 0 })") &&
    source.includes("page.items.find((session) => isRunPanelActiveStatus(session.status))"),
  true,
  "Portfolio detail should restore an active run-panel session after page reload",
);

assert.equal(
  source.includes("if (statusPollInFlightRef.current) return;") &&
    source.includes("statusPollInFlightRef.current = true;") &&
    source.includes("statusPollInFlightRef.current = false;"),
  true,
  "Portfolio detail run-session polling should skip overlapping status requests",
);

assert.equal(
  source.includes("const MAX_STATUS_POLL_ERRORS = 5;") &&
    source.includes("const statusPollErrorCountRef = useRef(0);") &&
    source.includes("Status updates are delayed; still polling.") &&
    source.includes("statusPollErrorCountRef.current < MAX_STATUS_POLL_ERRORS"),
  true,
  "Portfolio detail run-session polling should tolerate transient status failures without treating them as session errors",
);

assert.equal(
  source.includes("Status refresh failed; retrying"),
  false,
  "Portfolio detail should not surface transient status-poll failures as red retry errors",
);

const pollErrorCatch = source.match(/catch \(pollErr\) \{[\s\S]*?\n      \} finally \{/)?.[0] ?? "";
assert.equal(
  !pollErrorCatch.includes('statusLabel: "failed"') &&
    !pollErrorCatch.includes("setRunning(false)") &&
    !pollErrorCatch.includes("setActivePollSession(null)") &&
    pollErrorCatch.includes("statusNote:"),
  true,
  "Portfolio detail should keep polling after repeated status refresh failures instead of marking the session failed",
);

const clientSource = readFileSync(join(here, "../src/api/client.ts"), "utf8");

assert.equal(
  clientSource.includes("const SESSION_STATUS_TIMEOUT_MS = 8_000;") &&
    clientSource.includes("fetchWithTimeout(") &&
    clientSource.includes("`${apiBase()}/api/strategy-sessions/${sessionId}`") &&
    clientSource.includes("SESSION_STATUS_TIMEOUT_MS") &&
    clientSource.includes('"Session status timed out. Check runtime connectivity and try again."'),
  true,
  "getStrategyStatus should have a client-side timeout so stalled session polls cannot fill the browser connection pool",
);
