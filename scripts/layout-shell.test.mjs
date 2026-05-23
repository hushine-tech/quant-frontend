import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "../src/App.tsx"), "utf8");
const css = readFileSync(join(here, "../src/index.css"), "utf8");
const pkg = JSON.parse(readFileSync(join(here, "../package.json"), "utf8"));

const labels = [
  "Account Management",
  "Strategy Management",
  "Market Data",
  "Runtime Management",
  "Session Management",
  "Order History",
  "Notification Management",
];

let lastIndex = -1;
for (const label of labels) {
  const index = app.indexOf(label);
  assert.notEqual(index, -1, `Sidebar should include ${label}`);
  assert.equal(index > lastIndex, true, `${label} should appear after the previous workflow item`);
  lastIndex = index;
}

for (const token of [
  "lucide-react",
  "PanelLeftClose",
  "MoreHorizontal",
  "localStorage",
  "sidebar--collapsed",
  'path="/sessions"',
  'to: "/sessions"',
]) {
  assert.equal(app.includes(token) || css.includes(token), true, `App shell should include ${token}`);
}

assert.equal(
  pkg.dependencies && Object.prototype.hasOwnProperty.call(pkg.dependencies, "lucide-react"),
  true,
  "package.json should include lucide-react",
);

for (const token of [
  ".sidebar--collapsed",
  ".sidebar-tooltip",
  ".app-body--sidebar-collapsed",
]) {
  assert.equal(css.includes(token), true, `Collapsed sidebar CSS should include ${token}`);
}
