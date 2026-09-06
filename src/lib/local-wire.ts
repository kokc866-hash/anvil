/** Translate the agent's OpenAI-shaped history to Ollama's native chat API. */
const OLLAMA_KEYS = new Set(["model", "messages", "stream", "tools", "think", "keep_alive", "options"]);
const OPT_KEYS = new Set(["num_ctx", "num_predict", "temperature"]);
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};

export function ollamaRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/(?:v1|openai|api\/(?:chat|tags|generate))$/i, "");
}

export function usesOllamaNative(provider: string): boolean {
  // Custom endpoints stay OpenAI-compatible even when they happen to use 11434.
  return provider.toLowerCase() === "ollama";
}

export function localChatUrl(provider: string, baseUrl: string): string {
  return usesOllamaNative(provider) ? `${ollamaRoot(baseUrl)}/api/chat` : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function ollamaMessages(messages: unknown): RecordValue[] {
  const names = new Map<string, string>();
  if (!Array.isArray(messages) || !messages.length) return [{ role: "user", content: " " }];
  return messages.map((value) => {
    const message = record(value);
    const out: RecordValue = { role: message.role === "developer" ? "system" : message.role, content: message.content ?? "" };
    if (Array.isArray(message.content)) {
      const text: string[] = [];
      const images: string[] = [];
      for (const value of message.content) {
        const part = record(value);
        if (part.type === "text") text.push(String(part.text ?? ""));
        else if (part.type === "image_url") {
          const image = String(record(part.image_url).url ?? "").match(/^data:image\/[^;,]+;base64,([\s\S]+)$/i);
          if (!image) throw new Error("Ollama benötigt angehängte Bilddaten; die Bild-URL enthält keine Base64-Daten.");
          images.push(image[1]);
        }
      }
      out.content = text.join("\n");
      if (images.length) out.images = images;
    }
    const thinking = message.thinking ?? message.reasoning ?? message.reasoning_content;
    if (thinking) out.thinking = thinking;
    if (Array.isArray(message.tool_calls)) {
      out.tool_calls = message.tool_calls.map((value) => {
        const call = record(value);
        const fn = record(call.function);
        let args = fn.arguments ?? {};
        if (typeof args === "string") {
          try { args = JSON.parse(args); }
          catch { throw new Error(`Ungültige Werkzeugargumente für ${String(fn.name)}.`); }
        }
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Ollama-Werkzeugargumente müssen ein JSON-Objekt sein.");
        if (call.id) names.set(String(call.id), String(fn.name));
        return { type: "function", function: { name: fn.name, arguments: args } };
      });
    }
    if (message.role === "tool") {
      const name = message.tool_name ?? message.name ?? names.get(String(message.tool_call_id));
      if (name) out.tool_name = name;
    }
    return out;
  });
}

export function sanitizeLocalPayload(provider: string, payload: RecordValue): RecordValue {
  if (!usesOllamaNative(provider)) return payload;
  const out = Object.fromEntries(Object.entries(payload).filter(([key, value]) => OLLAMA_KEYS.has(key) && value !== undefined));
  const options = record(payload.options);
  out.options = Object.fromEntries(Object.entries(options).filter(([key, value]) => OPT_KEYS.has(key) && value !== undefined));
  out.messages = ollamaMessages(payload.messages);
  return out;
}

type StreamState = { nextTool: number; done: boolean; tools: boolean };

export function ndjsonLineToSse(line: string, state: StreamState = { nextTool: 0, done: false, tools: false }): string {
  if (!line.trim()) return "";
  let json: RecordValue;
  try { json = JSON.parse(line); }
  catch { throw new Error("Ollama hat ungültiges oder unvollständiges JSON geliefert."); }
  if (json.error) throw new Error(`Ollama: ${typeof json.error === "string" ? json.error : JSON.stringify(json.error)}`);
  const msg = record(json.message);
  const delta: RecordValue = {};
  if (msg.content) delta.content = msg.content;
  if (msg.thinking) delta.reasoning = msg.thinking;
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    state.tools = true;
    delta.tool_calls = msg.tool_calls.map((value) => {
      const call = record(value);
      const fn = record(call.function);
      const index = typeof fn.index === "number" ? fn.index : typeof call.index === "number" ? call.index : state.nextTool;
      state.nextTool = Math.max(state.nextTool, index + 1);
      return { index, id: call.id, function: { name: fn.name, arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}) } };
    });
  }
  state.done = json.done === true;
  const usage = state.done ? { prompt_tokens: json.prompt_eval_count ?? 0, completion_tokens: json.eval_count ?? 0 } : undefined;
  const finish = state.done ? json.done_reason === "length" ? "length" : state.tools ? "tool_calls" : "stop" : undefined;
  // Non-streaming replies put their entire message in the same object as done.
  return `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }], usage })}\n\n${state.done ? "data: [DONE]\n\n" : ""}`;
}

export function wrapOllamaResponse(url: string, res: Response): Response {
  if (!/\/api\/chat$/i.test(url) || !res.ok || !res.body) return res;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state: StreamState = { nextTool: 0, done: false, tools: false };
  let buffer = "";
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        let output = "";
        while (!output && !state.done) {
          const chunk = await reader.read();
          buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = chunk.done ? "" : lines.pop() ?? "";
          for (const line of lines) {
            output += ndjsonLineToSse(line, state);
            if (state.done) break;
          }
          if (chunk.done && !state.done) throw new Error("Ollama-Antwort unvollständig: Abschluss fehlt.");
        }
        if (output) controller.enqueue(encoder.encode(output));
        if (state.done) { controller.close(); await reader.cancel(); }
      } catch (error) {
        controller.error(error);
        await reader.cancel().catch(() => undefined);
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  const headers = new Headers(res.headers);
  headers.set("content-type", "text/event-stream");
  headers.delete("content-length");
  return new Response(stream, { status: res.status, statusText: res.statusText, headers });
}
