import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { missingFromError, runFailHint, scrubRunError } from "./run-error.ts";

const TRACE = `
Traceback (most recent call last):
  File "/lib/python312.zip/_pyodide/_base.py", line 597, in eval_code_async
    await CodeRunner(
  File "/lib/python312.zip/_pyodide/_base.py", line 411, in run_async
    coroutine = eval(self.code, globals, locals)
  File "<exec>", line 143, in <module>
  File "build.py", line 45, in <module>
FileNotFoundError: [Errno 44] No such file or directory: 'js/util.js'
`;

describe("run-error", () => {
  it("keeps the user file and the missing path, drops pyodide", () => {
    const s = scrubRunError(TRACE);
    assert.match(s, /build\.py/);
    assert.match(s, /js\/util\.js/);
    assert.doesNotMatch(s, /python312/);
    assert.doesNotMatch(s, /_pyodide/);
  });
  it("extracts the missing path", () => {
    assert.equal(missingFromError(TRACE), "js/util.js");
  });
  it("hint names the file", () => {
    const h = runFailHint(TRACE, ["js/ui.js", "js/main.js", "build.py"]);
    assert.match(h, /js\/util\.js/);
    assert.match(h, /write_file|ORDER|bundler/i);
  });
});
