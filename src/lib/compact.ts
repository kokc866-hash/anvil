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

function stubImages(v: unknown): unknown {
  if (typeof v === "string") return v.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, "[image]");
  if (Array.isArray(v)) {
    return v.map((p) => {
      if (p && typeof p === "object" && ["image_url", "image", "input_image"].includes(String((p as { type?: string }).type))) {
        return { type: (p as { type: string }).type, image: "[image]" };
      }
      if (p && typeof p === "object" && "text" in (p as object)) {
        return { ...(p as object), text: stubImages((p as { text: unknown }).text) };
      }
      return stubImages(p);
    });
  }
  return v;
}

function slimMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m) => {
    if (!m || typeof m !== "object") return m;
    return { ...(m as object), content: stubImages((m as { content?: unknown }).content) };
  });
}

function trimContent(m: Record<string, unknown>, maxChars: number): Record<string, unknown> {
  const c = m.content;
  if (Array.isArray(c)) {
    return {
      ...m,
      content: c.map((p) => {
        if (p && typeof p === "object" && (p as { type?: string }).type === "image_url") return p;
        if (p && typeof p === "object" && "text" in (p as object)) {
          const t = String((p as { text?: unknown }).text ?? "");
          return t.length <= maxChars ? p : { ...p, text: `${t.slice(0, Math.max(80, maxChars))}\n…[gekürzt]` };
        }
        return p;
      }),
    };
  }
  const t = String(c ?? "");
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
    const t = estimateTokens(JSON.stringify(slimMessages([rest[i]])));
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
  const used = estimateTokens(JSON.stringify(slimMessages(messages)));
  if (used <= budget) return { messages, compacted: false };

  const sys = messages.filter(isSys);
  const rest = messages.filter((m) => !isSys(m));
  const recent = keepRecent(rest, mode, budget);
  const old = rest.slice(0, rest.length - recent.length);

  if (!old.length) {
    const stubbed = rest.map((m, i) => (isTool(m) && i < rest.length - 1 ? stubTool(m) : m));
    const next = [...sys, ...stubbed];
    if (estimateTokens(JSON.stringify(slimMessages(next))) <= budget) return { messages: next, compacted: true };
    return { messages, compacted: false };
  }

  const blob = digestOldMessages(old, mode === "aggressive" ? 3500 : 8000);
  const compact = {
    role: "user",
    content: `${COMPACT_MARK}, ${old.length} Nachrichten):\n${blob}`,
  };
  let next = [...sys, compact, ...recent];
  if (estimateTokens(JSON.stringify(slimMessages(next))) > budget) {
    const tail = keepTail(recent, 4);
    const mid = recent.slice(0, recent.length - tail.length).map((m) => {
      if (isTool(m)) return stubTool(m);
      if (m.role === "assistant") {
        const copy = { ...m };
        if (typeof copy.content === "string" && copy.content.length > 1200) copy.content = copy.content.slice(0, 1200);
        return copy;
      }
      return trimContent(m, 1600);
    });
    next = [...sys, { ...compact, content: String(compact.content).slice(0, 4000) }, ...mid, ...tail];
  }
  return { messages: next, compacted: true };
}

// Image tokenization is model-dependent. Reserve a conservative allowance per image,
// independent of base64 size; this is still an estimate, never a tokenizer result.
export const IMAGE_TOKEN_RESERVE = 1536;
function imageCount(v: unknown): number {
  if (Array.isArray(v)) return v.reduce((n, x) => n + imageCount(x), 0);
  if (!v || typeof v !== "object") return 0;
  const o = v as Record<string, unknown>;
  if (o.type === "image_url" || o.type === "image" || o.type === "input_image") return 1;
  return Object.values(o).reduce<number>((n, x) => n + imageCount(x), 0);
}

/** Shared conservative estimate; actual provider tokenization can differ. */
export function estimatePrompt(messages: unknown, tools?: unknown): number {
  const n = estimateTokens(JSON.stringify(slimMessages(messages) ?? [])) + (tools ? estimateTokens(JSON.stringify(tools)) : 0);
  return Math.ceil(n * 1.2) + imageCount(messages) * IMAGE_TOKEN_RESERVE;
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
  const cap = Math.max(0, Math.floor(budget));
  let next = messages.map((m) => ({ ...m }));
  const used = () => estimatePrompt(next);
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

  // System instructions and tool-call arguments must remain intact.

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
  // Account for trim markers, multipart text and indivisible image/tool overhead.
  for (let i = 0; i < next.length && used() > cap; i++) {
    if (isSys(next[i])) continue;
    let chars = JSON.stringify(next[i].content ?? "").length;
    while (used() > cap && chars > 80) {
      chars = Math.max(80, Math.floor(chars / 2));
      next[i] = trimContent(next[i], chars);
    }
  }
  if (used() > cap) throw new Error("Context window zu klein für System, Bilder und Werkzeugaufrufe. Kontext vergrößern oder weniger Werkzeuge/Bilder verwenden.");
  return next;
}

export function isContextError(msg: string): boolean {
  return /exceeds the available context|context.?length|too many tokens|n_ctx|prompt is too long|maximum context|context size|context window|max context|token limit/i.test(msg);
}

/** Ollama/llama.cpp: KV/VRAM zu groß — num_ctx halbieren, nicht den Prompt zuerst. */
export function isVramError(msg: string): boolean {
  return /out of memory|\boom\b|cuda.?oom|unable to allocate|requires more (?:system )?memory|ggml_gallocr|failed to allocate|not enough memory|\bvram\b|kv cache/i.test(msg);
}

export function shrinkLocalCtx(ctx: number): number {
  return Math.max(4096, Math.floor(Math.max(2048, ctx) / 2));
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
  const overhead = 192;
  const toolsTok = payload.tools ? Math.ceil(estimateTokens(JSON.stringify(payload.tools)) * 1.2) : 0;
  const thinking = payload.thinking as Record<string, unknown> | undefined;
  const replyMin = thinking?.type === "enabled" ? 2048 : Math.min(256, Math.max(16, Math.floor(want)));
  let reply = Math.max(replyMin, Math.floor(want));
  let prompt = estimatePrompt(payload.messages, payload.tools);
  if (prompt + reply + overhead > ctxN) reply = Math.max(replyMin, ctxN - prompt - overhead);
  if (prompt + reply + overhead > ctxN && Array.isArray(payload.messages)) {
    payload.messages = fitMessages(payload.messages as Record<string, unknown>[], ctxN - replyMin - overhead - toolsTok);
    prompt = estimatePrompt(payload.messages, payload.tools);
    reply = Math.min(reply, ctxN - prompt - overhead);
  }
  if (reply < replyMin || prompt + reply + overhead > ctxN) {
    throw new Error("Context window zu klein für Prompt, Werkzeuge und Antwort. Kontext vergrößern.");
  }
  if (payload.max_tokens != null) payload.max_tokens = reply;
  if (payload.max_completion_tokens != null) payload.max_completion_tokens = reply;
  const opt = payload.options as Record<string, unknown> | undefined;
  if (opt && typeof opt === "object") {
    if (typeof opt.num_predict === "number") opt.num_predict = reply;
    opt.num_ctx = ctxN;
    if (typeof opt.n_ctx === "number") opt.n_ctx = ctxN;
  }
  if (typeof payload.n_ctx === "number") payload.n_ctx = ctxN;
  if (thinking?.type === "enabled" && typeof thinking.budget_tokens === "number") {
    if (reply < 2048) throw new Error("Context window zu klein für Denken und Antwort. Kontext vergrößern oder Denken ausschalten.");
    thinking.budget_tokens = Math.min(thinking.budget_tokens, reply - 1024);
  }
}
