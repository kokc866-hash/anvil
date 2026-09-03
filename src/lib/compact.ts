import { estimateTokens } from "./tokens.ts";
import { foldChatMessages } from "./chat-roles.ts";
import { stampToolCalls } from "./tool-call.ts";
import { COMPACT_MARK, digestOldMessages } from "./session.ts";

export type CompactMode = "off" | "auto" | "aggressive";

export { COMPACT_MARK };

function isSys(m: Record<string, unknown>): boolean {
  return m.role === "system" && !String(m.content ?? "").startsWith(COMPACT_MARK);
}

function isTool(m: Record<string, unknown>): boolean {
  return m.role === "tool";
}

function stubTool(m: Record<string, unknown>): Record<string, unknown> {
  const text = String(m.content ?? "");
  const path = text.split("\n")[0]?.slice(0, 80) || "tool";
  return { ...m, content: `[entfernt] ${path} (${text.length} Zeichen)` };
}

function trimContent(m: Record<string, unknown>, maxChars: number): Record<string, unknown> {
  const t = String(m.content ?? "");
  if (t.length <= maxChars) return m;
  return { ...m, content: `${t.slice(0, Math.max(80, maxChars))}\n…[gekürzt]` };
}

/** Keep last N messages, never split assistant tool_calls from their tool results. */
function keepTail(rest: Record<string, unknown>[], n: number): Record<string, unknown>[] {
  if (rest.length <= n) return rest;
  let start = rest.length - n;
  while (start > 0 && isTool(rest[start])) start -= 1;
  return rest.slice(start);
}

function keepRecent(rest: Record<string, unknown>[], mode: CompactMode, budget: number): Record<string, unknown>[] {
  const minKeep = mode === "aggressive" ? 6 : 10;
  const maxKeep = mode === "aggressive" ? 16 : 28;
  const tailBudget = Math.floor(budget * 0.55);
  let n = 0;
  let tok = 0;
  for (let i = rest.length - 1; i >= 0 && n < maxKeep; i--) {
    const t = estimateTokens(JSON.stringify(rest[i]));
    if (n >= minKeep && tok + t > tailBudget) break;
    tok += t;
    n += 1;
  }
  return keepTail(rest, Math.max(minKeep, n));
}

export function compactMessages(
  messages: Record<string, unknown>[],
  context: number,
  mode: CompactMode,
): { messages: Record<string, unknown>[]; compacted: boolean } {
  if (mode === "off") return { messages, compacted: false };
  const budget = Math.floor(Math.max(2048, context) * (mode === "aggressive" ? 0.5 : 0.75));
  const used = estimateTokens(JSON.stringify(messages));
  if (used <= budget) return { messages, compacted: false };

  const sys = messages.filter(isSys);
  const rest = messages.filter((m) => !isSys(m));
  const recent = keepRecent(rest, mode, budget);
  const old = rest.slice(0, rest.length - recent.length);

  if (!old.length) {
    const stubbed = rest.map((m, i) => (isTool(m) && i < rest.length - 1 ? stubTool(m) : m));
    const next = [...sys, ...stubbed];
    if (estimateTokens(JSON.stringify(next)) <= budget) return { messages: next, compacted: true };
    return { messages, compacted: false };
  }

  const blob = digestOldMessages(old, mode === "aggressive" ? 3500 : 8000);
  const compact = {
    role: "user",
    content: `${COMPACT_MARK}, ${old.length} Nachrichten):\n${blob}`,
  };
  let next = [...sys, compact, ...recent];
  if (estimateTokens(JSON.stringify(next)) > budget) {
    const tail = keepTail(recent, 4);
    const mid = recent.slice(0, recent.length - tail.length).map((m) => {
      if (isTool(m)) return stubTool(m);
      if (m.role === "assistant") {
        const copy = { ...m };
        if (typeof copy.content === "string" && copy.content.length > 1200) copy.content = copy.content.slice(0, 1200);
        return copy;
      }
      return { ...m, content: String(m.content ?? "").slice(0, 1600) };
    });
    next = [...sys, { ...compact, content: String(compact.content).slice(0, 4000) }, ...mid, ...tail];
  }
  return { messages: next, compacted: true };
}

/** llama.cpp / OpenAI: Prompt oft ~20 % größer als chars/4. */
export function estimatePrompt(messages: unknown, tools?: unknown): number {
  const n = estimateTokens(JSON.stringify(messages ?? [])) + (tools ? estimateTokens(JSON.stringify(tools)) : 0);
  return Math.ceil(n * 1.2);
}

function dropOldestTurn(msgs: Record<string, unknown>[]): Record<string, unknown>[] | null {
  const i = msgs.findIndex((m, idx) => idx > 0 && idx < msgs.length - 2 && !isSys(m));
  if (i < 0) return null;
  const role = String(msgs[i].role);
  let end = i + 1;
  if (role === "assistant") {
    while (end < msgs.length && isTool(msgs[end])) end += 1;
  } else if (role === "user") {
    if (end < msgs.length && msgs[end].role === "assistant") {
      end += 1;
      while (end < msgs.length && isTool(msgs[end])) end += 1;
    }
  }
  if (end >= msgs.length - 1) return null;
  return [...msgs.slice(0, i), ...msgs.slice(end)];
}

export function fitMessages(messages: Record<string, unknown>[], budget: number): Record<string, unknown>[] {
  const cap = Math.max(1024, budget);
  let next = messages.map((m) => ({ ...m }));
  const used = () => estimateTokens(JSON.stringify(next));
  if (used() <= cap) return next;

  const packed = compactMessages(next, cap, "aggressive");
  next = packed.messages;
  if (used() <= cap) return next;

  let lastTool = -1;
  for (let i = next.length - 1; i >= 0; i--) {
    if (isTool(next[i])) {
      lastTool = i;
      break;
    }
  }
  next = next.map((m, i) => (isTool(m) && i !== lastTool ? stubTool(m) : m));
  if (used() <= cap) return next;

  while (used() > cap && next.length > 3) {
    const trimmed = dropOldestTurn(next);
    if (!trimmed) break;
    next = trimmed;
  }
  if (used() <= cap) return next;

  next = next.map((m) => (isSys(m) ? trimContent(m, 8000) : m));
  if (used() <= cap) return next;

  let extra = used() - cap;
  for (let i = 0; i < next.length && extra > 0; i++) {
    if (isSys(next[i])) continue;
    if (i === next.length - 1) break;
    const t = String(next[i].content ?? "");
    const cut = Math.min(Math.max(0, t.length - 200), extra * 4);
    if (cut > 0) {
      next[i] = trimContent(next[i], t.length - cut);
      extra = used() - cap;
    }
  }
  extra = used() - cap;
  if (extra > 0) {
    const last = next.length - 1;
    if (last >= 0 && !isSys(next[last])) {
      const t = String(next[last].content ?? "");
      next[last] = trimContent(next[last], Math.max(200, t.length - extra * 4));
    }
  }
  return next;
}

export function isContextError(msg: string): boolean {
  return /exceeds the available context|context.?length|too many tokens|n_ctx|prompt is too long|maximum context|context size|context window|max context|token limit/i.test(msg);
}

/** Prompt + max_tokens/n_predict muss in n_ctx passen — llama.cpp, Ollama, OpenAI, Groq, … */
export function prepChatPayload(payload: Record<string, unknown>, ctx: number): void {
  const ctxN = Math.max(2048, ctx | 0);
  if (Array.isArray(payload.messages)) {
    payload.messages = stampToolCalls(foldChatMessages(payload.messages as Record<string, unknown>[]));
  }
  const want =
    (typeof payload.max_completion_tokens === "number" && payload.max_completion_tokens) ||
    (typeof payload.max_tokens === "number" && payload.max_tokens) ||
    (payload.options && typeof (payload.options as { num_predict?: number }).num_predict === "number"
      ? (payload.options as { num_predict: number }).num_predict
      : Math.floor(ctxN * 0.18));
  const toolsTok = payload.tools ? estimateTokens(JSON.stringify(payload.tools)) : 0;
  const overhead = 192 + Math.min(toolsTok, Math.floor(ctxN * 0.28));
  let replyWant = Math.min(Math.max(256, want), Math.floor(ctxN * 0.22));
  let prompt = estimatePrompt(payload.messages);
  if (prompt + replyWant + overhead > ctxN) {
    replyWant = Math.max(256, ctxN - prompt - overhead);
  }
  if (prompt + replyWant + overhead > ctxN && Array.isArray(payload.messages)) {
    const sysKeep = (payload.messages as Record<string, unknown>[]).filter((m) => m.role === "system");
    const sysTok = Math.max(800, estimateTokens(JSON.stringify(sysKeep)));
    const msgBudget = Math.max(sysTok + 400, ctxN - Math.max(256, replyWant) - overhead);
    payload.messages = fitMessages(payload.messages as Record<string, unknown>[], msgBudget);
    prompt = estimatePrompt(payload.messages);
  }
  const reply = Math.max(256, Math.min(replyWant, Math.max(256, ctxN - prompt - overhead)));
  if (payload.max_tokens != null) payload.max_tokens = reply;
  if (payload.max_completion_tokens != null) payload.max_completion_tokens = reply;
  const opt = payload.options as Record<string, unknown> | undefined;
  if (opt && typeof opt === "object") {
    if (typeof opt.num_predict === "number") opt.num_predict = reply;
    opt.num_ctx = ctxN;
  }
}

