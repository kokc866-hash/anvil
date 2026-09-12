import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { createAcpClient, probeAcp } from "../electron/acp-client.mjs";
const options = (mode) => ({
  command: process.execPath,
  args: [path.resolve("fixtures/acp-agent.mjs"), mode],
  cwd: process.cwd(),
  timeoutMs: 3000,
});

test("ACP probe reports negotiated capabilities without sending a prompt", async () => {
  const result = await probeAcp(options("normal"));
  assert.equal(result.protocolVersion, 1);
  assert.equal(result.scope, "initialization-only");
  assert.equal(result.agentCapabilities.promptCapabilities.image, false);
  assert.equal(result.agentInfo.name, "anvil-local-acp-fixture");
});
test("ACP text turn streams only its session and declines client tools and permissions", async () => {
  const updates = [];
  const client = createAcpClient({ ...options("normal"), onUpdate: (u) => updates.push(u) });
  try {
    await client.initialize();
    await client.newSession();
    const result = await client.prompt("Protocol fixture only");
    assert.equal(result.stopReason, "end_turn");
    assert.deepEqual(
      updates.map((u) => u.content.text),
      ["Fixture response"],
    );
  } finally {
    client.close();
  }
});
test("ACP rejects unsupported versions, malformed output and timeout without retries", async () => {
  await assert.rejects(() => probeAcp(options("version")), /Version/);
  await assert.rejects(() => probeAcp(options("malformed")), /Nachricht/);
  await assert.rejects(() => probeAcp({ ...options("hang"), timeoutMs: 150 }), /Zeitlimit/);
});
test("ACP cancellation rejects an in-flight turn and cannot report it completed", async () => {
  const controller = new AbortController();
  const client = createAcpClient({
    ...options("slow"),
    signal: controller.signal,
    onUpdate: () => controller.abort(),
  });
  try {
    await client.initialize();
    await client.newSession();
    await assert.rejects(() => client.prompt("cancel me"), /abgebrochen/);
    await assert.rejects(() => client.prompt("do not retry"), /geschlossen/);
  } finally {
    client.close();
  }
});
test("ACP never executes shell strings or batch wrappers", () => {
  assert.throws(
    () => createAcpClient({ ...options("normal"), command: "node && echo wrong" }),
    /Programmpfad/,
  );
  assert.throws(
    () => createAcpClient({ ...options("normal"), command: path.resolve("agent.cmd") }),
    /Programmpfad/,
  );
});
