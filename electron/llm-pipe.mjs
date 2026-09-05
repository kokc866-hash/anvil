/**
 * Native Ollama/LM-Studio-Leitung. Renderer spricht nur 127.0.0.1,
 * Node holt das Modell — wie curl, ohne CORS und ohne 5-Minuten-Abbruch.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { isLlmTargetHost, llmUpstream, listenLocal, pipeQuiet } from "../scripts/llm-agent.mjs";
import { handleOnce, onSync } from "./ipc.mjs";
import { pipeCorsOrigin } from "./llm-pipe-cors.mjs";

export const LLM_PIPE_PORT = 7848;

function readReq(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function fwdHeaders(req) {
  const skip = new Set(["host", "connection", "content-length", "transfer-encoding", "x-anvil-target", "x-anvil-pipe"]);
  const out = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (skip.has(String(k).toLowerCase())) continue;
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export async function startLlmPipe() {
  const token = randomBytes(16).toString("hex");
  const server = createServer(async (req, res) => {
    const allow = pipeCorsOrigin(req.headers.origin);
    if (allow) res.setHeader("Access-Control-Allow-Origin", allow);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, x-anvil-target, x-anvil-pipe");
    res.setHeader("x-anvil-lan", "1");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    const path = (req.url || "/").split("?")[0];
    if (path !== "/pipe") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    if (String(req.headers["x-anvil-pipe"] || "") !== token) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "pipe token" }));
      return;
    }
    const target = String(req.headers["x-anvil-target"] || "");
    try {
      req.socket?.setTimeout(0);
      res.setTimeout?.(0);
      const u = new URL(target);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("nur http(s)");
      if (!isLlmTargetHost(u.hostname)) throw new Error("nur LAN/Cloud-LLM");
      const method = (req.method ?? "GET").toUpperCase();
      const buf = method === "GET" || method === "HEAD" ? undefined : await readReq(req);
      const ac = new AbortController();
      const stop = () => {
        try {
          ac.abort();
        } catch {
          /* */
        }
      };
      req.on("aborted", stop);
      const r = await llmUpstream(u.toString(), {
        method,
        headers: fwdHeaders(req),
        body: buf && buf.length ? buf : undefined,
        signal: ac.signal,
      });
      res.statusCode = r.status;
      const ct = r.headers.get("content-type");
      if (ct) res.setHeader("content-type", ct);
      if (!r.stream) {
        res.end();
        return;
      }
      pipeQuiet(r.stream, res);
    } catch (e) {
      if (res.headersSent) {
        try {
          res.destroy();
        } catch {
          /* */
        }
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (/abort/i.test(msg)) {
        res.statusCode = 499;
        res.end();
        return;
      }
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: `Anvil erreicht das Modell nicht: ${msg}` }));
    }
  });
  server.on("clientError", (_err, socket) => {
    try {
      socket.destroy();
    } catch {
      /* */
    }
  });
  const port = await listenLocal(server, "127.0.0.1", LLM_PIPE_PORT);
  const info = { port, token };
  handleOnce("llm-pipe-info", () => info);
  onSync("llm-pipe-sync", () => info);
  return server;
}
