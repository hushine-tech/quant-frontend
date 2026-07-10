import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const source = readFileSync(join(here, "../src/pages/NotificationManagement.tsx"), "utf8");

assert.match(
  source,
  /const confirmed = await confirmNotificationBinding\(\)/,
  "Confirm binding should inspect the returned notification settings instead of assuming success",
);

assert.match(
  source,
  /confirmed\.telegram\?\.status[\s\S]*toLowerCase\(\)[\s\S]*!== "bound"/,
  "Confirm binding must reject non-bound Telegram status",
);

assert.match(
  source,
  /Telegram binding confirmed\./,
  "Success notice should only be used after status=bound",
);

assert.doesNotMatch(
  source,
  /setSettings\(await confirmNotificationBinding\(\)\);[\s\S]*setNotice\("Telegram binding refreshed\."\)/,
  "Pending binding responses must not be shown as a successful refresh",
);

assert.match(
  source,
  /deliveryBlockedReason/,
  "Notification overview should compute an explicit delivery blocking reason",
);

assert.match(
  source,
  /Order and strategy Telegram delivery is blocked until the Telegram channel is bound\./,
  "Pending or unbound Telegram delivery must be called out before users wait for missing order alerts",
);

console.log("notification binding status guard OK");
