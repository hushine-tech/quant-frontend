import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  APIError,
  formatRuntimeDependencyError,
  previewRunStrategy,
  setToken,
  validateStrategySource,
} from "../src/api/client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(join(here, "../src/api/client.ts"), "utf8");
const portfolioDetail = readFileSync(join(here, "../src/pages/PortfolioDetail.tsx"), "utf8");
const runtimeManagement = readFileSync(join(here, "../src/pages/RuntimeManagement.tsx"), "utf8");
const strategyList = readFileSync(join(here, "../src/pages/StrategyList.tsx"), "utf8");

const categories = new Map([
  ["UNSUPPORTED_STRATEGY_DEPENDENCY", "Unsupported strategy dependency"],
  ["STRATEGY_DEPENDENCY_UNAVAILABLE", "Runtime dependency unavailable"],
  ["STRATEGY_IMPORT_FAILED", "Strategy import initialization failed"],
  ["RUNTIME_DEPENDENCY_PROFILE_INVALID", "Runtime image profile invalid"],
  ["RUNTIME_DEPENDENCY_PROFILE_MISMATCH", "Runtime profile mismatch"],
]);

for (const [code, category] of categories) {
  const formatted = formatRuntimeDependencyError({
    code,
    module: "google.cloud",
    runtime_profile: "platform-python-3.13",
    runtime_profile_version: "1.0.0",
    image_build_id: "build-1",
    message: "Python module 'google.cloud' is not available",
    stack: "Traceback: /private/worker.py",
    path: "/private/worker.py",
    environment: "SECRET=value",
  });
  assert.ok(formatted?.includes(category), `${code} should use category ${category}`);
  assert.ok(formatted?.includes("google.cloud"), `${code} should include the module`);
  assert.ok(formatted?.includes("platform-python-3.13") && formatted.includes("1.0.0"), `${code} should include profile/version`);
  assert.ok(formatted?.includes("build-1"), `${code} should include image build ID`);
  assert.equal(formatted?.includes("Traceback"), false, `${code} must not render stack data`);
  assert.equal(formatted?.includes("/private/worker.py"), false, `${code} must not render paths`);
  assert.equal(formatted?.includes("SECRET=value"), false, `${code} must not render environment data`);
}
assert.equal(formatRuntimeDependencyError(undefined), null, "missing runtime_error should not invent a message");

setToken("test-token");
const originalFetch = globalThis.fetch;
let capturedRequest;
globalThis.fetch = async (input, init) => {
  capturedRequest = { input: String(input), init };
  return new Response(JSON.stringify({
    ok: false,
    issues: [{ code: "STRATEGY_DEPENDENCY_UNAVAILABLE", message: "dependency unavailable", module: "google.cloud", line: 1, symbol: "" }],
    runtime_profile: {
      schema_version: 1,
      profile_name: "platform-python-3.13",
      profile_version: "1.0.0",
      contract_sha256: "digest",
      hosted_python: "3.13",
      public_import_roots: ["numpy"],
      strategy_service_commit: "service",
      strategy_library_commit: "library",
      image_build_id: "build-1",
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};
try {
  const validation = await validateStrategySource("rt-1", "import numpy");
  assert.equal(capturedRequest.input, "http://localhost:8090/api/strategy/validate-source");
  assert.equal(capturedRequest.init.method, "POST");
  assert.deepEqual(JSON.parse(capturedRequest.init.body), { runtime_id: "rt-1", source: "import numpy" });
  assert.equal(validation.ok, false);
  assert.equal(validation.issues[0].module, "google.cloud");
  assert.equal(validation.runtime_profile.profile_name, "platform-python-3.13");

  globalThis.fetch = async () => new Response(JSON.stringify({
    error: "Python module 'google.cloud' is not available",
    runtime_error: {
      code: "STRATEGY_DEPENDENCY_UNAVAILABLE",
      module: "google.cloud",
      runtime_profile: "platform-python-3.13",
      runtime_profile_version: "1.0.0",
      image_build_id: "build-1",
      message: "Python module 'google.cloud' is not available",
      stack: "must be discarded",
    },
  }), { status: 412, headers: { "Content-Type": "application/json" } });
  await assert.rejects(
    previewRunStrategy(7, { runtime_id: "rt-1" }),
    (error) => error instanceof APIError
      && error.runtime_error?.code === "STRATEGY_DEPENDENCY_UNAVAILABLE"
      && !("stack" in error.runtime_error),
    "parseErr should preserve only the allowlisted runtime_error object",
  );
} finally {
  globalThis.fetch = originalFetch;
  setToken(null);
}

assert.ok(portfolioDetail.includes("formatRuntimeDependencyError"), "PortfolioDetail should use the runtime dependency formatter");
assert.ok(portfolioDetail.includes("APIError"), "PortfolioDetail should recognize structured API errors");
assert.ok(portfolioDetail.includes("job.runtime_error"), "PortfolioDetail should prefer download job runtime_error");
assert.ok(runtimeManagement.includes("RUNTIME_DEPENDENCY_PROFILE_INVALID"), "RuntimeManagement should identify invalid Runtime profiles");
assert.ok(runtimeManagement.includes("RUNTIME_DEPENDENCY_PROFILE_MISMATCH"), "RuntimeManagement should identify Runtime profile mismatches");
assert.ok(runtimeManagement.includes("f.reason"), "RuntimeManagement should show the safe admission reason");

assert.match(strategyList, /createStrategy\(\{ name, version, description, code \}\)/, "Strategy creation payload should remain storage-only");
assert.equal(strategyList.includes("validateStrategySource"), false, "Strategy creation must not implicitly validate against a Runtime");
assert.equal(strategyList.includes("runtime_id"), false, "Strategy creation must not require runtime_id");
assert.equal(strategyList.includes("RuntimeSelector"), false, "Strategy creation form must not add a Runtime selector");
const createPayload = clientSource.match(/export type CreateStrategyPayload = \{([\s\S]*?)\n\};/)?.[1] ?? "";
assert.equal(createPayload.includes("runtime_id"), false, "CreateStrategyPayload must remain Runtime-independent");

console.log("runtime dependency frontend contract checks passed");
