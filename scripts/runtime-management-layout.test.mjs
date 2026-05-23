import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/pages/RuntimeManagement.tsx"), "utf8");

const accountHeaderCount = (source.match(/<th>Account<\/th>/g) || []).length;
assert.equal(
  accountHeaderCount,
  1,
  "Runtime Management should only show Account in the session table, not as a runtime-level column",
);

assert.equal(
  source.includes("runtimeAccountLinks"),
  false,
  "Runtime list must not track a single account per runtime",
);

assert.equal(
  source.includes("const relatedAccount = useMemo"),
  false,
  "Runtime detail must not derive a single account for a runtime",
);

assert.equal(
  source.includes('<p className="muted">Account</p>'),
  false,
  "Runtime detail status card must not display Account as a runtime property",
);

assert.equal(
  source.includes("type RuntimeManagementTab"),
  true,
  "Runtime Management should use page-local tabs for the main panel",
);

assert.equal(
  source.includes("runtime-management-sidebar"),
  false,
  "Runtime Management primary page should no longer render a right-side operation sidebar",
);

for (const token of ["PageHeader", "PageTabs", "All Runtimes", "Create Runtime", "Failure Overview", "RuntimeCredentialsPanel", "showAdmissionFailures={false}"]) {
  assert.equal(source.includes(token), true, `Runtime Management should include ${token}`);
}

assert.equal(
  source.includes("New self-hosted runtime"),
  false,
  "Runtime creation should be consolidated under the Create Runtime tab",
);

assert.equal(
  source.includes("listRuntimeAdmissionFailures(5)"),
  true,
  "Runtime Management failure overview should only request the latest 5 failures",
);
