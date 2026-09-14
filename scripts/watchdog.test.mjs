import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function waitFor(read, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read().catch(() => null);
    if (value) return value;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("Watchdog condition timed out");
}

test("external Windows watcher survives abrupt parent death and preserves independent samples", { skip: process.platform !== "win32", timeout: 60000 }, async () => {
  const base = path.resolve("artifacts/watchdog-test"); await mkdir(base, { recursive: true });
  const logs = await mkdtemp(path.join(base, "run-"));
  // The monitored process itself launches the production watcher. A sibling
  // process launched by this test would not prove survival of its parent.
  const parent = spawn(process.execPath, ["--input-type=module", "-e", `
    import { EventEmitter } from 'node:events';
    import { startWatchdog } from ${JSON.stringify(pathToFileURL(path.resolve("electron/watchdog.mjs")).href)};
    const app = Object.assign(new EventEmitter(), { getVersion: () => 'test', getAppMetrics: () => [] });
    const watcher = startWatchdog({ app, getWindow: () => null, logs: ${JSON.stringify(logs)}, intervalMs: 1000, graceSeconds: 3 });
    console.log(watcher.directory);
    setInterval(()=>{},1000);
  `], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ANVIL_WATCHDOG: "1" } });
  let stdout = "", stderr = "";
  parent.stdout.on("data", b => { stdout += b; }); parent.stderr.on("data", b => { stderr += b; });
  const directory = await waitFor(async () => stdout.includes("\n") ? stdout.trim() : null);
  const summary = async () => JSON.parse(await readFile(path.join(directory, "summary.json"), "utf8"));
  const samples = async () => (await readFile(path.join(directory, "samples.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  try {
    await waitFor(async () => { const s = await summary(); return s.samples >= 2 || s.ended; });
    assert.notEqual((await summary()).reason, "watchdog-error", JSON.stringify(await samples()));
    const initial = (await samples()).filter(s => s.event === "sample");
    assert(initial.some(s => s.parentAlive && s.processes.some(p => p.pid === parent.pid && p.privateBytes > 0)));
    assert(initial.some(s => s.system?.totalBytes > 0 && s.system.commitLimitBytes >= s.system.commitBytes));
    parent.kill();
    const end = await waitFor(async () => { const s = await summary(); return s.ended ? s : null; });
    assert.equal(end.reason, "parent-exited", stderr);
    const after = (await samples()).filter(s => s.event === "sample" && !s.parentAlive);
    assert(after.length >= 2, "must continue sampling after parent exit");
    assert(Date.parse(after.at(-1).at) - Date.parse(after[0].at) >= 3000);
    assert(after.every(s => s.system.totalBytes > 0), "OS samples must continue independently after heartbeat stops");
    assert(end.peakPrivateBytes > 0);
    assert.equal(stderr, "");
  } finally { parent.kill(); await writeFile(path.join(directory, "stop"), "QA finished"); }
});
