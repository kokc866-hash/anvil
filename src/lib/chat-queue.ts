export type QueuedChatMode = "agent" | "ask" | "plan";
export type QueuedChatReply = { jobId: string; askId: string; project: string };
export type QueuedChatRequest = { text: string; mode: QueuedChatMode; reply?: QueuedChatReply };
export type QueuedChatEntry = QueuedChatRequest | string;

// Old queues did not record a mode. Restore those conservatively as questions.
export function queuedChatRequest(value: unknown): QueuedChatRequest | null {
  if (typeof value === "string") return value.trim() ? { text: value.trim(), mode: "ask" } : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.text !== "string" || !entry.text.trim()) return null;
  const reply = entry.reply as QueuedChatReply | undefined;
  if (entry.reply !== undefined && (entry.mode !== "agent" && entry.mode !== "ask" || entry.text.length > 3000 || !reply || typeof reply !== "object" ||
      typeof reply.jobId !== "string" || !/^[-\w:.]{1,120}$/.test(reply.jobId) ||
      typeof reply.askId !== "string" || !/^[-\w:.]{1,120}$/.test(reply.askId) ||
      typeof reply.project !== "string" || !reply.project || reply.project.length > 4000)) return null;
  return { text: entry.text.trim(), mode: entry.mode === "agent" ? "agent" : entry.mode === "plan" ? "plan" : "ask",
    ...(reply ? { reply: { jobId: reply.jobId, askId: reply.askId, project: reply.project } } : {}),
  };
}

export function queuedReplyMatches(request: QueuedChatRequest | null, job: { id: string; status: string; ask?: { id: string } | null } | null, project: string): boolean {
  return Boolean(request?.reply && job?.status === "ask" && request.reply.jobId === job.id && request.reply.askId === job.ask?.id && request.reply.project === project);
}

export function persistedChatQueue(value: unknown): QueuedChatRequest[] {
  if (!Array.isArray(value)) return [];
  return value.map(queuedChatRequest).filter((entry): entry is QueuedChatRequest => Boolean(entry))
    .slice(0, 8).map(entry => ({ ...entry, text: entry.reply ? entry.text : entry.text.slice(0, 2000) }));
}
