import assert from "node:assert/strict";
import { test } from "node:test";
import { isLanHost, lanAlts } from "./lan-url.ts";

test("lanAlts maps 127.168 to 192.168", () => {
  const a = lanAlts("http://127.168.178.41:11434/v1");
  assert.equal(a[0], "http://127.168.178.41:11434/v1");
  assert.equal(a[1], "http://192.168.178.41:11434/v1");
});

test("isLanHost", () => {
  assert.equal(isLanHost("192.168.178.41"), true);
  assert.equal(isLanHost("127.0.0.1"), true);
  assert.equal(isLanHost("localhost"), true);
  assert.equal(isLanHost("10.0.0.2"), true);
  assert.equal(isLanHost("8.8.8.8"), false);
  assert.equal(isLanHost("169.254.169.254"), false);
});
