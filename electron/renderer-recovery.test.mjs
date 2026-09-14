import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { bindRendererRecovery } from "./renderer-recovery.mjs";

const settle = () => new Promise(resolve => setImmediate(() => setImmediate(resolve)));
function fixture(response = 0, fails = false, shutdown = Promise.resolve()) {
  const window = new EventEmitter(); window.webContents = new EventEmitter(); window.isDestroyed = () => false;
  const seen = { logs: [], stopped: 0, reset: 0, restored: 0, closed: 0, dialogs: [] };
  bindRendererRecovery({ window,
    dialog: { showMessageBox: async (_w, options) => { seen.dialogs.push(options); return { response }; }, showErrorBox: () => {} },
    log: (...args) => seen.logs.push(args), stopJobs: () => { seen.stopped++; return shutdown; }, resetClose: () => seen.reset++,
    restore: async () => { seen.restored++; if (fails) throw new Error("failure"); }, close: () => seen.closed++,
  });
  return { window, seen, crash: reason => window.webContents.emit("render-process-gone", {}, { reason, exitCode: -1 }) };
}
test("renderer crash is logged and user-selected recovery happens outside the crash event", async () => {
  const f = fixture(); f.crash("oom");
  assert.equal(f.seen.restored, 0); assert.equal(f.seen.reset, 1);
  await settle();
  assert.equal(f.seen.restored, 1); assert.equal(f.seen.closed, 0); assert.equal(f.seen.stopped, 1);
  assert.match(f.seen.dialogs[0].message, /Arbeitsspeicher/);
  assert.deepEqual(f.seen.logs[0], ["renderer-gone", { reason: "oom", exitCode: -1 }]);
});
test("recovery waits for old connections to stop before creating a new renderer", async () => {
  let finish;
  const f = fixture(0, false, new Promise(resolve => { finish = resolve; }));
  f.crash("crashed"); await settle(); assert.equal(f.seen.restored, 0);
  finish(); await settle(); assert.equal(f.seen.restored, 1);
});
test("close choice never reloads, normal shutdown never opens recovery", async () => {
  const f = fixture(1); f.crash("clean-exit"); await settle(); assert.equal(f.seen.dialogs.length, 0);
  f.crash("crashed"); await settle(); assert.equal(f.seen.closed, 1); assert.equal(f.seen.restored, 0);
  f.window.emit("closed"); assert.equal(f.window.webContents.listenerCount("render-process-gone"), 0);
});
test("failed recovery closes instead of leaving a black window", async () => {
  const f = fixture(0, true); f.crash("crashed"); await settle();
  assert.equal(f.seen.closed, 1); assert.equal(f.seen.logs.at(-1)[0], "renderer-recovery-failed");
});
