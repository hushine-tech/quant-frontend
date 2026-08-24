import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const sourcePath = path.join(process.cwd(), "src/components/sessionIndicatorData.ts");
const source = readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const indicators = await import(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(transpiled)}`
);

const lineDefinition = {
  session_id: "session-a",
  strategy_id: 7,
  stream_key: "binance:spot:BTCUSDT:1m",
  indicator_key: "alpha",
  name: "Alpha",
  type: "line",
  pane: "strategy",
  color: "#2563eb",
  unit: "",
  description: "",
  config_json: "{}",
  protocol_version: 2,
};
const markerDefinition = {
  ...lineDefinition,
  indicator_key: "trade_signal",
  name: "Trade signal",
  type: "marker",
  config_json: '{"position":"belowBar","shape":"arrowUp"}',
};

assert.equal(indicators.intervalToMs("1s"), 1_000);
assert.equal(indicators.intervalToMs("15s"), 15_000);
assert.equal(indicators.intervalToMs("1m"), 60_000);
assert.equal(
  indicators.intervalToMs("1M"),
  30 * 24 * 60 * 60_000,
  "Binance month intervals must not be folded into minute intervals",
);
assert.equal(
  indicators.intervalToMs("9007199254740991w"),
  60_000,
  "interval conversion must fail closed when milliseconds exceed a safe integer",
);

function lineChunk(count, { finalized = false, revision = count, session = "session-a" } = {}) {
  const times = count === 1 ? [1_000] : [1_000, 9_000, 21_000].slice(0, count);
  return {
    session_id: session,
    stream_key: lineDefinition.stream_key,
    indicator_key: lineDefinition.indicator_key,
    chunk_index: 0,
    start_sequence: 0,
    end_sequence: count - 1,
    start_time_ms: times[0],
    end_time_ms: times[times.length - 1],
    interval_ms: 60_000,
    count,
    times_ms: times,
    scalar_values: [1.5, null, 0].slice(0, count),
    markers: [],
    revision,
    finalized,
    protocol_version: 2,
  };
}

const irregular = lineChunk(2);
assert.deepEqual(
  indicators.expandScalarIndicatorV2(lineDefinition, irregular),
  [{ time: 1, value: 1.5 }],
  "actual irregular times and null slots must be indexed together",
);
assert.deepEqual(
  indicators.expandScalarIndicatorV2(lineDefinition, lineChunk(3)),
  [{ time: 1, value: 1.5 }, { time: 21, value: 0 }],
  "a missing scalar must not shift a later zero value",
);

const markerChunk = {
  ...lineChunk(2),
  indicator_key: markerDefinition.indicator_key,
  scalar_values: [],
  markers: [
    {
      sequence: 1,
      offset: 1,
      time_ms: 9_000,
      text: "BUY",
      price: 0,
      color: "#16a34a",
      position: "",
      shape: "",
    },
    {
      sequence: 1,
      offset: 1,
      time_ms: 9_000,
      text: "SCALE",
      color: "#0284c7",
      position: "inBar",
      shape: "circle",
    },
  ],
};
const markerRows = indicators.buildIndicatorMarkersV2(markerDefinition, markerChunk);
assert.equal(markerRows[0].time, 9, "marker time must come from marker.time_ms");
assert.equal(markerRows[0].price, 0, "optional zero marker price must survive");
assert.deepEqual(
  markerRows.map(({ text }) => text),
  ["BUY", "SCALE"],
  "two markers on one bar must retain input order",
);
assert.equal(markerRows[0].position, "belowBar", "empty marker position should use definition config");
assert.equal(markerRows[0].shape, "arrowUp", "empty marker shape should use definition config");

let result = indicators.mergeIndicatorChunksV2(
  [lineDefinition],
  [],
  [lineChunk(1)],
);
assert.equal(result.progressed, true);
assert.equal(result.chunks[0].revision, 1);
result = indicators.mergeIndicatorChunksV2(
  [lineDefinition],
  result.chunks,
  [lineChunk(2)],
);
assert.equal(result.chunks[0].revision, 2, "newer open revision should replace its prefix");
const revisionTwo = result.chunks;
result = indicators.mergeIndicatorChunksV2(
  [lineDefinition],
  result.chunks,
  [lineChunk(1)],
);
assert.equal(result.chunks[0].revision, 2, "stale open revision should be ignored");
result = indicators.mergeIndicatorChunksV2(
  [lineDefinition],
  result.chunks,
  [lineChunk(2, { finalized: true })],
);
assert.equal(result.chunks[0].finalized, true, "same-revision finalized promotion should seal the chunk");
assert.deepEqual(
  indicators.indicatorTailState(revisionTwo),
  { openChunks: 1, finalizedChunks: 0 },
);
assert.deepEqual(
  indicators.indicatorTailState(result.chunks),
  { openChunks: 0, finalizedChunks: 1 },
);
const finalized = result.chunks;
result = indicators.mergeIndicatorChunksV2(
  [lineDefinition],
  result.chunks,
  [lineChunk(3)],
);
assert.equal(result.chunks[0].revision, 2, "finalized data must be immutable");
assert.equal(result.conflicts.length, 1, "post-finalization mutation should report a conflict");
result = indicators.mergeIndicatorChunksV2(
  [lineDefinition],
  result.chunks,
  [lineChunk(2, { finalized: true })],
);
assert.deepEqual(result.chunks, finalized, "identical finalized retry should be idempotent");
assert.equal(result.conflicts.length, 0);

assert.throws(
  () => indicators.validateIndicatorChunkV2(
    { ...lineDefinition, protocol_version: 1 },
    lineChunk(1),
  ),
  /protocol_version must be 2/,
);
assert.throws(
  () => indicators.validateIndicatorChunkV2(
    lineDefinition,
    { ...lineChunk(2), scalar_values: [1.5] },
  ),
  /cardinality/,
);
assert.throws(
  () => indicators.validateIndicatorChunkV2(
    markerDefinition,
    { ...markerChunk, scalar_values: [null, null] },
  ),
  /cannot contain scalar_values/,
);
assert.throws(
  () => indicators.validateIndicatorChunkV2(
    markerDefinition,
    {
      ...markerChunk,
      markers: [{ ...markerChunk.markers[0], position: "top" }],
    },
  ),
  /position/,
);
assert.throws(
  () => indicators.validateIndicatorChunkV2(
    markerDefinition,
    {
      ...markerChunk,
      markers: [{ ...markerChunk.markers[0], shape: "triangle" }],
    },
  ),
  /shape/,
);

assert.deepEqual(
  indicators.indicatorPollDecision(
    { status: "running", indicator_finalization_pending: false },
    finalized,
    0,
  ),
  { poll: true, delayMs: 5_000 },
  "running must poll across the sealed-boundary window",
);
assert.deepEqual(
  indicators.indicatorPollDecision(
    { status: "recoverable", indicator_finalization_pending: true },
    revisionTwo,
    10,
  ),
  { poll: true, delayMs: 30_000 },
  "recoverable pending retry must use bounded exponential backoff",
);
assert.deepEqual(
  indicators.indicatorPollDecision(
    { status: "recoverable", indicator_finalization_pending: false },
    revisionTwo,
    0,
  ),
  { poll: true, delayMs: 1_000 },
  "a cleared pending flag must allow one fetch of the durable finalized revision",
);
assert.deepEqual(
  indicators.indicatorPollDecision(
    { status: "recoverable", indicator_finalization_pending: false },
    revisionTwo,
    1,
  ),
  { poll: false, delayMs: 0 },
  "a cleared pending flag must stop after an unchanged final fetch",
);
assert.equal(
  indicators.indicatorPollDecision(
    { status: "finished", indicator_finalization_pending: false },
    revisionTwo,
    0,
  ).poll,
  true,
  "other terminal sessions keep polling while an open tail is visible",
);
assert.deepEqual(
  indicators.indicatorPollDecision(
    { status: "finished", indicator_finalization_pending: false },
    revisionTwo,
    5,
  ),
  { poll: false, delayMs: 0 },
  "an unchanged open tail on a terminal session must not poll forever",
);
assert.equal(
  indicators.indicatorPollDecision(
    { status: "finished", indicator_finalization_pending: false },
    finalized,
    0,
  ).poll,
  false,
  "fully finalized terminal sessions stop polling",
);
assert.deepEqual(
  indicators.indicatorPollDecision(
    { status: "finished", indicator_finalization_pending: false },
    [],
    1,
  ),
  { poll: true, delayMs: 2_000 },
  "a terminal empty response must retry because final chunks may not be visible yet",
);
assert.equal(
  indicators.indicatorPollDecision(
    { status: "failed", indicator_finalization_pending: false },
    [],
    5,
  ).poll,
  false,
  "terminal empty-result retries must be bounded",
);
for (const status of ["preflight_failed"]) {
  assert.equal(
    indicators.indicatorPollDecision(
      { status, indicator_finalization_pending: false },
      [],
      0,
    ).poll,
    false,
    `${status} with no open tail must stop indicator polling`,
  );
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function proveLateCompletionIgnored(oldIdentity, nextIdentity) {
  const owner = indicators.createIndicatorRequestOwner();
  const oldToken = owner.begin(oldIdentity.sessionID, oldIdentity.streamKey);
  const old = deferred();
  const effects = [];
  const oldApply = old.promise.then(() => {
    if (owner.isCurrent(oldToken)) effects.push("old");
  });
  owner.invalidate();
  const nextToken = owner.begin(nextIdentity.sessionID, nextIdentity.streamKey);
  if (owner.isCurrent(nextToken)) effects.push("new");
  old.resolve();
  await oldApply;
  assert.deepEqual(effects, ["new"]);
}

await proveLateCompletionIgnored(
  { sessionID: "old-session", streamKey: lineDefinition.stream_key },
  { sessionID: "new-session", streamKey: lineDefinition.stream_key },
);
await proveLateCompletionIgnored(
  { sessionID: "session-a", streamKey: "binance:spot:BTCUSDT:1m" },
  { sessionID: "session-a", streamKey: "binance:spot:ETHUSDT:1m" },
);
await proveLateCompletionIgnored(
  { sessionID: "aborted-session", streamKey: lineDefinition.stream_key },
  { sessionID: "current-session", streamKey: lineDefinition.stream_key },
);

console.log("session indicator V2 data checks passed");
