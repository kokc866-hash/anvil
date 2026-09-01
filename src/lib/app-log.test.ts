import assert from "node:assert/strict";
import { test } from "node:test";
import { appLog, appLogLines, clearAppLog, dumpAppLog, setAppLogOn } from "./app-log.ts";

test("app log records redacted lines", () => {
  clearAppLog();
  setAppLogOn(true);
  appLog("http", "HTTP 400 Bearer sk-abcdefghijklmnopqrstuvwxyz");
  const last = appLogLines().at(-1);
  assert.ok(last);
  assert.equal(last.tag, "http");
  assert.equal(last.msg.includes("sk-"), false);
  assert.match(last.msg, /redacted|HTTP 400/);
});

test("off writes nothing", () => {
  clearAppLog();
  setAppLogOn(false);
  appLog("agent", "start");
  assert.equal(appLogLines().length, 0);
  setAppLogOn(true);
});

test("dump has version header", () => {
  clearAppLog();
  setAppLogOn(true);
  appLog("boot", "Anvil test");
  const d = dumpAppLog();
  assert.match(d, /Anvil /);
  assert.match(d, /App-Log/);
  assert.match(d, /boot/);
});
