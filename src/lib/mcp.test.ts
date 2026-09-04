import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mcpCatalogText,
  parseMcpBody,
  unwrapMcp,
  schemaHint,
  encodeMcpPick,
  decodeMcpPick,
  uniqueMcpName,
  catalogServerKey,
  parseMcpUrl,
  isMcpLoopback,
  serversFingerprint,
  nextListCursor,
  mcpIsError,
} from "./mcp-parse.ts";

describe("mcp", () => {
  it("parses json and sse", () => {
    assert.equal((parseMcpBody('{"result":{"ok":true}}') as { result?: { ok?: boolean } }).result?.ok, true);
    const sse = parseMcpBody("event: message\ndata: {\"result\":{\"n\":1}}\n\n");
    assert.equal((sse.result as { n?: number })?.n, 1);
  });
  it("unwraps text content and isError", () => {
    const u = unwrapMcp({ content: [{ type: "text", text: "hello" }] }) as { text: string };
    assert.equal(u.text, "hello");
    const bad = unwrapMcp({ isError: true, content: [{ type: "text", text: "boom" }] });
    assert.equal(mcpIsError(bad), true);
    assert.equal((bad as { text: string }).text, "boom");
  });
  it("catalog lists server.tool and schema", () => {
    const t = mcpCatalogText([
      {
        server: "docs",
        name: "search",
        description: "find pages",
        inputSchema: { properties: { q: {}, n: {} }, required: ["q"] },
      },
    ]);
    assert.match(t, /docs\.search/);
    assert.match(t, /mcp_call/);
    assert.match(t, /q\*/);
  });
  it("encodes picks without splitting on dots", () => {
    const p = encodeMcpPick("mcp-abc", "tools.foo");
    assert.deepEqual(decodeMcpPick(p), { server: "mcp-abc", name: "tools.foo" });
    assert.deepEqual(decodeMcpPick("Companion.engine_run"), { server: "Companion", name: "engine_run" });
  });
  it("unique names and catalog keys", () => {
    const a = { id: "1", name: "MCP" };
    const b = { id: "2", name: "MCP" };
    assert.equal(uniqueMcpName([a], "MCP", "2"), "MCP 2");
    assert.equal(catalogServerKey(a, [a, b]), "1");
    assert.equal(catalogServerKey(a, [a]), "MCP");
  });
  it("allows loopback and LAN urls", () => {
    assert.equal(isMcpLoopback("127.0.0.1"), true);
    assert.equal(isMcpLoopback("::1"), true);
    assert.equal(parseMcpUrl("http://192.168.1.9:7845/mcp").hostname, "192.168.1.9");
    assert.equal(isMcpLoopback(parseMcpUrl("http://[::1]:7845/mcp").hostname), true);
    assert.throws(() => parseMcpUrl("file:///tmp"));
  });
  it("fingerprints servers and reads nextCursor", () => {
    const fp = serversFingerprint([
      { id: "a", name: "A", url: "http://127.0.0.1/mcp", enabled: true },
      { id: "b", name: "B", url: "http://x/mcp", enabled: false },
    ]);
    assert.match(fp, /a\t/);
    assert.equal(fp.includes("b\t"), false);
    assert.equal(nextListCursor({ nextCursor: "abc" }), "abc");
    assert.equal(nextListCursor({ nextCursor: "" }), "");
  });
  it("schema hint marks required", () => {
    assert.equal(schemaHint({ properties: { q: {}, n: {} }, required: ["q"] }), "q*, n");
    assert.equal(schemaHint(undefined), "");
  });
});
