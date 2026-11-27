import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";

test("search transfers only searchable source and still terminates on reply, abort and timeout", async (t) => {
  const workers = [];
  const oldWorker = globalThis.Worker;
  globalThis.Worker = class {
    constructor() { this.messages = []; this.stopped = false; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.stopped = true; }
  };
  const server = await createServer({ configFile: false, root: process.cwd(),
    optimizeDeps: { noDiscovery: true, entries: [] }, ssr: { optimizeDeps: { noDiscovery: true, include: [] } },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  t.after(async () => {
    t.mock.timers.reset(); await server.close();
    if (oldWorker === undefined) delete globalThis.Worker; else globalThis.Worker = oldWorker;
  });
  const { searchJob } = await server.ssrLoadModule("/src/lib/search-job.ts");
  const source = "find this";
  const initial = new AbortController();
  t.after(() => initial.abort());
  const promise = searchJob({ files: { "app.ts": source, ".env": "SECRET=find", "key.pem": "find",
    "node_modules/a.ts": "find", "image.png": "find", "opaque.txt": "data:application/octet-stream;base64,ZmluZA==",
    "nul.txt": "find\0binary", "too-large.ts": "find" + "x".repeat(1_500_000), "empty.ts": "" }, needle: "find", opts: {} }, initial.signal);
  void promise.catch(() => {});
  assert.deepEqual(Object.keys(workers[0].messages[0].files), ["app.ts"]);
  assert.equal(workers[0].messages[0].files["app.ts"], source);
  workers[0].onmessage({ data: { hits: [] } });
  assert.deepEqual(await promise, { hits: [] });
  assert.equal(workers[0].stopped, true);
  const controller = new AbortController();
  const aborted = searchJob({ files: { "app.ts": source }, needle: "(a+)+$", opts: { regex: true } }, controller.signal);
  controller.abort();
  await assert.rejects(aborted, { name: "AbortError" });
  assert.equal(workers[1].stopped, true);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const timed = searchJob({ files: { "app.ts": source }, needle: "(a+)+$", opts: { regex: true } });
  t.mock.timers.tick(5000);
  await assert.rejects(timed, /Suche dauert zu lange/);
  assert.equal(workers[2].stopped, true);
  t.mock.timers.reset();
  globalThis.Worker = class {
    constructor() { this.stopped = false; workers.push(this); }
    postMessage() { throw new Error("Cannot clone request"); }
    terminate() { this.stopped = true; }
  };
  await assert.rejects(searchJob({ files: { "app.ts": source }, needle: "find", opts: {} }), /Cannot clone request/);
  assert.equal(workers[3].stopped, true, "failed message transfer also releases the worker");
});
