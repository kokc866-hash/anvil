/** Codex exec JSONL has only completed messages. App-server supplies real text deltas.
 * Use the CLI's existing login, but disable its tools before creating an ephemeral thread. */
import { spawn } from "node:child_process";
import { createChoiceTextStream } from "./cli-stream.mjs";
import { stopProcess, safeCliText } from "./cli-runner.mjs";

export const CODEX_TRANSPORT_CONFIG = {
  "forced_login_method": "chatgpt", "approval_policy": "never", "sandbox_mode": "read-only",
  "features.shell_tool": false, "features.unified_exec": false, "features.multi_agent": false,
  "features.hooks": false, "features.codex_hooks": false, "features.plugins": false,
  "features.remote_plugin": false, "features.apps": false, "features.memories": false,
  "features.shell_snapshot": false, "features.skill_mcp_dependency_install": false,
  "features.browser_use": false, "features.computer_use": false, "features.tool_suggest": false,
  "features.code_mode.enabled": false, "agents.enabled": false,
  "tools.view_image": false, "web_search": "disabled", "notify": [],
  "history.persistence": "none", "project_doc_max_bytes": 0,
};

export function codexServerArgs() {
  // TOML accepts the primitive strings/booleans/empty arrays used in this fixed map.
  return ["app-server", "--listen", "stdio://", ...Object.entries(CODEX_TRANSPORT_CONFIG).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`])];
}

export function codexThreadConfig(config) {
  const overrides = { ...CODEX_TRANSPORT_CONFIG };
  if (!config || typeof config !== "object" || !config.features || config.features.hooks !== false || config.features.plugins !== false || config.features.apps !== false)
    throw Error("Codex CLI konnte nicht sicher vorbereitet werden. Bitte die CLI aktualisieren.");
  // An empty map does not erase inherited MCP servers: disable every effective entry explicitly.
  overrides.mcp_servers = Object.fromEntries(Object.keys(config.mcp_servers ?? {}).map(name => [name, { enabled: false }]));
  return overrides;
}

export function completeCodexServer(command, { model, prompt, imagePaths = [], effort, schema, cwd }, { env, signal, timeoutMs = 0, onActivity, onText } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error("CLI abgebrochen."));
    const child = spawn(command.file, [...command.args, ...codexServerArgs()], {
      cwd, env: { ...env, ...(command.electronAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
      shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "", bytes = 0, stderr = "", threadId, turnId, raw = "", final = "", ended = false, serial = 0;
    const pending = new Map();
    const content = createChoiceTextStream(onText);
    const deadline = timeoutMs > 0 ? setTimeout(() => finish(Error("CLI-Zeitlimit erreicht.")), timeoutMs) : null;
    function send(value) { if (!ended) child.stdin.write(JSON.stringify(value) + "\n"); }
    function request(method, params) {
      return new Promise((resolveCall, rejectCall) => {
        const id = ++serial;
        const timer = setTimeout(() => { pending.delete(id); rejectCall(Error(`Codex CLI antwortet nicht (${method}).`)); }, 30000);
        pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
        send({ id, method, params });
      });
    }
    function finish(error, result) {
      if (ended) return;
      ended = true;
      if (deadline) clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error || Error("Codex-Anfrage abgeschlossen.")); }
      pending.clear();
      child.stdin.destroy();
      stopProcess(child);
      // Wait for the process tree to stop before its private input directory is removed.
      child.once("close", () => error ? reject(error) : resolve(result));
    }
    function abort() { if (threadId && turnId) send({ id: ++serial, method: "turn/interrupt", params: { threadId, turnId } }); finish(Error("CLI abgebrochen.")); }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.on("error", error => finish(error));
    child.stdin.on("error", error => { if (!ended) finish(error); });
    child.on("close", code => {
      if (!ended) {
        // close already happened; finish's listener would never run.
        ended = true;
        if (deadline) clearTimeout(deadline);
        signal?.removeEventListener("abort", abort);
        const error = Error(safeCliText(stderr).slice(-1200) || `Codex CLI wurde vorzeitig beendet (${code}).`);
        for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
        pending.clear(); reject(error);
      }
    });
    function receive(message) {
      if (ended) return;
      onActivity?.();
      if (message.method && message.id !== undefined) {
        // No CLI-owned tools, permissions, elicitation or filesystem requests are granted.
        send({ id: message.id, error: { code: -32601, message: "Native tools are disabled. Request tools through Anvil's response envelope." } });
        finish(Error("Codex hat ein eigenes Werkzeug angefordert; Anvil hat die Ausführung verhindert."));
      } else if (message.id !== undefined) {
        const job = pending.get(message.id);
        if (job) { pending.delete(message.id); clearTimeout(job.timer); message.error ? job.reject(Error(safeCliText(message.error.message || "Codex CLI fehlgeschlagen."))) : job.resolve(message.result); }
      } else if (message.params?.threadId === threadId) {
        const p = message.params;
        if (message.method === "turn/started") turnId = p.turn?.id;
        if (message.method === "item/agentMessage/delta" && typeof p.delta === "string") { raw += p.delta; content.push(p.delta); }
        if (message.method === "item/completed" && p.item?.type === "agentMessage") {
          final = p.item.text;
          if (typeof final === "string" && final.startsWith(raw)) { content.push(final.slice(raw.length)); raw = final; }
        }
        if (message.method === "turn/completed") {
          if (p.turn?.status !== "completed") finish(Error(safeCliText(p.turn?.error?.message || "Codex-Anfrage fehlgeschlagen oder abgebrochen.")));
          else if (!final.trim()) finish(Error("Codex: Keine vollständige Modellantwort."));
          else finish(null, final);
        }
      }
    }
    for (const [stream, output] of [[child.stdout, true], [child.stderr, false]]) {
      stream.setEncoding("utf8");
      stream.on("data", part => {
        if (ended) return;
        bytes += Buffer.byteLength(part);
        if (bytes > 16 * 1024 * 1024) return finish(Error("CLI-Ausgabe ist zu groß."));
        if (!output) { stderr = (stderr + part).slice(-2000); onActivity?.(); return; }
        buffer += part;
        try { let i; while ((i = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0,i); buffer = buffer.slice(i+1); if (line.trim()) receive(JSON.parse(line)); } }
        catch (error) { finish(Error(`Codex-Stream ungültig: ${safeCliText(error.message)}`)); }
      });
    }
    void (async () => {
      await request("initialize", { clientInfo: { name: "anvil", title: "Anvil", version: "1" }, capabilities: { experimentalApi: true } });
      send({ method: "initialized" });
      const settings = await request("config/read", { cwd, includeLayers: false });
      const config = codexThreadConfig(settings?.config);
      const started = await request("thread/start", { model, modelProvider: "openai", cwd, ephemeral: true, approvalPolicy: "never", sandbox: "read-only", config, dynamicTools: [], selectedCapabilityRoots: [], environments: [], baseInstructions: "You are Anvil's model transport. No native tools. Return only the requested Anvil JSON response envelope." });
      threadId = started?.thread?.id;
      if (!threadId) throw Error("Codex CLI hat keine Sitzung angelegt.");
      if (started.approvalPolicy !== "never" || started.sandbox?.type !== "readOnly") throw Error("Codex CLI hat die geschützte Sitzung nicht bestätigt.");
      const turn = await request("turn/start", { threadId, input: [{ type: "text", text: prompt, text_elements: [] }, ...imagePaths.map(path => ({ type: "localImage", path }))], ...(effort && effort !== "auto" ? { effort } : {}), outputSchema: schema });
      turnId ||= turn?.turn?.id;
    })().catch(error => { if (!ended) finish(error); });
  });
}
