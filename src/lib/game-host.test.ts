import assert from "node:assert/strict";
import { test } from "node:test";
import { looksGraphical, withEngine, wrapJsGame } from "./game-host.ts";

test("looksGraphical sees canvas and Anvil.run", () => {
  assert.equal(looksGraphical("const c = document.createElement('canvas')"), true);
  assert.equal(looksGraphical("Anvil.run({ update() {} })"), true);
  assert.equal(looksGraphical("console.log(1)"), false);
});

test("withEngine injects once and keeps buttons playable", () => {
  const html = withEngine("<!doctype html><html><head></head><body><button>Start</button></body></html>");
  assert.match(html, /data-anvil-engine/);
  assert.match(html, /data-anvil-boot/);
  assert.match(html, /__ANVIL_INPUT__/);
  const again = withEngine(html);
  assert.equal(again.split("data-anvil-engine").length, 2);
  assert.match(html, /preventDefault/);
});

test("wrapJsGame runs user code in a page", () => {
  const page = wrapJsGame("Anvil.run({ width: 160, height: 90, draw() {} })");
  assert.match(page, /Anvil\.run/);
  assert.match(page, /touch-action: none/);
});

test("engine is a general canvas runtime", () => {
  const html = withEngine("<html><head></head><body><canvas id='view'></canvas></body></html>");
  assert.match(html, /attach: attach/);
  assert.match(html, /loadImage: loadImage/);
  assert.match(html, /function fitCanvas/);
  assert.match(html, /function toWorld/);
  assert.match(html, /webgl2/);
});
