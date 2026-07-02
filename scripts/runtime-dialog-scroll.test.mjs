import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../src/index.css"), "utf8");
const dialog = readFileSync(join(here, "../src/components/RuntimeSelectionDialog.tsx"), "utf8");

const dialogCardBlock = css.match(/\.dialog-card\s*\{[^}]+\}/)?.[0] ?? "";

assert.match(
  dialogCardBlock,
  /max-height:\s*calc\(100vh - 2rem\)/,
  "Dialog cards should stay within the viewport height.",
);

assert.match(
  dialogCardBlock,
  /overflow-y:\s*auto/,
  "Dialog cards should scroll vertically when coverage details exceed the viewport.",
);

assert.match(
  dialogCardBlock,
  /overscroll-behavior:\s*contain/,
  "Dialog scrolling should stay inside the modal instead of leaking to the page behind it.",
);

assert.equal(
  dialog.includes('className="dialog-close-button"'),
  true,
  "Runtime start dialog should expose a top close button when bottom actions are off-screen.",
);
