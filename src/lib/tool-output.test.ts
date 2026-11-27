import assert from "node:assert/strict";
import { test } from "node:test";
import { previewToolText, ToolOutputStore } from "./tool-output.ts";
import { packToolContent } from "./agent-read.ts";

const unpaired = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test("previews obey every small bound and retain well-formed Unicode", () => {
  const text = "BEGIN🛠️" + "🧩abc".repeat(80) + "END🦊";
  for (let cap = 0; cap <= text.length + 2; cap++) {
    const preview = previewToolText(text, cap);
    assert.ok(preview.length <= cap, `cap ${cap}`);
    assert.doesNotMatch(preview, unpaired, `cap ${cap}`);
    if (cap >= text.length) assert.equal(preview, text);
    if (cap > 100 && cap < text.length) { assert.match(preview, /BEGIN/); assert.match(preview, /END/); assert.match(preview, /omitted/); }
  }
});

test("bounded pages reconstruct the exact output without broken surrogate pairs", () => {
  const store = new ToolOutputStore();
  const text = JSON.stringify({ text: "😀\n".repeat(3000), final: "END" });
  const id = store.retain(text)!;
  let offset: number | null = 0, restored = "";
  while (offset !== null) {
    const page = store.read(id, offset, 257);
    assert.ok("text" in page);
    assert.doesNotMatch(page.text!, unpaired);
    assert.ok(page.text!.length <= 257);
    restored += page.text; offset = page.nextOffset!;
  }
  assert.equal(restored, text);
  const foreign = new ToolOutputStore().read(id);
  assert.match(foreign.error!, /unavailable in this task/);
});

test("retention evicts deterministically and rejects oversized records without dropping others", () => {
  const store = new ToolOutputStore(1000, 2);
  const first = store.retain("a".repeat(250))!;
  const second = store.retain("b".repeat(250))!;
  const third = store.retain("c".repeat(250))!;
  assert.match(store.read(first).error!, /evicted/);
  assert.equal(store.read(second).text, "b".repeat(250));
  assert.equal(store.retain("😀".repeat(251)), undefined, "budget is in UTF-8 bytes");
  assert.equal(store.read(third).text, "c".repeat(250));
});

test("run output has a retrievable complete result and an honest failure preview", () => {
  const store = new ToolOutputStore();
  const raw = { ok: false, stdout: "BUILD_BEGIN\n" + "work\n".repeat(9000), stderr: "ERROR_AT_END", code: 3 };
  const preview = packToolContent("run_file", raw, store);
  assert.ok(preview.length <= 16000);
  assert.match(preview, /^RUN FAIL/);
  assert.match(preview, /ERROR_AT_END/);
  const id = /outputId=([0-9a-f-]+)/.exec(preview)?.[1];
  assert.ok(id);
  let joined = "", offset: number | null = 0;
  while (offset !== null) { const page = store.read(id, offset); joined += page.text; offset = page.nextOffset!; }
  assert.deepEqual(JSON.parse(joined), raw);
});

test("large metadata cannot defeat the valid JSON output bound", () => {
  const packed = packToolContent("shell", { ok: false, error: { message: "Failure".repeat(20000) }, stdout: "\"\\".repeat(60000), status: "failed" });
  assert.ok(packed.length <= 80000);
  const value = JSON.parse(packed);
  assert.equal(value.ok, false);
  assert.equal(value.status, "failed");
  assert.equal(value.truncated, true);
  assert.ok(String(value.error).length <= 2000);
});

test("shortening a preview result preserves the actual function-check outcome", () => {
  for (const functionalChecks of [false, true]) {
    const packed = JSON.parse(packToolContent('play', { ok: true, functionalChecks, state: { text: 'x'.repeat(90000) } }));
    assert.equal(packed.functionalChecks, functionalChecks);
    assert.equal(packed.truncated, true);
  }
});

test("the HTML run result exposes observed output targets as well as controls", () => {
  const packed = packToolContent('run_file', { ok: true, stage: { kind: 'html' }, state: {
    text: 'Abgeschlossen: 0', elements: [{ selector: '#start', text: 'Start' }],
    observations: [{ selector: '#completed', text: '0' }],
  } });
  assert.match(packed, /#completed/);
  assert.match(packed, /#start/);
});
