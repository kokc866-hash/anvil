import { withAgentTimeout } from "./abort";
import { loadSecrets, saveSecrets } from "./secrets";

export type ToolchainInfo = {
  id: string;
  ids?: string[];
  label: string;
  about: string;
  kind: string;
  ready: boolean;
  via?: string;
  path?: string | null;
  home?: string;
};

export type CompanionInfo = {
  ok: boolean;
  version?: string;
  bins?: Record<string, string | null>;
  lsp?: LspPack[];
  installer?: string | null;
  toolchains?: ToolchainInfo[];
  toolHome?: string;
  runRoot?: string;
  lspHome?: string;
  packages?: { home: string; toolchains: string; lsp: string };
  git?: boolean;
  workspace?: string;
  error?: string;
  needToken?: boolean;
};

export type CompanionJob = {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  duration: number;
  cmd: string;
  stage?: { kind: "html" | "window" | "log"; out?: string; id?: string };
  running?: boolean;
};

export type CompanionDiag = {
  path: string;
  line: number;
  col?: number;
  message: string;
  severity?: string;
  source?: string;
};

export type LspPack = {
  id: string;
  label: string;
  langs: string;
  license: string;
  ready: boolean;
  path?: string | null;
  via?: string;
};

export const DEFAULT_COMPANION = "http://127.0.0.1:7845";
export const DEFAULT_ENGINE_MCP = "http://127.0.0.1:7845/mcp";

function token(): string {
  return loadSecrets().companionToken.trim();
}

function headers(): Record<string, string> {
  const t = token();
  const h: Record<string, string> = { "content-type": "application/json" };
  if (t) h["x-anvil-token"] = t;
  return h;
}

export function setCompanionToken(value: string): void {
  saveSecrets({ companionToken: value.trim() });
}

export function pairCompanion(base = DEFAULT_COMPANION): Promise<string> {
  const root = base.replace(/\/$/, "");
  const to = encodeURIComponent(typeof location !== "undefined" ? location.origin : "");
  const url = `${root}/v1/pair?to=${to}`;
  return new Promise((resolve, reject) => {
    const w = window.open(url, "anvil-pair", "width=420,height=320");
    if (!w) {
      reject(new Error("Popup blockiert"));
      return;
    }
    const t = window.setTimeout(() => {
      window.removeEventListener("message", onMsg);
      reject(new Error("Koppeln abgebrochen"));
    }, 120000);
    function onMsg(ev: MessageEvent) {
      const d = ev.data as { anvilPair?: number; token?: string };
      if (d?.anvilPair !== 1 || typeof d.token !== "string") return;
      if (ev.origin !== new URL(root).origin) return;
      window.clearTimeout(t);
      window.removeEventListener("message", onMsg);
      setCompanionToken(d.token);
      resolve(d.token);
    }
    window.addEventListener("message", onMsg);
  });
}

export async function companionPing(base = DEFAULT_COMPANION): Promise<CompanionInfo> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/ping`, {
      method: "GET",
      headers: headers(),
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json()) as CompanionInfo;
    if (r.status === 401) return { ok: false, needToken: true, error: j.error || "Token fehlt" };
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, version: j.version, bins: j.bins, lsp: j.lsp, installer: j.installer ?? null, toolchains: j.toolchains, toolHome: j.toolHome, runRoot: j.runRoot, git: Boolean(j.git), workspace: j.workspace };
  } catch {
    return { ok: false, error: "Companion aus. Auf dem Rechner: node companion/server.mjs" };
  }
}

export async function companionRun(
  body: { cwd?: string; cmd: string; timeoutMs?: number },
  base = DEFAULT_COMPANION,
): Promise<CompanionJob> {
  const r = await fetch(`${base.replace(/\/$/, "")}/v1/run`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: withAgentTimeout(Math.min(120000, Math.max(8000, body.timeoutMs ?? 90000))),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, code: r.status, stdout: "", stderr: t.slice(0, 4000), duration: 0, cmd: body.cmd };
  }
  return r.json() as Promise<CompanionJob>;
}

export type ToolPull = {
  kind: string;
  phase: string;
  got: number;
  total: number;
  pct: number;
  busy: boolean;
};

export type PackageHome = { home: string; toolchains: string; lsp: string };

export async function companionHome(base = DEFAULT_COMPANION): Promise<PackageHome | null> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/home`, { headers: headers(), signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => ({}))) as Partial<PackageHome>;
    if (!j.home) return null;
    return { home: String(j.home), toolchains: String(j.toolchains || ""), lsp: String(j.lsp || "") };
  } catch {
    return null;
  }
}

export async function companionSetHome(dir: string, base = DEFAULT_COMPANION): Promise<PackageHome> {
  const r = await fetch(`${base.replace(/\/$/, "")}/v1/home`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ path: dir }),
    signal: AbortSignal.timeout(8000),
  });
  const j = (await r.json().catch(() => ({}))) as Partial<PackageHome> & { error?: string; ok?: boolean };
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return { home: String(j.home || dir), toolchains: String(j.toolchains || ""), lsp: String(j.lsp || "") };
}

export async function companionToolchain(
  id: string,
  action: "pull" | "remove" | "abort" = "pull",
  base = DEFAULT_COMPANION,
): Promise<{ ok: boolean; error?: string; path?: string; label?: string; home?: string }> {
  const r = await fetch(`${base.replace(/\/$/, "")}/v1/toolchain`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ id, action }),
    signal: AbortSignal.timeout(action === "pull" ? 12 * 60 * 1000 : 8000),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; path?: string; label?: string; home?: string };
  if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
  return { ok: Boolean(j.ok), error: j.error, path: j.path, label: j.label, home: j.home };
}

export async function companionToolPull(base = DEFAULT_COMPANION): Promise<ToolPull | null> {
  const r = await fetch(`${base.replace(/\/$/, "")}/v1/toolchain`, { headers: headers(), signal: AbortSignal.timeout(4000) });
  if (!r.ok) return null;
  const j = (await r.json().catch(() => ({}))) as { pull?: ToolPull };
  return j.pull ?? null;
}

export async function companionInstall(
  bin: string,
  base = DEFAULT_COMPANION,
): Promise<{ ok: boolean; stderr?: string; stdout?: string; label?: string; via?: string }> {
  const r = await fetch(`${base.replace(/\/$/, "")}/v1/install`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ bin }),
    signal: AbortSignal.timeout(12 * 60 * 1000),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; stderr?: string; error?: string; stdout?: string; label?: string; via?: string };
  if (!r.ok) return { ok: false, stderr: j.error || j.stderr || `HTTP ${r.status}` };
  return { ok: Boolean(j.ok), stderr: j.stderr, stdout: j.stdout, label: j.label, via: j.via };
}

export async function companionCompile(
  body: { lang: string; entry: string; files: { path: string; content: string }[]; timeoutMs?: number; cwd?: string; asTest?: boolean; compileTimeoutMs?: number },
  base = DEFAULT_COMPANION,
  signal?: AbortSignal,
): Promise<CompanionJob> {
  const r = await fetch(`${base.replace(/\/$/, "")}/v1/compile`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(660000)]) : AbortSignal.timeout(660000),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, code: r.status, stdout: "", stderr: t.slice(0, 4000), duration: 0, cmd: body.lang };
  }
  return r.json() as Promise<CompanionJob>;
}

export async function companionFormat(
  body: { path: string; content: string },
  base = DEFAULT_COMPANION,
): Promise<{ ok: boolean; content: string; via?: string; error?: string }> {
  const r = await fetch(`${base.replace(/\/$/, "")}/v1/format`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, content: body.content, error: t.slice(0, 400) };
  }
  return r.json() as Promise<{ ok: boolean; content: string; via?: string; error?: string }>;
}

export async function companionLint(
  files: { path: string; content: string }[],
  base = DEFAULT_COMPANION,
  opts?: { enabled?: string[]; timeoutMs?: number; lspTimeoutMs?: number; maxFiles?: number },
): Promise<{ ok: boolean; diagnostics: CompanionDiag[]; tools?: { name: string; ok: boolean }[]; error?: string }> {
  try {
    const max = Math.max(8, Math.min(48, opts?.maxFiles ?? 40));
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/lint`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        files: files.slice(0, max),
        timeoutMs: opts?.timeoutMs ?? 40000,
        enabled: opts?.enabled,
        lspTimeoutMs: opts?.lspTimeoutMs ?? 8000,
      }),
      signal: AbortSignal.timeout(Math.min(60000, (opts?.timeoutMs ?? 40000) + 10000)),
    });
    if (r.status === 401) return { ok: false, diagnostics: [], error: "Token" };
    if (!r.ok) return { ok: false, diagnostics: [], error: `HTTP ${r.status}` };
    return r.json() as Promise<{ ok: boolean; diagnostics: CompanionDiag[]; tools?: { name: string; ok: boolean }[] }>;
  } catch (err) {
    return { ok: false, diagnostics: [], error: err instanceof Error ? err.message : "lint fail" };
  }
}

export async function companionLspList(
  base = DEFAULT_COMPANION,
): Promise<{ ok: boolean; servers: LspPack[]; error?: string }> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/lsp`, { headers: headers(), signal: AbortSignal.timeout(4000) });
    if (r.status === 401) return { ok: false, servers: [], error: "Token" };
    if (!r.ok) return { ok: false, servers: [], error: `HTTP ${r.status}` };
    const j = (await r.json()) as { servers?: LspPack[] };
    return { ok: true, servers: j.servers ?? [] };
  } catch (err) {
    return { ok: false, servers: [], error: err instanceof Error ? err.message : "lsp" };
  }
}

export async function companionLspCheck(
  id: string,
  base = DEFAULT_COMPANION,
): Promise<{ ok: boolean; id?: string; version?: string; error?: string; hint?: string; path?: string }> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/lsp/check`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(12000),
    });
    const j = (await r.json()) as { ok?: boolean; id?: string; version?: string; error?: string; hint?: string; path?: string };
    if (!r.ok) return { ok: false, error: j.error || `HTTP ${r.status}` };
    return { ok: Boolean(j.ok), id: j.id, version: j.version, error: j.error, hint: j.hint, path: j.path };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "check" };
  }
}

export async function companionLspPull(
  id: string,
  base = DEFAULT_COMPANION,
): Promise<{ ok: boolean; servers: LspPack[]; error?: string }> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/lsp/pull`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(190000),
    });
    const j = (await r.json()) as { ok?: boolean; servers?: LspPack[]; error?: string };
    if (!r.ok) return { ok: false, servers: j.servers ?? [], error: j.error || `HTTP ${r.status}` };
    return { ok: Boolean(j.ok), servers: j.servers ?? [], error: j.error };
  } catch (err) {
    return { ok: false, servers: [], error: err instanceof Error ? err.message : "pull" };
  }
}

export async function termStart(cwd?: string, base = DEFAULT_COMPANION): Promise<{ ok: boolean; id?: string; shell?: string; error?: string }> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/term/start`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ cwd }),
      signal: AbortSignal.timeout(5000),
    });
    return r.json() as Promise<{ ok: boolean; id?: string; shell?: string }>;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "term" };
  }
}

export async function termWrite(id: string, data: string, base = DEFAULT_COMPANION): Promise<boolean> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/term/in`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ id, data }),
      signal: AbortSignal.timeout(4000),
    });
    const j = (await r.json()) as { ok?: boolean };
    return Boolean(j.ok);
  } catch {
    return false;
  }
}

export async function termRead(id: string, base = DEFAULT_COMPANION): Promise<{ ok: boolean; data: string; alive: boolean }> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/term/out?id=${encodeURIComponent(id)}`, {
      headers: headers(),
      signal: AbortSignal.timeout(4000),
    });
    return r.json() as Promise<{ ok: boolean; data: string; alive: boolean }>;
  } catch {
    return { ok: false, data: "", alive: false };
  }
}

export async function termKill(id: string, base = DEFAULT_COMPANION): Promise<void> {
  try {
    await fetch(`${base.replace(/\/$/, "")}/v1/term/kill`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* */
  }
}

export type GitFile = { path: string; kind: string; staged?: boolean; unstaged?: boolean; untracked?: boolean };
export type GitLog = { hash: string; at: number; message: string };
export type GitStatus = {
  ok: boolean;
  error?: string;
  cwd?: string;
  repo?: boolean;
  branch?: string;
  files?: GitFile[];
  log?: GitLog[];
  branches?: string[];
  stdout?: string;
  text?: string;
};

export async function companionGit(
  action: string,
  body: Record<string, unknown> = {},
  base = DEFAULT_COMPANION,
): Promise<GitStatus> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/git`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ action, ...body }),
      signal: AbortSignal.timeout(action === "push" || action === "pull" || action === "clone" ? 180000 : 20000),
    });
    return (await r.json()) as GitStatus;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Git nicht erreichbar" };
  }
}

export async function companionWorkspace(cwd: string, base = DEFAULT_COMPANION): Promise<{ ok: boolean; cwd?: string; error?: string }> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/workspace`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ cwd }),
      signal: AbortSignal.timeout(8000),
    });
    return (await r.json()) as { ok: boolean; cwd?: string; error?: string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Companion aus" };
  }
}

export async function companionTree(
  cwd?: string,
  base = DEFAULT_COMPANION,
): Promise<{ ok: boolean; files?: Record<string, string>; dirs?: string[]; skipped?: number; n?: number; error?: string }> {
  try {
    const q = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/tree${q}`, {
      headers: headers(),
      signal: AbortSignal.timeout(30000),
    });
    return (await r.json()) as { ok: boolean; files?: Record<string, string>; dirs?: string[]; skipped?: number; n?: number; error?: string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Baum fehlgeschlagen" };
  }
}

export async function companionWriteFile(path: string, content: string, cwd?: string, base = DEFAULT_COMPANION): Promise<boolean> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/file`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ path, content, cwd }),
      signal: AbortSignal.timeout(15000),
    });
    const j = (await r.json()) as { ok?: boolean };
    return Boolean(j.ok);
  } catch {
    return false;
  }
}

export async function companionDeleteFile(path: string, cwd?: string, base = DEFAULT_COMPANION): Promise<boolean> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/file/delete`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ path, cwd }),
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json()) as { ok?: boolean };
    return Boolean(j.ok);
  } catch {
    return false;
  }
}

export async function companionMkdir(path: string, cwd?: string, base = DEFAULT_COMPANION): Promise<boolean> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/mkdir`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ path, cwd }),
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json()) as { ok?: boolean };
    return Boolean(j.ok);
  } catch {
    return false;
  }
}

export type DebugPause = {
  path: string;
  line: number;
  reason: string;
  locals: Record<string, string>;
  stack: Array<{ path: string; line: number; fn: string }>;
};

export type DebugSnap = {
  ok: boolean;
  id?: string;
  error?: string;
  done?: boolean;
  code?: number;
  stdout?: string;
  stderr?: string;
  eval?: string;
  pause?: DebugPause | null;
};

export async function companionDebug(
  action: "start" | "cmd" | "poll" | "stop",
  body: Record<string, unknown> = {},
  base = DEFAULT_COMPANION,
): Promise<DebugSnap> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/debug`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ action, ...body }),
      signal: AbortSignal.timeout(action === "start" ? 15000 : 8000),
    });
    return (await r.json()) as DebugSnap;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Debug nicht erreichbar" };
  }
}

export async function companionRunStatus(id: string, base = DEFAULT_COMPANION): Promise<CompanionJob> {
  const { withCompanion } = await import("./companion-life");
  return withCompanion(async () => {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/run-status?id=${encodeURIComponent(id)}`, { headers: headers(), signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j as CompanionJob;
  }, base);
}
