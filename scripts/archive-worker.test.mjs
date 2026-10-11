import assert from "node:assert/strict";
import test from "node:test";
import { Worker as NodeWorker } from "node:worker_threads";
import { zipFiles, unzipFiles } from "../src/lib/archive.ts";

test("archive module worker completes offline, preserves caller buffers and terminates on abort/timeout", async t => {
  const originals = new Map(["window", "Worker", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const active = new Set();
  let started = 0, terminated = 0;
  class WorkerAdapter {
    constructor(url) {
      started++;
      this.worker = new NodeWorker(`
        const {parentPort} = require('node:worker_threads');
        globalThis.fetch = async () => { throw new Error('No network in archive worker fixture'); };
        globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
        (async () => {
          await import(${JSON.stringify(url.href)});
          parentPort.on('message', data => globalThis.onmessage({data}));
        })().catch(error => { throw error; });
      `, { eval: true });
      active.add(this.worker);
      this.worker.on("message", data => this.onmessage?.({ data }));
      this.worker.on("error", error => this.onerror?.({ message: error.message }));
    }
    postMessage(payload, transfer) { this.worker.postMessage(payload, transfer); }
    terminate() { terminated++; active.delete(this.worker); void this.worker.terminate(); }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: WorkerAdapter });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async () => { throw new Error("No parent network"); } });
  t.after(async () => {
    await Promise.all([...active].map(worker => worker.terminate()));
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  });
  const source = { "readme.md": "module worker fixture", "pixel.png": "data:image/png;base64,iVBORwD/", "document.pdf": "data:application/pdf;base64,JVBERi0xLjQKAP8=" };
  const blob = await zipFiles(source), bytes = await blob.arrayBuffer(), length = bytes.byteLength;
  assert.deepEqual({ ...await unzipFiles(bytes) }, source);
  assert.equal(bytes.byteLength, length, "unzip transfers a copy, never detaches the caller's buffer");
  assert.equal(terminated, 2);
  const controller = new AbortController(), pending = zipFiles(source, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(zipFiles(source, { timeoutMs: 1 }), { name: "TimeoutError" });
  assert.equal(started, 4);
  assert.equal(terminated, 4);
  assert.equal(active.size, 0);
});
