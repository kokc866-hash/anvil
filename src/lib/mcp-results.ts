type Stored = { server: string[]; json: string; bytes: number };
const outputs = new Map<string, Stored>();
const MAX_BYTES = 32 * 1024 * 1024;
let bytes = 0;

export function forgetMcpOutputs(server: string) {
  for (const [id, value] of outputs)
    if (value.server.includes(server)) {
      outputs.delete(id);
      bytes -= value.bytes;
    }
}

export function readMcpOutput(id: string, allowed: string[], offset = 0, limit = 12000) {
  const value = outputs.get(id);
  if (!value || !value.server.every((s) => allowed.includes(s)))
    throw new Error(
      "MCP-Ausgabe nicht mehr verfügbar oder Server nicht aktiviert. Den ursprünglichen Tool-Aufruf nicht automatisch wiederholen.",
    );
  const start = Math.max(0, Math.min(value.json.length, Math.floor(Number(offset) || 0)));
  const size = Math.max(256, Math.min(24000, Math.floor(Number(limit) || 12000)));
  const end = Math.min(value.json.length, start + size);
  return {
    id,
    server: value.server,
    format: "json",
    offset: start,
    text: value.json.slice(start, end),
    total: value.json.length,
    nextOffset: end < value.json.length ? end : null,
  };
}

/** Keep complete results outside the model context; paging never repeats an action. */
export function modelMcpResult(
  server: string | string[],
  raw: unknown,
  options?: { images?: boolean },
): Record<string, unknown> {
  const rec =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : { text: String(raw ?? "") };
  const json = JSON.stringify(rec);
  const length = new TextEncoder().encode(json).length;
  let outputId: string | undefined;
  if (length <= MAX_BYTES) {
    while (outputs.size >= 16 || bytes + length > MAX_BYTES) {
      const oldest = outputs.keys().next().value;
      if (!oldest) break;
      bytes -= outputs.get(oldest)!.bytes;
      outputs.delete(oldest);
    }
    outputId = crypto.randomUUID();
    outputs.set(outputId, {
      server: Array.isArray(server) ? server : [server],
      json,
      bytes: length,
    });
    bytes += length;
  }
  const images = (
    Array.isArray(rec.images) ? rec.images : typeof rec.image === "string" ? [rec.image] : []
  ).filter(
    (x): x is string => typeof x === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(x),
  );
  const cleanBlock = (block: unknown): unknown => {
    if (!block || typeof block !== "object") return block;
    const b = block as Record<string, unknown>;
    if (typeof b.data === "string")
      return { ...b, data: `[${b.data.length} base64 characters; retained in output]` };
    if (typeof b.blob === "string")
      return { ...b, blob: `[${b.blob.length} base64 characters; retained in output]` };
    if (b.resource && typeof b.resource === "object")
      return { ...b, resource: cleanBlock(b.resource) };
    return b;
  };
  const { image: _image, images: _images, ...base } = rec;
  const clean = {
    ...base,
    ...(Array.isArray(rec.content) ? { content: rec.content.map(cleanBlock) } : {}),
    ...(Array.isArray(rec.contents) ? { contents: rec.contents.map(cleanBlock) } : {}),
  };
  const text = JSON.stringify(clean);
  const result =
    text.length > 24000
      ? {
          text: text.slice(0, 12000),
          truncated: true,
          totalCharacters: text.length,
          hint: outputId
            ? "Vollständiges Ergebnis mit mcp_read_output lesen (nextOffset bis null). Aktion nicht erneut ausführen."
            : "Ausgabe überschreitet 32 MiB. Aktion nicht automatisch wiederholen; gezielt kleinere Ausgabe anfordern.",
        }
      : clean;
  return {
    ...result,
    isError: Boolean(rec.isError),
    server,
    outputId,
    retained: Boolean(outputId),
    mcpResult: true,
    ...(images.length
      ? {
          mcpImages:
            options?.images === false
              ? []
              : images.filter((url) => url.length <= 8 * 1024 * 1024).slice(0, 4),
          imageCount: images.length,
          imageHint:
            "Bilder liegen in Anvil und, falls retained=true, im vollständigen Ergebnis. Nur tatsächlich übertragene Bilder auswerten.",
        }
      : {}),
  };
}
