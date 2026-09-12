import assert from "node:assert/strict";
import { test } from "node:test";
import { McpHost, mcpConfig } from "../electron/mcp-host.mjs";

async function until(predicate) {
  const end = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("Native MCP event did not arrive");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("native MCP catalog and close events retain their originating connection generation", async (t) => {
  const events = [];
  const host = new McpHost({ emit: (event) => events.push(event) });
  t.after(() => host.stop());
  const script = `
    import readline from 'node:readline';
    const send = value => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\\n');
    readline.createInterface({input:process.stdin}).on('line', line => {
      const msg = JSON.parse(line);
      if (msg.id == null) return;
      if (msg.method === 'initialize') return send({id:msg.id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{listChanged:true}},serverInfo:{name:'generation-fixture',version:'1'}}});
      if (msg.method === 'tools/list') {
        send({id:msg.id,result:{tools:[{name:'pid_'+process.pid,inputSchema:{type:'object'}}]}});
        send({method:'notifications/tools/list_changed'});
        return;
      }
      if (msg.method === 'tools/call') return process.exit(0);
      send({id:msg.id,error:{code:-32601,message:'Method not found'}});
    });`;
  const first = {
    id: "anvil-service:generation-test",
    connectionToken: "1",
    transport: "stdio",
    command: process.execPath,
    args: ["--input-type=module", "-e", script],
  };
  const result1 = await host.request(first, "tools/list");
  await until(() => events.some((event) => event.kind === "catalog"));
  const oldEvent = events.find((event) => event.kind === "catalog");
  assert.equal(oldEvent.connectionToken, "1");
  const second = { ...first, connectionToken: "2" };
  const result2 = await host.request(second, "tools/list");
  await until(() =>
    events.some((event) => event.kind === "catalog" && event.connectionToken === "2"),
  );
  assert.notEqual(
    result1.tools[0].name,
    result2.tools[0].name,
    "new token starts a new native session",
  );
  assert.equal(oldEvent.connectionToken, "1", "a queued old event is still distinguishable");
  await assert.rejects(
    host.request(second, "tools/call", { name: result2.tools[0].name, arguments: {} }),
  );
  await until(() => events.some((event) => event.kind === "closed"));
  assert.deepEqual(
    events.filter((event) => event.kind === "closed"),
    [{ server: first.id, kind: "closed", connectionToken: "2" }],
  );
});

test("native MCP keeps untagged callers compatible and bounds optional generation tokens", () => {
  const config = { id: "legacy", url: "https://example.org/mcp" };
  assert.equal(mcpConfig(config).connectionToken, undefined);
  assert.equal(mcpConfig({ ...config, connectionToken: "123" }).connectionToken, "123");
  for (const connectionToken of [123, "", "x".repeat(81), "a\nb"])
    assert.throws(() => mcpConfig({ ...config, connectionToken }), /Verbindungsgeneration/);
});
