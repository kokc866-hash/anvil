import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyModelText,
  EDITOR_MAX_CHARS,
  markerEndCol,
  modelUriString,
  modelsToDrop,
  pathFromModelUri,
} from "./monaco-models.ts";
import { monacoVsAbs, monacoWorkerBootstrap } from "./monaco-worker.ts";

describe("monaco prune", () => {
  it("keeps open tabs", () => {
    const drop = modelsToDrop(["/a.ts", "/b.ts", "/c.ts"], ["b.ts"]);
    assert.deepEqual(drop.sort(), ["a.ts", "c.ts"]);
  });
  it("ignores empty keep", () => {
    assert.deepEqual(modelsToDrop(["/a.ts"], []), ["a.ts"]);
  });
  it("preserves decoded model paths and decodes complete URIs once", () => {
    assert.equal(pathFromModelUri("/src/app.ts"), "src/app.ts");
    assert.equal(pathFromModelUri("/anvil/src/app.ts"), "anvil/src/app.ts");
    assert.equal(pathFromModelUri(modelUriString("src/a b.ts")), "src/a b.ts");
  });
});

describe("monaco uri / edits", () => {
  it("builds stable inmemory uri", () => {
    assert.equal(modelUriString("src/app.ts"), "inmemory://anvil/src/app.ts?workspace=0");
    assert.equal(modelUriString("\\src\\app.ts"), "inmemory://anvil/src/app.ts?workspace=0");
    assert.match(modelUriString("src/a b.ts"), /a%20b/);
    assert.notEqual(modelUriString("a.ts", 1), modelUriString("a.ts", 2));
    assert.equal(pathFromModelUri("/src/%20.ts"), "src/%20.ts");
  });
  it("marker is a token, not +200", () => {
    assert.equal(markerEndCol(3, "undefined foo"), 12);
    assert.ok(markerEndCol(1, "x") < 50);
  });
  it("applyModelText uses pushEditOperations", () => {
    let value = "old";
    const model = {
      getValue: () => value,
      getLineCount: () => 1,
      getLineMaxColumn: () => 4,
      pushEditOperations: (_b: unknown[], edits: unknown[]) => {
        const e = edits[0] as { text: string };
        value = e.text;
      },
    };
    assert.equal(applyModelText(model, "old"), false);
    assert.equal(applyModelText(model, "next"), true);
    assert.equal(value, "next");
  });
  it("applyModelText skips setValue when equal", () => {
    let sets = 0;
    const model = {
      getValue: () => "x",
      setValue: () => {
        sets += 1;
      },
    };
    assert.equal(applyModelText(model, "x"), false);
    assert.equal(sets, 0);
  });
  it("caps editor size", () => {
    assert.ok(EDITOR_MAX_CHARS >= 200_000);
    assert.ok(EDITOR_MAX_CHARS <= 2_000_000);
  });
});

describe("monaco worker url", () => {
  it("makes vs absolute so workers can fetch", () => {
    assert.equal(monacoVsAbs("/monaco/vs", "http://127.0.0.1:8080"), "http://127.0.0.1:8080/monaco/vs");
    assert.equal(monacoVsAbs("https://cdn.example/vs", "http://127.0.0.1:8080"), "https://cdn.example/vs");
  });
  it("bootstrap importScripts is absolute, not /monaco/vs/...", () => {
    const src = monacoWorkerBootstrap("http://127.0.0.1:8080/monaco/vs");
    assert.match(src, /importScripts\("http:\/\/127\.0\.0\.1:8080\/monaco\/vs\/base\/worker\/workerMain\.js"\)/);
    assert.match(src, /baseUrl:"http:\/\/127\.0\.0\.1:8080\/monaco\/"/);
  });
});
