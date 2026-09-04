import { keepDotName } from "./ws-skip.ts";

type Fflate = {
  zipSync: (files: Record<string, Uint8Array>, opts?: { level: number }) => Uint8Array;
  unzipSync: (data: Uint8Array) => Record<string, Uint8Array>;
  strToU8: (s: string) => Uint8Array;
  strFromU8: (u: Uint8Array) => string;
};

let mod: Fflate | null = null;

async function fflate(): Promise<Fflate> {
  if (!mod) {
    mod = (await import(/* @vite-ignore */ "https://esm.sh/fflate@0.8.2")) as Fflate;
  }
  return mod;
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
};

export function u8ToB64(u8: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s);
}

export function bytesToDataUrl(data: Uint8Array, mime: string): string {
  return `data:${mime};base64,${u8ToB64(data)}`;
}

/** Best-effort strings from uncompressed PDFs. Empty when the file is binary-only. */
export function extractPdfText(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let raw = "";
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]!;
    raw += c >= 32 && c < 127 ? String.fromCharCode(c) : "\n";
  }
  const bits: string[] = [];
  const re = /\((?:\\.|[^\\)]){4,}\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    bits.push(m[0].slice(1, -1).replace(/\\n/g, "\n").replace(/\\(.)/g, "$1"));
  }
  return bits.join(" ").replace(/\s+/g, " ").trim().slice(0, 80_000);
}

export async function zipFiles(files: Record<string, string>): Promise<Blob> {
  const { zipSync, strToU8 } = await fflate();
  const input: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    const m = content.match(/^data:([^;,]+);base64,(.+)$/s);
    if (m) {
      const bin = typeof Buffer !== "undefined" ? Buffer.from(m[2], "base64") : Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      input[path] = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
      continue;
    }
    input[path] = strToU8(content);
  }
  const out = zipSync(input, { level: 1 });
  const copy = new Uint8Array(out.byteLength);
  copy.set(out);
  return new Blob([copy], { type: "application/zip" });
}

export async function unzipFiles(buf: ArrayBuffer): Promise<Record<string, string>> {
  const { unzipSync, strFromU8 } = await fflate();
  const files = unzipSync(new Uint8Array(buf));
  const out: Record<string, string> = {};
  for (const [path, data] of Object.entries(files)) {
    if (path.endsWith("/")) continue;
    const rel = path.replace(/^\/+/, "");
    const ext = (rel.split(".").pop() ?? "").toLowerCase();
    const mime = IMAGE_MIME[ext];
    if (mime) {
      out[rel] = bytesToDataUrl(data, mime);
      continue;
    }
    if (ext === "pdf") {
      const text = extractPdfText(data);
      if (text.trim()) out[rel.replace(/\.pdf$/i, ".md")] = text;
      continue;
    }
    out[rel] = strFromU8(data);
  }
  return out;
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function stripZipRoot(files: Record<string, string>): Record<string, string> {
  const keys = Object.keys(files);
  if (!keys.length) return files;
  const root = keys[0].split("/")[0];
  if (!keys.every((k) => k === root || k.startsWith(`${root}/`))) return files;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) {
    const n = k.slice(root.length + 1);
    if (!n) continue;
    const first = n.split("/")[0] ?? n;
    if (first.startsWith(".") && !keepDotName(first)) continue;
    out[n] = v;
  }
  return out;
}
