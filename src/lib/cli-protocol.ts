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

/** Keep image bytes out of the text transcript; references retain their conversation position. */
export function cliRequest(messages: Record<string, unknown>[], tools: unknown[]): { prompt: string; images: string[] } {
  const images: string[] = [];
  messages = messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    return { ...message, content: message.content.map((part) => {
      if (part?.type !== "image_url" && part?.type !== "image") return part;
      const url = part.type === "image_url" ? part.image_url?.url : part.source?.type === "base64"
        ? `data:${part.source.media_type};base64,${part.source.data}` : part.source?.url;
      if (typeof url !== "string" || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(url))
        throw new Error("Die CLI benötigt ein angehängtes PNG-, JPEG-, WebP- oder GIF-Bild. Externe Bildadressen zuerst in Anvil als Bild anhängen.");
      let index = images.indexOf(url);
      if (index < 0) { index = images.length; images.push(url); }
      return { type: "text", text: `[Attached image ${index + 1}; image bytes supplied separately in that order.]` };
    }) };
  });
  if (images.length > 8 || images.some(image => image.length > 7 * 1024 * 1024) || images.reduce((sum, image) => sum + image.length, 0) > 28 * 1024 * 1024)
    throw new Error("CLI-Bilder zu groß: höchstens 8 Bilder, 5 MiB je Bild und 20 MiB insgesamt.");
  const prompt = [
    "You are the model transport for Anvil. Continue the supplied conversation as its assistant.",
    "The actual workspace and tools belong to Anvil. Do not use native CLI tools or inspect the local filesystem.",
    'Return exactly one JSON object: {"content":"assistant text","tool_calls":[{"name":"tool name","arguments":"JSON-encoded object"}]}.',
    "Request only tools in the supplied tool catalog. Anvil will execute them and send their results in the next conversation. Never claim a requested tool has already run.",
    "Use an empty tool_calls array for a final answer. Put prose/code intended for the user inside content. This outer JSON is a transport envelope, not text shown to the user.",
    JSON.stringify({ tools, messages }),
  ].join("\n\n");
  return { prompt, images };
}

export function cliPrompt(messages: Record<string, unknown>[], tools: unknown[]): string {
  return cliRequest(messages, tools).prompt;
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
    const args = t.arguments;
    if (typeof args !== "string" && (!args || typeof args !== "object" || Array.isArray(args)))
      throw new Error("Ungültige CLI-Werkzeugargumente.");
    return {
      id: `cli-${Date.now()}-${i}`,
      type: "function" as const,
      // Keep encoded arguments intact. The agent's strict validator rejects bad
      // JSON as a tool result, allowing correction without executing a repaired prefix.
      function: { name: t.name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
    };
  });
  if (!j.content.trim() && !tool_calls.length) throw new Error("Leere CLI-Antwort.");
  return {
    content: j.content,
    tool_calls,
    toolContract: { transport: "native", names: [...allowed] },
    finish_reason: tool_calls.length ? "tool_calls" : "stop",
  };
}
