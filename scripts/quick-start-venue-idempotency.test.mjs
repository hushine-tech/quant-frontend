import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const venueManagementPath = path.join(root, "src/pages/VenueManagement.tsx");
const source = readFileSync(venueManagementPath, "utf8");

assert.match(source, /findReusableVenue/, "Venue create should look up an existing compatible venue after duplicate errors");
assert.match(source, /venue already exists for account route or api key scope/, "Venue create should recognize the backend duplicate-route error");
assert.match(source, /onCreated\(existingVenue/, "Duplicate-route recovery should reuse the existing venue and trigger the normal created callback");
assert.match(source, /Venue already exists; using existing venue/, "Non-QuickStart duplicate recovery should surface a notice instead of a blocking error");

console.log("quick start venue idempotency checks passed");
