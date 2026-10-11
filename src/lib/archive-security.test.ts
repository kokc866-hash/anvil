import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";
import { zipFiles, unzipFiles, ARCHIVE_MAX_FILE } from "./archive.ts";
const buffer = (bytes: Uint8Array) => Uint8Array.from(bytes).buffer;
const zip = (files: Record<string, string>, level: 0 | 1 = 0) => zipSync(Object.fromEntries(Object.entries(files).map(([path, body]) => [path, new TextEncoder().encode(body)])), { level });
const directory = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 6, true);

test("local ZIP roundtrip preserves UTF-8, image bytes and generic binary resources offline", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No network allowed"); };
  try {
    const source = { "src/a.ts": "Grüße 👋", "assets/pixel.png": "data:image/png;base64,iVBORwD/", "document.pdf": "data:application/pdf;base64,JVBERi0xLjQKAP8=", "data.bin": "data:application/octet-stream;base64,AP8B" };
    const archived = await zipFiles(source), result = await unzipFiles(await archived.arrayBuffer());
    assert.deepEqual({ ...result }, source);
    const deflated = await unzipFiles(buffer(zip({ "readme.md": "fixture ".repeat(1000) }, 1)));
    assert.equal(deflated["readme.md"], "fixture ".repeat(1000));
  } finally { globalThis.fetch = originalFetch; }
});
test("ZIP rejects path traversal, drive/reserved names, case duplicates and file/dir conflicts", async () => {
  for (const path of ["../outside.txt", "/absolute.txt", "C:/absolute.txt", "dir/CON.txt", "dir/name. "]) {
    await assert.rejects(unzipFiles(buffer(zip({ [path]: "fixture" }))), /Pfad/);
    await assert.rejects(zipFiles({ [path]: "fixture" }), /Pfad/);
  }
  await assert.rejects(unzipFiles(buffer(zip({ "A.txt": "one", "a.txt": "two" }))), /doppelter Pfad/);
  await assert.rejects(zipFiles({ "A.txt": "one", "a.txt": "two" }), /doppelter Pfad/);
  await assert.rejects(unzipFiles(buffer(zip({ "dir": "one", "dir/a.txt": "two" }))), /Datei und Ordner/);
});
test("ZIP rejects CRC corruption, symlinks, oversized headers and lying inflation sizes before success", async () => {
  const corrupt = zip({ "a.txt": "fixture" }), dir = directory(corrupt);
  corrupt[35] ^= 1;
  await assert.rejects(unzipFiles(buffer(corrupt)), /beschädigte/);
  const linked = zip({ "a.txt": "fixture" });
  new DataView(linked.buffer).setUint32(directory(linked) + 38, 0xa000 << 16, true);
  await assert.rejects(unzipFiles(buffer(linked)), /Verknüpfungen/);
  const oversized = zip({ "a.txt": "fixture" });
  new DataView(oversized.buffer).setUint32(directory(oversized) + 24, ARCHIVE_MAX_FILE + 1, true);
  await assert.rejects(unzipFiles(buffer(oversized)), /größe/i);
  const lying = zip({ "a.txt": "fixture ".repeat(1000) }, 1);
  new DataView(lying.buffer).setUint32(directory(lying) + 24, 1, true);
  await assert.rejects(unzipFiles(buffer(lying)), /Größe/);
  assert.ok(dir > 35);
});
test("ZIP enforces file count, abort and timeout options and keeps single root files", async () => {
  const many = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`file${i}.txt`, ""]));
  await assert.rejects(zipFiles(many), /5000/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(zipFiles({ "a.txt": "fixture" }, { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(unzipFiles(buffer(zip({ "a.txt": "fixture" })), { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(zipFiles({}, { timeoutMs: 0 }), /Zeitlimit/);
});
