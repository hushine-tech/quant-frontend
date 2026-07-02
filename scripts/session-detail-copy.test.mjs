import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/SessionDetailPage.tsx"), "utf8");

assert.equal(
  source.includes("Current status:"),
  true,
  "Session detail status label should be English",
);

assert.match(
  source,
  /\{session\?\.error\s*\?\s*\(\s*<p className="error"/,
  "Session detail should render session.error for running debug sessions as well as terminal sessions",
);

assert.equal(
  source.includes("当前状态"),
  false,
  "Session detail should not render Chinese status copy in the English UI",
);

assert.equal(
  source.includes("const [activeTab, setActiveTab] = useState<SessionDetailTab>(\"orders\");"),
  true,
  "Session detail should still open on the Orders tab",
);

assert.equal(
  source.includes("const [pnlSummary, setPnlSummary] = useState<SessionPnLSummary | null>(null);"),
  true,
  "Session detail should keep headline PnL in state independent of the Snapshots tab",
);

assert.equal(
  source.includes("getSessionSnapshots(stableSessionId, { limit: 1, offset: 0 })"),
  true,
  "Session detail should fetch the newest snapshot immediately for headline PnL",
);

assert.equal(
  source.includes("offset: Math.max(summaryFirstPage.total - 1, 0)"),
  true,
  "Session detail should fetch the oldest snapshot directly so headline PnL is session-wide",
);

assert.equal(
  source.includes("currently-visible snapshots page"),
  false,
  "Headline PnL must not be described as depending on the currently-visible snapshots page",
);

assert.equal(
  source.includes("getStrategy,"),
  true,
  "Session detail should fetch the session strategy for context",
);

assert.equal(
  source.includes("extractStrategyInputs(strategy.code)"),
  true,
  "Session detail should derive kline inputs from the session strategy code",
);

assert.equal(
  source.includes("Session context"),
  true,
  "Session detail should render a context block",
);

assert.equal(
  source.includes("Market inputs"),
  true,
  "Session detail should list declared market/kline inputs",
);

assert.equal(
  source.includes("formatInputRoute(input)"),
  true,
  "Session detail should display declared inputs such as ZECUSDT 15m",
);

assert.equal(
  source.includes("formatRangeEndpoint(session.start_time_ms)"),
  true,
  "Session detail should render the input range start on its own line",
);

assert.equal(
  source.includes("formatRangeEndpoint(session.end_time_ms)"),
  true,
  "Session detail should render the input range end on its own line",
);

assert.equal(
  source.includes("formatTimeRange(session.start_time_ms, session.end_time_ms)"),
  false,
  "Session detail should not render the input range as one long inline string",
);
