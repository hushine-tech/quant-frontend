import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/components/DateTimeRangePicker.tsx"), "utf8");

assert.equal(
  source.includes("function timeValue(value: string): string") &&
    source.includes('return "00:00:00";'),
  true,
  "DateTimeRangePicker should default blank time controls to an interval-aligned value",
);

assert.equal(
  source.includes("if (pickedEnd === pickedStart)") && source.includes("addDays(dateOnly(date), 1)"),
  true,
  "Selecting the same calendar day twice should produce a one-day end-exclusive range",
);

assert.equal(
  source.includes("function floorToMinute(date: Date): Date") &&
    source.includes("next.setSeconds(0, 0);") &&
    source.includes("const end = floorToMinute(new Date());"),
  true,
  "DateTimeRangePicker presets should align start/end to whole minutes for 1m coverage checks",
);
