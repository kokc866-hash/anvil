import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

export const LLM_HEADERS = ["content-type", "accept", "authorization", "x-api-key", "api-key", "anthropic-version", "anthropic-beta", "openai-beta", "openai-organization", "openai-project", "x-goog-api-key", "http-referer", "x-title"];
export function llmHeaders(raw) {
  const out = {};
  for (const [key, value] of Object.entries(raw || {})) {
    if (LLM_HEADERS.includes(key.toLowerCase()) && typeof value === "string") out[key] = value;
  }
  return out;
}

function blockedLlmHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return h === "fd00:ec2::254" || h === "metadata.google.internal" || h === "metadata" || h === "0.0.0.0" || h === "::" || /^169\.254\./.test(h) || /^fe[89ab][0-9a-f]:/i.test(h) || /^::ffff:/i.test(h);
}

/** A user-configured Custom base grants only its own origin and path prefix. */
export function assertLlmTarget(raw, customBase = "") {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || blockedLlmHost(url.hostname)) throw new Error("Ungültiges Modellziel.");
  if (customBase) {
    const base = new URL(customBase);
    const path = base.pathname.replace(/\/+$/, "");
    if (base.username || base.password || base.search || base.hash || url.origin !== base.origin || !(url.pathname === path || url.pathname.startsWith(path + "/"))) throw new Error("Custom-Ziel liegt außerhalb der konfigurierten API-URL.");
    return url;
  }
  if (!isLlmTargetHost(url.hostname)) throw new Error("Eigenen Endpunkt unter Custom konfigurieren.");
  return url;
}

export function isLanHost(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (blockedLlmHost(h)) return false;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".internal") || h.endsWith(".ts.net")) return true;
  if (h === "::1" || h === "127.0.0.1") return true;
  if (isIP(h) === 6 && /^f[cd]/.test(h)) return true;
  const p = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!p) return false;
  const a = Number(p[1]);
  const b = Number(p[2]);
  if (p.slice(1).some((v) => Number(v) > 255)) return false;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

const CLOUD_LLM = new Set([
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.groq.com",
  "api.together.xyz",
  "api.together.ai",
  "api.fireworks.ai",
  "api.mistral.ai",
  "api.deepseek.com",
  "openrouter.ai",
  "api.x.ai",
  "api.perplexity.ai",
  "api.cohere.ai",
  "api.cohere.com",
  "router.huggingface.co",
  "api.cerebras.ai",
  "integrate.api.nvidia.com",
]);

export function isCloudLlmHost(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (CLOUD_LLM.has(h)) return true;
  if (h.endsWith(".openai.azure.com") || h.endsWith(".googleapis.com")) return true;
  return false;
}

export function isLlmTargetHost(host) {
  return isLanHost(host) || isCloudLlmHost(host);
}

export function isAbortNoise(err) {
  if (!err) return false;
  const c = typeof err === "object" && err && "code" in err ? String(err.code) : "";
  const n = typeof err === "object" && err && "name" in err ? String(err.name) : "";
  const m = err instanceof Error ? err.message : String(err);
  const cause = typeof err === "object" && err && "cause" in err ? err.cause : null;
  if (cause && cause !== err && isAbortNoise(cause)) return true;
  return (
    n === "AbortError" ||
    c === "ECONNRESET" ||
    c === "EPIPE" ||
    c === "ECONNABORTED" ||
    c === "ABORT_ERR" ||
    c === "ERR_STREAM_DESTROYED" ||
    c === "ERR_STREAM_PREMATURE_CLOSE" ||
    m === "aborted" ||
    /^(aborted|AbortError)$/i.test(m) ||
    /ECONNRESET|EPIPE|premature close|operation was aborted/i.test(m)
  );
}

export function noTimeout(server) {
  if (!server) return;
  server.timeout = 0;
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 0;
}

export function listenLocal(server, host, port, span = 16) {
  return new Promise((resolve, reject) => {
    let n = Number(port) || 0;
    const max = n + span;
    const onErr = (err) => {
      if (err && err.code === "EADDRINUSE" && n < max) {
        n += 1;
        try {
          server.listen(n, host);
        } catch (e) {
          onErr(e);
        }
        return;
      }
      server.off("error", onErr);
      reject(err);
    };
    server.on("error", onErr);
    server.once("listening", () => {
      server.off("error", onErr);
      noTimeout(server);
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : n);
    });
    server.listen(n, host);
  });
}

function swallow(stream) {
  if (!stream || typeof stream.on !== "function") return;
  stream.on("error", (err) => {
    if (!isAbortNoise(err)) return;
  });
}

/** Node-Stream → HTTP-Antwort. Abbruch darf den Prozess nicht killen. */
export function pipeQuiet(src, dest) {
  if (!src) {
    try {
      dest.end();
    } catch {
      /* */
    }
    return;
  }
  swallow(src);
  swallow(dest);
  src.on("error", () => {
    try {
      if (!dest.writableEnded) dest.end();
    } catch {
      /* */
    }
  });
  dest.on("error", () => {
    try {
      src.destroy?.();
    } catch {
      /* */
    }
  });
  src.pipe(dest);
}

/** Header sofort raus — sonst wartet der Browser bis zum ersten Token. */
export function openLlmPipe(res, upstream) {
  res.statusCode = upstream?.status || 200;
  const ct = upstream?.headers?.get?.("content-type");
  if (ct) res.setHeader("content-type", ct);
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  try {
    res.flushHeaders?.();
  } catch {
    /* */
  }
  if (!upstream?.stream) {
    try {
      res.end();
    } catch {
      /* */
    }
    return;
  }
  pipeQuiet(upstream.stream, res);
}

function killReq(req, incoming) {
  try {
    incoming?.destroy();
  } catch {
    /* */
  }
  try {
    req.destroy();
  } catch {
    /* */
  }
  try {
    req.socket?.destroy();
  } catch {
    /* */
  }
}

/** Node-http wie curl. Abbruch schließt den Socket — Ollama stoppt. */
export function llmUpstream(url, init = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      reject(e);
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const headers = { connection: "close", ...(init.headers || {}) };
    const body = init.body;
    const buf = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : String(body));
    if (buf && !headers["content-length"] && !headers["Content-Length"]) headers["content-length"] = String(buf.length);
    const ipv4 = /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname);
    let settled = false;
    let incoming = null;
    let req;

    const fail = (err) => {
      killReq(req, incoming);
      if (settled) return;
      settled = true;
      if (isAbortNoise(err) || (err instanceof Error && err.message === "Aborted")) {
        const e = new Error("Aborted");
        e.name = "AbortError";
        reject(e);
        return;
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: (init.method || "GET").toUpperCase(),
        headers,
        timeout: 0,
        family: ipv4 ? 4 : undefined,
      },
      (res) => {
        incoming = res;
        swallow(res);
        swallow(res.socket);
        res.setTimeout?.(0);
        const hdrs = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v == null) continue;
          hdrs.set(k, Array.isArray(v) ? v.join(", ") : String(v));
        }
        if (settled) {
          res.resume();
          res.destroy();
          return;
        }
        settled = true;
        resolve({
          status: res.statusCode || 502,
          statusText: res.statusMessage || "",
          headers: hdrs,
          stream: res,
        });
      },
    );
    swallow(req);
    req.setTimeout(0);
    req.on("timeout", () => fail(new Error("timeout")));
    req.on("error", (err) => fail(err));
    const sig = init.signal;
    if (sig) {
      if (sig.aborted) {
        fail(sig.reason instanceof Error ? sig.reason : new Error("Aborted"));
        return;
      }
      const onAbort = () => fail(new Error("Aborted"));
      sig.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => sig.removeEventListener("abort", onAbort));
    }
    if (buf) req.write(buf);
    req.end();
  });
}
