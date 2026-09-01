import { loadSecrets, saveSecrets } from "./secrets";

export type CodexAuth = {
  token: string;
  refresh?: string;
  accountId?: string;
  email?: string;
  expiresAt?: number;
};

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_URL = "https://auth.openai.com/oauth/token";

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    const pad = part.replace(/-/g, "+").replace(/_/g, "/");
    const filled = pad + "=".repeat((4 - (pad.length % 4)) % 4);
    const raw = typeof atob === "function" ? atob(filled) : Buffer.from(filled, "base64").toString("utf8");
    const j = JSON.parse(raw) as Record<string, unknown>;
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  }
}

export function jwtExpMs(token: string): number {
  const part = String(token || "").split(".")[1];
  if (!part) return 0;
  const j = b64urlJson(part);
  const exp = Number(j?.exp ?? 0);
  return exp > 0 ? exp * 1000 : 0;
}

export function jwtAccountId(token: string): string {
  const part = String(token || "").split(".")[1];
  if (!part) return "";
  const j = b64urlJson(part);
  if (!j) return "";
  const auth = j["https://api.openai.com/auth"];
  if (auth && typeof auth === "object") {
    const id = String((auth as { chatgpt_account_id?: string }).chatgpt_account_id || "");
    if (id) return id;
  }
  return String(j.chatgpt_account_id || j.account_id || "");
}

/** OpenAI-Plattform-Key, kein ChatGPT-OAuth-JWT. */
export function isOpenAiPlatformKey(token: string): boolean {
  const k = String(token || "").trim();
  if (!k || /^sk-ant-/i.test(k) || k.includes(".")) return false;
  return /^(sk-|sess-)[A-Za-z0-9_-]{10,}/.test(k);
}

export function jwtEmail(token: string): string {
  const part = String(token || "").split(".")[1];
  if (!part) return "";
  const j = b64urlJson(part);
  const email = String(j?.email ?? j?.["https://api.openai.com/profile"] ?? "");
  if (email.includes("@")) return email;
  const nested = j?.["https://api.openai.com/profile"];
  if (nested && typeof nested === "object" && "email" in nested) return String((nested as { email?: string }).email || "");
  return "";
}

export function parseCodexAuth(raw: string): CodexAuth | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const tokens = (j.tokens && typeof j.tokens === "object" ? j.tokens : j) as Record<string, unknown>;
  const token = String(tokens.access_token || j.access_token || "").trim();
  if (!token || token === "null") return null;
  const refresh = String(tokens.refresh_token || j.refresh_token || "").trim() || undefined;
  const accountId = String(tokens.account_id || j.account_id || "").trim() || jwtAccountId(token) || undefined;
  const idTok = String(tokens.id_token || j.id_token || "");
  const email = jwtEmail(idTok) || jwtEmail(token) || undefined;
  const expiresAt = jwtExpMs(token) || undefined;
  return { token, refresh, accountId, email, expiresAt };
}

export function previewToken(token: string): string {
  const t = String(token || "");
  if (t.length < 12) return "…";
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

export async function refreshCodexToken(refresh: string): Promise<CodexAuth> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: CLIENT_ID,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Abo-Token: HTTP ${res.status} ${text.slice(0, 120)}`);
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Abo-Token unlesbar");
  }
  const token = String(j.access_token || "").trim();
  if (!token) throw new Error("Kein access_token");
  return {
    token,
    refresh: String(j.refresh_token || refresh).trim() || refresh,
    accountId: String(j.account_id || "").trim() || undefined,
    email: jwtEmail(String(j.id_token || token)),
    expiresAt: jwtExpMs(token),
  };
}

export function needsRefresh(auth: CodexAuth, skewMs = 120_000): boolean {
  if (!auth.expiresAt) return false;
  return Date.now() + skewMs >= auth.expiresAt;
}

export type SubLoadOk = {
  ok: true;
  token: string;
  accountId?: string;
  refresh?: string;
  email?: string;
  preview: string;
};

export type SubLoadErr = { ok: false; error: string };

export type SubKind = "codex" | "claude" | "gemini" | "copilot" | "huggingface";

export const SUB_KIND_META: { kind: SubKind; provider: string; cmd: string; label: string }[] = [
  { kind: "codex", provider: "codex", cmd: "codex login", label: "Codex" },
  { kind: "claude", provider: "anthropic", cmd: "claude /login", label: "Claude" },
  { kind: "copilot", provider: "github", cmd: "gh auth login", label: "Copilot" },
  { kind: "huggingface", provider: "huggingface", cmd: "huggingface-cli login", label: "Hugging Face" },
];

export function subKindForProvider(provider: string): SubKind | null {
  return SUB_KIND_META.find((m) => m.provider === provider)?.kind ?? null;
}

export type ProviderCreds = {
  token: string;
  accountId?: string;
  refresh?: string;
  via: "abo" | "key" | "";
};

/** mode: Abo und API sind getrennte Töpfe. Codex immer Abo. */
export function credsForProvider(provider: string, mode?: "abo" | "key"): ProviderCreds {
  const s = loadSecrets();
  const kind = subKindForProvider(provider);
  const want = provider === "codex" ? "abo" : mode;
  if (want !== "key" && kind) {
    const abo = String(s.keys[kind] || "").trim();
    if (abo) {
      return {
        token: abo,
        accountId: String(s.keys[`${kind}Account`] || "") || undefined,
        refresh: String(s.keys[`${kind}Refresh`] || "") || undefined,
        via: "abo",
      };
    }
  }
  if (want !== "abo") {
    const key = String(s.keys[provider] || "").trim();
    if (key) return { token: key, via: "key" };
  }
  return { token: "", via: "" };
}

export function saveAbo(
  kind: SubKind,
  r: { token: string; accountId?: string; refresh?: string },
): void {
  const cur = loadSecrets();
  saveSecrets({
    keys: {
      ...cur.keys,
      [kind]: r.token,
      [`${kind}Account`]: r.accountId || "",
      [`${kind}Refresh`]: r.refresh || "",
    },
  });
}

export function parseGhHosts(raw: string): CodexAuth | null {
  const m = String(raw || "").match(/oauth_token:\s*["']?([A-Za-z0-9_\-]+)["']?/);
  if (!m?.[1]) return null;
  const user = String(raw).match(/^\s*user:\s*["']?([^\s"']+)/m);
  return { token: m[1], email: user?.[1] };
}

export function parseHfToken(raw: string): CodexAuth | null {
  const token = String(raw || "").trim().split(/\s+/)[0] || "";
  if (!/^hf_[A-Za-z0-9]+/.test(token) && token.length < 16) return null;
  if (!token) return null;
  return { token };
}

export function parseCopilotConfig(raw: string): CodexAuth | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return parseGhHosts(raw);
  }
  const token = String(j.github_token || j.oauth_token || j.token || j.access_token || "").trim();
  if (!token) return null;
  return { token, email: String(j.user || j.login || "") || undefined };
}

export function parseClaudeAuth(raw: string): CodexAuth | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const oauth = (j.claudeAiOauth && typeof j.claudeAiOauth === "object" ? j.claudeAiOauth : j) as Record<string, unknown>;
  const token = String(oauth.accessToken || oauth.access_token || j.accessToken || "").trim();
  if (!token) return null;
  const refresh = String(oauth.refreshToken || oauth.refresh_token || "").trim() || undefined;
  const expiresAt = Number(oauth.expiresAt || oauth.expires_at || 0) || undefined;
  return { token, refresh, expiresAt };
}

export function parseGeminiAuth(raw: string): CodexAuth | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const token = String(j.access_token || j.accessToken || "").trim();
  if (!token) return null;
  const refresh = String(j.refresh_token || j.refreshToken || "").trim() || undefined;
  const expiresAt = Number(j.expiry_date || j.expiryDate || 0) || undefined;
  return { token, refresh, expiresAt, email: String(j.email || "") || undefined };
}

export function isClaudeOauth(token: string): boolean {
  return /sk-ant-oat|sk-ant-ort/i.test(token);
}

export function isGeminiOauth(token: string): boolean {
  return /^ya29\./.test(String(token || "").trim());
}

export async function refreshClaudeToken(refresh: string): Promise<CodexAuth> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  });
  const res = await fetch("https://console.anthropic.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Claude-Abo: HTTP ${res.status} ${text.slice(0, 80)}`);
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Claude-Token unlesbar");
  }
  const token = String(j.access_token || j.accessToken || "").trim();
  if (!token) throw new Error("Kein Claude access_token");
  return {
    token,
    refresh: String(j.refresh_token || j.refreshToken || refresh).trim() || refresh,
  };
}

export function hasSubNative(): boolean {
  try {
    const n = (window as unknown as { anvilNative?: { subLoad?: unknown; subLogin?: unknown } }).anvilNative;
    return typeof n?.subLoad === "function" && typeof n?.subLogin === "function";
  } catch {
    return false;
  }
}

export async function loadSubFromNative(kind: SubKind): Promise<SubLoadOk | SubLoadErr> {
  const cmd = SUB_KIND_META.find((m) => m.kind === kind)?.cmd || kind;
  if (!hasSubNative()) return { ok: false, error: `Anmelden/CLI nur im Anvil-Fenster, nicht in der Vorschau. CLI: ${cmd}` };
  const native = (window as unknown as { anvilNative: { subLoad: (kind: string) => Promise<SubLoadOk | SubLoadErr> } }).anvilNative;
  try {
    return await native.subLoad(kind);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Abo nicht lesbar" };
  }
}

export async function loginSubFromNative(kind: SubKind): Promise<SubLoadOk | SubLoadErr> {
  if (!hasSubNative()) return { ok: false, error: "Anmelden nur im Anvil-Fenster (Desktop), nicht in der Browser-Vorschau." };
  const native = (window as unknown as { anvilNative: { subLogin: (kind: string) => Promise<SubLoadOk | SubLoadErr> } }).anvilNative;
  try {
    return await native.subLogin(kind);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Login fehlgeschlagen" };
  }
}

export async function loadCodexFromNative(): Promise<SubLoadOk | SubLoadErr> {
  return loadSubFromNative("codex");
}

export type SubScanRow = { kind: SubKind; found: boolean };

export async function scanSubsFromNative(): Promise<SubScanRow[]> {
  if (typeof window === "undefined") return [];
  const native = (window as unknown as { anvilNative?: { subScan?: () => Promise<SubScanRow[]> } }).anvilNative;
  if (!native?.subScan) return [];
  try {
    return await native.subScan();
  } catch {
    return [];
  }
}
