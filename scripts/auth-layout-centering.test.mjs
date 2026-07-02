import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8");
const login = fs.readFileSync(path.join(root, "src/pages/Login.tsx"), "utf8");
const signup = fs.readFileSync(path.join(root, "src/pages/Signup.tsx"), "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  app.includes('location.pathname === "/login"') && app.includes('location.pathname === "/signup"'),
  "Layout should detect login/signup as auth routes.",
);
assert(
  app.includes("app-shell app-shell--auth") && app.includes("content-area content-area--auth"),
  "Auth routes should render through the centered auth shell.",
);
assert(
  /if \(isAuthRoute\)[\s\S]*?<main className="content-area content-area--auth">[\s\S]*?<\/main>[\s\S]*?<\/div>[\s\S]*?;\s*\}/.test(app),
  "Auth layout should return before rendering the sidebar layout.",
);
assert(login.includes('className="card auth-card"'), "Login card should use auth-card sizing.");
assert(signup.includes('className="card auth-card"'), "Signup card should use auth-card sizing.");
assert(css.includes(".content-area--auth") && css.includes("place-items: center"), "Auth content should be centered.");
assert(css.includes(".auth-card") && css.includes("width: min(100%, 420px)"), "Auth card should have stable centered width.");
assert(
  /@media \(max-width: 640px\)[\s\S]*?\.app-header--auth[\s\S]*?text-align: center/.test(css),
  "Auth header should stay centered on mobile.",
);

console.log("auth layout centering checks passed");
