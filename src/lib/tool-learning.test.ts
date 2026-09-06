import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ToolLearningSession, changeToolRule, observeToolText, sanitizeToolLearning, toolLearningMode, LEARNING_LIMITS, type ToolLearning } from "./tool-learning.ts";
import { toolTargetKey, type ToolContract } from "./tool-compat.ts";
import type { ToolCall } from "./tool-call.ts";

const key = toolTargetKey("ollama", "model", "http://127.0.0.1:11434/v1");
const native = (name: string, args: unknown): ToolCall => ({ id: crypto.randomUUID(), type: "function", function: { name, arguments: JSON.stringify(args) } });
const dialect = (name = "read", args: object = { file: "private-canary.txt" }) => ({ content: JSON.stringify({ tool: name, ...args }) });
function fixture(wire: ToolContract["transport"] = "text", names = ["read_file", "write_file", "open_preview"]) {
  let state: ToolLearning = { mode: "auto", rules: [] };
  const job = () => new ToolLearningSession({ get: () => state, update: (fn) => { state = sanitizeToolLearning({ [key]: fn(state) })[key]; }, contract: () => ({ transport: wire, names }), compatibility: "text" });
  return { job, get state() { return state; }, set state(s: ToolLearning) { state = s; } };
}

describe("bounded tool dialect recognition", () => {
  it("keeps existing mode observational and compact/text adaptive", () => {
    assert.equal(toolLearningMode(undefined), "observe");
    assert.equal(toolLearningMode(undefined, "compact"), "auto");
    assert.equal(toolLearningMode("off", "text"), "off");
  });
  it("leaves valid native calls on the direct path", () => {
    const f = fixture("native");
    assert.equal(f.job().resolve({ tool_calls: [native("read_file", { path: "a" })] }), undefined);
    assert.deepEqual(f.state.rules, []);
  });
  it("normalizes native names and fields without coercing values", () => {
    const f = fixture("native");
    const call = f.job().resolve({ tool_calls: [native("functions.readFile", { filePath: "a", startLine: 2 })] })?.calls?.[0];
    assert.equal(call?.function.name, "read_file");
    assert.deepEqual(JSON.parse(call!.function.arguments), { path: "a", start_line: 2 });
    assert.equal(f.job().resolve({ tool_calls: [native("read_file", { file: "a", startLine: "2" })] }), undefined);
    const engine = fixture("native", ["engine_run"]);
    const translated = engine.job().resolve({ tool_calls: [native("engineRun", { action: "test", timeout_ms: 5000 })] })?.calls?.[0];
    assert.deepEqual(JSON.parse(translated!.function.arguments), { action: "test", timeoutMs: 5000 });
  });
  for (const value of [
    { tool: "read", file: "a" }, { name: "readFile", args: { file: "a" } },
    { function: "read_file", parameters: { path: "a" } }, { tool: "read_file", params: '{"path":"a"}' },
    { function: { name: "readFile", arguments: { file: "a" } } }, { name: "read_file", arguments: '{"path":"a"}' },
  ]) it(`recognizes the complete envelope ${JSON.stringify(value)}`, () => {
    const f = fixture();
    const call = f.job().resolve({ content: JSON.stringify(value) })?.calls?.[0];
    assert.equal(call?.function.name, "read_file");
    assert.deepEqual(JSON.parse(call!.function.arguments), { path: "a" });
  });
  it("never harvests native prose or reasoning as calls", () => {
    const f = fixture("native");
    assert.equal(f.job().resolve(dialect()), undefined);
    assert.deepEqual(f.state.rules, []);
  });
  it("rejects framing, examples, batches, truncated JSON and field collisions", () => {
    const raw = dialect().content;
    for (const content of [`Example: ${raw}`, `\`\`\`json\n${raw}\n\`\`\``, `<tool_call>${raw}</tool_call>`, JSON.stringify(raw), `[${raw}]`, raw + raw, raw.slice(0, -1),
      '{"tool":"read","args":{"path":"a"},"explanation":"example"}',
      '{"tool":"read","path":"a","file":"b"}', '{"tool":"read","file":"a","unexpected":"secret"}',
      '{"tool":"read","arguments":{"path":"a"},"args":{"path":"b"}}', '{"tool":"read","file":123}',
    ]) assert.equal(observeToolText(content), undefined, content);
  });
  it("keeps nested MCP payloads exact and never guesses a server", () => {
    const f = fixture("native", ["mcp_call"]);
    const args = { server: "registered-server", name: "external_tool", arguments: { file: "untouched", query: { name: "read_file" } } };
    const call = f.job().resolve({ tool_calls: [native("mcpCall", args)] })?.calls?.[0];
    assert.deepEqual(JSON.parse(call!.function.arguments), args);
    assert.equal(f.job().resolve({ tool_calls: [native("mcpCall", { name: "external_tool", arguments: {} })] }), undefined);
    assert.equal(f.job().resolve({ tool_calls: [native("external_tool", { file: "a" })] }), undefined);
    assert.equal(observeToolText('{"tool":"mcpCall","args":{"server":"s","name":"n","arguments":{"nested":{"__proto__":{}}}}}'), undefined);
  });
  it("does not use offered-tool filtering to resolve an ambiguous meaning", () => {
    const f = fixture("text", ["read_file"]);
    assert.match(f.job().resolve(dialect("open"))!.error!, /bestätigen/);
    assert.deepEqual(f.state.rules[0].candidates.map((c) => c.name), ["read_file", "open_preview"]);
  });
});

describe("learning from real execution results", () => {
  it("records only shapes, and promotes after two separate successful jobs", () => {
    const f = fixture(); const first = f.job();
    for (let i = 0; i < 2; i++) { const call = first.resolve(dialect())!.calls![0]; first.after(call, { ok: true }); }
    assert.equal(f.state.rules[0].status, "observed"); assert.equal(f.state.rules[0].successes, 1);
    const second = f.job(); second.after(second.resolve(dialect())!.calls![0], { ok: true });
    assert.equal(f.state.rules[0].status, "learned"); assert.equal(f.state.rules[0].successes, 2);
    assert.ok(!JSON.stringify(f.state).includes("private-canary"));
  });
  it("does not promote failed, replayed, pending or truncated actions", () => {
    const f = fixture(); const job = f.job(); const call = job.resolve(dialect())!.calls![0];
    job.after(call, { error: "missing file" });
    for (const result of [{ ok: false }, { already_executed: true }, { running: true }, { pending: true }, { truncated: true }]) job.after(call, result);
    assert.equal(f.state.rules[0].successes, 0); assert.equal(f.state.rules[0].failures, 2);
    assert.equal(f.state.rules[0].status, "observed");
  });
  it("requires manual confirmation for save even with one schema-compatible target", () => {
    const f = fixture(); const job = f.job(); const input = dialect("save", { file: "a", text: "private-canary" });
    assert.match(job.resolve(input)!.error!, /bestätigen/);
    f.state = changeToolRule(f.state, f.state.rules[0].id, "confirm", "write_file");
    const call = job.resolve(input)!.calls![0];
    assert.equal(call.function.name, "write_file"); assert.equal(job.before(call), undefined);
    assert.equal(f.state.rules[0].status, "manual");
    assert.ok(!JSON.stringify(f.state).includes("private-canary"));
  });
  it("persists a chosen target among ambiguous candidates", () => {
    const f = fixture(); const job = f.job(); job.resolve(dialect("open"));
    f.state = changeToolRule(f.state, f.state.rules[0].id, "confirm", "open_preview");
    f.state = sanitizeToolLearning({ [key]: f.state })[key];
    assert.equal(job.resolve(dialect("open"))!.calls![0].function.name, "open_preview");
  });
  it("never expands the offered tools, including for confirmed rules", () => {
    const f = fixture("text", ["read_file"]);
    assert.match(f.job().resolve(dialect("write", { file: "a", text: "new" }))!.error!, /nicht verfügbar/);
    assert.equal(f.state.rules[0].successes, 0);
  });
  it("observes without routing and can be switched fully off", () => {
    const f = fixture(); f.state.mode = "observe";
    assert.equal(f.job().resolve(dialect()), undefined); assert.equal(f.state.rules.length, 1);
    f.state.mode = "off";
    assert.equal(f.job().resolve(dialect("write", { file: "a", text: "new" })), undefined);
    assert.equal(f.state.rules.length, 1);
  });
  it("rechecks deletion, disabling and off before execution and late success", () => {
    for (const action of ["delete", "toggle", "off"] as const) {
      const f = fixture(); const job = f.job(); const call = job.resolve(dialect())!.calls![0];
      f.state = action === "off" ? { ...f.state, mode: "off" } : changeToolRule(f.state, f.state.rules[0].id, action);
      assert.ok(job.before(call)); job.after(call, { ok: true });
      assert.equal(f.state.rules[0]?.successes || 0, 0);
      if (action === "delete") assert.equal(f.state.rules.length, 0);
    }
  });
  it("requires fresh confirmation after a schema change", () => {
    const f = fixture(); const job = f.job(); job.resolve(dialect());
    f.state.rules[0].candidates[0].schema = "older schema";
    assert.match(job.resolve(dialect())!.error!, /bestätigen/);
    assert.equal(f.state.rules[0].review, true);
    f.state = changeToolRule(f.state, f.state.rules[0].id, "confirm", "read_file");
    assert.ok(job.resolve(dialect())?.calls);
  });
  it("invalidates a prepared batch when its mapping changes", () => {
    const f = fixture(); const job = f.job(); const call = job.resolve(dialect())!.calls![0];
    f.state = changeToolRule(f.state, f.state.rules[0].id, "toggle");
    f.state = changeToolRule(f.state, f.state.rules[0].id, "toggle");
    assert.ok(job.before(call));
  });
});

describe("bounded persistence and imports", () => {
  it("demotes imported confirmations without losing their reviewable mapping", () => {
    const f = fixture(); f.job().resolve(dialect("save", { file: "a", text: "new" }));
    f.state = changeToolRule(f.state, f.state.rules[0].id, "confirm", "write_file");
    f.state = sanitizeToolLearning({ [key]: f.state }, true)[key];
    assert.equal(f.state.rules[0].review, true); assert.equal(f.state.rules[0].status, "observed");
    assert.match(f.job().resolve(dialect("save", { file: "a", text: "new" }))!.error!, /bestätigen/);
  });
  it("rejects poisoned targets and field bindings rather than importing arbitrary routes", () => {
    const f = fixture(); f.job().resolve(dialect());
    const badKey = JSON.stringify(["ollama", "http://user:password@server:11434", "ollama-chat", "model"]);
    assert.deepEqual(sanitizeToolLearning({ [badKey]: f.state }), {});
    f.state.rules[0].candidates[0].fields.file = "command";
    assert.deepEqual(sanitizeToolLearning({ [key]: f.state })[key].rules, []);
    assert.deepEqual(sanitizeToolLearning(null), {});
  });
  it("never stores arbitrary imported schema text or duplicate rule identities", () => {
    const f = fixture(); f.job().resolve(dialect()); f.job().resolve(dialect("write", { file: "a", text: "b" }));
    f.state.rules[1].id = f.state.rules[0].id;
    f.state.rules[0].candidates[0].schema = "private-canary masquerading as a schema";
    const cleaned = sanitizeToolLearning({ [key]: f.state })[key];
    assert.equal(cleaned.rules.length, 1);
    assert.ok(!JSON.stringify(cleaned).includes("private-canary"));
    f.state = cleaned;
    assert.match(f.job().resolve(dialect())!.error!, /bestätigen/);
  });
  it("keeps explicit disabled rules when the bounded cache is full", () => {
    const f = fixture(); f.job().resolve(dialect());
    const seed = f.state.rules[0];
    const names = ["read", "readFile", "ReadFile", "read_file", "tools.read_file", "functions.read_file"];
    const envelopes = ["tool:flat", "name:args", "tool:arguments", "function"];
    f.state.rules = Array.from({ length: LEARNING_LIMITS.rules }, (_, i) => ({ ...structuredClone(seed), id: crypto.randomUUID(), shape: { ...seed.shape, name: names[i % names.length], envelope: envelopes[Math.floor(i / names.length)] }, enabled: false }));
    const original = JSON.stringify(f.state);
    const job = f.job();
    assert.ok(job.resolve(dialect("write", { file: "a", text: "new" }))?.error);
    assert.equal(JSON.stringify(f.state), original);
  });
});
