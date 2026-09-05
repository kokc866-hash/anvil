import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ANVIL_PARTITION, allowAnvilPerm, anvilWebPrefs } from "./session.mjs";

const dir = dirname(fileURLToPath(import.meta.url));

test("editor and run share persist:anvil", () => {
  assert.equal(ANVIL_PARTITION, "persist:anvil");
  assert.doesNotMatch(ANVIL_PARTITION, /^temp:/);
  const p = anvilWebPrefs("/preload.cjs");
  assert.equal(p.partition, ANVIL_PARTITION);
  assert.equal(p.preload, "/preload.cjs");
  assert.equal(p.sandbox, true);
  assert.equal(p.nodeIntegration, false);
  assert.equal(p.contextIsolation, true);
});

test("child windows must not use a temp partition", () => {
  const src = readFileSync(join(dir, "child.mjs"), "utf8");
  assert.doesNotMatch(src, /temp:anvil-run/);
  assert.match(src, /anvilWebPrefs/);
});

test("main window uses the same session helper", () => {
  const src = readFileSync(join(dir, "main.mjs"), "utf8");
  assert.match(src, /anvilWebPrefs/);
  assert.match(src, /allowAnvilPerm/);
  assert.doesNotMatch(src, /temp:anvil-run/);
});

test("preview iframe keeps sandbox without same-origin", () => {
  const src = readFileSync(join(dir, "..", "src", "components", "ide", "preview-pane.tsx"), "utf8");
  assert.match(src, /sandbox="allow-scripts/);
  assert.doesNotMatch(src, /allow-same-origin/);
});
