import assert from "node:assert/strict";
import { test } from "node:test";
import { hasAsciiControl, stripAnsiCsi } from "../electron/text-controls.mjs";

test("path control checks preserve C0 and optional DEL boundaries", () => {
  for (const code of [0, 9, 10, 13, 27, 31]) assert.equal(hasAsciiControl(`src/a${String.fromCharCode(code)}.ts`), true);
  for (const code of [32, 65, 127, 128, 159, 255]) assert.equal(hasAsciiControl(`src/a${String.fromCharCode(code)}.ts`), false);
  assert.equal(hasAsciiControl("src/a" + String.fromCharCode(127) + ".ts", true), true);
  assert.equal(hasAsciiControl("src/Grüße 🐣.ts", true), false);
  assert.equal(hasAsciiControl("", true), false);
});

test("terminal cleanup removes CSI color codes without changing visible Unicode or lines", () => {
  const esc = String.fromCharCode(27);
  const colored = `${esc}[31mSCRIPT ERROR:${esc}[0m Grüße 🐣\n${esc}[2Kdone`;
  assert.equal(stripAnsiCsi(colored), "SCRIPT ERROR: Grüße 🐣\ndone");
  assert.equal(stripAnsiCsi(colored), "SCRIPT ERROR: Grüße 🐣\ndone", "reuse resets the global matcher");
  assert.equal(stripAnsiCsi(`${esc}]title\u0007[plain]`), `${esc}]title\u0007[plain]`, "non-CSI sequences keep the previous behavior");
});
