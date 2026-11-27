import { packChatHistory, type ChatTurn } from "./session.ts";
import { SUPPLEMENTAL_CONTEXT_MARK } from "./compact.ts";
import { agentMessageContent } from './agent-output.ts';

/** The actual task is always separate from removable project context. */
export function packAgentHistory(chat: ChatTurn[], task: { content: string; images?: string[] }, context = "", cap?: number) {
  const history = chat.map(message => ({ ...message, content: agentMessageContent(message) }));
  // Foreground chat already holds this request followed by an empty streaming reply.
  if (history.at(-1)?.role === "assistant" && !history.at(-1)?.content) {
    history.pop();
    if (history.at(-1)?.role === "user" && history.at(-1)?.content === task.content) history.pop();
  }
  const messages = packChatHistory(history, task, cap);
  const current = messages.pop()!;
  if (context.trim()) messages.push({ role: "user", content: `${SUPPLEMENTAL_CONTEXT_MARK}${context}` });
  messages.push(current);
  return messages;
}
