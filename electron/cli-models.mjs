import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { CLI_KINDS, cliEnvironment, completionArgs, findCli, runProcess, safeCliText, stopProcess } from "./cli-runner.mjs";
import { codexServerArgs } from "./cli-codex-server.mjs";

/** A CLI catalog is a list of suggestions, not proof of account access. */
export function parseCodexModels(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Codex CLI: Keine gültige Modellliste erhalten.");
  }
  if (!Array.isArray(value?.models)) throw new Error("Codex CLI: Ungültige Modellliste.");
  const ids = [];
  for (const row of value.models) {
    if (!row || typeof row !== "object" || typeof row.slug !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$/.test(row.slug))
      throw new Error("Codex CLI: Ungültiger Eintrag in der Modellliste.");
    if (row.visibility === "list") ids.push(row.slug);
  }
  return [...new Set(ids)];
}

function parseModels(value, field, label) {
  if (!Array.isArray(value?.models)) throw new Error(`${label}: Ungültige Modellliste.`);
  const ids = value.models.map(row => {
    const id = row?.[field];
    if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+[\]-]{0,199}$/.test(id))
      throw new Error(`${label}: Ungültiger Eintrag in der Modellliste.`);
    return id;
  });
  return [...new Set(ids)];
}

/** Metadata only: initialize Claude's control channel or call Copilot models.list.
 * Never send a user message, create a session, or accept a server tool request. */
function readCatalog(kind, command, { signal, env, cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("CLI abgebrochen."));
    const claude = kind === "claude";
    const args = claude ? completionArgs("claude", "sonnet", cwd).slice(0, -2)
      : ["--server", "--stdio", "--no-auto-update", "--no-custom-instructions", "--disable-builtin-mcps", "--available-tools=", "--deny-tool=*"];
    const child = spawn(command.file, [...command.args, ...args], {
      cwd, env: { ...env, ...(command.electronAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
      shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = Buffer.alloc(0), bytes = 0, stderr = "", ended = false, failure, result, shutdown;
    const deadline = setTimeout(() => finish(new Error("CLI-Modellliste: Zeitlimit erreicht.")), timeoutMs);
    function finish(error, ids) {
      if (ended) return;
      ended = true; failure = error; result = ids;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
      child.stdin.end();
      shutdown = setTimeout(() => stopProcess(child), 1000);
      shutdown.unref();
    }
    function abort() { finish(new Error("CLI abgebrochen.")); }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.on("error", error => finish(error));
    child.stdin.on("error", error => { if (!ended) finish(error); });
    child.on("close", code => {
      clearTimeout(deadline); clearTimeout(shutdown);
      signal?.removeEventListener("abort", abort);
      if (!ended) reject(new Error(safeCliText(stderr).slice(-1200) || `${kind}: Modellliste vorzeitig beendet (${code}).`));
      else if (failure) reject(failure);
      else resolve(result);
    });
    function receive(message) {
      if (ended) return;
      if (message.type === "control_request" || (message.method && message.id !== undefined))
        throw new Error(`${kind}: Eigenes Werkzeug während der Modellabfrage verhindert.`);
      if (claude && message.type === "control_response" && message.response?.request_id === "anvil-models") {
        if (message.response.subtype !== "success") throw new Error(`Claude CLI: ${safeCliText(message.response.error || "Modellliste konnte nicht geladen werden.")}`);
        finish(null, parseModels(message.response.response, "value", "Claude CLI"));
      } else if (!claude && message.id === "anvil-models") {
        if (message.error) throw new Error(`Copilot CLI: ${safeCliText(message.error.message || "Modellliste konnte nicht geladen werden.")}`);
        finish(null, parseModels(message.result, "id", "Copilot CLI"));
      }
    }
    child.stderr.on("data", part => { stderr = (stderr + part.toString()).slice(-2000); });
    child.stdout.on("data", part => {
      if (ended) return;
      bytes += part.length;
      if (bytes > 2 * 1024 * 1024) return finish(new Error(`${kind}: Modellliste ist zu groß.`));
      buffer = Buffer.concat([buffer, part]);
      try {
        while (!ended) {
          if (claude) {
            const end = buffer.indexOf(10);
            if (end < 0) break;
            const line = buffer.subarray(0, end).toString().trim();
            buffer = buffer.subarray(end + 1);
            if (line) receive(JSON.parse(line));
          } else {
            const end = buffer.indexOf("\r\n\r\n");
            if (end < 0) break;
            const length = Number(buffer.subarray(0, end).toString().match(/^Content-Length:\s*(\d+)/im)?.[1]);
            if (!Number.isSafeInteger(length) || length <= 0 || length > 2 * 1024 * 1024) throw new Error("Copilot CLI: Ungültige Modellliste.");
            if (buffer.length < end + 4 + length) break;
            const body = buffer.subarray(end + 4, end + 4 + length);
            buffer = buffer.subarray(end + 4 + length);
            receive(JSON.parse(body));
          }
        }
      } catch (error) { finish(new Error(`${kind}: ${safeCliText(error.message).slice(-1200)}`)); }
    });
    if (ended) return;
    const message = claude
      ? { type: "control_request", request_id: "anvil-models", request: { subtype: "initialize", hooks: {}, agents: {}, skills: [] } }
      : { jsonrpc: "2.0", id: "anvil-models", method: "models.list", params: {} };
    const body = Buffer.from(JSON.stringify(message));
    child.stdin.write(claude ? Buffer.concat([body, Buffer.from("\n")])
      : Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
  });
}

export async function listCliModels(kind, { signal, command, env = process.env, timeoutMs = 45000 } = {}) {
  if (!CLI_KINDS.includes(kind)) throw new Error("Diese CLI stellt keine abrufbare Modellliste bereit.");
  if (signal?.aborted) throw new Error("CLI abgebrochen.");
  const cli = command || findCli(kind);
  if (kind !== "codex") {
    const cwd = await mkdtemp(join(os.tmpdir(), "anvil-models-"));
    try { return await readCatalog(kind, cli, { signal, env: cliEnvironment(env), cwd, timeoutMs: timeoutMs > 0 ? Math.min(timeoutMs, 45000) : 45000 }); }
    finally { await rm(cwd, { recursive: true, force: true }); }
  }
  // `debug models` refreshes the catalog; --bundled would deliberately skip that.
  // No thread, turn, project tool, login prompt or inference is started here.
  const result = await runProcess(cli, ["debug", "models", ...codexServerArgs().slice(3)], {
    signal, timeoutMs: 45000, env: cliEnvironment(env),
  });
  if (result.code !== 0)
    throw new Error(safeCliText(result.stderr || result.stdout || "Codex CLI: Modellliste konnte nicht geladen werden.").slice(-1200));
  return parseCodexModels(result.stdout);
}
