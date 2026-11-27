import assert from "node:assert/strict";
import test from "node:test";
import { downloadVsix, resolveVsixUrl } from "./market.ts";
import { ARCHIVE_MAX_COMPRESSED } from "./archive.ts";

test("VSIX download is bounded before allocation and during streaming without Content-Length", async () => {
  const oldFetch = globalThis.fetch;
  try {
    let pulls = 0;
    globalThis.fetch = async () => new Response(new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(1)); } }), { headers: { "content-length": String(ARCHIVE_MAX_COMPRESSED + 1) } });
    await assert.rejects(downloadVsix("https://fixture.invalid/a.vsix"), /Größenbegrenzung/);
    assert.ok(pulls <= 1, "oversized declared body is never consumed");
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    }));
    await assert.rejects(downloadVsix("https://fixture.invalid/a.vsix"), /Größenbegrenzung/);
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = oldFetch; }
});
test("metadata is bounded, exact VSIX bytes are returned, and stalled bodies abort", async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": String(1024 * 1024 + 1) } });
    await assert.rejects(resolveVsixUrl("https://fixture.invalid/metadata"), /Größenbegrenzung/);
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
    assert.deepEqual(new Uint8Array(await downloadVsix("https://fixture.invalid/a.vsix")), new Uint8Array([1, 2, 3]));
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({ start() {}, cancel() { cancelled = true; } }));
    const controller = new AbortController(), pending = downloadVsix("https://fixture.invalid/a.vsix", controller.signal);
    await new Promise(resolve => setImmediate(resolve)); controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = oldFetch; }
});
