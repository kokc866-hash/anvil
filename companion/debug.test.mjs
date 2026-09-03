import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { debugCmd, debugPoll, debugStart, debugStop, pythonBin } from "./debug.mjs";

function waitPause(id, ms = 4000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const p = debugPoll(id);
      if (p.pause || p.done) return resolve(p);
      if (Date.now() - t0 > ms) return reject(new Error("timeout"));
      setTimeout(tick, 40);
    };
    tick();
  });
}

function waitEval(id, ms = 4000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const p = debugPoll(id);
      if (p.eval || p.done) return resolve(p);
      if (Date.now() - t0 > ms) return reject(new Error("eval timeout"));
      setTimeout(tick, 40);
    };
    tick();
  });
}

describe("native python debug", () => {
  it("pauses and continues when python exists", async () => {
    if (!pythonBin()) return;
    const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-pydbg-"));
    let id = "";
    try {
      writeFileSync(path.join(dir, "app.py"), "x = 1\ny = x + 1\nprint(y)\n");
      const start = debugStart({ cwd: dir, path: "app.py", pauseOnEntry: true, breakpoints: { "app.py": [2] } });
      assert.equal(start.ok, true);
      id = start.id;
      const first = await waitPause(id);
      assert.ok(first.pause, first.stderr);
      debugCmd(id, "eval", "1+1");
      const ev = await waitEval(id);
      assert.equal(ev.eval, "2", ev.stderr);
      debugCmd(id, "continue");
      let end = await waitPause(id, 6000);
      for (let i = 0; i < 6 && !end.done; i++) {
        debugCmd(id, "continue");
        end = await waitPause(id, 6000);
      }
      assert.equal(end.done, true);
      debugStop(id);
    } finally {
      if (id) debugStop(id);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
