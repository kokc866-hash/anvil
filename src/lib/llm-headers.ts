/** Provider-Header für die Pipe (Browser/Electron), nicht nur den Server-Proxy. */

export function copilotHeaders(headers: Record<string, string>) {
  headers["Editor-Version"] = "vscode/1.103.0";
  headers["Editor-Plugin-Version"] = "copilot-chat/0.30.0";
  headers["Copilot-Integration-Id"] = "vscode-chat";
  headers["Openai-Intent"] = "conversation-panel";
  headers["User-Agent"] = "GitHubCopilotChat/0.30.0";
}

export async function copilotBearer(apiKey: string): Promise<string> {
  const k = apiKey.trim();
  if (/^tid=/.test(k) || /;exp=/.test(k)) return k;
  if (!/^(gho_|ghu_|ghp_)/.test(k)) return k;
  const res = await fetch("https://api.github.com/copilot_internal/v2/token", {
    headers: {
      Accept: "application/json",
      Authorization: `token ${k}`,
      "Editor-Version": "vscode/1.103.0",
      "Editor-Plugin-Version": "copilot-chat/0.30.0",
      "User-Agent": "GitHubCopilotChat/0.30.0",
    },
    signal: AbortSignal.timeout(12000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Copilot HTTP ${res.status}: ${text.slice(0, 180)}`);
  let j: { token?: string };
  try {
    j = JSON.parse(text) as { token?: string };
  } catch {
    throw new Error("Copilot-Token ungültig. gh auth login.");
  }
  const tok = String(j.token || "").trim();
  if (!tok) throw new Error("Copilot-Token leer. gh auth login, Copilot-Abo prüfen.");
  return tok;
}

export function responsesNative(provider: string): boolean {
  return provider === "openai" || provider === "azure";
}

export function pipeHeaders(provider: string, apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key || "none"}`,
  };
  if (provider === "openrouter") {
    h["HTTP-Referer"] = "https://anvil.app";
    h["X-Title"] = "Anvil";
  }
  if (provider === "google" && /^AIza/.test(key)) h["x-goog-api-key"] = key;
  if (provider === "github") copilotHeaders(h);
  if (provider === "azure" && key) {
    h["api-key"] = key;
    delete h.Authorization;
  }
  return h;
}

export function anthropicHeaders(apiKey: string, oauth: boolean): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (oauth) {
    h.Authorization = `Bearer ${apiKey.trim()}`;
    h["anthropic-beta"] = "oauth-2025-04-20,claude-code-20250219";
    h["User-Agent"] = "claude-cli/2.0.27 (external, cli)";
  } else {
    h["x-api-key"] = apiKey.trim();
  }
  return h;
}

export function codexPipeHeaders(apiKey: string, accountId?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    Authorization: `Bearer ${apiKey}`,
    originator: "codex_cli_rs",
    "User-Agent": "codex_cli_rs/0.144.0",
    version: "0.144.0",
  };
  if (accountId) h["ChatGPT-Account-ID"] = accountId;
  return h;
}
