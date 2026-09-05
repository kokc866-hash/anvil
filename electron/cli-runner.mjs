/** Subscription inference is owned by the installed CLI, including login and refresh. */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import os from "node:os";
import { nodeCommand } from "./node-cmd.mjs";

export const CLI_KINDS = ["codex", "claude", "copilot"];
const PACKAGES = {
  codex: "@openai/codex",
  claude: "@anthropic-ai/claude-code",
  copilot: "@github/copilot",
};
export const LOGIN_ARGS = {
  codex: ["login"],
  claude: ["auth", "login"],
  copilot: ["login", "--web-flow"],
};
const LIMIT = 16 * 1024 * 1024;

export function cliEnvironment(base = process.env) {
  const env = { ...base, NO_COLOR: "1" };
  // An API key inherited by the desktop must never override the selected subscription.
  for (const k of Object.keys(env)) {
    if (
      /^(OPENAI_|CODEX_API_KEY$|ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN$|CLAUDE_CODE_USE_|COPILOT_API_|COPILOT_PROVIDER_|COPILOT_GITHUB_TOKEN$|GITHUB_TOKEN$|GH_TOKEN$|ELECTRON_RUN_AS_NODE$|NODE_OPTIONS$)/i.test(
        k,
      )
    )
      delete env[k];
  }
  return env;
}

export function findCli(kind, env = process.env, platform = process.platform) {
  if (!CLI_KINDS.includes(kind)) throw new Error("Unbekannte CLI.");
  const dirs = [
    ...String(env.PATH || env.Path || "").split(delimiter),
    join(os.homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  if (env.APPDATA) dirs.push(join(env.APPDATA, "npm"));
  for (const dir of dirs.filter(Boolean)) {
    const bin = resolve(dir, kind + (platform === "win32" ? ".exe" : ""));
    if (existsSync(bin)) return { file: bin, args: [] };
    if (platform !== "win32") continue;
    // npm's .cmd wrappers need a shell. Launch their declared JS entry point directly instead.
    const pkgDir = join(dir, "node_modules", PACKAGES[kind]);
    try {
      const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
      const entry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[kind];
      if (!entry || !existsSync(resolve(pkgDir, entry))) continue;
      const node = nodeCommand({
        isPackaged: Boolean(process.versions.electron),
        execPath: process.execPath,
      });
      return {
        file: node.file,
        args: [resolve(pkgDir, entry)],
        electronAsNode: node.electronAsNode,
      };
    } catch {
      /* Not this installation. */
    }
  }
  throw new Error(`${kind} CLI nicht gefunden. CLI installieren und Anvil neu starten.`);
}

export function stopProcess(child) {
  if (!child.pid) return;
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
      child.kill("SIGKILL");
    }
  }
}

/** No shell, bounded output, cancellation also terminates descendants. */
export function runProcess(
  command,
  args,
  { input = "", cwd = os.tmpdir(), signal, timeoutMs = 0, onOutput, env = cliEnvironment() } = {},
) {
  return new Promise((resolveRun, reject) => {
    if (signal?.aborted) return reject(new Error("CLI abgebrochen."));
    const childEnv = { ...env };
    if (command.electronAsNode) childEnv.ELECTRON_RUN_AS_NODE = "1";
    const child = spawn(command.file, [...command.args, ...args], {
      cwd,
      env: childEnv,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      bytes = 0,
      failure;
    const stop = (message) => {
      failure ??= new Error(message);
      stopProcess(child);
    };
    const abort = () => stop("CLI abgebrochen.");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer =
      timeoutMs > 0 ? setTimeout(() => stop("CLI-Zeitlimit erreicht."), timeoutMs) : null;
    const clean = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    for (const [stream, name] of [
      [child.stdout, "stdout"],
      [child.stderr, "stderr"],
    ]) {
      stream.setEncoding("utf8");
      stream.on("data", (part) => {
        bytes += Buffer.byteLength(part);
        if (bytes > LIMIT) return stop("CLI-Ausgabe ist zu groß.");
        if (name === "stdout") stdout += part;
        else stderr += part;
        onOutput?.(part, name);
      });
    }
    child.on("error", (err) => {
      failure = err;
    });
    child.on("close", (code) => {
      clean();
      if (failure) reject(failure);
      else resolveRun({ code, stdout, stderr });
    });
    child.stdin.on("error", (err) => {
      if (err.code !== "EPIPE") stop(err.message);
    });
    child.stdin.end(input);
  });
}

export function safeCliText(text) {
  return String(text)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(
      /\b(?:sk-[\w-]+|gh[opusr]_[\w]+|github_pat_[\w]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g,
      "[redacted]",
    );
}

export async function probeCli(kind, signal) {
  const command = findCli(kind);
  const version = await runProcess(command, ["--version"], { signal, timeoutMs: 10000 });
  if (version.code !== 0)
    throw new Error(
      safeCliText(version.stderr || version.stdout || `${kind} startet nicht.`).slice(-1200),
    );
  let authenticated = null;
  if (kind !== "copilot") {
    const args = kind === "codex" ? ["login", "status"] : ["auth", "status"];
    const r = await runProcess(command, args, { signal, timeoutMs: 10000 });
    if (kind === "codex")
      authenticated =
        r.code === 0 &&
        /chatgpt/i.test(r.stdout + r.stderr) &&
        !/API key/i.test(r.stdout + r.stderr);
    else {
      try {
        const a = JSON.parse(r.stdout);
        authenticated =
          r.code === 0 &&
          a.loggedIn === true &&
          a.authMethod === "claude.ai" &&
          (!a.apiProvider || a.apiProvider === "firstParty");
      } catch {
        authenticated = false;
      }
    }
  }
  return {
    kind,
    installed: true,
    authenticated,
    version: safeCliText(version.stdout || version.stderr)
      .trim()
      .slice(0, 160),
  };
}

export async function loginCli(kind, { signal, onOutput } = {}) {
  const command = findCli(kind);
  const r = await runProcess(command, LOGIN_ARGS[kind], {
    signal,
    timeoutMs: 180000,
    onOutput: (part) => onOutput?.(safeCliText(part)),
  });
  if (r.code !== 0)
    throw new Error(
      safeCliText(r.stderr || r.stdout || "CLI-Anmeldung fehlgeschlagen.").slice(-1600),
    );
  return probeCli(kind, signal);
}

export const CHOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["content", "tool_calls"],
  properties: {
    content: { type: "string" },
    tool_calls: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "arguments"],
        properties: { name: { type: "string" }, arguments: { type: "string" } },
      },
    },
  },
};

export function completionArgs(kind, model, dir) {
  if (!CLI_KINDS.includes(kind)) throw new Error("Unbekannte CLI.");
  if (typeof model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+\-]{0,199}$/.test(model))
    throw new Error("Ungültige CLI-Modell-ID.");
  if (kind === "codex")
    return [
      "exec",
      "--ignore-user-config",
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--color",
      "never",
      "--json",
      "-c",
      'forced_login_method="chatgpt"',
      "-c",
      'approval_policy="never"',
      "-c",
      "features.shell_tool=false",
      "-c",
      "agents.enabled=false",
      "-c",
      'web_search="disabled"',
      "--model",
      model,
      "--output-schema",
      join(dir, "schema.json"),
      "-",
    ];
  if (kind === "claude")
    return [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--tools",
      "",
      "--disallowedTools",
      "mcp__*",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--setting-sources",
      "",
      "--settings",
      '{"disableAllHooks":true}',
      "--model",
      model,
    ];
  return [
    "--silent",
    "--output-format",
    "text",
    "--no-color",
    "--no-custom-instructions",
    "--disable-builtin-mcps",
    "--available-tools=",
    "--deny-tool=*",
    "--no-ask-user",
    "--model",
    model,
  ];
}

export function parseCliOutput(kind, stdout) {
  if (kind === "copilot") {
    if (!stdout.trim()) throw new Error("Copilot: Leere Modellantwort.");
    return stdout.trim();
  }
  let result = "",
    error = "";
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (kind === "codex" && e.type === "item.completed" && e.item?.type === "agent_message")
      result = e.item.text;
    if (kind === "claude" && e.type === "result") {
      if (e.is_error) error = e.result || e.errors?.join(" · ") || "Claude CLI fehlgeschlagen.";
      else result = e.structured_output ? JSON.stringify(e.structured_output) : e.result;
    }
    if (e.type === "error" || e.type === "turn.failed" || e.type === "session.error")
      error = e.message || e.error?.message || e.data?.message || "CLI fehlgeschlagen.";
  }
  if (error) throw new Error(safeCliText(error));
  if (!result?.trim())
    throw new Error(
      `${kind}: Keine vollständige Modellantwort. CLI aktualisieren und Anmeldung prüfen.`,
    );
  return result;
}

export async function completeCli(
  { kind, model, prompt },
  { signal, onActivity, timeoutMs = 0 } = {},
) {
  if (typeof prompt !== "string" || !prompt.trim() || Buffer.byteLength(prompt) > 8 * 1024 * 1024)
    throw new Error("CLI-Anfrage leer oder zu groß (max. 8 MiB).");
  const status = await probeCli(kind, signal);
  if (status.authenticated === false)
    throw new Error(`${kind}: Abo-Anmeldung fehlt. Einstellungen → Abo → Anmelden.`);
  const dir = await mkdtemp(join(os.tmpdir(), "anvil-cli-"));
  try {
    await writeFile(join(dir, "schema.json"), JSON.stringify(CHOICE_SCHEMA), { mode: 0o600 });
    const r = await runProcess(findCli(kind), completionArgs(kind, model, dir), {
      cwd: dir,
      input: prompt,
      signal,
      timeoutMs,
      onOutput: () => onActivity?.(),
    });
    if (r.code !== 0)
      throw new Error(safeCliText(r.stderr || r.stdout || `${kind}: Exit ${r.code}`).slice(-1800));
    return parseCliOutput(kind, r.stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
