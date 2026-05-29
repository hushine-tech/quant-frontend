import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/components/DateTimeRangePicker.tsx"), "utf8");

assert.equal(
  source.includes('return fallback === "end" ? "00:00:00" : "00:00:00";'),
  true,
  "DateTimeRangePicker should default end time to an interval-aligned exclusive boundary",
);

assert.equal(
  source.includes("if (pickedEnd === pickedStart)") && source.includes("addDays(dateOnly(date), 1)"),
  true,
  "Selecting the same calendar day twice should produce a one-day end-exclusive range",
);
