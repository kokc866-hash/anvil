import assert from "node:assert/strict";
import { test } from "node:test";
import { packToolContent, packToolEvidence, readKey, readWindow, READ_CHAR_CAP } from "./agent-read.ts";

test("plan references preserve structured MCP results and readable run output", () => {
  const structured = { ok: true, structuredContent: { value: 42 }, content: [{ type: "text", text: "Result" }] };
  const result = JSON.parse(packToolEvidence("mcp_read_resource", structured, "e7"));
  assert.deepEqual(result, { ...structured, plan_evidence_id: "e7" });
  assert.equal("plan_evidence_id" in structured, false);
  assert.match(packToolEvidence("run_file", { ok: true, stdout: "Tests passed" }, "e8"), /^Plan evidence ID: e8[\s\S]*RUN OK[\s\S]*Tests passed/);
});

test('HTML run output exposes real selectors, values and CSS bounds to the model',()=>{
  const observation={viewport:{width:1000,height:700},elements:[{selector:'#name',tag:'INPUT',value:'Seed',rect:{x:20,y:30,width:200,height:40}}]};
  for(const result of [{ok:true,stdout:'Ready',stage:{kind:'html'},state:observation},{ok:true,stdout:'Ready',graphical:true,observation}]) {
    const packed=packToolEvidence('run_file',result,'e2');
    assert.match(packed,/RUN OK/);assert.match(packed,/HTML preview controls \(CSS pixels\):/);
    const controls=JSON.parse(packed.split('HTML preview controls (CSS pixels):\n')[1]);assert.deepEqual(controls,observation);
  }
  assert.doesNotMatch(packToolContent('run_file',{ok:true,stdout:'Node output',stage:{kind:'log'}}),/HTML preview controls/);
});

test("small file reads in full", () => {
  const src = "a\nb\nc";
  const w = readWindow(src);
  assert.equal(w.truncated, false);
  assert.equal(w.body, src);
  assert.equal(w.total, 3);
});

test("large file windows with start_line", () => {
  const src = Array.from({ length: 8000 }, (_, i) => `L${i + 1} ${"x".repeat(40)}`).join("\n");
  assert.ok(src.length > READ_CHAR_CAP);
  const w = readWindow(src, 1, 0);
  assert.equal(w.truncated, true);
  assert.equal(w.from, 1);
  assert.ok(w.to < 8000);
  const w2 = readWindow(src, w.to + 1, 0);
  assert.equal(w2.from, w.to + 1);
});

test("pack tells the model to continue, not rewrite", () => {
  const packed = packToolContent("read_file", {
    path: "index.html",
    content: "hello",
    start_line: 1,
    end_line: 1,
    total_lines: 900,
    truncated: true,
  });
  assert.match(packed, /start_line=2/);
  assert.doesNotMatch(packed, /abgeschnitten/);
  assert.match(packed, / {4}1\|hello/);
});

test("small pack has no truncate note", () => {
  const packed = packToolContent("read_file", {
    path: "a.js",
    content: "x",
    start_line: 1,
    end_line: 1,
    total_lines: 1,
    truncated: false,
  });
  assert.doesNotMatch(packed, /abgeschnitten/);
  assert.ok(packed.length < READ_CHAR_CAP);
});

test("read windows of the same file are different keys", () => {
  assert.notEqual(readKey("big.ts", 1), readKey("big.ts", 2501));
  assert.equal(readKey("big.ts", 1), readKey("big.ts"));
});

test("run_file pack is the Compile/Run log", () => {
  const packed = packToolContent("run_file", {
    ok: false,
    stdout: "— Compile —\nc++ main.cpp -o out",
    stderr: "main.cpp:1: error: x",
    hint: "Error. Patch and run_file again.",
  });
  assert.match(packed, /RUN FAIL/);
  assert.match(packed, /Compile/);
  assert.match(packed, /main\.cpp:1/);
  assert.doesNotMatch(packed, /^\{/);
});

test("model-facing run output distinguishes pending, cancelled, unknown and failed results", () => {
  assert.match(packToolContent("run_file", { ok: true, running: true, stdout: "process started" }), /^RUN PENDING\b/);
  assert.match(packToolContent("run_file", { isError: true, stdout: "runtime error" }), /^RUN FAIL\b/);
  assert.match(packToolContent("run_file", { aborted: true, stdout: "cancelled" }), /^RUN CANCELLED\b/);
  assert.match(packToolContent("run_file", { code: 7, stdout: "failed exit" }), /^RUN FAIL\b/);
  assert.match(packToolContent("run_file", { stdout: "output without an outcome" }), /^RUN UNKNOWN\b/);
  assert.match(packToolContent("run_file", { ok: true, code: 2, exitExpectationMatched: true }), /^RUN OK\b/);
});

test("a long run log retains its final failure and marks the omitted middle", () => {
  const packed = packToolContent("run_file", { ok: false, stdout: "COMPILE_START\n" + "build log\n".repeat(6000), stderr: "FINAL_DIAGNOSTIC: missing symbol" });
  assert.ok(packed.length <= 16000);
  assert.match(packed, /COMPILE_START/);
  assert.match(packed, /FINAL_DIAGNOSTIC/);
  assert.match(packed, /omitted|gekürzt|truncated/);
});

test("large generic output remains valid JSON with outcome and end diagnostics", () => {
  const packed = packToolContent("shell", { ok: false, code: 5, stdout: "BEGIN_LOG " + "body ".repeat(24000) + " FINAL_DIAGNOSTIC", error: "Build failed" });
  const parsed = JSON.parse(packed);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, 5);
  assert.equal(parsed.error, "Build failed");
  assert.equal(parsed.truncated, true);
  assert.match(parsed.text, /BEGIN_LOG/);
  assert.match(parsed.text, /FINAL_DIAGNOSTIC/);
  assert.ok(packed.length <= 80000);
});
