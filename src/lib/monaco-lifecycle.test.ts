import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { observeMonacoTeardown } from "./monaco-lifecycle.ts";

// Exercise the actual dependency that produces the browser cancellation, without
// loading the editor DOM or replacing its cancellation behavior with a mock.
const { Delayer } = await import(pathToFileURL(path.resolve("node_modules/monaco-editor/esm/vs/base/common/async.js")).href);
const { CancellationError } = await import(pathToFileURL(path.resolve("node_modules/monaco-editor/esm/vs/base/common/errors.js")).href);

test("a real pending Monaco highlighter delay is owned before editor disposal", async t => {
  const delayer = new Delayer(60000);
  t.after(() => delayer.dispose());
  let executions = 0;
  void delayer.trigger(() => { executions++; });
  const editor = { getContribution: (id: string) => { assert.equal(id, "editor.contrib.wordHighlighter"); return { wordHighlighter: { runDelayer: delayer } }; }, dispose: () => delayer.dispose() };
  const settled = observeMonacoTeardown(editor);
  assert.ok(settled);
  editor.dispose();
  await assert.doesNotReject(settled);
  assert.equal(executions, 0);
  assert.equal(delayer.completionPromise, null);
});

test("model replacement cancels the previous highlighter without an unhandled rejection", async t => {
  const old = new Delayer(60000), next = new Delayer(60000);
  t.after(() => { old.dispose(); next.dispose(); });
  void old.trigger(() => assert.fail("removed model task ran"));
  let current = old;
  const editor = { getContribution: () => ({ wordHighlighter: { runDelayer: current } }), setModel: () => { current.dispose(); current = next; } };
  const settled = observeMonacoTeardown(editor);
  editor.setModel();
  await assert.doesNotReject(settled!);
  let runs = 0;
  const fresh = next.trigger(() => { runs++; }, 0);
  await fresh;
  assert.equal(runs, 1, "replacement model work still executes");
});

test("genuine highlighter failures preserve their original identity", async t => {
  for (const cause of [new TypeError("highlight provider failed"), new Error("Canceled"), Object.assign(new Error("server lost"), { name: "Canceled" }), { name: "Canceled", message: "Canceled" }]) {
    const delayer = new Delayer(0);
    t.after(() => delayer.dispose());
    void delayer.trigger(() => { throw cause; });
    const settled = observeMonacoTeardown({ getContribution: () => ({ wordHighlighter: { runDelayer: delayer } }) });
    await assert.rejects(settled!, error => error === cause);
  }
});

test("unrelated rejections and missing contributions are never intercepted", async () => {
  assert.equal(observeMonacoTeardown({}), undefined);
  assert.equal(observeMonacoTeardown({ getContribution: () => null }), undefined);
  const unrelated = Promise.reject(new CancellationError());
  assert.equal(observeMonacoTeardown({ getContribution: () => ({ differentFeature: { completionPromise: unrelated } }) }), undefined);
  await assert.rejects(unrelated, error => error instanceof Error && error.name === "Canceled");
});

test("the same pending delay is observed once across adjacent teardown operations", async t => {
  const delayer = new Delayer(60000);
  t.after(() => delayer.dispose());
  void delayer.trigger(() => undefined);
  const editor = { getContribution: () => ({ wordHighlighter: { runDelayer: delayer } }) };
  const first = observeMonacoTeardown(editor), second = observeMonacoTeardown(editor);
  assert.equal(first, second);
  delayer.dispose();
  await first;
});
