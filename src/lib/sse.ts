import { chatUsage, anthropicUsage, type ReportedUsage } from "./token-usage";
import type { LlmChoice, ToolCall } from "./agent-core";
import { asToolCall } from "./agent-core";
import { agentBeat, agentGen, localSseStall, streamIdleMs } from "./abort";
import { useIde } from "@/store/ide";
import { applyLiveDraft, applyLiveText, finishLiveWrite } from "./live-write";
import { applyResponsesEvent, choiceFromAcc, emptyResponsesAcc } from "./responses-parse";
import { withModelFailureContext } from "../../electron/agent-failure.mjs";
import { ReasoningChannel, ReasoningGuard, repetitionFailure } from "./reasoning-guard";

const AFTER_FINISH_MS = 8_000;
const AFTER_STOP_MS = 2_000;

function thinkOff(): boolean {
  try {
    return useIde.getState().llmThinking === "off";
  } catch {
    return false;
  }
}

function stallWait(gotEvent: boolean): number {
  try {
    const st = useIde.getState();
    return streamIdleMs(gotEvent, st.llmHardStopMin ?? 0, localSseStall(st.llmProvider, st.llmBaseUrl));
  } catch {
    return streamIdleMs(gotEvent, 0, false);
  }
}

export class StreamStallError extends Error {
  constructor(msg = "Modell hat den Strom abgebrochen.") {
    super(msg);
    this.name = "StreamStallError";
  }
}

function streamFailure(error: unknown, res: Response): Error {
  const failure = error instanceof Error ? error : new Error(String(error));
  withModelFailureContext(failure, { phase: "stream", attempt: 1, status: res.status });
  return failure;
}

function serverError(value: unknown, fallback: string): string {
  const message = typeof value === "string" ? value
    : value && typeof value === "object" && "message" in value ? String(value.message ?? "") : "";
  return message.trim().slice(0, 1000) || fallback;
}

function validateCalls(calls: ToolCall[], res: Response): void {
  for (const call of calls) {
    try {
      const args = JSON.parse(call.function.arguments);
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("object required");
    } catch {
      throw streamFailure(new StreamStallError("Modellantwort unvollständig: Werkzeugargumente sind kein gültiges JSON-Objekt."), res);
    }
  }
}

const incomplete = (finish: string | undefined) => finish === "length" || finish === "incomplete" || finish === "content_filter";

export async function readSseChat(
  res: Response,
  onDelta?: (text: string, kind?: "text" | "think") => void,
): Promise<LlmChoice> {
  if (!res.body) throw new Error("Keine Stream-Antwort.");
  const generation = agentGen();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let eventName = "";
  let content = "";
  let reasoning = "";
  let usage: ReportedUsage | undefined;
  let sawDone = false;
  let finish = "";
  let sawStop = false;
  let finishAt = 0;
  let gotEvent = false;
  const tools = new Map<number, { id: string; name: string; args: string }>();

  const channel = new ReasoningChannel((s: string) => {
    content += s;
    onDelta?.(s, "text");
  }, (s: string) => {
    if (!s) return;
    reasoning += s;
    if (!thinkOff()) onDelta?.(s, "think");
  });

  const readChunk = (): Promise<{ value?: Uint8Array; done: boolean }> =>
    new Promise((resolve, reject) => {
      const wait = sawStop ? Math.max(1, AFTER_STOP_MS - (Date.now() - finishAt)) : stallWait(gotEvent);
      const t =
        wait > 0
          ? setTimeout(() => {
              if (sawDone || sawStop) {
                resolve({ done: true });
                return;
              }
              reject(new StreamStallError("Es sind keine weiteren Antwortdaten eingegangen. Die Verbindung wurde unterbrochen. Du kannst die Nachricht erneut senden."));
            }, wait)
          : 0;
      reader
        .read()
        .then((r) => {
          if (t) clearTimeout(t);
          resolve(r);
        })
        .catch((err) => {
          if (t) clearTimeout(t);
          reject(err);
        });
    });

  try {
  while (true) {
    const { value, done } = await readChunk();
    if (done && !buf.trim()) break;
    if (value && value.byteLength) gotEvent = true;
    buf += done ? dec.decode() + "\n" : dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) { eventName = ""; continue; }
      if (t.startsWith("event:")) { eventName = t.slice(6).trim(); continue; }
      if (t.startsWith(":")) {
        agentBeat();
        continue;
      }
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") {
        sawDone = true;
        if (channel.inThinking && !tools.size) finish = finish || "length";
        continue;
      }
      try {
        const json = JSON.parse(data) as {
          error?: unknown;
          type?: string;
          message?: unknown;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          choices?: {
            finish_reason?: string | null;
            delta?: {
              content?: string;
              reasoning_content?: string;
              reasoning?: string;
              thinking?: string;
              function_call?: { name?: string; arguments?: string };
              tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
            };
            message?: {
              function_call?: { name?: string; arguments?: string };
              tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
            };
          }[];
        };
        if (json.error || json.type === "error" || eventName === "error")
          throw repetitionFailure(json.error ?? json) || new StreamStallError(serverError(json.error ?? json.message, "Der Modellserver meldet einen Fehler im Antwortstrom."));
        if (json.usage) {
          const next = chatUsage(json.usage);
          if (next) usage = { ...usage, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) };
        }
        const ch = json.choices?.[0];
        if (ch?.finish_reason) {
          const fr = ch.finish_reason;
          if (fr === "tool_calls" || fr === "function_call" || fr === "length" || fr === "incomplete" || fr === "content_filter") {
            finish = fr;
            sawStop = true;
            finishAt ||= Date.now();
            // Usage may arrive in a separate chunk after finish_reason.
          } else if (fr === "stop" || fr === "end_turn") {
            finish = finish || fr;
            sawStop = true;
            finishAt ||= Date.now();
          }
        }
        const delta = ch?.delta;
        const think = delta?.reasoning_content || delta?.reasoning || delta?.thinking;
        if (think) channel.thought(think);
        if (delta?.content) channel.content(delta.content);
        if (content && (content.includes("write_file") || content.includes("edit_file") || content.includes("append_file"))) {
          applyLiveText(content);
        }
        if (think || delta?.content || delta?.tool_calls?.length || delta?.function_call || (delta && !delta.content)) agentBeat();
        if (delta?.function_call) {
          const cur = tools.get(0) ?? { id: "legacy", name: "", args: "" };
          if (delta.function_call.name) cur.name += delta.function_call.name;
          if (delta.function_call.arguments) cur.args += delta.function_call.arguments;
          tools.set(0, cur);
          if (cur.name && cur.args) applyLiveDraft(cur.name, cur.args);
        }
        const listed = delta?.tool_calls ?? ch?.message?.tool_calls ?? [];
        for (const tc of listed) {
          const idx = typeof tc.index === "number" ? tc.index : tools.size;
          const cur = tools.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          tools.set(idx, cur);
          if (cur.name && cur.args) applyLiveDraft(cur.name, cur.args);
        }
        const legacy = ch?.message?.function_call;
        if (legacy?.name) {
          tools.set(0, { id: "legacy", name: legacy.name, args: legacy.arguments || "{}" });
        }
      } catch (error) {
        if (error instanceof SyntaxError) throw new StreamStallError("Modellantwort unterbrochen: ungültiges oder unvollständiges JSON im Antwortstrom.");
        throw error;
      }
    }
    if (sawDone || done) break;
  }
  channel.finish();
  } catch (error) {
    throw streamFailure(error, res);
  } finally {
    finishLiveWrite(generation);
    try {
      await reader.cancel();
    } catch {
      /* */
    }
    try {
      reader.releaseLock();
    } catch {
      /* */
    }
  }
  if (!sawDone && !sawStop) throw streamFailure(new StreamStallError("Modellantwort unterbrochen: Abschluss fehlt."), res);
  const tool_calls: ToolCall[] = [...tools.values()]
    .filter((t) => t.name)
    .map((t, i) => asToolCall(t.id || `call_${i}`, t.name, t.args || "{}"));
  if (channel.inThinking && reasoning && !tools.size && !["incomplete", "content_filter"].includes(finish)) finish = finish === "tool_calls" || finish === "function_call" ? finish : "length";
  if (incomplete(finish) && tool_calls.length)
    throw streamFailure(new StreamStallError("Modellantwort unvollständig: Werkzeugaufrufe wurden nicht ausgeführt."), res);
  validateCalls(tool_calls, res);
  if (!content && !reasoning && !tool_calls.length) {
    throw streamFailure(new StreamStallError("Leerer oder unvollständiger Stream — Modell hat keine ausführbare Antwort geliefert."), res);
  }
  return {
    role: "assistant",
    content,
    reasoning: reasoning || undefined,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    finish_reason: finish || (tool_calls.length ? "tool_calls" : sawDone ? "stop" : undefined),
    usage,
  };
}

export async function readSseResponses(
  res: Response,
  onDelta?: (text: string, kind?: "text" | "think") => void,
): Promise<LlmChoice> {
  if (!res.body) throw new Error("Keine Stream-Antwort.");
  const generation = agentGen();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let eventName = "";
  const acc = emptyResponsesAcc();
  const guard = new ReasoningGuard();
  const guardedDelta = (text: string, kind?: "text" | "think") => {
    if (kind === "think") guard.push(text);
    else if (text.trim()) { guard.finish(); guard.clear(); }
    onDelta?.(text, kind);
  };
  let sawDone = false;
  let gotEvent = false;

  const readChunk = (): Promise<{ value?: Uint8Array; done: boolean }> =>
    new Promise((resolve, reject) => {
      const wait = sawDone || acc.done ? AFTER_FINISH_MS : stallWait(gotEvent);
      const t =
        wait > 0
          ? setTimeout(() => {
              if (sawDone || acc.done) {
                resolve({ done: true });
                return;
              }
              reject(new StreamStallError("Es sind keine weiteren Antwortdaten eingegangen. Die Verbindung wurde unterbrochen. Du kannst die Nachricht erneut senden."));
            }, wait)
          : 0;
      reader
        .read()
        .then((r) => {
          if (t) clearTimeout(t);
          resolve(r);
        })
        .catch((err) => {
          if (t) clearTimeout(t);
          reject(err);
        });
    });

  try {
    while (true) {
      const { value, done } = await readChunk();
      if (done && !buf.trim()) break;
      if (value && value.byteLength) gotEvent = true;
      buf += done ? dec.decode() + "\n" : dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t) { eventName = ""; continue; }
        if (t.startsWith("event:")) { eventName = t.slice(6).trim(); continue; }
        if (t.startsWith(":")) {
          agentBeat();
          continue;
        }
        if (!t.startsWith("data:")) continue;
        const data = t.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") {
          sawDone = true;
          acc.done = true;
          continue;
        }
        try {
          const j = JSON.parse(data) as Record<string, unknown>;
          if (!j.type && eventName) j.type = eventName;
          const beforeC = acc.content.length;
          const beforeR = acc.reasoning.length;
          if (j.type === "error" || j.type === "response.failed") {
            const failure = repetitionFailure(j);
            if (failure) throw failure;
          }
          applyResponsesEvent(acc, j, guardedDelta);
          agentBeat();
          if (acc.content.length > beforeC) applyLiveText(acc.content);
          if (acc.content.length > beforeC || acc.reasoning.length > beforeR || acc.tools.size) agentBeat();
          for (const tcall of acc.tools.values()) {
            if (tcall.name && tcall.args) applyLiveDraft(tcall.name, tcall.args);
          }
          if (acc.error) throw new Error(acc.error);
        } catch (error) {
          if (error instanceof SyntaxError) throw new StreamStallError("Modellantwort unterbrochen: ungültiges oder unvollständiges JSON im Antwortstrom.");
          throw error;
        }
      }
      if (sawDone || acc.done || done) break;
    }
    guard.finish();
  } catch (error) {
    throw streamFailure(error, res);
  } finally {
    finishLiveWrite(generation);
    try {
      await reader.cancel();
    } catch {
      /* */
    }
    try {
      reader.releaseLock();
    } catch {
      /* */
    }
  }
  const choice = choiceFromAcc(acc);
  if (!sawDone && !acc.done) throw streamFailure(new StreamStallError("Modellantwort unterbrochen: Abschluss fehlt."), res);
  if (incomplete(choice.finish_reason) && choice.tool_calls?.length)
    throw streamFailure(new StreamStallError("Modellantwort unvollständig: Werkzeugaufrufe wurden nicht ausgeführt."), res);
  validateCalls(choice.tool_calls || [], res);
  if (!choice.content && !choice.reasoning && !choice.tool_calls?.length) {
    throw streamFailure(new StreamStallError("Leerer oder unvollständiger Stream — Modell hat keine ausführbare Antwort geliefert."), res);
  }
  return choice;
}

export async function readSseAnthropic(
  res: Response,
  onDelta?: (text: string, kind?: "text" | "think") => void,
): Promise<LlmChoice> {
  if (!res.body) throw new Error("Keine Stream-Antwort.");
  const generation = agentGen();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let eventName = "";
  let content = "";
  let reasoning = "";
  const tools = new Map<string, { id: string; name: string; args: string }>();
  let blockId = "";
  let blockKind = "";
  let sawStop = false;
  let finish = "";
  const usageFields: Record<string, unknown> = {};
  let finished = false;
  let errMsg = "";
  let gotEvent = false;
  const guard = new ReasoningGuard();

  const readChunk = (): Promise<{ value?: Uint8Array; done: boolean }> =>
    new Promise((resolve, reject) => {
      const wait = sawStop ? AFTER_STOP_MS : stallWait(gotEvent);
      const t =
        wait > 0
          ? setTimeout(() => {
              if (sawStop) {
                resolve({ done: true });
                return;
              }
              reject(new StreamStallError("Es sind keine weiteren Antwortdaten eingegangen. Die Verbindung wurde unterbrochen. Du kannst die Nachricht erneut senden."));
            }, wait)
          : 0;
      reader
        .read()
        .then((r) => {
          if (t) clearTimeout(t);
          resolve(r);
        })
        .catch((e) => {
          if (t) clearTimeout(t);
          reject(e);
        });
    });

  try {
    while (true) {
      const { value, done } = await readChunk();
      if (done && !buf.trim()) break;
      if (value && value.byteLength) gotEvent = true;
      buf += done ? dec.decode() + "\n" : dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t) { eventName = ""; continue; }
        if (t.startsWith("event:")) { eventName = t.slice(6).trim(); continue; }
        if (t.startsWith(":")) {
          if (t.startsWith(":")) agentBeat();
          continue;
        }
        if (!t.startsWith("data:")) continue;
        const data = t.slice(5).trim();
        if (!data || data === "[DONE]") {
          if (data === "[DONE]") { sawStop = true; finished = true; }
          continue;
        }
        let j: Record<string, unknown>;
        try {
          j = JSON.parse(data) as Record<string, unknown>;
        } catch {
          throw new StreamStallError("Modellantwort unterbrochen: ungültiges oder unvollständiges JSON im Antwortstrom.");
        }
        const type = String(j.type ?? eventName);
        if (type === "error") {
          const failure = repetitionFailure(j.error ?? j);
          if (failure) throw failure;
          const e = j.error;
          errMsg =
            typeof e === "string"
              ? e
              : e && typeof e === "object" && "message" in e
                ? String((e as { message?: string }).message ?? "")
                : String(j.message ?? "Anthropic-Fehler");
          sawStop = true;
          continue;
        }
        if (type === "content_block_start") {
          const block = (j.content_block && typeof j.content_block === "object" ? j.content_block : {}) as {
            type?: string;
            id?: string;
            name?: string;
          };
          blockKind = String(block.type ?? "");
          blockId = String(block.id ?? j.index ?? "");
          if (blockKind === "tool_use" && block.name) {
            const id = String(block.id ?? `call_${tools.size}`);
            tools.set(id, { id, name: String(block.name), args: "" });
            blockId = id;
          }
          agentBeat();
        }
        if (type === "content_block_delta") {
          const delta = (j.delta && typeof j.delta === "object" ? j.delta : {}) as {
            type?: string;
            text?: string;
            thinking?: string;
            partial_json?: string;
          };
          const dt = String(delta.type ?? "");
          if (dt === "text_delta" || blockKind === "text") {
            const s = String(delta.text ?? "");
            if (s) {
              if (s.trim()) { guard.finish(); guard.clear(); }
              content += s;
              onDelta?.(s, "text");
              applyLiveText(content);
            }
          } else if (dt === "thinking_delta" || blockKind === "thinking") {
            const s = String(delta.thinking ?? delta.text ?? "");
            if (s) {
              guard.push(s);
              reasoning += s;
              onDelta?.(s, "think");
            }
          } else if (dt === "input_json_delta") {
            const id = blockId || [...tools.keys()].at(-1) || "call";
            const cur = tools.get(id) ?? { id, name: "", args: "" };
            cur.args += String(delta.partial_json ?? "");
            tools.set(id, cur);
            if (cur.name && cur.args) applyLiveDraft(cur.name, cur.args);
          }
          agentBeat();
        }
        if (type === "message_start") {
          const message = j.message as { usage?: Record<string, unknown> } | undefined;
          if (message?.usage) Object.assign(usageFields, message.usage);
        }
        if (type === "message_delta") {
          const usage = (j.usage && typeof j.usage === "object" ? j.usage : null) as
            | { input_tokens?: number; output_tokens?: number }
            | null;
          if (usage) {
            Object.assign(usageFields, usage);
          }
          const delta = (j.delta && typeof j.delta === "object" ? j.delta : {}) as { stop_reason?: string };
          if (delta.stop_reason) {
            sawStop = true;
            finish = delta.stop_reason === "max_tokens" ? "length" : delta.stop_reason === "tool_use" ? "tool_calls"
              : delta.stop_reason === "end_turn" || delta.stop_reason === "stop_sequence" ? "stop" : delta.stop_reason;
          }
        }
        if (type === "message_stop") { sawStop = true; finished = true; }
      }
      if (finished || errMsg || done) break;
    }
    guard.finish();
  } catch (error) {
    throw streamFailure(error, res);
  } finally {
    finishLiveWrite(generation);
    try {
      await reader.cancel();
    } catch {
      /* */
    }
    try {
      reader.releaseLock();
    } catch {
      /* */
    }
  }
  if (errMsg) throw streamFailure(new StreamStallError(errMsg), res);
  if (!sawStop) throw streamFailure(new StreamStallError("Modellantwort unterbrochen: Abschluss fehlt."), res);
  const tool_calls: ToolCall[] = [...tools.values()]
    .filter((t) => t.name)
    .map((t) => asToolCall(t.id, t.name, t.args || "{}"));
  if (incomplete(finish) && tool_calls.length)
    throw streamFailure(new StreamStallError("Modellantwort unvollständig: Werkzeugaufrufe wurden nicht ausgeführt."), res);
  validateCalls(tool_calls, res);
  if (!content && !reasoning && !tool_calls.length) {
    throw streamFailure(new StreamStallError("Leerer oder unvollständiger Stream — Modell hat keine ausführbare Antwort geliefert."), res);
  }
  return {
    role: "assistant",
    content: content || null,
    reasoning: reasoning || undefined,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    finish_reason: finish || (tool_calls.length ? "tool_calls" : "stop"),
    usage: anthropicUsage(usageFields),
  };
}
