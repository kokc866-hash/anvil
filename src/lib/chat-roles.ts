function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object" && "text" in p) return String((p as { text?: unknown }).text ?? "");
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return content == null ? "" : String(content);
}

function isSysRole(role: string): boolean {
  return role === "system" || role === "developer";
}

/** Qwen/llama.cpp: exactly one system message, and it must be first. Later system → user. */
export function foldChatMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  const sys: string[] = [];
  const rest: Record<string, unknown>[] = [];
  let seenOther = false;
  for (const m of messages) {
    const role = String(m.role ?? "user");
    if (isSysRole(role)) {
      const text = textOf(m.content).trim();
      if (!text) continue;
      if (!seenOther) sys.push(text);
      else rest.push({ role: "user", content: text });
      continue;
    }
    seenOther = true;
    rest.push(m);
  }
  if (!sys.length) return rest;
  return [{ role: "system", content: sys.join("\n\n") }, ...rest];
}
