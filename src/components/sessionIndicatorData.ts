import type {
  Session,
  StrategyIndicatorChunk,
  StrategyIndicatorDefinition,
  StrategyIndicatorMarkerV2,
} from "../api/client";
import type { SeriesMarker, UTCTimestamp } from "lightweight-charts";

export type IndicatorMergeConflict = {
  key: string;
  reason: string;
};

export type IndicatorMergeResult = {
  chunks: StrategyIndicatorChunk[];
  conflicts: IndicatorMergeConflict[];
  progressed: boolean;
};

export type IndicatorRequestToken = Readonly<{
  sessionID: string;
  streamKey: string;
  epoch: number;
}>;

export type IndicatorRequestOwner = {
  begin(sessionID: string, streamKey: string): IndicatorRequestToken;
  invalidate(): void;
  isCurrent(token: IndicatorRequestToken): boolean;
};

const TERMINAL_SESSION_STATUSES = new Set([
  "completed",
  "finished",
  "stopped",
  "failed",
  "stop_failed",
  "stopping_failed",
  "recoverable",
  "preflight_failed",
]);

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function chunkIdentity(chunk: StrategyIndicatorChunk): string {
  return [
    chunk.session_id,
    chunk.stream_key,
    chunk.indicator_key,
    chunk.chunk_index,
  ].join("\u0000");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, stableValue(record[key])]),
    );
  }
  return value;
}

function stableJSON(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sameExceptFinalized(
  left: StrategyIndicatorChunk,
  right: StrategyIndicatorChunk,
): boolean {
  return stableJSON({ ...left, finalized: false }) ===
    stableJSON({ ...right, finalized: false });
}

function markerPrefixMatches(
  current: StrategyIndicatorChunk,
  incoming: StrategyIndicatorChunk,
): boolean {
  const incomingPrefix = incoming.markers.filter(
    (marker) => marker.sequence <= current.end_sequence,
  );
  return stableJSON(current.markers) === stableJSON(incomingPrefix);
}

function extendsOpenChunk(
  current: StrategyIndicatorChunk,
  incoming: StrategyIndicatorChunk,
): boolean {
  if (
    incoming.count <= current.count ||
    incoming.start_sequence !== current.start_sequence ||
    incoming.interval_ms !== current.interval_ms ||
    incoming.start_time_ms !== current.start_time_ms
  ) {
    return false;
  }
  if (
    stableJSON(incoming.times_ms.slice(0, current.count)) !==
      stableJSON(current.times_ms) ||
    stableJSON(incoming.scalar_values.slice(0, current.scalar_values.length)) !==
      stableJSON(current.scalar_values)
  ) {
    return false;
  }
  return markerPrefixMatches(current, incoming);
}

function markerPosition(value: string): "aboveBar" | "belowBar" | "inBar" {
  if (value === "belowBar" || value === "inBar") return value;
  return "aboveBar";
}

function markerShape(
  value: string,
): "circle" | "square" | "arrowUp" | "arrowDown" {
  if (value === "square" || value === "arrowUp" || value === "arrowDown") {
    return value;
  }
  return "circle";
}

function definitionConfig(
  definition: StrategyIndicatorDefinition,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(definition.config_json || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function validateIndicatorChunkV2(
  definition: StrategyIndicatorDefinition,
  chunk: StrategyIndicatorChunk,
): void {
  assertCondition(definition.protocol_version === 2, "indicator definition protocol_version must be 2");
  assertCondition(chunk.protocol_version === 2, "indicator chunk protocol_version must be 2");
  assertCondition(
    definition.session_id === chunk.session_id &&
      definition.stream_key === chunk.stream_key &&
      definition.indicator_key === chunk.indicator_key,
    "indicator definition/chunk identity mismatch",
  );
  assertCondition(
    positiveInteger(chunk.count) && chunk.count <= 1024,
    "indicator chunk count must be between 1 and 1024",
  );
  assertCondition(
    Number.isInteger(chunk.chunk_index) && chunk.chunk_index >= 0,
    "indicator chunk_index must be a non-negative integer",
  );
  assertCondition(
    chunk.start_sequence === chunk.chunk_index * 1024,
    "indicator chunk start_sequence mismatch",
  );
  assertCondition(
    chunk.end_sequence === chunk.start_sequence + chunk.count - 1,
    "indicator chunk end_sequence mismatch",
  );
  assertCondition(
    chunk.revision === chunk.count,
    "indicator chunk revision must equal count",
  );
  assertCondition(
    chunk.times_ms.length === chunk.count,
    "indicator chunk times_ms cardinality mismatch",
  );
  chunk.times_ms.forEach((timeMS, index) => {
    assertCondition(
      finiteNumber(timeMS) && timeMS > 0,
      `indicator chunk times_ms[${index}] must be positive`,
    );
    if (index > 0) {
      assertCondition(
        timeMS > chunk.times_ms[index - 1],
        "indicator chunk times_ms must strictly increase",
      );
    }
  });
  assertCondition(
    chunk.start_time_ms === chunk.times_ms[0] &&
      chunk.end_time_ms === chunk.times_ms[chunk.times_ms.length - 1],
    "indicator chunk start/end time mismatch",
  );
  assertCondition(
    positiveInteger(chunk.interval_ms),
    "indicator chunk interval_ms must be positive",
  );

  const kind = definition.type.trim().toLowerCase();
  if (kind === "line" || kind === "histogram") {
    assertCondition(
      chunk.scalar_values.length === chunk.count,
      "scalar indicator cardinality must equal count",
    );
    chunk.scalar_values.forEach((value, index) => {
      assertCondition(
        value === null || finiteNumber(value),
        `indicator scalar_values[${index}] must be finite or null`,
      );
    });
    assertCondition(
      chunk.markers.length === 0,
      "scalar indicator cannot contain markers",
    );
  } else if (kind === "marker") {
    assertCondition(
      chunk.scalar_values.length === 0,
      "marker indicator cannot contain scalar_values",
    );
  } else {
    throw new Error(`unsupported indicator type: ${definition.type}`);
  }

  chunk.markers.forEach((marker, index) => {
    assertCondition(
      Number.isInteger(marker.sequence) &&
        marker.sequence >= chunk.start_sequence &&
        marker.sequence <= chunk.end_sequence,
      `indicator marker[${index}] sequence is outside chunk`,
    );
    const expectedOffset = marker.sequence - chunk.start_sequence;
    assertCondition(
      marker.offset === expectedOffset &&
        marker.time_ms === chunk.times_ms[expectedOffset],
      `indicator marker[${index}] offset/time mismatch`,
    );
    assertCondition(
      marker.price === undefined || finiteNumber(marker.price),
      `indicator marker[${index}] price must be finite`,
    );
    assertCondition(
      marker.position === "" ||
        marker.position === "aboveBar" ||
        marker.position === "belowBar" ||
        marker.position === "inBar",
      `indicator marker[${index}] position is invalid`,
    );
    assertCondition(
      marker.shape === "" ||
        marker.shape === "circle" ||
        marker.shape === "square" ||
        marker.shape === "arrowUp" ||
        marker.shape === "arrowDown",
      `indicator marker[${index}] shape is invalid`,
    );
  });
}

export function expandScalarIndicatorV2(
  definition: StrategyIndicatorDefinition,
  chunk: StrategyIndicatorChunk,
): Array<{ time: UTCTimestamp; value: number }> {
  validateIndicatorChunkV2(definition, chunk);
  const kind = definition.type.trim().toLowerCase();
  assertCondition(
    kind === "line" || kind === "histogram",
    "only scalar indicators can expand scalar points",
  );
  const points: Array<{ time: UTCTimestamp; value: number }> = [];
  chunk.scalar_values.forEach((value, index) => {
    if (value === null) return;
    points.push({
      time: Math.floor(chunk.times_ms[index] / 1000) as UTCTimestamp,
      value,
    });
  });
  return points;
}

export function buildIndicatorMarkersV2(
  definition: StrategyIndicatorDefinition,
  chunk: StrategyIndicatorChunk,
): SeriesMarker<UTCTimestamp>[] {
  validateIndicatorChunkV2(definition, chunk);
  assertCondition(
    definition.type.trim().toLowerCase() === "marker",
    "only marker indicators can build markers",
  );
  const config = definitionConfig(definition);
  const configPosition = typeof config.position === "string" ? config.position : "";
  const configShape = typeof config.shape === "string" ? config.shape : "";
  const ordered = chunk.markers
    .map((marker, inputOrder) => ({ marker, inputOrder }))
    .sort((left, right) =>
      left.marker.time_ms - right.marker.time_ms ||
      left.marker.sequence - right.marker.sequence ||
      left.inputOrder - right.inputOrder
    );
  return ordered.map(({ marker }) => {
    const out: SeriesMarker<UTCTimestamp> & { price?: number } = {
      time: Math.floor(marker.time_ms / 1000) as UTCTimestamp,
      position: markerPosition(marker.position || configPosition),
      shape: markerShape(marker.shape || configShape),
      color: marker.color || definition.color || "#0f766e",
      text: marker.text.trim() || definition.name || definition.indicator_key,
    };
    if (marker.price !== undefined) out.price = marker.price;
    return out;
  });
}

export function mergeIndicatorChunksV2(
  definitions: StrategyIndicatorDefinition[],
  current: StrategyIndicatorChunk[],
  incoming: StrategyIndicatorChunk[],
): IndicatorMergeResult {
  const definitionByKey = new Map(
    definitions.map((definition) => [
      [
        definition.session_id,
        definition.stream_key,
        definition.indicator_key,
      ].join("\u0000"),
      definition,
    ]),
  );
  const merged = new Map(current.map((chunk) => [chunkIdentity(chunk), chunk]));
  const conflicts: IndicatorMergeConflict[] = [];
  let progressed = false;

  for (const candidate of incoming) {
    const key = chunkIdentity(candidate);
    const definition = definitionByKey.get([
      candidate.session_id,
      candidate.stream_key,
      candidate.indicator_key,
    ].join("\u0000"));
    if (!definition) {
      conflicts.push({ key, reason: "missing matching indicator definition" });
      continue;
    }
    try {
      validateIndicatorChunkV2(definition, candidate);
    } catch (error) {
      conflicts.push({
        key,
        reason: error instanceof Error ? error.message : "invalid indicator chunk",
      });
      continue;
    }

    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, candidate);
      progressed = true;
      continue;
    }
    if (previous.finalized) {
      if (!candidate.finalized || stableJSON(previous) !== stableJSON(candidate)) {
        conflicts.push({ key, reason: "finalized indicator chunk is immutable" });
      }
      continue;
    }
    if (candidate.revision < previous.revision) continue;
    if (candidate.revision === previous.revision) {
      if (stableJSON(previous) === stableJSON(candidate)) continue;
      if (
        !previous.finalized &&
        candidate.finalized &&
        sameExceptFinalized(previous, candidate)
      ) {
        merged.set(key, candidate);
        progressed = true;
        continue;
      }
      conflicts.push({ key, reason: "same indicator revision has conflicting payload" });
      continue;
    }
    if (!extendsOpenChunk(previous, candidate)) {
      conflicts.push({ key, reason: "new indicator revision does not extend the open prefix" });
      continue;
    }
    merged.set(key, candidate);
    progressed = true;
  }

  const chunks = [...merged.values()].sort((left, right) =>
    left.session_id.localeCompare(right.session_id) ||
    left.stream_key.localeCompare(right.stream_key) ||
    left.indicator_key.localeCompare(right.indicator_key) ||
    left.chunk_index - right.chunk_index
  );
  return { chunks, conflicts, progressed };
}

export function indicatorTailState(
  chunks: StrategyIndicatorChunk[],
): { openChunks: number; finalizedChunks: number } {
  return chunks.reduce(
    (state, chunk) => {
      if (chunk.finalized) state.finalizedChunks += 1;
      else state.openChunks += 1;
      return state;
    },
    { openChunks: 0, finalizedChunks: 0 },
  );
}

export function indicatorPollDecision(
  session: Pick<Session, "status" | "indicator_finalization_pending">,
  chunks: StrategyIndicatorChunk[],
  retryAttempt: number,
): { poll: boolean; delayMs: number } {
  const status = (session.status || "").trim().toLowerCase();
  const terminal = TERMINAL_SESSION_STATUSES.has(status);
  if (!terminal) return { poll: true, delayMs: 5_000 };
  const tail = indicatorTailState(chunks);
  const emptyTerminalRetry = (): { poll: boolean; delayMs: number } => {
    if (
      chunks.length !== 0 ||
      status === "preflight_failed" ||
      status === "stopping_failed" ||
      retryAttempt >= 5
    ) {
      return { poll: false, delayMs: 0 };
    }
    const exponent = Math.max(0, Math.min(4, Math.trunc(retryAttempt)));
    return {
      poll: true,
      delayMs: Math.min(16_000, 1_000 * (2 ** exponent)),
    };
  };
  if (status === "recoverable") {
    if (!session.indicator_finalization_pending) {
      return tail.openChunks > 0 && retryAttempt < 1
        ? { poll: true, delayMs: 1_000 }
        : emptyTerminalRetry();
    }
    const exponent = Math.max(0, Math.min(5, Math.trunc(retryAttempt)));
    return {
      poll: true,
      delayMs: Math.min(30_000, 1_000 * (2 ** exponent)),
    };
  }
  if (tail.openChunks > 0) {
    if (retryAttempt >= 5) return { poll: false, delayMs: 0 };
    const exponent = Math.max(0, Math.min(4, Math.trunc(retryAttempt)));
    return {
      poll: true,
      delayMs: Math.min(16_000, 1_000 * (2 ** exponent)),
    };
  }
  return emptyTerminalRetry();
}

export function createIndicatorRequestOwner(): IndicatorRequestOwner {
  let epoch = 0;
  let current: IndicatorRequestToken | null = null;
  return {
    begin(sessionID: string, streamKey: string): IndicatorRequestToken {
      epoch += 1;
      current = Object.freeze({ sessionID, streamKey, epoch });
      return current;
    },
    invalidate(): void {
      epoch += 1;
      current = null;
    },
    isCurrent(token: IndicatorRequestToken): boolean {
      return current !== null &&
        token.sessionID === current.sessionID &&
        token.streamKey === current.streamKey &&
        token.epoch === current.epoch;
    },
  };
}

export type { StrategyIndicatorMarkerV2 };
