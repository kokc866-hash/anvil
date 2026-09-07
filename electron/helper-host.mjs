import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { join, normalize, relative, sep } from "node:path";
import { readdir } from "node:fs/promises";
import { helperModelInfo, adoptLegacyHelper, downloadHelperBundle, cancelHelperDownload, deleteHelperBundle, recoverHelperBundles } from "./helper-files.mjs";
import { randomBytes } from "node:crypto";
import { helperDir } from "./paths.mjs";
import { listenLocal, pipeQuiet } from "../scripts/llm-agent.mjs";
import { handleOnce, onSync } from "./ipc.mjs";
import { fetchJsonText, hfAllowed, diskRel, helperModelId, parseHelperPath } from "./hf-get.mjs";
import { allowCorsOrigin } from "../companion/guard.mjs";

export { helperDir };
export const HELPER_PORT = 7847;
let boundPort = HELPER_PORT;
const TOKEN = randomBytes(16).toString("hex");

function safeJoin(root, rel) {
  const p = normalize(join(root, rel));
  const relTo = relative(root, p);
  if (relTo.startsWith("..") || relTo.startsWith(sep)) throw new Error("Pfad ungültig");
  return p;
}

let listCache = null;
let listGeneration = 0;
let listPromise = null;
function invalidateList() { listGeneration++; listCache = null; listPromise = null; }
async function modelList() {
  const root = helperDir();
  if (listCache?.root === root && Date.now() - listCache.t < 5000) return listCache.rows;
  if (listPromise) return listPromise;
  const generation = listGeneration;
  const promise = (async () => {
    const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
    const rows = await Promise.all(dirs.filter((d) => d.isDirectory() && d.name !== "libs" && !d.name.startsWith(".")).map(async (d) => ({ id: d.name, ...await helperModelInfo(join(root, d.name)) })));
    if (generation === listGeneration) listCache = { root, t: Date.now(), rows };
    return rows;
  })().finally(() => { if (listPromise === promise) listPromise = null; });
  listPromise = promise;
  return promise;
}

export async function startHelperHost() {
  mkdirSync(helperDir(), { recursive: true });
  mkdirSync(join(helperDir(), "libs"), { recursive: true });
  try {
    const recovery = await recoverHelperBundles(helperDir());
    for (const issue of recovery.issues) console.warn("Helfer-Wiederherstellung:", issue.id, issue.error);
  } catch (error) { console.warn("Helfer-Wiederherstellung:", error); }
  invalidateList();
  const server = createServer((req, res) => {
    const origin = allowCorsOrigin(req.headers.origin);
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type, x-anvil-helper");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    void serve(req, res);
  });
  boundPort = await listenLocal(server, "127.0.0.1", HELPER_PORT);
  onSync("helper-port-sync", () => boundPort);
  onSync("helper-auth-sync", () => ({ port: boundPort, token: TOKEN }));
  return server;
}

async function serve(req, res) {
  try {
    mkdirSync(helperDir(), { recursive: true });
    const u = new URL(req.url || "/", "http://127.0.0.1");
    const qTok = u.searchParams.get("t") || "";
    const hdr = String(req.headers["x-anvil-helper"] || "");
    let raw;
    if (hdr === TOKEN || qTok === TOKEN) {
      raw = decodeURIComponent(u.pathname).replace(/^\/+/, "");
      if (raw.startsWith("t/")) {
        const parsed = parseHelperPath(u.pathname, TOKEN);
        if (!parsed.ok) {
          res.statusCode = 401;
          res.end("token");
          return;
        }
        raw = parsed.rest;
      }
    } else {
      const parsed = parseHelperPath(u.pathname, TOKEN);
      if (!parsed.ok) {
        res.statusCode = 401;
        res.end("token");
        return;
      }
      raw = parsed.rest;
    }
    let file;
    try {
      file = safeJoin(helperDir(), diskRel(raw));
    } catch {
      res.statusCode = 400;
      res.end("bad path");
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", statSync(file).size);
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
  handleOnce("helper-auth", () => ({ port: boundPort, token: TOKEN }));
  handleOnce("helper-list", modelList);
  handleOnce("helper-has", async (_e, id, wasmName) => {
    const name = helperModelId(id);
    const dir = join(helperDir(), name);
    if ((await helperModelInfo(dir)).ready) return true;
    const adopted = await adoptLegacyHelper(dir, join(helperDir(), "libs"), wasmName);
    if (adopted) invalidateList();
    return adopted;
  });
  handleOnce("helper-cancel", async (_e, id) => {
    await cancelHelperDownload(helperDir(), id);
    invalidateList();
    return true;
  });
  handleOnce("helper-delete", async (_e, id) => {
    try { return await deleteHelperBundle(helperDir(), id); }
    finally { invalidateList(); }
  });
  handleOnce("helper-download", async (_e, job) => {
    try { return await downloadHelperBundle(helperDir(), job, send); }
    finally { invalidateList(); }
  });
}
