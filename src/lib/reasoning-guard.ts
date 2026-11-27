/** Only exact, sustained repetition inside one reasoning phase is a loop.
 * No wall clock, token-rate or semantic similarity enters this decision. */
const WINDOW = 65536;
const MAX_PERIOD = 8192;
const MIN_COPIES = 5;
const MIN_SPAN = 4096;
const CHECK_EVERY = 256;

export class ReasoningRepetitionError extends Error {
  readonly code = "reasoning_repetition";
  readonly period: number;
  readonly copies: number;
  constructor(period = 0, copies = 0) {
    super("Modellantwort angehalten: Im Denktext wurde eine lange, identische Wiederholungsschleife erkannt. Bisherige Änderungen bleiben erhalten. Werkzeuge aus dieser Antwort wurden nicht ausgeführt.");
    this.name = "ReasoningRepetitionError";
    this.period = period;
    this.copies = copies;
  }
}

export function repetitionFailure(value: unknown): ReasoningRepetitionError | undefined {
  for (let depth = 0; depth < 3; depth++) {
    if (typeof value === "string") {
      if (value.length > 65536) return;
      try { value = JSON.parse(value); } catch { return; }
    }
    if (!value || typeof value !== "object") return;
    if ("code" in value && value.code === "reasoning_repetition") return new ReasoningRepetitionError();
    value = "error" in value ? value.error : "response" in value ? value.response : undefined;
  }
}

export class ReasoningGuard {
  private history = "";
  private unchecked = 0;
  private readonly z = new Uint32Array(WINDOW);
  get bufferedCharacters(): number { return this.history.length; }
  clear(): void { this.history = ""; this.unchecked = 0; }
  finish(): void { if (this.unchecked) { this.unchecked = 0; this.check(); } }
  push(text: string): void {
    // Segment large provider chunks too: a repetitive prefix must not disappear
    // behind a final answer or a later unrelated suffix in the same SSE frame.
    for (let at = 0; at < text.length;) {
      const size = Math.min(CHECK_EVERY - this.unchecked, text.length - at);
      this.history = (this.history + text.slice(at, at + size)).slice(-WINDOW);
      this.unchecked += size;
      at += size;
      if (this.unchecked === CHECK_EVERY) {
        this.unchecked = 0;
        this.check();
      }
    }
  }
  private check(): void {
    const text = this.history, n = text.length;
    if (n < MIN_SPAN) return;
    // Z-values on the reversed suffix find exact periods in linear time.
    // Compare code units in place; avoid regex backtracking and reverse copies.
    const max = Math.min(MAX_PERIOD, Math.floor(n / MIN_COPIES));
    let left = 0, right = 0;
    for (let period = 1; period <= max; period++) {
      let equal = period < right ? Math.min(this.z[period - left], right - period) : 0;
      while (period + equal < n && text.charCodeAt(n - 1 - equal) === text.charCodeAt(n - 1 - period - equal)) equal++;
      this.z[period] = equal;
      if (period + equal > right) { left = period; right = period + equal; }
      const copies = Math.max(MIN_COPIES, Math.ceil(MIN_SPAN / period));
      if (copies * period <= n && equal >= (copies - 1) * period) throw new ReasoningRepetitionError(period, copies);
    }
  }
}

/** Reasoning fields and inline <think> blocks share one guarded channel.
 * Partial tags are held across arbitrary provider/network chunk boundaries. */
export class ReasoningChannel {
  private readonly guard = new ReasoningGuard();
  private pending = "";
  private inside = false;
  private readonly onText: (text: string) => void;
  private readonly onThought: (text: string) => void;
  constructor(onText: (text: string) => void, onThought: (text: string) => void) {
    this.onText = onText;
    this.onThought = onThought;
  }
  get inThinking(): boolean { return this.inside; }
  thought(text: string): void {
    if (!text) return;
    this.guard.push(text);
    this.onThought(text);
  }
  visible(text: string): void {
    if (!text) return;
    if (text.trim()) { this.guard.finish(); this.guard.clear(); }
    this.onText(text);
  }
  content(text: string): void {
    this.pending += text;
    while (this.pending) {
      const tag = this.inside ? "</think>" : "<think>";
      const at = this.pending.toLowerCase().indexOf(tag);
      if (at >= 0) {
        this.emit(this.pending.slice(0, at));
        this.pending = this.pending.slice(at + tag.length);
        this.inside = !this.inside;
        continue;
      }
      let held = Math.min(tag.length - 1, this.pending.length);
      while (held && !tag.startsWith(this.pending.slice(-held).toLowerCase())) held--;
      this.emit(this.pending.slice(0, this.pending.length - held));
      this.pending = held ? this.pending.slice(-held) : "";
      return;
    }
  }
  finish(): void {
    this.emit(this.pending);
    this.pending = "";
    this.guard.finish();
  }
  private emit(text: string): void { if (this.inside) this.thought(text); else this.visible(text); }
}

/** Non-streaming completions receive the same checks before any tool can run. */
export function guardReasoningChoice<T extends {
  content?: string | null; reasoning?: string | null; reasoning_content?: unknown; thinking?: unknown;
  tool_calls?: unknown[]; finish_reason?: string;
}>(choice: T): T {
  let content = "", reasoning = "";
  const channel = new ReasoningChannel(text => { content += text; }, text => { reasoning += text; });
  const thought = choice.reasoning_content ?? choice.reasoning ?? choice.thinking;
  if (typeof thought === "string") channel.thought(thought);
  if (typeof choice.content === "string") channel.content(choice.content);
  channel.finish();
  return { ...choice, content, reasoning: reasoning || undefined,
    ...(channel.inThinking && !choice.tool_calls?.length && !["incomplete", "content_filter"].includes(choice.finish_reason || "") ? { finish_reason: "length" } : {}) };
}
