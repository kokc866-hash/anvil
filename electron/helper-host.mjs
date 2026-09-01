import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, normalize, relative, sep } from "node:path";
import { helperDir } from "./paths.mjs";
import { listenLocal, pipeQuiet } from "../scripts/llm-agent.mjs";
import { handleOnce, onSync } from "./ipc.mjs";
import { downloadFile, fetchJsonText, hfAllowed, diskRel, hfSource } from "./hf-get.mjs";

export { helperDir };
export const HELPER_PORT = 7847;
let boundPort = HELPER_PORT;

function safeJoin(root, rel) {
  const p = normalize(join(root, rel));
  const relTo = relative(root, p);
  if (relTo.startsWith("..") || relTo.startsWith(sep)) throw new Error("Pfad ungültig");
  return p;
}

function jsonFileOk(p) {
  try {
    const t = readFileSync(p, "utf8").trim();
    if (!t || (t[0] !== "{" && t[0] !== "[")) return false;
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function modelReady(dir) {
  const cfg = join(dir, "mlc-chat-config.json");
  const cache = join(dir, "ndarray-cache.json");
  if (!jsonFileOk(cfg) || !jsonFileOk(cache)) return false;
  try {
    const rec = JSON.parse(readFileSync(cache, "utf8"));
    const rows = rec.records || [];
    if (!rows.length) return false;
    let ok = 0;
    for (const r of rows) {
      const fp = join(dir, r.dataPath || "");
      if (existsSync(fp) && statSync(fp).size > 0) ok += 1;
    }
    return ok >= Math.max(1, rows.length - 1);
  } catch {
    return false;
  }
}

export async function startHelperHost() {
  mkdirSync(helperDir(), { recursive: true });
  mkdirSync(join(helperDir(), "libs"), { recursive: true });
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    void serve(req, res);
  });
  boundPort = await listenLocal(server, "127.0.0.1", HELPER_PORT);
  onSync("helper-port-sync", () => boundPort);
  return server;
}

function sourceUrl(rel, src) {
  return hfSource(rel, src);
}

async function ensureFile(rel, src) {
  const dest = safeJoin(helperDir(), diskRel(rel));
  if (existsSync(dest) && statSync(dest).size > 0 && (!dest.endsWith(".json") || jsonFileOk(dest))) return dest;
  const url = sourceUrl(rel, src);
  if (!url) return null;
  await downloadFile(url, dest, jsonFileOk);
  return dest;
}

async function serve(req, res) {
  try {
    mkdirSync(helperDir(), { recursive: true });
    const u = new URL(req.url || "/", "http://127.0.0.1");
    const raw = decodeURIComponent(u.pathname).replace(/^\/+/, "");
    const src = u.searchParams.get("src") || "";
    let file;
    try {
      file = safeJoin(helperDir(), diskRel(raw));
    } catch {
      res.statusCode = 400;
      res.end("bad path");
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      try {
        file = await ensureFile(raw, src);
      } catch (err) {
        res.statusCode = 404;
        res.end(err instanceof Error ? err.message : "not found");
        return;
      }
    }
    if (!file || !existsSync(file) || statSync(file).isDirectory()) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    if (req.method === "HEAD") {
      res.statusCode = 200;
      res.end();
      return;
    }
    pipeQuiet(createReadStream(file), res);
  } catch {
    if (!res.headersSent) {
      res.statusCode = 400;
      res.end("bad path");
    }
  }
}

export function bindHelperIpc(send) {
  handleOnce("helper-dir", () => helperDir());
  handleOnce("helper-json", async (_e, url) => {
    if (!hfAllowed(String(url || ""))) throw new Error("nur HuggingFace");
    return fetchJsonText(String(url));
  });
  handleOnce("helper-port", () => boundPort);
  handleOnce("helper-list", () => {
    const root = helperDir();
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "libs")
      .map((d) => {
        const dir = join(root, d.name);
        let bytes = 0;
        const walk = (p) => {
          for (const n of readdirSync(p, { withFileTypes: true })) {
            const fp = join(p, n.name);
            if (n.isDirectory()) walk(fp);
            else bytes += statSync(fp).size;
          }
        };
        try {
          walk(dir);
        } catch {
          bytes = 0;
        }
        const ready = modelReady(dir);
        return { id: d.name, bytes, ready };
      });
  });
  handleOnce("helper-has", (_e, id) => {
    return modelReady(join(helperDir(), String(id)));
  });
  handleOnce("helper-delete", (_e, id) => {
    const dir = join(helperDir(), String(id));
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    return true;
  });
  handleOnce("helper-download", async (_e, job) => {
    const { id, files } = job;
    const root = join(helperDir(), id);
    mkdirSync(root, { recursive: true });
    let done = 0;
    const total = files.length;
    for (const f of files) {
      const dest = f.lib ? join(helperDir(), "libs", f.rel) : safeJoin(root, f.rel);
      const r = await downloadFile(f.url, dest, jsonFileOk);
      done += 1;
      send({ id, rel: f.rel, done, total, bytes: r.bytes, skipped: r.skipped });
    }
    return { ok: true, dir: root };
  });
}
