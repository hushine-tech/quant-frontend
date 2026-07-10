import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const app = readFileSync(path.join(root, "src/App.tsx"), "utf8");
const client = readFileSync(path.join(root, "src/api/client.ts"), "utf8");
const css = readFileSync(path.join(root, "src/index.css"), "utf8");

assert.match(client, /export function setAuthUser/, "client should persist authenticated user metadata");
assert.match(client, /export function getAuthUser/, "client should expose authenticated user metadata");
assert.match(client, /user_id/, "AuthUser should expose user_id for the profile display");
assert.match(client, /\/api\/portfolios/, "client should call the portfolio API hard-cut endpoint");
assert.doesNotMatch(client, /\/api\/accounts/, "client should not call the legacy account API endpoint");

assert.match(app, /Profile/, "app shell should render a profile region");
assert.match(app, /getAuthUser/, "app shell should read persisted auth user metadata");
assert.match(app, /app-profile__button/, "profile should be a clickable menu trigger");
assert.match(app, /aria-haspopup="dialog"/, "profile trigger should expose popover semantics");
assert.match(app, /app-profile__menu/, "profile should render a dropdown menu");
assert.doesNotMatch(app, /role="menu"/, "profile details panel should not hide static details behind menu semantics");
assert.doesNotMatch(app, /role="menuitem"/, "profile logout should remain a normal button inside the details panel");
assert.match(app, /USER ID:/, "profile menu should show USER ID label");
assert.match(app, /USER:/, "profile menu should show USER label");
assert.match(app, /app-profile__logout/, "log out action should live inside the profile menu");
assert.doesNotMatch(app, /className="sidebar-logout"/, "authed sidebar should not render a separate logout button");
assert.match(css, /\.app-profile__menu/, "profile dropdown should have shell CSS");
assert.match(css, /\.app-profile__logout[\s\S]*color:\s*#dc2626/, "profile logout should be styled red");
assert.match(app, /Portfolio Management/, "navigation should use Portfolio Management copy");
assert.match(app, /\/portfolios/, "navigation should route to /portfolios");
assert.doesNotMatch(app, /Account Management/, "navigation should not expose legacy Account Management copy");
assert.doesNotMatch(app, /\/accounts/, "navigation should not route to legacy /accounts");

console.log("profile and portfolio shell checks passed");
