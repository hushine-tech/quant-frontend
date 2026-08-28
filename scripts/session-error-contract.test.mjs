import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sessionDetail = readFileSync(join(here, "../src/pages/SessionDetailPage.tsx"), "utf8");

assert.match(
  sessionDetail,
  /if \(!detail && session\.error_detail_json\)\s*\{\s*try\s*\{\s*detail = JSON\.parse\(session\.error_detail_json\)/s,
  "failed sessions must parse the persisted structured error detail",
);
assert.match(
  sessionDetail,
  /<code>\{failure\.code \|\| "SESSION_FAILURE"\}<\/code>/,
  "failed sessions must show the structured failure code",
);
assert.match(
  sessionDetail,
  /\{failure\.message \? `: \$\{failure\.message\}` : ""\}/,
  "failed sessions must show the structured failure message",
);

console.log("session error frontend contract checks passed");
