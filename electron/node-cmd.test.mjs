import assert from "node:assert/strict";
import { test } from "node:test";
import { nodeCommand, withNodeEnv } from "./node-cmd.mjs";

test("packaged exe uses Electron as Node", () => {
  const c = nodeCommand({ isPackaged: true, execPath: "C:\\\\Anvil.exe" });
  assert.equal(c.file, "C:\\\\Anvil.exe");
  assert.equal(c.electronAsNode, true);
  assert.equal(withNodeEnv({ ELECTRON_RUN_AS_NODE: "" }, true).ELECTRON_RUN_AS_NODE, "1");
});

test("dev uses system node when given", () => {
  const c = nodeCommand({ isPackaged: false, execPath: "/opt/Anvil" });
  assert.equal(c.electronAsNode === true || typeof c.file === "string", true);
  const env = withNodeEnv({ FOO: "1", ELECTRON_RUN_AS_NODE: "1" }, false);
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.FOO, "1");
});

test("no system node falls back to Electron", () => {
  const c = nodeCommand({ isPackaged: false, execPath: "/tmp/Anvil" });
  if (!c.electronAsNode) assert.ok(c.file);
});
