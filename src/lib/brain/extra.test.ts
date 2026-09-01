import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  heuristicComment,
  heuristicI18nKey,
  heuristicLogTrim,
  heuristicMention,
  heuristicStopNote,
  heuristicTabHint,
  leftoverSecretHints,
} from "./extra-heur.ts";

describe("helper extra jobs", () => {
  it("tab hint from comment", () => {
    assert.match(heuristicTabHint("js/render.js", "// Canvas renderer\nexport function draw() {}"), /Canvas/);
  });
  it("stop note uses done steps", () => {
    const n = heuristicStopNote([
      { name: "read_file", detail: "a.js", status: "ok" },
      { name: "run_file", detail: "index.html", status: "ok" },
      { name: "write_file", status: "run" },
    ]);
    assert.match(n, /read_file/);
    assert.doesNotMatch(n, /write_file/);
  });
  it("log trim drops stack frames", () => {
    const t = heuristicLogTrim("Error: boom\n    at foo (a.js:1)\n    at bar (b.js:2)\nTypeError: x");
    assert.match(t, /Error: boom/);
    assert.doesNotMatch(t, /^\s*at /m);
  });
  it("i18n key camelCase", () => {
    assert.equal(heuristicI18nKey("Neues Fenster öffnen"), "neuesFensterOeffnen");
  });
  it("mention prefers active and dirty", () => {
    const r = heuristicMention("ren", ["js/main.js", "js/render.js", "css/style.css"], {
      dirty: ["js/render.js"],
      recent: ["js/main.js"],
      active: "js/render.js",
    });
    assert.equal(r[0], "js/render.js");
  });
  it("comment prefix by lang", () => {
    assert.match(heuristicComment("py", "def clip():\n  pass"), /^# /);
    assert.match(heuristicComment("js", "function clip() {}"), /^\/\//);
  });
  it("leftover secrets after redacted stay silent if none", () => {
    assert.equal(leftoverSecretHints("hello world").length, 0);
    assert.ok(leftoverSecretHints("api_key = supersecretvalue99").length >= 1);
  });
});
