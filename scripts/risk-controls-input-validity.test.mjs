import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const files = [
  "../src/pages/PortfolioDetail.tsx",
  "../src/pages/SessionDetailPage.tsx",
];
const defaultMaxLossClosePercent = 30;

function attr(inputAttrs, name) {
  const match = inputAttrs.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : "";
}

function stepMatches(value, minText, stepText) {
  if (!stepText || stepText === "any") return true;
  const min = Number(minText || 0);
  const step = Number(stepText);
  if (!Number.isFinite(min) || !Number.isFinite(step) || step <= 0) return false;
  const ratio = (value - min) / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

let checked = 0;
for (const file of files) {
  const source = readFileSync(join(here, file), "utf8");
	assert.equal(source.includes("<span>Leverage (x)</span>"), false, `${file} must not expose an editable leverage control`);
  const matches = source.matchAll(/<span>Max loss close \(%\)<\/span>[\s\S]*?<input([\s\S]*?)\/>/g);
  for (const match of matches) {
    checked += 1;
    const inputAttrs = match[1];
    const min = Number(attr(inputAttrs, "min") || 0);
    const max = Number(attr(inputAttrs, "max") || Infinity);
    const step = attr(inputAttrs, "step");
    assert.equal(
      defaultMaxLossClosePercent >= min && defaultMaxLossClosePercent <= max,
      true,
      `${file} max-loss close default should be inside min/max`,
    );
    assert.equal(
      stepMatches(defaultMaxLossClosePercent, attr(inputAttrs, "min"), step),
      true,
      `${file} max-loss close default should pass browser number-input step validation`,
    );
  }
}

assert.equal(checked >= 3, true, "Expected to check all max-loss close inputs");
