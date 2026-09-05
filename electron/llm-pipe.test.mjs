import assert from "node:assert/strict";
import { test } from "node:test";
import { pipeCorsOrigin } from "./llm-pipe-cors.mjs";

test("pipe CORS allows loopback, rejects the public web", () => {
  assert.equal(pipeCorsOrigin("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
  assert.equal(pipeCorsOrigin("http://localhost:8080"), "http://localhost:8080");
  assert.equal(pipeCorsOrigin("https://evil.example"), "");
  assert.equal(pipeCorsOrigin("file://"), "");
});
