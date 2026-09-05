import type { LlmChoice } from "./agent-core";

export type CliKind = "codex" | "claude" | "copilot";
export const CLI_PROVIDERS: { kind: CliKind; provider: string; cmd: string; label: string }[] = [
  { kind: "codex", provider: "codex", cmd: "codex login", label: "Codex CLI" },
  { kind: "claude", provider: "anthropic", cmd: "claude auth login", label: "Claude Code CLI" },
  { kind: "copilot", provider: "github", cmd: "copilot login", label: "Copilot CLI" },
];

export function cliKindFor(provider: string, mode: "abo" | "key"): CliKind | null {
  if (provider !== "codex" && provider !== "github" && mode !== "abo") return null;
  return CLI_PROVIDERS.find((p) => p.provider === provider)?.kind ?? null;
}

export function cliPrompt(messages: Record<string, unknown>[], tools: unknown[]): string {
  if (
    messages.some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((p) => p?.type === "image_url" || p?.type === "image"),
    )
  ) {
    throw new Error(
      "Bilder werden über die Abo-CLI noch nicht übertragen. Bitte Text verwenden oder eine API-Verbindung wählen.",
    );
  }
  return [
    "You are the model transport for Anvil. Continue the supplied conversation as its assistant.",
    "The actual workspace and tools belong to Anvil. Do not use native CLI tools or inspect the local filesystem.",
    'Return exactly one JSON object: {"content":"assistant text","tool_calls":[{"name":"tool name","arguments":"JSON-encoded object"}]}.',
    "Request only tools in the supplied tool catalog. Anvil will execute them and send their results in the next conversation. Never claim a requested tool has already run.",
    "Use an empty tool_calls array for a final answer. Put prose/code intended for the user inside content. This outer JSON is a transport envelope, not text shown to the user.",
    JSON.stringify({ tools, messages }),
  ].join("\n\n");
}

export function parseCliChoice(raw: string, allowed: string[]): LlmChoice {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```$/, "");
  let j: { content?: unknown; tool_calls?: { name?: unknown; arguments?: unknown }[] };
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("CLI lieferte kein gültiges Anvil-Antwortformat.");
  }
  if (
    !j ||
    typeof j.content !== "string" ||
    !Array.isArray(j.tool_calls) ||
    j.tool_calls.length > 32
  )
    throw new Error("Ungültige CLI-Antwort.");
  const tool_calls = j.tool_calls.map((t, i) => {
    if (!t || typeof t.name !== "string" || !allowed.includes(t.name))
      throw new Error("CLI hat ein unbekanntes Werkzeug angefordert.");
    const args: unknown = typeof t.arguments === "string" ? JSON.parse(t.arguments) : t.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new Error("Ungültige CLI-Werkzeugargumente.");
    return {
      id: `cli-${Date.now()}-${i}`,
      type: "function" as const,
      function: { name: t.name, arguments: JSON.stringify(args) },
    };
  });
  if (!j.content.trim() && !tool_calls.length) throw new Error("Leere CLI-Antwort.");
  return {
    content: j.content,
    tool_calls,
    finish_reason: tool_calls.length ? "tool_calls" : "stop",
  };
}
