import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { EventEmitter } from "node:events";
import { AgentConnections } from "../electron/agent-connections.mjs";
import { AgentProjectRuntime } from "../electron/agent-project-runtime.mjs";
import { AgentJobHost } from "../electron/agent-job-host.mjs";
import { McpHost } from "../electron/mcp-host.mjs";
import { McpOAuth, oauthKey } from "../electron/mcp-oauth.mjs";
import { serviceFixture, installCliFixture } from "./fixtures/background-connections.mjs";
import { buildAgentRuntime } from "./build-agent-runtime.mjs";

await buildAgentRuntime();

const until = async (check) => {
  for (let n = 0; n < 300; n++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("Condition timed out");
};
test(
  "background services reuse OAuth, enforce grants/schema, read resources and never retry ambiguous calls",
  { timeout: 30000 },
  async () => {
    const f = await serviceFixture(),
      issuer = new URL(f.url).origin;
    const record = {
      issuer,
      clients: {},
      tokens: { [issuer]: { access_token: "fixture-access", token_type: "Bearer" } },
      expiresAt: { [issuer]: Date.now() + 3600000 },
    };
    const oauth = new McpOAuth({
      read: async (key) => (key === oauthKey(f.config) ? record : undefined),
      write: async () => {},
      open: () => assert.fail("No login browser during background execution"),
    });
    const connections = new AgentConnections({ mcp: new McpHost({ oauth }) });
    connections.begin({
      services: [f.config],
      surface: { id: "anvil", mode: "bridge" },
      model: {},
    });
    const invoke = (op) =>
      connections.execute(
        { kind: "mcp", server: f.config.id, ...op },
        { signal: new AbortController().signal },
      );
    try {
      const catalog = await invoke({ action: "list" });
      assert.deepEqual(
        catalog.tools.map((t) => t.name),
        ["record"],
      );
      assert.equal(catalog.resources[0].uri, "fixture://document");
      assert.equal(catalog.resourceTemplates.length, 1);
      assert.equal(f.state.badAuth, 0);
      await assert.rejects(
        invoke({ action: "call", name: "forbidden", args: { text: "no" } }),
        /freigegeben/,
      );
      await assert.rejects(invoke({ action: "call", name: "record", args: { text: 3 } }));
      assert.equal(f.state.calls.length, 0);
      assert.match(
        JSON.stringify(await invoke({ action: "call", name: "record", args: { text: "one" } })),
        /SERVICE_OK one/,
      );
      assert.match(
        JSON.stringify(await invoke({ action: "read", name: "fixture://document" })),
        /RESOURCE_OK/,
      );
      assert.equal(
        connections.samePermissions([{ ...f.config, allowedTools: [] }], {
          id: "anvil",
          mode: "bridge",
        }),
        false,
      );
      assert.equal(
        connections.samePermissions([f.config, { ...f.config, id: "new" }], {
          id: "anvil",
          mode: "bridge",
        }),
        true,
      );
      f.state.mode = "disconnect";
      await assert.rejects(invoke({ action: "call", name: "record", args: { text: "uncertain" } }));
      assert.equal(f.state.calls.length, 2, "the uncertain call was sent exactly once");
    } finally {
      await connections.close();
      await f.close();
    }
  },
);

test(
  "host persists uncertain service outcome, strips credentials, deduplicates and cancels owned service calls",
  { timeout: 30000 },
  async () => {
    const f = await serviceFixture(),
      dir = mkdtempSync(join(tmpdir(), "anvil-stage3-"));
    const service = { ...f.config, headers: { authorization: "Bearer fixture-access" } };
    const connections = new AgentConnections(),
      runtime = new AgentProjectRuntime({ connections });
    let child;
    const sent = [];
    const host = new AgentJobHost({
      runtime,
      snapshotPath: join(dir, "latest.json"),
      launch() {
        child = new EventEmitter();
        child.send = (x) => sent.push(x);
        child.kill = () => {};
        return child;
      },
    });
    const request = {
      project: dir,
      execution: true,
      files: {},
      services: [service],
      model: { model: "fixture" },
      messages: [{ role: "user", content: "Test" }],
    };
    const start = () => {
      host.start(request);
      child.emit("message", { type: "ready" });
    };
    const op = {
      kind: "mcp",
      action: "call",
      server: service.id,
      name: "record",
      args: { text: "one" },
    };
    try {
      start();
      f.state.mode = "hold";
      child.emit("message", { type: "operation", id: 1, operation: op });
      await until(() => f.state.calls.length === 1);
      child.emit("message", { type: "operation", id: 1, operation: op });
      assert.ok(!JSON.stringify(sent.find((x) => x.type === "start")).includes("fixture-access"));
      assert.ok(!readFileSync(join(dir, "latest.json"), "utf8").includes("fixture-access"));
      host.stop();
      await host.close();
      assert.equal(host.state.status, "stopped");
      assert.match(host.state.error, /möglicherweise bereits/);
      assert.equal(f.state.calls.length, 1);
      host.dismiss(host.state.id);
      await host.waitForCleanup();
      start();
      f.state.mode = "disconnect";
      child.emit("message", { type: "operation", id: 1, operation: op });
      await until(() => host.state.status === "failed" && !host.operation);
      assert.match(host.state.error, /Prüfe dort das Ergebnis, bevor du sie erneut startest/);
      assert.equal(f.state.calls.length, 2);
    } finally {
      await host.close();
      await f.close();
    }
  },
);

test(
  "background CLI uses the actual guarded runner, streams text, forwards thinking and kills the process on Stop",
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "anvil-stage3-cli-"));
    await installCliFixture(dir);
    const oldPath = process.env.PATH;
    process.env.PATH = dir + delimiter + oldPath;
    const connections = new AgentConnections();
    connections.begin({
      model: {
        cliKind: "claude",
        model: "claude-sonnet-4-20250514",
        thinking: "low",
        hardStopMin: 0,
      },
    });
    writeFileSync(
      join(dir, "cli-choice.json"),
      JSON.stringify({ content: "CLI_OK", tool_calls: [] }),
    );
    try {
      let streamed = "";
      const answer = await connections.execute(
        { kind: "cli", prompt: "Fixture only" },
        { signal: new AbortController().signal, emit: (x) => (streamed += x) },
      );
      assert.equal(JSON.parse(answer).content, "CLI_OK");
      assert.equal(streamed, "CLI_OK");
      const call = JSON.parse(readFileSync(join(dir, "cli-calls.jsonl"), "utf8").trim());
      assert.equal(call.args[call.args.indexOf("--tools") + 1], "");
      assert.equal(call.thinking, "2048");
      writeFileSync(join(dir, "cli-hold"), "hold");
      const controller = new AbortController();
      const run = connections.execute(
        { kind: "cli", prompt: "Hold fixture" },
        { signal: controller.signal },
      );
      const rejection = assert.rejects(run);
      await until(
        () => readFileSync(join(dir, "cli-calls.jsonl"), "utf8").trim().split("\n").length === 2,
      );
      const pid = Number(readFileSync(join(dir, "cli.pid"), "utf8"));
      assert.doesNotThrow(() => process.kill(pid, 0));
      controller.abort();
      await rejection;
      await until(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      });
    } finally {
      process.env.PATH = oldPath;
      await connections.close();
    }
  },
);

test("exclusive surface blocks local execution and unselected services at the host boundary", async () => {
  let requests = 0;
  const connection = new AgentConnections({
    mcp: {
      request() {
        requests++;
        throw Error("must not connect");
      },
      stop() {},
    },
  });
  const runtime = new AgentProjectRuntime({ connections: connection });
  const server = (id) => ({ id, name: id, enabled: true, url: "http://127.0.0.1:1/mcp" });
  runtime.begin(
    {
      files: {},
      services: [server("selected"), server("other")],
      surface: { id: "selected", mode: "exclusive" },
      model: {},
    },
    "fixture",
  );
  const ctx = { signal: new AbortController().signal };
  await assert.rejects(
    runtime.execute({ kind: "mcp", action: "call", server: "other", name: "x" }, ctx),
    /Dienst fehlt/,
  );
  await assert.rejects(
    runtime.execute({ kind: "write", path: "file.txt", content: "blocked" }, ctx),
    /Brücke/,
  );
  assert.equal(
    connection.samePermissions([server("selected")], { id: "anvil", mode: "bridge" }),
    false,
  );
  assert.equal(requests, 0);
  await runtime.close();
});
