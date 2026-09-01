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

export async function zipFiles(files: Record<string, string>): Promise<Blob> {
  const { zipSync, strToU8 } = await fflate();
  const input: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
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
    out[path.replace(/^\/+/, "")] = strFromU8(data);
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
    if (n && !n.startsWith(".")) out[n] = v;
  }
  return out;
}
