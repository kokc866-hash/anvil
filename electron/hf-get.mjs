import http from "node:http";
import https from "node:https";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

const UA = "Anvil/1.1";
export const MAX_JSON = 8_000_000;
export const MAX_FILE = 2_400_000_000;
export const MAX_REDIRECTS = 5;
export const MAX_JOB_FILES = 400;

export function hfAllowed(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.replace(/^www\./, "");
  return (
    h === "huggingface.co" ||
    h.endsWith(".huggingface.co") ||
    h === "hf.co" ||
    h.endsWith(".hf.co") ||
    h === "hf-mirror.com" ||
    h.endsWith(".hf-mirror.com") ||
    h === "github.com" ||
    h.endsWith(".github.com") ||
    h === "githubusercontent.com" || h.endsWith(".githubusercontent.com")
  );
}

export function jsonAlts(url) {
  const out = [url];
  if (url.includes("huggingface.co/")) {
    out.push(url.replace("https://huggingface.co", "https://hf-mirror.com"));
    if (url.includes("/resolve/main/")) out.push(url.replace("/resolve/main/", "/raw/main/"));
  }
  return [...new Set(out)];
}

export function modelParts(rel) {
  const r = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (r.startsWith("libs/")) return { kind: "lib", id: "libs", file: r.slice(5) };
  const m = r.match(/^([\w.+-]+)\/(?:resolve\/main\/)?(.+)$/);
  if (!m) return null;
  return { kind: "model", id: m[1], file: m[2] };
}

export function diskRel(rel) {
  const p = modelParts(rel);
  if (!p) return String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (p.kind === "lib") return `libs/${p.file}`;
  return `${p.id}/${p.file}`;
}

export function hfSource(rel, src = "") {
  if (src && hfAllowed(src)) return src;
  const p = modelParts(rel);
  if (!p) return "";
  if (p.kind === "lib") {
    if (!/^[\w.+-]+\.wasm$/i.test(p.file)) return "";
    return `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/${p.file}`;
  }
  if (p.file.includes("..")) return "";
  return `https://huggingface.co/mlc-ai/${p.id}/resolve/main/${p.file}`;
}

export function helperModelId(id) {
  const s = String(id || "").trim();
  if (!s || s.length > 180) throw new Error("id ungültig");
  if (s === "libs" || s === "t" || s.includes("..") || s.startsWith(".")) throw new Error("id ungültig");
  if (!/^[\w][\w.+-]*$/.test(s)) throw new Error("id ungültig");
  return s;
}

export function parseHelperPath(pathname, token) {
  const raw = decodeURIComponent(String(pathname || "")).replace(/^\/+/, "");
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "t" && parts[1]) {
    if (parts[1] !== token) return { ok: false, rest: "", reason: "token" };
    return { ok: true, rest: parts.slice(2).join("/"), reason: "" };
  }
  return { ok: false, rest: "", reason: "token" };
}

export function nodeReq(url, hops = 0, options = {}) {
  return new Promise((resolve, reject) => {
    if (hops > MAX_REDIRECTS) return reject(new Error("zu viele Redirects"));
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error("URL ungültig"));
    }
    if (!hfAllowed(u.href)) return reject(new Error("nur HuggingFace"));
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.get(
      u,
      { headers: { "User-Agent": UA, Accept: "*/*" }, signal: options.signal },
      (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, u).href;
          nodeReq(next, hops + 1, options).then(resolve, reject);
          return;
        }
        if (code >= 400) {
          res.resume();
          reject(new Error(`HTTP ${code}`));
          return;
        }
        resolve(res);
      },
    );
    req.on("error", reject);
    req.setTimeout(180000, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

export async function nodeText(url, max = MAX_JSON) {
  const res = await nodeReq(url);
  const chunks = [];
  let n = 0;
  for await (const c of res) {
    n += c.length;
    if (n > max) {
      res.destroy?.();
      throw new Error("Antwort zu groß");
    }
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchJsonText(url) {
  let last;
  for (const a of jsonAlts(url)) {
    try {
      const text = await nodeText(a);
      const t = text.trim();
      if (!t || (t[0] !== "{" && t[0] !== "[")) throw new Error("keine JSON");
      JSON.parse(t);
      return text;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("JSON nicht lesbar");
}

export async function downloadFile(url, dest, jsonOk, options = {}) {
  mkdirSync(dirname(dest), { recursive: true });
  let last;
  for (const a of jsonAlts(url)) {
    const tmp = `${dest}.${randomUUID()}.part`;
    try {
      options.signal?.throwIfAborted();
      const res = await (options.request || nodeReq)(a, 0, { signal: options.signal });
      const len = Number(res.headers["content-length"] || 0);
      const etag = String(res.headers.etag || "");
      if (len > MAX_FILE) { res.destroy(); throw new Error("Datei zu groß"); }
      let prior;
      try { prior = JSON.parse(readFileSync(`${dest}.http.json`, "utf8")); } catch { /* first download */ }
      // Length alone cannot identify a revision. Explicit updates revalidate
      // against a server ETag; missing validators require a fresh download.
      if (etag && prior?.etag === etag && prior.url === url && prior.sha256 && existsSync(dest)
          && statSync(dest).size === prior.bytes && (!len || len === prior.bytes)
          && (!dest.endsWith(".json") || jsonOk(dest))) {
        res.destroy();
        return { bytes: prior.bytes, sha256: prior.sha256, etag, skipped: true };
      }
      let n = 0;
      const hash = createHash("sha256");
      const cap = new Transform({
        transform(chunk, _enc, cb) {
          n += chunk.length;
          if (n > MAX_FILE) cb(new Error("Datei zu groß"));
          else { hash.update(chunk); cb(null, chunk); }
        },
      });
      await pipeline(res, cap, createWriteStream(tmp, { flags: "wx" }), { signal: options.signal });
      if (!n || (len && len !== n)) throw new Error("Datei unvollständig");
      if (dest.endsWith(".json") && !jsonOk(tmp)) throw new Error(`unvollständige JSON: ${dest}`);
      options.signal?.throwIfAborted();
      const sha256 = hash.digest("hex");
      renameSync(tmp, dest);
      writeFileSync(`${tmp}.http.json`, JSON.stringify({ url, bytes: n, etag, sha256 }));
      renameSync(`${tmp}.http.json`, `${dest}.http.json`);
      return { bytes: n, sha256, etag, skipped: false };
    } catch (err) {
      options.signal?.throwIfAborted();
      last = err;
    } finally {
      try { unlinkSync(tmp); } catch { /* already committed */ }
      try { unlinkSync(`${tmp}.http.json`); } catch { /* already committed */ }
    }
  }
  throw last instanceof Error ? last : new Error("Download fehlgeschlagen");
}
