/** Bounded ACP v1 feasibility client. It grants no client filesystem/terminal tools. */
import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { cliEnvironment } from "./cli-runner.mjs";

const LIMIT = 1024 * 1024;
export function createAcpClient({
  command,
  args = [],
  cwd,
  signal,
  timeoutMs = 15000,
  onUpdate = () => {},
}) {
  if (
    typeof command !== "string" ||
    !isAbsolute(command) ||
    /\.(cmd|bat)$/i.test(command) ||
    !Array.isArray(args) ||
    args.length > 64 ||
    args.some((a) => typeof a !== "string" || a.length > 8192 || a.includes("\0")) ||
    !isAbsolute(cwd)
  )
    throw Error("ACP benötigt einen absoluten Programmpfad, einen Ordner und eine Argumentliste.");
  if (signal?.aborted) throw Error("ACP abgebrochen.");
  const child = spawn(command, args, {
    cwd,
    env: cliEnvironment(),
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let serial = 0,
    buffer = "",
    bytes = 0,
    ended = false,
    initialized,
    sessionId,
    turn = false;
  const deadline = Math.min(120000, Math.max(100, timeoutMs));
  function write(message) {
    if (!ended) child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  }
  function close(reason = new Error("ACP-Verbindung beendet.")) {
    if (ended) return;
    ended = true;
    signal?.removeEventListener("abort", abort);
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(reason);
    }
    pending.clear();
    child.stdin.destroy();
    if (child.pid && child.exitCode === null) {
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("error", () => child.kill());
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill();
        }
      }
    }
  }
  function abort() {
    if (sessionId) write({ method: "session/cancel", params: { sessionId } });
    close(new Error("ACP abgebrochen."));
  }
  signal?.addEventListener("abort", abort, { once: true });
  child.on("error", close);
  child.stdin.on("error", close);
  child.on("exit", (code) => close(new Error(`ACP-Prozess beendet (${code ?? "Signal"}).`)));
  child.stderr.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > LIMIT) close(new Error("ACP-Ausgabe zu groß."));
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (ended) return;
    bytes += Buffer.byteLength(chunk);
    if (bytes > LIMIT) {
      close(new Error("ACP-Ausgabe zu groß."));
      return;
    }
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0 && !ended) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        close(new Error("Ungültige ACP-Nachricht."));
        return;
      }
      if (msg?.jsonrpc !== "2.0") {
        close(new Error("Ungültige ACP-Protokollversion."));
        return;
      }
      if (typeof msg.method === "string") {
        if (msg.id !== undefined) {
          if (msg.method === "session/request_permission")
            write({ id: msg.id, result: { outcome: { outcome: "cancelled" } } });
          else
            write({
              id: msg.id,
              error: {
                code: -32601,
                message: "Client capability not available in Anvil ACP preview",
              },
            });
        } else if (
          msg.method === "session/update" &&
          sessionId &&
          msg.params?.sessionId === sessionId
        ) {
          try {
            onUpdate(msg.params.update);
          } catch {
            close(new Error("ACP-Ausgabe konnte nicht verarbeitet werden."));
          }
        }
        continue;
      }
      const job = pending.get(msg.id);
      if (!job) continue;
      pending.delete(msg.id);
      clearTimeout(job.timer);
      if (msg.error)
        job.reject(new Error(String(msg.error.message || "ACP-Anfrage fehlgeschlagen.")));
      else if (!Object.hasOwn(msg, "result")) job.reject(new Error("ACP-Ergebnis fehlt."));
      else job.resolve(msg.result);
    }
  });
  function request(method, params) {
    if (ended) return Promise.reject(new Error("ACP-Verbindung geschlossen."));
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(
        () => close(new Error("ACP-Zeitlimit erreicht. Kein automatischer Wiederholungsversuch.")),
        deadline,
      );
      pending.set(id, { resolve, reject, timer });
      write({ id, method, params });
    });
  }
  return {
    async initialize() {
      const result = await request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "anvil-acp-preview", version: "1" },
      });
      if (result?.protocolVersion !== 1) {
        close();
        throw Error("ACP-Version nicht unterstützt.");
      }
      initialized = result;
      return result;
    },
    async newSession() {
      if (!initialized || sessionId) throw Error("ACP-Sitzung nicht bereit.");
      const result = await request("session/new", { cwd, mcpServers: [] });
      if (typeof result?.sessionId !== "string" || !result.sessionId) {
        close();
        throw Error("ACP-Sitzungskennung fehlt.");
      }
      sessionId = result.sessionId;
      return result;
    },
    async prompt(text) {
      if (!sessionId || turn || typeof text !== "string" || !text.trim() || text.length > 32000)
        throw Error("ACP-Auftrag nicht bereit.");
      turn = true;
      try {
        return await request("session/prompt", { sessionId, prompt: [{ type: "text", text }] });
      } finally {
        turn = false;
      }
    },
    cancel: abort,
    close,
  };
}

export async function probeAcp(options) {
  const client = createAcpClient(options);
  try {
    const result = await client.initialize();
    return {
      protocolVersion: result.protocolVersion,
      agentInfo: result.agentInfo ?? null,
      agentCapabilities: result.agentCapabilities ?? {},
      authMethods: result.authMethods ?? [],
      scope: "initialization-only",
    };
  } finally {
    client.close();
  }
}
