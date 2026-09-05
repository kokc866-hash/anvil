import assert from "node:assert/strict";
import { test } from "node:test";
import { cliEnvironment, completionArgs, parseCliOutput, runProcess } from "./cli-runner.mjs";
const node = { file: process.execPath, args: [] };

test("CLI input is delivered literally via stdin without a shell", async () => {
  const input = 'Quotes " and $(echo injected) `echo injected`\nUnicode: Grüße';
  const r = await runProcess(node, ["-e", "process.stdin.pipe(process.stdout)"], { input });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, input);
});
test("process failures and spawn failures are observable", async () => {
  const r = await runProcess(node, [
    "-e",
    "process.stderr.write('login required');process.exit(7)",
  ]);
  assert.equal(r.code, 7);
  assert.equal(r.stderr, "login required");
  await assert.rejects(runProcess({ file: "/missing/anvil-cli", args: [] }, []), /ENOENT/);
});
test("cancel kills a running CLI and its process group", async () => {
  const ctrl = new AbortController();
  let childPid;
  const pending = runProcess(
    node,
    [
      "-e",
      "const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)']);console.log(c.pid);setInterval(()=>{},1000)",
    ],
    {
      signal: ctrl.signal,
      onOutput: (text) => {
        childPid = Number(text.trim());
        ctrl.abort();
      },
    },
  );
  await assert.rejects(pending, /abgebrochen/);
  assert.ok(childPid > 0);
  // A killed child may briefly remain as a zombie until init reaps it on Linux.
});
test("hard stop and output limit terminate the process", async () => {
  await assert.rejects(
    runProcess(node, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 50 }),
    /Zeitlimit/,
  );
  await assert.rejects(
    runProcess(node, ["-e", "process.stdout.write('x'.repeat(17*1024*1024))"]),
    /groß/,
  );
});
test("subscription child cannot inherit API credentials and does retain CLI homes", () => {
  const env = cliEnvironment({
    PATH: "/bin",
    CODEX_HOME: "/codex",
    OPENAI_API_KEY: "api",
    CODEX_API_KEY: "api",
    ANTHROPIC_API_KEY: "api",
    CLAUDE_CODE_USE_BEDROCK: "1",
    COPILOT_GITHUB_TOKEN: "api",
    GITHUB_TOKEN: "api",
  });
  assert.equal(env.CODEX_HOME, "/codex");
  assert.equal(env.PATH, "/bin");
  for (const k of [
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_USE_BEDROCK",
    "COPILOT_GITHUB_TOKEN",
    "GITHUB_TOKEN",
  ])
    assert.equal(env[k], undefined);
});
test("CLI output contracts distinguish final answers from errors and diagnostics", () => {
  const reply = '{"content":"ok","tool_calls":[]}';
  assert.equal(
    parseCliOutput(
      "codex",
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: reply } }),
    ),
    reply,
  );
  assert.equal(parseCliOutput("claude", JSON.stringify({ type: "result", result: reply })), reply);
  assert.equal(parseCliOutput("copilot", reply), reply);
  assert.throws(
    () =>
      parseCliOutput(
        "claude",
        JSON.stringify({ type: "result", is_error: true, result: "quota exhausted" }),
      ),
    /quota/,
  );
  assert.throws(
    () => parseCliOutput("codex", '{"type":"turn.failed","error":{"message":"expired"}}'),
    /expired/,
  );
  assert.throws(() => parseCliOutput("codex", '{"type":"thread.started"}'), /vollständige/);
});
test("Copilot receives stdin, not an overriding -p argument; native tools are restricted", () => {
  const cp = completionArgs("copilot", "gpt-4.1", "/tmp");
  assert.ok(!cp.includes("-p"));
  assert.ok(cp.includes("--deny-tool=*"));
  assert.ok(completionArgs("claude", "sonnet", "/tmp").includes("--strict-mcp-config"));
  assert.ok(completionArgs("codex", "gpt-5.4", "/tmp").includes("read-only"));
  assert.throws(() => completionArgs("codex", "--unsafe", "/tmp"), /Modell/);
});
