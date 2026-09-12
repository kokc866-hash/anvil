import assert from "node:assert/strict";
import { test } from "node:test";
import { cliEnvironment, completionArgs, completionEnvironment, parseCliOutput, runProcess } from "./cli-runner.mjs";
const node = { file: process.execPath, args: [] };

test("Thinking reaches each CLI as a per-request argument", () => {
  assert.ok(completionArgs("codex", "gpt-5.6-terra", ".", "max").includes('model_reasoning_effort="max"'));
  const claude = completionArgs("claude", "claude-fable-5", ".", "xhigh");
  assert.equal(claude[claude.indexOf("--effort") + 1], "xhigh");
  assert.ok(completionArgs("copilot", "claude-sonnet-5", ".", "max").includes("--effort=max"));
});

test("Auto preserves CLI defaults; unsupported or injected levels cannot become flags", () => {
  for (const [kind, model] of [["codex", "gpt-5.5"], ["claude", "claude-fable-5"], ["copilot", "claude-sonnet-5"]]) {
    const args = completionArgs(kind, model, ".", "auto");
    assert.equal(args.some(v => /effort/.test(v)), false);
    assert.throws(() => completionArgs(kind, model, ".", 'high" --allow-all'), /Thinking/);
  }
  assert.deepEqual(completionArgs("codex", "gpt-5.5", ".", "max"), completionArgs("codex", "gpt-5.5", ".", "auto"));
  assert.deepEqual(completionArgs("claude", "claude-fable-5", ".", "off"), completionArgs("claude", "claude-fable-5", ".", "auto"));
});

test("Claude thinking overrides only request-local settings, including legacy budgets", () => {
  const base = { PATH: "keep", MAX_THINKING_TOKENS: "0", CLAUDE_CODE_EFFORT_LEVEL: "low", CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1", ANTHROPIC_API_KEY: "must-strip" };
  const env = completionEnvironment("claude", "claude-opus-5", "max", base);
  assert.equal(env.PATH, "keep");
  assert.equal(env.MAX_THINKING_TOKENS, undefined);
  assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, undefined);
  assert.equal(env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(base.MAX_THINKING_TOKENS, "0");
  assert.equal(completionEnvironment("claude", "claude-opus-5", "auto", base).CLAUDE_CODE_EFFORT_LEVEL, "low");
  assert.equal(completionEnvironment("claude", "claude-sonnet-4-5", "high", base).MAX_THINKING_TOKENS, "32768");
  assert.equal(completionEnvironment("claude", "claude-opus-5", "off", base).MAX_THINKING_TOKENS, "0");
  const args = completionArgs("claude", "claude-opus-5", ".", "off");
  assert.deepEqual(JSON.parse(args[args.indexOf("--settings") + 1]), { disableAllHooks: true, alwaysThinkingEnabled: false });
});

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
