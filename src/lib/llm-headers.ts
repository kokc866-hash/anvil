/** Provider-Header für die Pipe (Browser/Electron), nicht nur den Server-Proxy. */

export function responsesNative(provider: string): boolean {
  return provider === "openai" || provider === "azure";
}

export function pipeHeaders(provider: string, apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
  if (provider === "openrouter") {
    h["HTTP-Referer"] = "https://anvil.app";
    h["X-Title"] = "Anvil";
  }
  if (provider === "google" && /^AIza/.test(key)) h["x-goog-api-key"] = key;
  if (provider === "azure" && key) {
    h["api-key"] = key;
    delete h.Authorization;
  }
  return h;
}

export function anthropicHeaders(apiKey: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "anthropic-version": "2023-06-01",
  };
  if (/sk-ant-oat|sk-ant-ort/i.test(apiKey)) throw new Error("Claude-Abo unter Abo → Claude Code CLI auswählen. Cloud benötigt einen API-Key.");
  h["x-api-key"] = apiKey.trim();
  return h;
}
