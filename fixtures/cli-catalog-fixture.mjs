// Protocol fixture: never connects to a provider or starts a model turn.
import assert from "node:assert/strict";
const kind = process.env.ANVIL_CATALOG_KIND;
const mode = process.env.ANVIL_CATALOG_MODE || "catalog";
const args = process.argv.slice(2);
assert.ok(!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.GITHUB_TOKEN);
if (kind === "claude") {
  assert.ok(args.includes("--no-session-persistence"));
  assert.ok(args.includes("--strict-mcp-config"));
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(JSON.parse(args[args.indexOf("--settings") + 1]).disableAllHooks, true);
} else {
  assert.ok(args.includes("--server") && args.includes("--stdio"));
  assert.ok(args.includes("--disable-builtin-mcps"));
}
let buffer = Buffer.alloc(0);
let calls = 0;
function receive(message) {
  assert.equal(++calls, 1, "Catalog refresh must send no inference, session, or tool request");
  if (kind === "claude") {
    assert.equal(message.type, "control_request");
    assert.equal(message.request.subtype, "initialize");
    assert.deepEqual(message.request.hooks, {});
  } else {
    assert.equal(message.method, "models.list");
    assert.deepEqual(message.params, {});
  }
  if (mode === "early") process.exit(7);
  if (mode === "wait") return;
  const models = mode === "malformed" ? [{}] : [kind === "claude" ? { value: "claude-future[1m]" } : { id: "vendor/future-copilot" }];
  const reply = kind === "claude"
    ? mode === "permission" ? { type: "control_request", request_id: "tool", request: { subtype: "can_use_tool" } }
      : { type: "control_response", response: { subtype: "success", request_id: message.request_id, response: { models } } }
    : mode === "permission" ? { jsonrpc: "2.0", id: "tool", method: "tool.call", params: {} }
      : { jsonrpc: "2.0", id: message.id, result: { models } };
  const body = Buffer.from(JSON.stringify(reply));
  const packet = kind === "claude" ? Buffer.concat([body, Buffer.from("\n")])
    : Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
  // Deliberately split headers, UTF-8 bodies, and newline boundaries.
  process.stdout.write(packet.subarray(0, 17));
  setTimeout(() => process.stdout.write(packet.subarray(17)), 10);
}
process.stdin.on("data", part => {
  buffer = Buffer.concat([buffer, part]);
  if (kind === "claude") {
    const end = buffer.indexOf(10);
    if (end >= 0) { receive(JSON.parse(buffer.subarray(0, end))); buffer = buffer.subarray(end + 1); }
  } else {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) return;
    const length = Number(buffer.subarray(0, end).toString().match(/Content-Length: (\d+)/i)?.[1]);
    if (buffer.length >= end + 4 + length) {
      receive(JSON.parse(buffer.subarray(end + 4, end + 4 + length)));
      buffer = buffer.subarray(end + 4 + length);
    }
  }
});
process.stdin.on("end", () => process.exit(0));
