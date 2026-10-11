import { zipSync } from "fflate";
import { normalizePluginPath } from "./agent-plugin-package.ts";

// Covers normal projects up to the workspace's 96 MB persistence budget.
export const ARCHIVE_MAX_COMPRESSED = 64 * 1024 * 1024;
export const ARCHIVE_MAX_EXPANDED = 128 * 1024 * 1024;
export const ARCHIVE_MAX_FILE = 32 * 1024 * 1024;
export const ARCHIVE_MAX_FILES = 5000;
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", bmp: "image/bmp" };
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
const crc32 = (data: Uint8Array) => {
  let value = 0xffffffff;
  for (const byte of data) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
};

export function u8ToB64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function bytesToDataUrl(data: Uint8Array, mime: string): string {
  return `data:${mime};base64,${u8ToB64(data)}`;
}

/** Best-effort strings from uncompressed PDFs. Empty for binary-only files. */
export function extractPdfText(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let raw = "";
  for (const byte of bytes) raw += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : "\n";
  const bits: string[] = [], re = /\((?:\\.|[^\\)]){4,}\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) bits.push(match[0].slice(1, -1).replace(/\\n/g, "\n").replace(/\\(.)/g, "$1"));
  return bits.join(" ").replace(/\s+/g, " ").trim().slice(0, 80_000);
}

/** Preflight before structured cloning to the worker; exact bytes checked there. */
export function checkArchiveInput(files: Record<string, string>): void {
  const entries = Object.entries(files);
  if (entries.length > ARCHIVE_MAX_FILES) throw new Error("ZIP: höchstens 5000 Dateien.");
  let total = 0;
  for (const [path, content] of entries) {
    normalizePluginPath(path);
    if (typeof content !== "string" || content.length > ARCHIVE_MAX_FILE * 1.4) throw new Error(`ZIP: Datei zu groß: ${path}`);
    total += content.length;
    if (total > ARCHIVE_MAX_EXPANDED * 1.4) throw new Error("ZIP: Projekt überschreitet 128 MiB.");
  }
}

function checkPathSet(paths: string[]): void {
  const seen = new Set<string>();
  for (const path of paths) {
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error(`ZIP: doppelter Pfad: ${path}`);
    seen.add(key);
  }
  for (const path of seen) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) if (seen.has(parts.slice(0, i).join("/"))) throw new Error("ZIP: ein Pfad ist Datei und Ordner.");
  }
}

export function encodeArchive(files: Record<string, string>): Uint8Array {
  checkArchiveInput(files);
  const input: Record<string, Uint8Array> = Object.create(null), paths: string[] = [];
  let total = 0;
  for (const [raw, content] of Object.entries(files)) {
    const path = normalizePluginPath(raw), match = content.match(/^data:([^;,]+);base64,(.*)$/s);
    let bytes: Uint8Array;
    if (match) {
      const binary = atob(match[2]);
      bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    } else bytes = encoder.encode(content);
    total += bytes.length;
    if (bytes.length > ARCHIVE_MAX_FILE || total > ARCHIVE_MAX_EXPANDED) throw new Error("ZIP: Datei-/Projektgröße überschritten (32/128 MiB).");
    input[path] = bytes;
    paths.push(path);
  }
  checkPathSet(paths);
  const result = zipSync(input, { level: 1 });
  if (result.length > ARCHIVE_MAX_COMPRESSED) throw new Error("ZIP: komprimiertes Archiv überschreitet 64 MiB.");
  return result;
}

/** Validate all metadata before inflating; stream output is capped even if sizes lie. */
export async function decodeArchive(buffer: ArrayBuffer, signal?: AbortSignal): Promise<Record<string, string>> {
  signal?.throwIfAborted();
  if (buffer.byteLength > ARCHIVE_MAX_COMPRESSED) throw new Error("ZIP: komprimiertes Archiv überschreitet 64 MiB.");
  const bytes = new Uint8Array(buffer), view = new DataView(buffer), fail = () => new Error("Ungültiges oder nicht unterstütztes ZIP.");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw fail();
  const count = view.getUint16(end + 10, true), startDirectory = view.getUint32(end + 16, true), sizeDirectory = view.getUint32(end + 12, true);
  if (count !== view.getUint16(end + 8, true) || count > ARCHIVE_MAX_FILES || startDirectory + sizeDirectory !== end) throw fail();
  type Entry = { path: string; start: number; compressed: number; size: number; checksum: number; method: number; directory: boolean; local: number };
  const entries: Entry[] = [], seen = new Set<string>();
  let offset = startDirectory, total = 0;
  for (let index = 0; index < count; index++) {
    signal?.throwIfAborted();
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw fail();
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true), compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
    const external = view.getUint32(offset + 38, true), local = view.getUint32(offset + 42, true);
    if (offset + 46 + nameLength + extraLength + commentLength > end || (flags & 1) || ![0, 8].includes(method) || view.getUint16(offset + 34, true)) throw fail();
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)), directory = name.endsWith("/");
    const path = normalizePluginPath(directory ? name.slice(0, -1) : name), key = path.toLowerCase();
    if (seen.has(key)) throw new Error(`ZIP: doppelter Pfad: ${path}`);
    seen.add(key);
    const kind = (external >>> 16) & 0xf000;
    if (kind && kind !== 0x8000 && kind !== 0x4000) throw new Error("ZIP: Verknüpfungen und Spezialdateien sind nicht erlaubt.");
    if ((kind === 0x4000 && !directory) || local + 30 > startDirectory || view.getUint32(local, true) !== 0x04034b50
      || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) throw fail();
    const localNameLength = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true), start = local + 30 + localNameLength + localExtra;
    if (start > startDirectory || start + compressed > startDirectory || decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name) throw fail();
    total += size;
    if (size > ARCHIVE_MAX_FILE || total > ARCHIVE_MAX_EXPANDED) throw new Error("ZIP: entpackte Datei-/Projektgröße überschritten (32/128 MiB).");
    if (directory && (size || compressed)) throw fail();
    if (method === 0 && compressed !== size) throw fail();
    entries.push({ path, start, compressed, size, checksum, method, directory, local });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== end) throw fail();
  checkPathSet(entries.filter(entry => !entry.directory).map(entry => entry.path));
  const ranges = entries.slice().sort((a, b) => a.local - b.local);
  for (let i = 1; i < ranges.length; i++) if (ranges[i - 1].start + ranges[i - 1].compressed > ranges[i].local) throw fail();
  const result: Record<string, string> = Object.create(null);
  const outputNames = new Set<string>();
  for (const entry of entries) {
    signal?.throwIfAborted();
    if (entry.directory) continue;
    let data: Uint8Array;
    if (entry.method === 0) data = bytes.subarray(entry.start, entry.start + entry.compressed);
    else {
      const stream = new Blob([bytes.slice(entry.start, entry.start + entry.compressed)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const reader = stream.getReader(), chunks: Uint8Array[] = [];
      let length = 0;
      const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        for (;;) {
          signal?.throwIfAborted();
          const chunk = await reader.read();
          signal?.throwIfAborted();
          if (chunk.done) break;
          length += chunk.value.length;
          if (length > entry.size) { await reader.cancel(); throw new Error(`ZIP: entpackte Größe falsch: ${entry.path}`); }
          chunks.push(chunk.value);
        }
      } finally { signal?.removeEventListener("abort", abort); reader.releaseLock(); }
      data = new Uint8Array(length);
      let at = 0;
      for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; }
    }
    if (data.length !== entry.size || crc32(data) !== entry.checksum) throw new Error(`ZIP: beschädigte Datei: ${entry.path}`);
    const ext = entry.path.split(".").pop()?.toLowerCase() ?? "";
    const path = entry.path;
    let content: string;
    if (IMAGE_MIME[ext]) content = bytesToDataUrl(data, IMAGE_MIME[ext]);
    else if (ext === "pdf") content = bytesToDataUrl(data, "application/pdf");
    else {
      try { content = decoder.decode(data); if (content.includes("\0")) content = bytesToDataUrl(data, "application/octet-stream"); }
      catch { content = bytesToDataUrl(data, "application/octet-stream"); }
    }
    if (outputNames.has(path.toLowerCase())) throw new Error(`ZIP: Ausgabe-Pfad mehrfach vorhanden: ${path}`);
    outputNames.add(path.toLowerCase());
    result[path] = content;
  }
  checkPathSet(Object.keys(result));
  return result;
}
