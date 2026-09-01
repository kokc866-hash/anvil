import assert from "node:assert/strict";
import { test } from "node:test";
import { lanAlts } from "./lan-url.ts";

test("127.168 falls back to 192.168", () => {
  const alts = lanAlts("http://127.168.178.41:11434/v1/models");
  assert.equal(alts[0], "http://127.168.178.41:11434/v1/models");
  assert.equal(alts[1], "http://192.168.178.41:11434/v1/models");
});

test("192.168 stays", () => {
  assert.deepEqual(lanAlts("http://192.168.178.41:11434/v1"), ["http://192.168.178.41:11434/v1"]);
});
