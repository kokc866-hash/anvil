import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { packedServerEnv, packedServerPath, serverLaunch } from "./ui-boot.mjs";

test("packaged without ui-build is a clear error", () => {
  const dir = mkdtempSync(join(tmpdir(), "anvil-ui-"));
  const r = serverLaunch(dir, true, 8080);
  assert.equal(r.kind, undefined);
  assert.match(r.error, /UI fehlt/);
  rmSync(dir, { recursive: true, force: true });
});

test("packaged with ui-build launches nitro", () => {
  const dir = mkdtempSync(join(tmpdir(), "anvil-ui-"));
  const entry = packedServerPath(dir);
  mkdirSync(join(dir, "ui-build", "server"), { recursive: true });
  writeFileSync(entry, "export {}\n");
  const r = serverLaunch(dir, true, 8080);
  assert.equal(r.kind, "packed");
  assert.equal(r.args[0], entry);
  assert.equal(r.extraEnv.PORT, "8080");
  assert.equal(packedServerEnv(8080).NITRO_PORT, "8080");
  rmSync(dir, { recursive: true, force: true });
});

test("unpackaged does not require ui-build", () => {
  const dir = mkdtempSync(join(tmpdir(), "anvil-ui-"));
  const r = serverLaunch(dir, false, 8080);
  assert.equal(r.kind, undefined);
  assert.match(r.error, /Vite fehlt/);
  rmSync(dir, { recursive: true, force: true });
});
