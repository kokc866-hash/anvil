/** A bounded preview retains both ends and never cuts a UTF-16 surrogate pair. */
export function previewToolText(text: string, maxChars: number): string {
  const cap = Math.max(0, Math.floor(Number(maxChars) || 0));
  if (text.length <= cap) return text;
  const prefix = (value: string, length: number) => {
    let end = Math.max(0, Math.min(value.length, length));
    if (end > 0 && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end] || "")) end--;
    return value.slice(0, end);
  };
  const marker = `\n[... middle omitted; ${text.length} total characters ...]\n`;
  if (cap <= marker.length) return prefix(marker, cap);
  const available = cap - marker.length;
  const head = prefix(text, Math.ceil(available / 2));
  let start = text.length - Math.floor(available / 2);
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start] || "") && /[\uD800-\uDBFF]/.test(text[start - 1])) start++;
  return head + marker + text.slice(start);
}

/** Per-agent-invocation output retention; handles cannot address another invocation. */
export class ToolOutputStore {
  private outputs = new Map<string, { text: string; bytes: number }>();
  private bytes = 0;
  private readonly maxBytes: number;
  private readonly maxRecords: number;
  constructor(maxBytes = 16 * 1024 * 1024, maxRecords = 16) {
    this.maxBytes = Math.max(0, Math.floor(maxBytes));
    this.maxRecords = Math.max(0, Math.floor(maxRecords));
  }

  retain(text: string): string | undefined {
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > this.maxBytes || this.maxRecords < 1) return undefined;
    while (this.outputs.size >= this.maxRecords || this.bytes + bytes > this.maxBytes) {
      const oldest = this.outputs.keys().next().value;
      if (!oldest) break;
      this.bytes -= this.outputs.get(oldest)!.bytes;
      this.outputs.delete(oldest);
    }
    const id = crypto.randomUUID();
    this.outputs.set(id, { text, bytes });
    this.bytes += bytes;
    return id;
  }

  read(id: string, offset = 0, limit = 12000) {
    const output = this.outputs.get(id);
    if (!output) return { error: "Output is unavailable in this task or was evicted. Do not repeat the original action to retrieve its output.", definitelyNotExecuted: true };
    let from = Math.max(0, Math.min(output.text.length, Math.floor(Number(offset) || 0)));
    // An arbitrary caller offset must not start in the middle of an encoded character.
    if (from > 0 && /[\uDC00-\uDFFF]/.test(output.text[from] || "") && /[\uD800-\uDBFF]/.test(output.text[from - 1])) from--;
    const size = Math.max(256, Math.min(24000, Math.floor(Number(limit) || 12000)));
    let end = Math.min(output.text.length, from + size);
    if (end < output.text.length && /[\uD800-\uDBFF]/.test(output.text[end - 1] || "") && /[\uDC00-\uDFFF]/.test(output.text[end])) end--;
    return { outputId: id, format: "json", offset: from, text: output.text.slice(from, end), totalCharacters: output.text.length, nextOffset: end < output.text.length ? end : null };
  }
}

/** Keep actual outcome fields visible even when the payload itself is abbreviated. */
export function toolOutcomeFields(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) return {};
  const source = result as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const key of ["ok", "isError", "error", "status", "running", "pending", "aborted", "cancelled", "canceled", "interrupted", "timedOut", "code", "exitExpectationMatched", "definitelyNotExecuted", "functionalChecks"]) {
    if (Object.hasOwn(source, key)) {
      const value = source[key];
      fields[key] = typeof value === "string" ? previewToolText(value, 2000)
        : value && typeof value === "object" ? previewToolText(JSON.stringify(value), 2000) : value;
    }
  }
  return fields;
}

export function retainedToolPreview(text: string, result: unknown, cap: number, store?: ToolOutputStore): Record<string, unknown> {
  const outputId = store?.retain(text);
  return { ...toolOutcomeFields(result), text: previewToolText(text, cap), truncated: true, totalCharacters: text.length,
    retained: Boolean(outputId), ...(outputId ? { outputId } : {}),
    hint: outputId ? `Read the complete original JSON with read_tool_output({"output_id":"${outputId}","offset":0}); continue with nextOffset until null. If absent, select_tools can select it. Do not repeat the original action.`
      : "Output was shortened. The complete original is not retained here. Do not repeat an external action to recover logs; inspect its current state or request a smaller read." };
}
