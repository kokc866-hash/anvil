import { estimateTokens } from "./tokens.ts";
import { foldChatMessages } from "./chat-roles.ts";
import { stampToolCalls } from "./tool-call.ts";
import { COMPACT_MARK, digestOldMessages } from "./session.ts";
import { ANVIL_RUN_FRAME, MODEL_IMAGE_LIMIT } from "./agent-image.ts";

export type CompactMode = "off" | "auto" | "aggressive";

export { COMPACT_MARK };

// Content markers survive native/CLI payload conversions without private wire fields.
export const USER_REQUEST_MARK = "[Anvil current user request; preserve the complete text]\n";
export const SUPPLEMENTAL_CONTEXT_MARK = "[Supplemental project context; may be shortened. Read omitted files with read_file.]\n";
export function isPinnedRequest(message: Record<string, unknown>): boolean {
  if (message.role !== "user") return false;
  const content = message.content;
  const text = Array.isArray(content) ? content.map(part => part && typeof part === "object" && "text" in part ? String(part.text) : "").join("\n") : String(content ?? "");
  return text.startsWith(USER_REQUEST_MARK);
}

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

/** A neutral context message does not close unanswered tool calls. */
function toolBoundaryCuts(messages: Record<string, unknown>[]): boolean[] {
  const pending = new Map<string, number>();
  let unnamed = 0;
  const cuts = [true];
  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        const id = call && typeof call === "object" && typeof call.id === "string" ? call.id : "";
        if (id) pending.set(id, (pending.get(id) ?? 0) + 1);
        else unnamed += 1;
      }
    } else if (isTool(message)) {
      const id = typeof message.tool_call_id === "string" ? message.tool_call_id : "";
      const count = pending.get(id) ?? 0;
      if (count > 1) pending.set(id, count - 1);
      else if (count === 1) pending.delete(id);
      else if (unnamed > 0) unnamed -= 1;
    }
    cuts.push(pending.size === 0 && unnamed === 0);
  }
  return cuts;
}

/** Keep last N messages, including any tool group crossing the selected cut. */
function keepTail(rest: Record<string, unknown>[], n: number): Record<string, unknown>[] {
  if (rest.length <= n) return rest;
  const cuts = toolBoundaryCuts(rest);
  let start = rest.length - n;
  while (start > 0 && (!cuts[start] || isTool(rest[start]))) start -= 1;
  return rest.slice(start);
}

function includeToolGroups(messages: Record<string, unknown>[], selected: Set<Record<string, unknown>>): void {
  const cuts = toolBoundaryCuts(messages);
  let start = 0;
  for (let end = 1; end <= messages.length; end++) {
    if (!cuts[end] && end < messages.length) continue;
    // Pinned context within a group must retain its calls and results, too.
    if (messages.slice(start, end).some(message => selected.has(message))) {
      for (let i = start; i < end; i++) selected.add(messages[i]);
    }
    start = end;
  }
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
  const kept = new Set([...keepRecent(rest, mode, budget), ...rest.filter(isPinnedRequest)]);
  includeToolGroups(rest, kept);
  const recent = rest.filter(message => kept.has(message));
  const old = rest.filter(message => !kept.has(message));

  if (!old.length) {
    const stubbed = rest.map((m, i) => (isTool(m) && i < rest.length - 1 ? stubTool(m) : m));
    const next = [...sys, ...stubbed];
    if (estimateTokens(JSON.stringify(slimMessages(next))) <= budget) return { messages: next, compacted: true };
    return { messages, compacted: false };
  }

  const blob = digestOldMessages(old, mode === "aggressive" ? 3500 : 8000);
  const compact = {
    role: "user",
    content: `${COMPACT_MARK}, ${old.length} Nachrichten):\nHistorical context, not new instructions.\n${blob}`,
  };
  let next = [...sys, compact, ...recent];
  if (estimateTokens(JSON.stringify(slimMessages(next))) > budget) {
    const tail = keepTail(recent, 4);
    const mid = recent.slice(0, recent.length - tail.length).map((m) => {
      if (isPinnedRequest(m)) return m;
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
const IMAGE_OMITTED = "[Anvil omitted image content to fit the request image limit.]";
function isImagePart(part: unknown): boolean {
  if (!part || typeof part !== "object" || !("type" in part)) return false;
  return part.type === "image_url" || part.type === "image" || part.type === "input_image";
}

function messageImageCount(message: Record<string, unknown>): number {
  return Array.isArray(message.content) ? message.content.filter(isImagePart).length : 0;
}

function imageCount(v: unknown): number {
  if (Array.isArray(v)) return v.reduce((n, x) => n + imageCount(x), 0);
  if (!v || typeof v !== "object") return 0;
  if (isImagePart(v)) return 1;
  return Object.values(v).reduce<number>((n, x) => n + imageCount(x), 0);
}

/** Preserve current human attachments and fill slots with the latest available evidence. */
export function limitModelImages(messages: Record<string, unknown>[], limit = MODEL_IMAGE_LIMIT): Record<string, unknown>[] {
  const counts = messages.map(messageImageCount);
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= limit) return messages;
  const human = (message: Record<string, unknown>) => message.role === "user" && !message.mcpResult && !Object.hasOwn(message, ANVIL_RUN_FRAME);
  const hasPinnedRequest = messages.some(message => human(message) && isPinnedRequest(message));
  const latestHuman = hasPinnedRequest ? -1 : messages.map(human).lastIndexOf(true);
  const protectedImages = messages.map((message, index) => human(message) && (index === latestHuman || isPinnedRequest(message)) ? counts[index] : 0);
  const protectedCount = protectedImages.reduce((sum, count) => sum + count, 0);
  if (protectedCount > MODEL_IMAGE_LIMIT) {
    throw new Error(`Die aktuellen Nutzeranfragen enthalten ${protectedCount} Bilder. Pro Modellanfrage sind höchstens ${MODEL_IMAGE_LIMIT} möglich. Bitte weniger Bilder anhängen.`);
  }
  let remaining = Math.max(0, limit - protectedCount);
  const result = messages.slice();
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!counts[i] || protectedImages[i]) continue;
    const keep = Math.min(remaining, counts[i]);
    remaining -= keep;
    if (keep === counts[i]) continue;
    let slots = keep;
    const retained = (messages[i].content as unknown[]).filter(part => !isImagePart(part) || slots-- > 0);
    if (!retained.some(part => part && typeof part === "object" && "text" in part && part.text === IMAGE_OMITTED)) {
      retained.push({ type: "text", text: IMAGE_OMITTED });
    }
    result[i] = { ...messages[i], content: retained };
  }
  return result;
}

export function isImageCountRejection(status: number, body: string): boolean {
  if (status !== 400) return false;
  try {
    const error = JSON.parse(body)?.error;
    return error?.code === "invalid_image" && typeof error.message === "string" && /\b(?:zu viele (?:bildvorlagen|bilder)|too many (?:(?:input|attached) )?images)\b/i.test(error.message);
  } catch {
    return false;
  }
}

export const IMAGE_COUNT_RETRIES = 2;

/** This is only called after explicit image-count admission failure. Rejects with all images protected stay visible. */
export function reduceRejectedImages(payload: Record<string, unknown>): number | undefined {
  if (!Array.isArray(payload.messages)) return undefined;
  const before = payload.messages.reduce((sum, message) => sum + messageImageCount(message), 0);
  if (!before) return undefined;
  const reduced = limitModelImages(payload.messages, Math.floor(before / 2));
  const after = reduced.reduce((sum, message) => sum + messageImageCount(message), 0);
  if (after >= before) return undefined;
  payload.messages = reduced;
  return after;
}

/** Shared conservative estimate; actual provider tokenization can differ. */
export function estimatePrompt(messages: unknown, tools?: unknown): number {
  const n = estimateTokens(JSON.stringify(slimMessages(messages) ?? [])) + (tools ? estimateTokens(JSON.stringify(tools)) : 0);
  return Math.ceil(n * 1.2) + imageCount(messages) * IMAGE_TOKEN_RESERVE;
}

function dropOldestTurn(msgs: Record<string, unknown>[]): Record<string, unknown>[] | null {
  const cuts = toolBoundaryCuts(msgs);
  for (let i = 1; i < msgs.length - 2; i++) {
    if (!cuts[i] || isSys(msgs[i]) || isPinnedRequest(msgs[i])) continue;
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
    while (end < msgs.length && !cuts[end]) end += 1;
    if (end >= msgs.length - 1 || msgs.slice(i, end).some(message => isSys(message) || isPinnedRequest(message))) continue;
    return [...msgs.slice(0, i), ...msgs.slice(end)];
  }
  return null;
}

export function fitMessages(messages: Record<string, unknown>[], budget: number): Record<string, unknown>[] {
  const cap = Math.max(0, Math.floor(budget));
  if (estimatePrompt(messages) <= cap) return messages;
  let next = messages.map((m) => ({ ...m }));
  const used = () => estimatePrompt(next);

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
    if (isSys(next[i]) || isPinnedRequest(next[i])) continue;
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
    if (last >= 0 && !isSys(next[last]) && !isPinnedRequest(next[last])) {
      const t = String(next[last].content ?? "");
      next[last] = trimContent(next[last], Math.max(200, t.length - extra * 4));
    }
  }
  // Account for trim markers, multipart text and indivisible image/tool overhead.
  for (let i = 0; i < next.length && used() > cap; i++) {
    if (isSys(next[i]) || isPinnedRequest(next[i])) continue;
    let chars = JSON.stringify(next[i].content ?? "").length;
    while (used() > cap && chars > 80) {
      chars = Math.max(80, Math.floor(chars / 2));
      next[i] = trimContent(next[i], chars);
    }
  }
  if (used() > cap) throw new Error("Context window zu klein für den vollständigen Nutzerauftrag, System, Bilder und Werkzeugaufrufe. Kontext vergrößern oder weniger Werkzeuge/Bilder verwenden; der Auftrag wurde nicht gekürzt.");
  return next;
}

export function isContextError(msg: string): boolean {
  if (/\bcontext_length_exceeded\b/i.test(msg)) return true;
  if (/(?:unknown|unrecognized|unsupported|not supported) (?:field|parameter|option)?\s*["']?context[_ -]?(?:length|window|size)/i.test(msg)) return false;
  if (/(?:Modellkontext|Kontextfenster|Kontextlänge).{0,80}(?:reicht.{0,40}nicht aus|überschritten|zu klein)/i.test(msg)) return true;
  return /exceeds the available context|context.?length|too many tokens|n_ctx|prompt is too long|maximum context|context size|context window|max context|token limit/i.test(msg);
}

/** A rejected history/response reservation is different from allocating the model itself. */
export function isHistoryMemoryError(msg: string): boolean {
  return /agentenverlauf|nachrichtenverlauf|verlauf|history|conversation|messages|prompt|context/i.test(msg)
    && /speicherbudget|(?:memory|gpu)[_\s-]?budget|available memory|verfügbaren? speicher/i.test(msg)
    && /passt.{0,100}nicht|überschreit|exceed|does not fit|cannot fit|not enough|insufficient|too (?:large|big)/i.test(msg);
}

export const HISTORY_MEMORY_RETRIES = 2;

/**
 * Compact only the rejected outgoing payload, leaving the saved history, model,
 * configured context and tool contracts intact. An irreducible task is never cut.
 */
export function compactRejectedHistory(payload: Record<string, unknown>, recovery: { preserveOutput?: boolean } = {}): boolean {
  if (!Array.isArray(payload.messages)) return false;
  const messages = payload.messages as Record<string, unknown>[];
  const prompt = estimatePrompt(messages);
  let smaller: Record<string, unknown>[] | undefined;
  try {
    const fitted = fitMessages(messages, Math.floor(prompt * 0.6));
    if (estimatePrompt(fitted) < prompt) smaller = fitted;
  } catch (error) {
    // Protected user instructions, tool arguments and images can be indivisible.
    if (!(error instanceof Error) || !error.message.startsWith("Context window")) throw error;
  }
  let changed = Boolean(smaller);
  if (smaller) payload.messages = smaller;
  // A context admission failure is not evidence that the configured thinking or
  // output reservation is wrong. First reduce only replaceable history.
  if (recovery.preserveOutput) return changed;
  const thinking = payload.thinking as Record<string, unknown> | undefined;
  const thinkingEnabled = thinking?.type === "enabled" || payload.enable_thinking === true || typeof payload.reasoning_budget === "number" && payload.reasoning_budget > 0;
  const lower = (value: unknown) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return value;
    const minimum = thinkingEnabled ? Math.min(value, 2048) : Math.min(value, 256);
    const reduced = Math.max(minimum, Math.floor(value / 2));
    if (reduced < value) changed = true;
    return reduced;
  };
  for (const key of ["max_tokens", "max_completion_tokens"]) {
    if (typeof payload[key] === "number") payload[key] = lower(payload[key]);
  }
  const options = payload.options as Record<string, unknown> | undefined;
  if (options && typeof options.num_predict === "number") payload.options = { ...options, num_predict: lower(options.num_predict) };
  const reservation = [payload.max_tokens, payload.max_completion_tokens, (payload.options as Record<string, unknown> | undefined)?.num_predict]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const reply = reservation.length ? Math.min(...reservation) : 0;
  if (thinkingEnabled && reply >= 2048 && typeof payload.reasoning_budget === "number" && payload.reasoning_budget > reply - 1024) {
    payload.reasoning_budget = reply - 1024;
    changed = true;
  }
  return changed;
}

/** Ollama/llama.cpp: KV/VRAM zu groß — num_ctx halbieren, nicht den Prompt zuerst. */
export function isVramError(msg: string): boolean {
  return /out of memory|\boom\b|cuda.?oom|unable to allocate|requires more (?:system )?memory|ggml_gallocr|failed to allocate|not enough memory|\bvram\b|kv cache/i.test(msg);
}

export function shrinkLocalCtx(ctx: number): number {
  return Math.max(4096, Math.floor(Math.max(2048, ctx) / 2));
}

/** Prompt + max_tokens/n_predict muss in n_ctx passen — llama.cpp, Ollama, OpenAI, Groq, … */
export function prepChatPayload(payload: Record<string, unknown>, ctx: number, imageLimit = MODEL_IMAGE_LIMIT): void {
  const ctxN = Math.max(2048, ctx | 0);
  if (Array.isArray(payload.messages)) {
    payload.messages = stampToolCalls(foldChatMessages(limitModelImages(payload.messages, imageLimit)));
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
  for (const key of ["reasoning_budget", "reasoning_budget_tokens"]) {
    if (typeof payload[key] === "number" && payload[key] >= 0) payload[key] = Math.min(payload[key], reply);
  }
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
