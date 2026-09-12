export type QueuedChatMode = "agent" | "ask";
export type QueuedChatRequest = { text: string; mode: QueuedChatMode };
export type QueuedChatEntry = QueuedChatRequest | string;

// Old queues did not record a mode. Restore those conservatively as questions.
export function queuedChatRequest(value: unknown): QueuedChatRequest | null {
  if (typeof value === "string") return value.trim() ? { text: value.trim(), mode: "ask" } : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.text !== "string" || !entry.text.trim()) return null;
  return { text: entry.text.trim(), mode: entry.mode === "agent" ? "agent" : "ask" };
}

export function persistedChatQueue(value: unknown): QueuedChatRequest[] {
  if (!Array.isArray(value)) return [];
  return value.map(queuedChatRequest).filter((entry): entry is QueuedChatRequest => Boolean(entry))
    .slice(0, 8).map(entry => ({ ...entry, text: entry.text.slice(0, 2000) }));
}
