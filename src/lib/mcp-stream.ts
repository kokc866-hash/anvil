/** Read one JSON-RPC response without waiting for a persistent SSE connection to close. */
export async function readMcpSse(res: Response, onEvent?: (event: unknown) => void, wantId?: number): Promise<unknown> {
  if (!res.ok) throw new Error(`MCP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  if (!res.body) throw new Error("MCP-Stream leer");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", data: string[] = [], found = false, result: unknown;
  const dispatch = () => {
    if (!data.length) return;
    const raw = data.join("\n"); data = [];
    if (!raw.trim() || raw.trim() === "[DONE]") return;
    let event: { id?: unknown; result?: unknown; error?: { message?: string } };
    try { event = JSON.parse(raw); } catch { return; }
    if (!event || typeof event !== "object") return;
    const matches = wantId == null || event.id === wantId;
    if (matches && event.error) throw new Error(event.error.message || "MCP error");
    onEvent?.(event);
    if (matches && "result" in event) { result = event.result; found = true; }
  };
  const line = (text: string) => {
    const clean = text.replace(/\r$/, "");
    if (clean === "") dispatch();
    else if (clean.startsWith("data:")) data.push(clean.slice(5).replace(/^ /, ""));
  };
  try {
    while (!found) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (found) break;
      }
      if (done) { if (buffer) line(buffer); dispatch(); break; }
    }
    if (!found && wantId != null) throw new Error("MCP-Stream endete ohne passende Tool-Antwort.");
    return result;
  } finally {
    try { await reader.cancel(); } catch { /* Connection may already be closed. */ }
    reader.releaseLock();
  }
}
