import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { looksGraphical, withEngine, wrapJsGame } from "./game-host.ts";
import { DEFAULT_INPUT_MAP } from "./input-map.ts";
import { ANVIL_ENGINE } from "./engine-source.ts";

test("recognizes the three public Canvas entry points", () => {
  for (const code of [
    "Anvil.create({})",
    "Anvil.run({})",
    "Anvil.attach(canvas)",
    'document.createElement("canvas")',
  ])
    assert.equal(looksGraphical(code), true);
  assert.equal(looksGraphical("console.log(1)"), false);
});
test("bootstrap precedes user scripts, injects once, and preserves literal replacement tokens", () => {
  const html = withEngine(
    '<html><head><script>window.user="$&";</script></head><body></body></html>',
  );
  assert.ok(html.indexOf("data-anvil-engine") < html.indexOf("window.user="));
  assert.ok(html.includes('window.user="$&";'));
  assert.equal(withEngine(html).match(/<script data-anvil-engine>/g)?.length, 1);
  assert.doesNotThrow(() => new vm.Script(ANVIL_ENGINE));
});
test("standalone JavaScript keeps custom bindings and script delimiters in strings", () => {
  const map = { ...DEFAULT_INPUT_MAP, left: { keys: ["q"], pad: [14] } };
  const page = wrapJsGame('window.text="</script>";', map);
  const cfg = page.match(/window\.__ANVIL_INPUT__=(.*?)<\/script>/s)!;
  assert.deepEqual(JSON.parse(cfg[1]).left.keys, ["q"]);
  assert.ok(page.includes('window.text="<\\/script>";'));
});
