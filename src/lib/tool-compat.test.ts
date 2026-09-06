import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_TOOLS, AGENT_TOOL_NAMES } from "./agent-tools.ts";
import { ToolSession, isToolStall, parseTextTool, toolTargetKey, validateToolCall } from "./tool-compat.ts";
import { prepareTextTools } from "./tool-fallback.ts";
import { harvestTools } from "./agent-parse.ts";
import { getCap, setCap, resetCap, capLabel, classifyLlmError } from "./model-caps.ts";

test("strict text executes only one complete allowed envelope, including ask_user", () => {
  const call = JSON.stringify({ name: "ask_user", arguments: { prompt: "Welche Variante?", choices: ["A", { id: "b", label: "B" }] } });
  assert.equal(parseTextTool(call, ["ask_user"]).calls.length, 1);
  assert.ok(parseTextTool(call, ["read_file"]).error);
  for (const example of [`Beispiel: ${call}`, `\`\`\`json\n${call}\n\`\`\``, `<think>${call}</think>`, `<tool_call>${call}</tool_call>`, `[${call}]`, `${call}\n${call}`, JSON.stringify(call)]) {
    assert.deepEqual(parseTextTool(example, ["ask_user"]).calls, []);
  }
  assert.equal(parseTextTool('{"name":"write_file","arguments":{"path":"a.txt"}}', ["write_file"]).calls.length, 0);
  assert.equal(harvestTools(call)[0].function.name, "ask_user");
  assert.ok(AGENT_TOOL_NAMES.has("ask_user"));
});

test("native and text validate required, types, enums and complete JSON equally", () => {
  for (const args of [{ path: 12, content: "x" }, { path: "a.txt" }, null, [], "{}"] ) {
    const call = { id: "1", type: "function" as const, function: { name: "write_file", arguments: JSON.stringify(args) } };
    assert.ok(validateToolCall(call, ["write_file"]).error);
    assert.ok(parseTextTool(JSON.stringify({ name: "write_file", arguments: args }), ["write_file"]).error);
  }
  assert.ok(validateToolCall({ id: "1", type: "function", function: { name: "write_file", arguments: '{"path":"a.txt","content":"cut' } }, ["write_file"]).error);
});

test("compact selection includes MCP/Run immediately, remains bounded and allows explicit discovery", () => {
  const session = new ToolSession("compact", "MCP finden und Run compile prüfen");
  const first = session.tools(AGENT_TOOLS).map((t) => t.function.name);
  assert.ok(first.length <= 8);
  for (const name of ["mcp_list", "mcp_call", "run_file", "see_run", "ask_user", "select_tools"]) assert.ok(first.includes(name), name);
  assert.ok(session.select(["missing_tool"]).error);
  session.select(["debug_start", "play", "engine_run"]);
  const next = session.tools(AGENT_TOOLS).map((t) => t.function.name);
  for (const name of ["debug_start", "play", "engine_run", "ask_user"]) assert.ok(next.includes(name));
  const reads = AGENT_TOOLS.filter((t) => ["read_file", "ask_user", "select_tools"].includes(t.function.name));
  session.tools(reads);
  assert.ok(session.select(["write_file"]).error);
  assert.ok(session.tools(reads).every((t) => reads.includes(t) || reads.some((r) => r.function.name === t.function.name)));
});

test("standard keeps exactly its existing catalog and never opts into stall fallback", () => {
  const tools = AGENT_TOOLS.filter((t) => t.function.name !== "select_tools");
  const session = new ToolSession("standard", "Schreibe Datei");
  assert.equal(session.tools(tools), tools);
  assert.equal(session.tryTextFallback(), false);
  const compact = new ToolSession("compact", "Schreibe Datei");
  assert.equal(compact.tryTextFallback(), true);
  assert.equal(compact.tryTextFallback(), false);
  assert.equal(new ToolSession("text", "Schreibe Datei").tryTextFallback(), false);
});

test("project rules do not crowd out tools needed by the actual chat task", () => {
  const wrapped = "Projektregeln:\nNach Änderungen Tests ausführen. Run/Engine in .anvil/harness.json. MCP nur bei Bedarf.\n\nAuftrag:\nLies README.md und erkläre den Inhalt.";
  const session = new ToolSession("text", wrapped);
  const names = session.tools(AGENT_TOOLS).map((t) => t.function.name);
  assert.ok(names.includes("read_file")); assert.ok(names.includes("grep"));
  assert.ok(!names.includes("engine_run")); assert.ok(!names.includes("mcp_call"));
  assert.ok(names.length <= 8);
});

test("normal answers, questions and completed work cannot trigger a stall fallback", () => {
  assert.equal(isToolStall("Analysiere Dateien", [], "Keine Tools verfügbar"), false);
  assert.equal(isToolStall("Schreibe Datei", [], "Welche Sprache soll ich verwenden?"), false);
  assert.equal(isToolStall("Schreibe Datei", [], "Fertig."), false);
  assert.equal(isToolStall("Schreibe Datei", ["write_file"], "Keine Tools verfügbar"), false);
  assert.equal(isToolStall("Schreibe Datei", [], "Keine Tools verfügbar"), true);
  assert.equal(isToolStall("Kompiliere snake.c", [], ""), true);
});

test("text history has decoded arguments, preserves results and never mutates canonical history", () => {
  const original = [{ role: "system", content: "- While working: tool call only — no essay, no plan sentence, no tool XML/JSON in the text." }, { role: "assistant", tool_calls: [{ id: "c1", function: { name: "read_file", arguments: '{"path":"a.txt"}' } }] }, { role: "tool", tool_call_id: "c1", content: "Existing result" }];
  const snapshot = JSON.stringify(original);
  const payload: Record<string, unknown> = { messages: original, tools: AGENT_TOOLS, tool_choice: "required" };
  prepareTextTools(payload, AGENT_TOOLS.slice(0, 3));
  prepareTextTools(payload, AGENT_TOOLS.slice(0, 3));
  assert.equal(JSON.stringify(original), snapshot);
  assert.equal(payload.tools, undefined);
  assert.equal(payload.tool_choice, undefined);
  const msgs = payload.messages as { role: string; content: string }[];
  assert.deepEqual(JSON.parse(msgs[1].content).arguments, { path: "a.txt" });
  assert.match(msgs[2].content, /Existing result/);
  assert.doesNotMatch(msgs[0].content, /no tool XML\/JSON/);
  assert.equal(msgs[0].content.split("Tool transport for this request").length, 2);
});

test("capabilities and settings are isolated by endpoint, model case and protocol, with reset", () => {
  const a = "http://192.168.1.2:11434/v1";
  const b = "http://192.168.1.3:11434/v1";
  assert.equal(toolTargetKey("ollama", "qwen", a), toolTargetKey("ollama", "qwen", "http://192.168.1.2:11434/api/chat"));
  assert.notEqual(toolTargetKey("ollama", "qwen", a), toolTargetKey("ollama", "qwen", b));
  assert.notEqual(toolTargetKey("custom", "ModelA", a), toolTargetKey("custom", "modela", a));
  assert.notEqual(toolTargetKey("custom", "x", a, "openai"), toolTargetKey("custom", "x", a, "anthropic"));
  assert.doesNotThrow(() => toolTargetKey("custom", "x", "http://"));
  setCap("ollama", "qwen", { tools: "text", noStreamTools: true }, a);
  assert.equal(getCap("ollama", "qwen", b).tools, "unknown");
  assert.match(capLabel(getCap("ollama", "qwen", a)), /Tools als Text.*ohne Stream/);
  resetCap("ollama", "qwen", a);
  assert.equal(getCap("ollama", "qwen", a).tools, "unknown");
  for (const status of [0, 401, 429, 500, 503]) assert.equal(classifyLlmError(status, "does not support tools"), null);
  assert.equal(classifyLlmError(400, "invalid reasoning_effort value"), null);
});
