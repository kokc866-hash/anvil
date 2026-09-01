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
      signal: AbortSignal.timeout(2500),
    });
    const j = (await r.json()) as CompanionInfo;
    if (r.status === 401) return { ok: false, needToken: true, error: j.error || "Token fehlt" };
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, version: j.version, bins: j.bins, lsp: j.lsp, installer: j.installer ?? null, toolchains: j.toolchains, toolHome: j.toolHome };
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
  body: { lang: string; entry: string; files: { path: string; content: string }[]; timeoutMs?: number },
  base = DEFAULT_COMPANION,
): Promise<CompanionJob> {
  const r = await fetch(`${base.replace(/\/$/, "")}/v1/compile`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: withAgentTimeout(Math.min(120000, Math.max(8000, body.timeoutMs ?? 60000))),
  });
  if (!r.ok) {
    const t = await r.text();
    return { ok: false, code: r.status, stdout: "", stderr: t.slice(0, 4000), duration: 0, cmd: body.lang };
  }
  return r.json() as Promise<CompanionJob>;
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
