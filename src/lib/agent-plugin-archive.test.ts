import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { readPluginZip, pluginFileContent } from "./agent-plugin-archive.ts";
import { skillPackageZip } from "./skill-package.ts";

function buffer(bytes: Uint8Array): ArrayBuffer { return bytes.slice().buffer as ArrayBuffer; }
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(path: string, content: Uint8Array, compressed = false): Uint8Array {
  const name = new TextEncoder().encode(path), packed = compressed ? new Uint8Array(deflateRawSync(content)) : content;
  const local = new Uint8Array(30 + name.length + packed.length), l = new DataView(local.buffer);
  l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true); l.setUint16(8, compressed ? 8 : 0, true);
  l.setUint32(14, crc32(content), true); l.setUint32(18, packed.length, true); l.setUint32(22, content.length, true); l.setUint16(26, name.length, true);
  local.set(name, 30); local.set(packed, 30 + name.length);
  const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
  c.setUint32(0, 0x02014b50, true); c.setUint16(4, 0x314, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(10, compressed ? 8 : 0, true);
  c.setUint32(16, crc32(content), true); c.setUint32(20, packed.length, true); c.setUint32(24, content.length, true); c.setUint16(28, name.length, true); central.set(name, 46);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, 1, true); e.setUint16(10, 1, true); e.setUint32(12, central.length, true); e.setUint32(16, local.length, true);
  const output = new Uint8Array(local.length + central.length + end.length);
  output.set(local); output.set(central, local.length); output.set(end, local.length + central.length);
  return output;
}
function centralOffset(bytes: Uint8Array): number { return new DataView(bytes.buffer).getUint32(bytes.length - 6, true); }
const text = (value: string) => new TextEncoder().encode(value);

test("stored ZIP roundtrip preserves text and binary companion resources", async () => {
  const files = { "plugin.json": '{"name":"example"}', "skills/review/SKILL.md": "Anleitung mit Umlauten: Größe.", "assets/image.bin": "data:application/octet-stream;base64,AP8BAg==" };
  assert.deepEqual({ ...await readPluginZip(buffer(skillPackageZip(files))) }, files);
  assert.equal(pluginFileContent(new Uint8Array([0, 255, 1, 2])), files["assets/image.bin"]);
});

test("real raw-deflate ZIP is decompressed using native stream", async () => {
  const body = "Do not truncate instructions. ".repeat(500);
  assert.equal((await readPluginZip(buffer(zip("skills/review/SKILL.md", text(body), true))))["skills/review/SKILL.md"], body);
});

test("traversal, Windows device aliases, duplicate casing and directory conflicts are rejected", async () => {
  for (const name of ["../outside.md", "C:/outside.md", "folder/NUL.txt", "folder/file:stream", "folder/file."]) await assert.rejects(() => readPluginZip(buffer(zip(name, text("text")))));
  await assert.rejects(() => readPluginZip(buffer(skillPackageZip({ "a.md": "a", "A.md": "b" }))), /Doppelter/);
  await assert.rejects(() => readPluginZip(buffer(skillPackageZip({ file: "a", "file/child.md": "b" }))));
});

test("bad CRC, truncated input and disagreement between local and central paths are rejected", async () => {
  const badCrc = zip("check.md", text("123456789"));
  assert.equal(crc32(text("123456789")), 0xcbf43926, "independent published CRC32 test vector");
  new DataView(badCrc.buffer).setUint32(centralOffset(badCrc) + 16, 0, true);
  await assert.rejects(() => readPluginZip(buffer(badCrc)), /Beschädigte/);
  await assert.rejects(() => readPluginZip(new ArrayBuffer(3)));
  const mismatch = zip("check.md", text("test")); mismatch[30] = "x".charCodeAt(0);
  await assert.rejects(() => readPluginZip(buffer(mismatch)));
});

test("encrypted entries, symbolic links and advertised oversized files are rejected before use", async () => {
  const link = zip("link", text("../../outside"));
  new DataView(link.buffer).setUint32(centralOffset(link) + 38, (0xa1ff << 16) >>> 0, true);
  await assert.rejects(() => readPluginZip(buffer(link)), /Verknüpfungen/);
  const encrypted = zip("secret.txt", text("text"));
  new DataView(encrypted.buffer).setUint16(centralOffset(encrypted) + 8, 0x801, true);
  await assert.rejects(() => readPluginZip(buffer(encrypted)));
  const oversized = zip("large.txt", text("tiny"));
  new DataView(oversized.buffer).setUint32(centralOffset(oversized) + 24, 16 * 1024 * 1024 + 1, true);
  await assert.rejects(() => readPluginZip(buffer(oversized)), /Größenbegrenzung/);
});

test("deflate expansion cannot exceed declared size even with matching archive bounds", async () => {
  const dishonest = zip("large.txt", text("x".repeat(100_000)), true);
  new DataView(dishonest.buffer).setUint32(centralOffset(dishonest) + 24, 5, true);
  await assert.rejects(() => readPluginZip(buffer(dishonest)));
});
