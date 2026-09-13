/** Decode only the top-level content string of Anvil's JSON envelope, incrementally.
 * Tool arguments, reasoning, protocol frames and diagnostics never become chat text. */
export function createChoiceTextStream(onText = () => {}) {
  let depth = 0, inString = false, escaped = false, unicode = "", key = "", field = "";
  let keyString = false, contentString = false, expectKey = false, started = false, ended = false;
  let prefix = "", text = "", surrogate = "";
  function emit(value) {
    value = surrogate + value;
    surrogate = "";
    if (/[\uD800-\uDBFF]$/.test(value)) { surrogate = value.slice(-1); value = value.slice(0, -1); }
    if (value) { text += value; onText(value); }
  }
  return {
    get text() { return text; },
    push(part) {
      for (const ch of part) {
        if (ended) continue;
        if (!started) {
          prefix += ch;
          if (ch === "{" && /^(?:\s*```(?:json)?\s*)?\s*\{$/.test(prefix)) { started = true; depth = 1; expectKey = true; }
          else if (prefix.length > 100) ended = true;
          continue;
        }
        if (inString) {
          if (unicode) {
            if (!/[a-f\d]/i.test(ch)) { ended = true; continue; }
            unicode += ch;
            if (unicode.length === 5) {
              const value = String.fromCharCode(parseInt(unicode.slice(1), 16));
              if (contentString) emit(value);
              if (keyString) key += value;
              unicode = "";
            }
          } else if (escaped) {
            escaped = false;
            if (ch === "u") { unicode = "u"; continue; }
            const value = ({ '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" })[ch];
            if (value === undefined) { ended = true; continue; }
            if (contentString) emit(value);
            if (keyString) key += value;
          } else if (ch === "\\") escaped = true;
          else if (ch === '"') {
            inString = false;
            if (keyString) { field = key; expectKey = false; }
            if (contentString) { if (surrogate) { text += surrogate; onText(surrogate); surrogate = ""; } ended = true; }
          } else {
            if (ch.charCodeAt(0) < 32) { ended = true; continue; }
            if (contentString) emit(ch);
            if (keyString) key += ch;
          }
          continue;
        }
        if (ch === '"') {
          inString = true; escaped = false; key = "";
          keyString = depth === 1 && expectKey;
          contentString = depth === 1 && !expectKey && field === "content";
        } else if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") { depth--; if (!depth) ended = true; }
        else if (ch === "," && depth === 1) { expectKey = true; field = ""; }
      }
    },
  };
}

/** Consume bounded JSONL stdout. Final-only events reconcile against prior deltas. */
export function createCliStream(kind, onText) {
  const content = createChoiceTextStream(onText);
  let buffer = "", raw = "", bytes = 0;
  function append(delta) { if (typeof delta === "string") { raw += delta; content.push(delta); } }
  function complete(value) { if (typeof value === "string" && value.startsWith(raw)) append(value.slice(raw.length)); }
  function line(value) {
    let event;
    try { event = JSON.parse(value); } catch { return; }
    if (kind === "claude") {
      if (event.type === "stream_event" && event.event?.type === "content_block_delta" && event.event.delta?.type === "text_delta") append(event.event.delta.text);
      if (event.type === "result" && !event.is_error) complete(event.structured_output ? JSON.stringify(event.structured_output) : event.result);
    } else if (kind === "copilot") {
      if (event.type === "assistant.message_delta" && !event.data?.parentToolCallId) append(event.data?.deltaContent);
      if (event.type === "assistant.message" && !event.data?.parentToolCallId) complete(event.data?.content);
    } else if (kind === "codex" && event.type === "item.completed" && event.item?.type === "agent_message") complete(event.item.text);
  }
  return {
    get text() { return content.text; },
    push(part) {
      bytes += Buffer.byteLength(part);
      if (bytes > 16 * 1024 * 1024) throw Error("CLI-Ausgabe ist zu groß.");
      buffer += part;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) { line(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
    },
    finish() { if (buffer.trim()) line(buffer); buffer = ""; },
  };
}
