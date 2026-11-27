import { normalizePluginPath } from "./agent-plugin-package.ts";

export const PLUGIN_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const PLUGIN_ARCHIVE_FILES = 1000;

export function pluginFileContent(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.includes("\0")) return text;
  } catch { /* Preserve binary resources without executing or transforming them. */ }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:application/octet-stream;base64,${btoa(binary)}`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Bounded ZIP reader: no network dependency, extraction, scripts or filesystem links. */
export async function readPluginZip(buffer: ArrayBuffer): Promise<Record<string, string>> {
  if (buffer.byteLength > PLUGIN_ARCHIVE_BYTES) throw new Error("Das ZIP darf höchstens 32 MB groß sein.");
  const data = new Uint8Array(buffer), view = new DataView(buffer);
  const fail = () => new Error("Ungültiges oder nicht unterstütztes Plugin-ZIP.");
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === data.length) { end = i; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw fail();
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true), total = 0;
  if (count !== view.getUint16(end + 8, true) || count > PLUGIN_ARCHIVE_FILES || offset + directorySize !== end) throw fail();
  const files: Record<string, string> = Object.create(null), seen = new Set<string>();
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw fail();
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true), compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
    const nameSize = view.getUint16(offset + 28, true), extraSize = view.getUint16(offset + 30, true), commentSize = view.getUint16(offset + 32, true);
    const external = view.getUint32(offset + 38, true), local = view.getUint32(offset + 42, true);
    if (offset + 46 + nameSize + extraSize + commentSize > end || (flags & 1) || ![0, 8].includes(method) || view.getUint16(offset + 34, true)) throw fail();
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(offset + 46, offset + 46 + nameSize));
    const directory = raw.endsWith("/");
    const path = normalizePluginPath(directory ? raw.slice(0, -1) : raw);
    if (seen.has(path.toLowerCase())) throw new Error(`Doppelter ZIP-Pfad: ${path}`);
    seen.add(path.toLowerCase());
    const unixKind = (external >>> 16) & 0xf000;
    if (unixKind && unixKind !== 0x8000 && unixKind !== 0x4000) throw new Error("Verknüpfungen und Spezialdateien sind in Plugin-ZIPs nicht erlaubt.");
    if (local + 30 > offset || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 8, true) !== method || view.getUint16(local + 6, true) !== flags) throw fail();
    const localNameSize = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true);
    const start = local + 30 + localNameSize + localExtra;
    if (start + compressed > view.getUint32(end + 16, true) || start > offset) throw fail();
    const localName = new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(local + 30, local + 30 + localNameSize));
    if (localName !== raw) throw fail();
    total += size;
    if (total > PLUGIN_ARCHIVE_BYTES || size > 16 * 1024 * 1024) throw new Error("Das entpackte Plugin-ZIP überschreitet die Größenbegrenzung.");
    offset += 46 + nameSize + extraSize + commentSize;
    if (directory) { if (size || compressed) throw fail(); continue; }
    let bytes: Uint8Array;
    if (method === 0) bytes = data.subarray(start, start + compressed);
    else {
      const stream = new Blob([data.slice(start, start + compressed)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const reader = stream.getReader(), chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.length;
          if (length > size) { await reader.cancel(); throw fail(); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      bytes = new Uint8Array(length);
      let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    }
    if (bytes.length !== size || crc32(bytes) !== checksum) throw new Error(`Beschädigte ZIP-Datei: ${path}`);
    files[path] = pluginFileContent(bytes);
  }
  if (offset !== end) throw fail();
  const paths = Object.keys(files).map(path => path.toLowerCase());
  const names = new Set(paths);
  if (paths.some(path => path.split("/").slice(0, -1).some((_, index, parts) => names.has(parts.slice(0, index + 1).join("/"))))) throw fail();
  return files;
}
