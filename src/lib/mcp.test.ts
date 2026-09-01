import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mcpCatalogText, parseMcpBody, unwrapMcp } from "./mcp-parse.ts";

describe("mcp", () => {
  it("parses json and sse", () => {
    assert.equal((parseMcpBody('{"result":{"ok":true}}') as { result?: { ok?: boolean } }).result?.ok, true);
    const sse = parseMcpBody("event: message\ndata: {\"result\":{\"n\":1}}\n\n");
    assert.equal((sse.result as { n?: number })?.n, 1);
  });
  it("unwraps text content", () => {
    const u = unwrapMcp({ content: [{ type: "text", text: "hello" }] }) as { text: string };
    assert.equal(u.text, "hello");
  });
  it("catalog lists server.tool", () => {
    const t = mcpCatalogText([{ server: "docs", name: "search", description: "find pages" }]);
    assert.match(t, /docs\.search/);
    assert.match(t, /mcp_call/);
  });
});
