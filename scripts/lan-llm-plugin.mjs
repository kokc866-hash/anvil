import { isLanHost, llmUpstream, noTimeout, pipeQuiet } from "./llm-agent.mjs";

function readReq(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Same-origin proxy: Anvil Node holt Ollama/LM Studio. Kein CORS im Fenster. */
export function lanLlmPlugin() {
  return {
    name: "anvil-lan-llm",
    apply: "serve",
    configureServer(server) {
      const bind = () => noTimeout(server.httpServer);
      bind();
      server.httpServer?.on("listening", bind);
      server.middlewares.use(async (req, res, next) => {
        const pathOnly = (req.url ?? "").split("?", 1)[0];
        if (pathOnly !== "/__lan") {
          next();
          return;
        }
        res.setHeader("x-anvil-lan", "1");
        if ((req.method ?? "GET") === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        const target = String(req.headers["x-anvil-target"] || "");
        try {
          req.socket?.setTimeout(0);
          res.setTimeout?.(0);
          const u = new URL(target);
          if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("nur http(s)");
          if (!isLanHost(u.hostname)) throw new Error("nur LAN/localhost");
          const method = (req.method ?? "GET").toUpperCase();
          const headers = {};
          if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
          if (req.headers.authorization) headers.authorization = req.headers.authorization;
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
          res.on("close", () => {
            if (!res.writableEnded) stop();
          });
          const r = await llmUpstream(u.toString(), {
            method,
            headers,
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
          if (res.headersSent) return;
          const cause = e && typeof e === "object" && "cause" in e ? e.cause : null;
          const bits = [
            e instanceof Error ? e.message : e,
            cause && typeof cause === "object" && "code" in cause ? cause.code : "",
            cause && typeof cause === "object" && "message" in cause ? cause.message : "",
          ].filter(Boolean);
          res.statusCode = 502;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: `Anvil erreicht das Modell nicht: ${bits.join(" — ")}` }));
        }
      });
    },
  };
}
