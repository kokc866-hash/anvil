import assert from "node:assert/strict";
import { test } from "node:test";
import { appOrigin } from "../electron/app-origin.mjs";

test("private IPC accepts only the current Anvil HTTP origin", () => {
  const allowed = appOrigin(8080);
  assert.equal(allowed("http://127.0.0.1:8080/"), true);
  assert.equal(allowed("http://127.0.0.1:8080/settings?tab=agent"), true);
  for (const url of [undefined, "", "data:text/html,", "about:blank", "file:///tmp/a",
    "http://localhost:8080/", "http://127.0.0.1:8081/", "https://127.0.0.1:8080/",
    "http://127.0.0.1:8080.evil.example/", "http://user:pass@127.0.0.1:8080/"])
    assert.equal(allowed(url), false, String(url));
});
