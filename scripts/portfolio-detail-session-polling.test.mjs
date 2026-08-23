import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/PortfolioDetail.tsx"), "utf8");

const singleFlightSource = readFileSync(join(here, "../src/utils/singleFlight.ts"), "utf8");
const transpiledSingleFlight = ts.transpileModule(singleFlightSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const asyncControls = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(transpiledSingleFlight)}`
);

assert.equal(
  typeof asyncControls.createRequestGenerationOwner,
  "function",
  "session polling should use a generation owner that invalidates superseded requests",
);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const owner = asyncControls.createRequestGenerationOwner();
const sessionA = owner.begin("session-a");
const lateSessionAResponse = deferred();
let activePanel = { sessionId: "session-a", status: "running" };
let activeInterval = "session-a-interval";
const applyLateSessionAResponse = lateSessionAResponse.promise.then((status) => {
  if (!owner.isCurrent(sessionA)) return;
  activePanel = { sessionId: "session-a", status };
  activeInterval = null;
});

const sessionB = owner.begin("session-b");
activePanel = { sessionId: "session-b", status: "running" };
activeInterval = "session-b-interval";
lateSessionAResponse.resolve("finished");
await applyLateSessionAResponse;

assert.deepEqual(
  activePanel,
  { sessionId: "session-b", status: "running" },
  "a late response from session A must not update session B's panel",
);
assert.equal(
  activeInterval,
  "session-b-interval",
  "a late terminal response from session A must not clear session B's interval",
);
assert.equal(owner.isCurrent(sessionB), true, "session B should remain the active polling generation");

const firstSameSessionGeneration = owner.begin("same-session");
const secondSameSessionGeneration = owner.begin("same-session");
assert.equal(
  owner.isCurrent(firstSameSessionGeneration),
  false,
  "restarting polling for the same session should still supersede its previous generation",
);
assert.equal(owner.isCurrent(secondSameSessionGeneration), true);

assert.equal(
  source.includes("const statusPollOwnerRef = useRef(createRequestGenerationOwner());") &&
    source.includes("const pollToken = statusPollOwnerRef.current.begin(sessionId);") &&
    source.includes("const isCurrentPoll = () => statusPollOwnerRef.current.isCurrent(pollToken);") &&
    source.includes("statusPollOwnerRef.current.invalidate();"),
  true,
  "Portfolio detail should own, capture, and invalidate each polling generation",
);

assert.match(
  source,
  /const st = await getStrategyStatus\(sessionId\);\s+if \(!isCurrentPoll\(\)\) return;/,
  "status responses should be rejected after their polling generation is superseded",
);
assert.match(
  source,
  /catch \(pollErr\) \{\s+if \(!isCurrentPoll\(\)\) return;/,
  "status errors should be rejected after their polling generation is superseded",
);
assert.match(
  source,
  /finally \{\s+if \(isCurrentPoll\(\)\) \{\s+statusPollInFlightRef\.current = false;/,
  "a superseded request should not release the active generation's in-flight guard",
);

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
