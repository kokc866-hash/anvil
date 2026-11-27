import { withoutLegacyAcceptancePrefix } from '../../electron/agent-output.mjs';

/** Legacy assessments are hidden without rewriting the stored conversation. */
export function agentMessageContent(message: { role: string; content: string }): string {
  return message.role === 'assistant' && Object.hasOwn(message, 'acceptance')
    ? withoutLegacyAcceptancePrefix(message.content) : message.content;
}
