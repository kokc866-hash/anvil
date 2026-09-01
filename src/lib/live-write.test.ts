import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { draftFromText, draftFromToolArgs, extractJsonString, mcpMirrorPath } from "./live-write-parse.ts";

describe("live-write", () => {
  it("extracts a closed string", () => {
    assert.equal(extractJsonString(`{"path":"a.py","content":"hi"}`, "path"), "a.py");
    assert.equal(extractJsonString(`{"path":"a.py","content":"hi"}`, "content"), "hi");
  });
  it("keeps a partial string", () => {
    assert.equal(extractJsonString(`{"path":"game.py","content":"def foo():\\n    x = `, "path"), "game.py");
    assert.equal(extractJsonString(`{"path":"game.py","content":"def foo():\\n    x = `, "content"), "def foo():\n    x = ");
  });
  it("draft from native tool args", () => {
    const d = draftFromToolArgs("write_file", `{"path":"src/a.js","content":"console.log(1)"}`);
    assert.deepEqual(d, { path: "src/a.js", content: "console.log(1)", mode: "write" });
  });
  it("draft from text blob", () => {
    const d = draftFromText(`ok\nwrite_file({"path":"b.py","content":"print(1)"}`);
    assert.equal(d?.path, "b.py");
    assert.equal(d?.content, "print(1)");
  });
  it("mcp mirror path", () => {
    assert.equal(mcpMirrorPath("Ziva", { path: "res://player.gd" }, "write_script"), "mcp/Ziva/player.gd");
  });
});
