import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = fs.readFileSync(path.join(ROOT, "public/coverage-owner.html"), "utf8");

assert.match(page, /<!doctype html>/i);
assert.match(page, /coverage owner/i);
for (const forbidden of [
  /<script\b/i,
  /<link\b/i,
  /<style\b/i,
  /<form\b/i,
  /<input\b/i,
  /<meta[^>]+http-equiv\s*=\s*["']?refresh/i,
  /fetch\s*\(/i,
  /XMLHttpRequest/i,
  /localStorage|sessionStorage|document\.cookie/i,
  /password|credential|token|secret/i,
]) {
  assert.doesNotMatch(page, forbidden);
}

console.log("coverage owner page contract: ok");
