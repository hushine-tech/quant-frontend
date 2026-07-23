import type { StrategyInputDeclaration, StrategyOrderTargetDeclaration } from "@/api/client";

function extractAssignmentList(code: string | undefined, name: string): string {
  if (!code) return "";
  const match = new RegExp(`\\b${name}\\s*=`).exec(code);
  if (!match) return "";
  const start = code.indexOf("[", match.index);
  if (start < 0) return "";

  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < code.length; index += 1) {
    const char = code[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return code.slice(start + 1, index);
    }
  }
  return "";
}

function splitPythonDicts(block: string): string[] {
  const result: string[] = [];
  let start = -1;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < block.length; index += 1) {
    const char = block[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index + 1;
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        result.push(block.slice(start, index));
        start = -1;
      }
    }
  }
  return result;
}

function parsePythonValue(raw: string | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim().replace(/,$/, "");
  const quoted = /^["'](.*)["']$/.exec(trimmed);
  if (quoted) return quoted[1];
  const enumValue = /(?:Exchange|Market)\.([A-Z0-9_]+)/.exec(trimmed);
  if (enumValue) return enumValue[1].toLowerCase();
  return trimmed;
}

function dictValue(dict: string, key: string): string {
  const match = new RegExp(`["']${key}["']\\s*:\\s*([^,}\\n]+)`).exec(dict);
  return parsePythonValue(match?.[1]);
}

export function extractStrategyInputs(code: string | undefined): StrategyInputDeclaration[] {
  return splitPythonDicts(extractAssignmentList(code, "INPUTS"))
    .map((dict) => ({
      exchange: dictValue(dict, "exchange") || "binance",
      market: dictValue(dict, "market"),
      kind: dictValue(dict, "kind") || "kline",
      symbol: dictValue(dict, "symbol"),
      interval: dictValue(dict, "interval"),
    }))
    .filter((input) => Boolean(input.symbol && input.interval));
}

export function extractStrategyOrderTargets(code: string | undefined): StrategyOrderTargetDeclaration[] {
  return splitPythonDicts(extractAssignmentList(code, "ORDER_TARGETS"))
    .map((dict) => ({
      exchange: dictValue(dict, "exchange") || "binance",
      market: dictValue(dict, "market"),
      symbol: dictValue(dict, "symbol"),
    }))
    .filter((target) => Boolean(target.symbol));
}

export function strategyDeclaresSpot(code: string | undefined): boolean {
  return [
    ...extractStrategyInputs(code),
    ...extractStrategyOrderTargets(code),
  ].some((declaration) => declaration.market.trim().toLowerCase() === "spot");
}
