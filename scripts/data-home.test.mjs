import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configureDataHome, dataHome } from "../electron/data-home.mjs";

test("source and renamed source runtimes keep their profile in the checkout", () => {
  const root = join(tmpdir(), "Anvil");
  for (const isPackaged of [false, true]) {
    assert.equal(dataHome({ root, execPath: join(root, "node_modules", "electron", "dist", "Anvil.exe"), isPackaged, defaultApp: true }), join(root, "data"));
  }
});

test("installed runtime keeps the profile beside the executable, outside resources", () => {
  const install = join(tmpdir(), "Anvil");
  assert.equal(dataHome({ root: join(install, "resources", "app"), execPath: join(install, "Anvil.exe"), isPackaged: true }), join(install, "data"));
});

test("explicit data and QA directories are respected; relative overrides fail", () => {
  const chosen = join(tmpdir(), "anvil-chosen");
  const qa = join(tmpdir(), "anvil-qa");
  assert.equal(dataHome({ env: { ANVIL_USER_DATA: chosen } }), chosen);
  assert.equal(dataHome({ env: { ANVIL_USER_DATA: chosen, ANVIL_QA_USER_DATA: qa } }), qa);
  assert.throws(() => dataHome({ env: { ANVIL_USER_DATA: "relative" } }), /absoluter/);
});

test("profile, sessions, crashes and application logs all use the selected data root", (t) => {
  const root = mkdtempSync(join(tmpdir(), "anvil-data-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = {};
  const app = { setPath: (key, value) => { paths[key] = value; }, setAppLogsPath: (value) => { paths.logs = value; } };
  const data = configureDataHome(app, { root, isPackaged: false });
  assert.deepEqual(paths, { userData: data, sessionData: data, crashDumps: join(data, "Crashpad"), logs: join(data, "logs") });
  const blocked = join(root, "blocked");
  writeFileSync(blocked, "file");
  assert.throws(() => configureDataHome(app, { env: { ANVIL_USER_DATA: join(blocked, "profile") } }));
  assert.equal(paths.userData, data, "a failed target must not fall back to AppData");
});
