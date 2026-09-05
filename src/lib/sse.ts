import type { LlmChoice, ToolCall } from "./agent-core";
import { asToolCall } from "./agent-core";
import { agentBeat, streamIdleMs } from "./abort";
import { useIde } from "@/store/ide";
import { isToolTemplateEcho } from "./agent-parse";
import { applyLiveDraft, applyLiveText } from "./live-write";
import { applyResponsesEvent, choiceFromAcc, emptyResponsesAcc } from "./responses-parse";

const AFTER_FINISH_MS = 8_000;
const AFTER_STOP_MS = 2_000;
const THINK_OFF_IDLE_MS = 12_000;

function thinkOff(): boolean {
  try {
    return useIde.getState().llmThinking === "off";
  } catch {
    return false;
  }
}

function stallWait(gotEvent: boolean): number {
  try {
    return streamIdleMs(gotEvent, useIde.getState().llmHardStopMin ?? 0);
  } catch {
    return streamIdleMs(gotEvent, 0);
  }
}

export class StreamStallError extends Error {
  constructor(msg = "Modell hat den Strom abgebrochen.") {
    super(msg);
    this.name = "StreamStallError";
  }
}

export async function readSseChat(
  res: Response,
  onDelta?: (text: string, kind?: "text" | "think") => void,
): Promise<LlmChoice> {
  if (!res.body) throw new Error("Keine Stream-Antwort.");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  let reasoning = "";
  let promptTok = 0;
  let completionTok = 0;
  let sawDone = false;
  let finish = "";
  let inThink = false;
  let gotThink = false;
  let sawStop = false;
  let thinkAt = 0;
  let gotEvent = false;
  const tools = new Map<number, { id: string; name: string; args: string }>();

  const pumpThink = (s: string) => {
    if (!s) return;
    gotThink = true;
    if (!thinkAt) thinkAt = Date.now();
    reasoning += s;
    if (!thinkOff()) onDelta?.(s, "think");
  };
  const pumpText = (s: string) => {
    if (!s) return;
    content += s;
    onDelta?.(s, "text");
  };

  const takeContent = (raw: string) => {
    if (thinkOff()) {
      let piece = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
      const open = piece.search(/<think>/i);
      if (open >= 0) piece = piece.slice(0, open);
      pumpText(piece);
      return;
    }
    let piece = raw;
    if (inThink) {
      const end = piece.indexOf("</think>");
      if (end < 0) {
        pumpThink(piece);
        return;
      }
      pumpThink(piece.slice(0, end));
      piece = piece.slice(end + 8);
      inThink = false;
    }
    while (piece) {
      const start = piece.search(/<think>/i);
      if (start < 0) {
        pumpText(piece);
        return;
      }
      if (start > 0) pumpText(piece.slice(0, start));
      piece = piece.slice(start).replace(/^<think>/i, "");
      const end = piece.search(/<\/think>/i);
      if (end < 0) {
        pumpThink(piece);
        inThink = true;
        return;
      }
      pumpThink(piece.slice(0, end));
      piece = piece.slice(end).replace(/^<\/think>/i, "");
    }
  };

  const readChunk = (): Promise<{ value?: Uint8Array; done: boolean }> =>
    new Promise((resolve, reject) => {
      const wait = sawDone ? AFTER_FINISH_MS : sawStop ? AFTER_STOP_MS : stallWait(gotEvent);
      const t =
        wait > 0
          ? setTimeout(() => {
              if (sawDone || sawStop) {
                resolve({ done: true });
                return;
              }
              reject(new StreamStallError("Kein Token — Verbindung weg. Nochmal senden."));
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
    if (done) break;
    if (value && value.byteLength) gotEvent = true;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith(":")) {
        agentBeat();
        continue;
      }
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") {
        sawDone = true;
        if (inThink && !tools.size) finish = finish || "length";
        continue;
      }
      try {
        const json = JSON.parse(data) as {
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
        if (json.usage) {
          promptTok = json.usage.prompt_tokens ?? promptTok;
          completionTok = json.usage.completion_tokens ?? completionTok;
        }
        const ch = json.choices?.[0];
        if (ch?.finish_reason) {
          const fr = ch.finish_reason;
          if (fr === "tool_calls" || fr === "function_call" || fr === "length") {
            finish = fr;
            sawStop = true;
            if (fr !== "length") sawDone = true;
          } else if (fr === "stop" || fr === "end_turn") {
            finish = finish || fr;
            sawStop = true;
            if (thinkOff() || content || tools.size) sawDone = true;
          }
        }
        const delta = ch?.delta;
        const think = delta?.reasoning_content || delta?.reasoning || delta?.thinking;
        if (think) pumpThink(think);
        if (delta?.content) takeContent(delta.content);
        if (content && (content.includes("write_file") || content.includes("edit_file") || content.includes("append_file"))) {
          applyLiveText(content);
        }
        if (isToolTemplateEcho(content)) {
          sawDone = true;
          finish = finish || "stop";
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
      } catch {
        /* ignore broken chunk */
      }
    }
    if (sawDone) break;
    if (
      thinkOff() &&
      thinkAt &&
      !content &&
      !tools.size &&
      Date.now() - thinkAt > THINK_OFF_IDLE_MS
    ) {
      finish = finish || "stop";
      break;
    }
  }
  } finally {
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
  const tool_calls: ToolCall[] = [...tools.values()]
    .filter((t) => t.name)
    .map((t, i) => asToolCall(t.id || `call_${i}`, t.name, t.args || "{}"));
  if (inThink && reasoning && !tools.size) finish = finish === "tool_calls" || finish === "function_call" ? finish : "length";
  if (!content && !reasoning && !tool_calls.length && !sawDone) {
    throw new StreamStallError("Leerer Stream — Modell hat abgebrochen (oft kalt oder Context zu groß).");
  }
  return {
    role: "assistant",
    content,
    reasoning: reasoning || undefined,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    finish_reason: finish || (tool_calls.length ? "tool_calls" : sawDone ? "stop" : undefined),
    usage: promptTok || completionTok ? { prompt: promptTok, completion: completionTok } : undefined,
  };
}

export async function readSseResponses(
  res: Response,
  onDelta?: (text: string, kind?: "text" | "think") => void,
): Promise<LlmChoice> {
  if (!res.body) throw new Error("Keine Stream-Antwort.");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const acc = emptyResponsesAcc();
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
              reject(new StreamStallError("Kein Token — Verbindung weg. Nochmal senden."));
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
      if (done) break;
      if (value && value.byteLength) gotEvent = true;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        if (t.startsWith(":")) {
          agentBeat();
          continue;
        }
        if (!t.startsWith("data:")) continue;
        const data = t.slice(5).trim();
        if (data === "[DONE]") {
          sawDone = true;
          acc.done = true;
          continue;
        }
        try {
          const j = JSON.parse(data) as Record<string, unknown>;
          const beforeC = acc.content.length;
          const beforeR = acc.reasoning.length;
          applyResponsesEvent(acc, j, onDelta);
          agentBeat();
          if (acc.content.length > beforeC) applyLiveText(acc.content);
          if (acc.content.length > beforeC || acc.reasoning.length > beforeR || acc.tools.size) agentBeat();
          for (const tcall of acc.tools.values()) {
            if (tcall.name && tcall.args) applyLiveDraft(tcall.name, tcall.args);
          }
          if (acc.error) throw new Error(acc.error);
        } catch (err) {
          if (err instanceof Error && acc.error) throw err;
        }
      }
      if (sawDone || acc.done) break;
    }
  } finally {
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
  if (!choice.content && !choice.reasoning && !choice.tool_calls?.length && !sawDone && !acc.done) {
    throw new StreamStallError("Leerer Stream — Modell hat abgebrochen (oft kalt oder Context zu groß).");
  }
  return choice;
}

export async function readSseAnthropic(
  res: Response,
  onDelta?: (text: string, kind?: "text" | "think") => void,
): Promise<LlmChoice> {
  if (!res.body) throw new Error("Keine Stream-Antwort.");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  let reasoning = "";
  const tools = new Map<string, { id: string; name: string; args: string }>();
  let blockId = "";
  let blockKind = "";
  let sawStop = false;
  let promptTok = 0;
  let completionTok = 0;
  let errMsg = "";
  let gotEvent = false;

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
              reject(new StreamStallError("Kein Token — Verbindung weg. Nochmal senden."));
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
      if (done) break;
      if (value && value.byteLength) gotEvent = true;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith("event:") || t.startsWith(":")) {
          if (t.startsWith(":")) agentBeat();
          continue;
        }
        if (!t.startsWith("data:")) continue;
        const data = t.slice(5).trim();
        if (!data || data === "[DONE]") {
          if (data === "[DONE]") sawStop = true;
          continue;
        }
        let j: Record<string, unknown>;
        try {
          j = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const type = String(j.type ?? "");
        if (type === "error") {
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
              content += s;
              onDelta?.(s, "text");
              applyLiveText(content);
            }
          } else if (dt === "thinking_delta" || blockKind === "thinking") {
            const s = String(delta.thinking ?? delta.text ?? "");
            if (s) {
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
        if (type === "message_delta") {
          const usage = (j.usage && typeof j.usage === "object" ? j.usage : null) as
            | { input_tokens?: number; output_tokens?: number }
            | null;
          if (usage) {
            promptTok = usage.input_tokens ?? promptTok;
            completionTok = usage.output_tokens ?? completionTok;
          }
          const delta = (j.delta && typeof j.delta === "object" ? j.delta : {}) as { stop_reason?: string };
          if (delta.stop_reason) sawStop = true;
        }
        if (type === "message_stop") sawStop = true;
      }
      if (sawStop) break;
    }
  } finally {
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
  if (errMsg) throw new Error(errMsg);
  const tool_calls: ToolCall[] = [...tools.values()]
    .filter((t) => t.name)
    .map((t) => asToolCall(t.id, t.name, t.args || "{}"));
  if (!content && !reasoning && !tool_calls.length && !sawStop) {
    throw new StreamStallError("Leerer Stream — Modell hat abgebrochen (oft kalt oder Context zu groß).");
  }
  return {
    role: "assistant",
    content: content || null,
    reasoning: reasoning || undefined,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    usage: promptTok || completionTok ? { prompt: promptTok, completion: completionTok } : undefined,
  };
}

