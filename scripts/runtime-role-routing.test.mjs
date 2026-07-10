import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runtimeRoleForSessionEnvironment } from "../src/api/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const portfolioDetail = readFileSync(join(here, "../src/pages/PortfolioDetail.tsx"), "utf8");
const sessionDetail = readFileSync(join(here, "../src/pages/SessionDetailPage.tsx"), "utf8");

assert.equal(
  runtimeRoleForSessionEnvironment(0),
  "executor",
  "backtest environment should request executor runtimes through the unified route policy",
);

assert.equal(
  runtimeRoleForSessionEnvironment(1),
  "executor",
  "demo environment should request executor runtimes",
);

assert.equal(
  runtimeRoleForSessionEnvironment(undefined),
  "executor",
  "unknown session environment should keep executor as the conservative default",
);

assert.equal(
  portfolioDetail.includes("role={runtimeRoleForSessionEnvironment(pendingStart?.kind === \"demo\" ? 1 : 0)}"),
  true,
  "Portfolio detail start dialog must route by portfolio environment",
);

assert.equal(
  portfolioDetail.includes("role={runtimeRoleForSessionEnvironment(resumeDialogSession?.environment)}"),
  true,
  "Portfolio detail resume dialog must route by session environment",
);

assert.equal(
  sessionDetail.includes("role={runtimeRoleForSessionEnvironment(session?.environment)}"),
  true,
  "Session detail resume dialog must route by session environment",
);
