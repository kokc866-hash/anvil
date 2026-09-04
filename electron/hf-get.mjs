import http from "node:http";
import https from "node:https";
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
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
    h.endsWith("githubusercontent.com")
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

export function nodeReq(url, hops = 0) {
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
      { headers: { "User-Agent": UA, Accept: "*/*" } },
      (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, u).href;
          nodeReq(next, hops + 1).then(resolve, reject);
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

export async function downloadFile(url, dest, jsonOk) {
  mkdirSync(dirname(dest), { recursive: true });
  let last;
  const alts = jsonAlts(url);
  for (const a of alts) {
    try {
      const res = await nodeReq(a);
      const len = Number(res.headers["content-length"] || 0);
      if (len > MAX_FILE) {
        res.resume();
        throw new Error("Datei zu groß");
      }
      if (existsSync(dest) && len && statSync(dest).size === len) {
        res.resume();
        if (!dest.endsWith(".json") || jsonOk(dest)) return { bytes: len, skipped: true };
      }
      const tmp = `${dest}.part`;
      let n = 0;
      const cap = new Transform({
        transform(chunk, _enc, cb) {
          n += chunk.length;
          if (n > MAX_FILE) cb(new Error("Datei zu groß"));
          else cb(null, chunk);
        },
      });
      await pipeline(res, cap, createWriteStream(tmp));
      renameSync(tmp, dest);
      if (dest.endsWith(".json") && !jsonOk(dest)) {
        try {
          unlinkSync(dest);
        } catch {
          /* */
        }
        throw new Error(`unvollständige JSON: ${dest}`);
      }
      return { bytes: existsSync(dest) ? statSync(dest).size : 0, skipped: false };
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("Download fehlgeschlagen");
}
