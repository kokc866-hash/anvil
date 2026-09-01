import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPrivateHost, publicHttpUrl } from "./net-guard.ts";
import { esc } from "./syntax/engine.ts";

describe("net-guard", () => {
  it("blocks loopback and ipv6", () => {
    assert.equal(isPrivateHost("127.0.0.1"), true);
    assert.equal(isPrivateHost("::1"), true);
    assert.equal(isPrivateHost("10.0.0.1"), true);
    assert.equal(isPrivateHost("169.254.169.254"), true);
    assert.equal(isPrivateHost("::ffff:127.0.0.1"), true);
    assert.equal(isPrivateHost("example.com"), false);
  });
  it("rejects private urls", () => {
    assert.throws(() => publicHttpUrl("http://127.0.0.1/x"));
    assert.throws(() => publicHttpUrl("https://localhost/x"));
  });
});

describe("esc", () => {
  it("escapes html", () => {
    const lt = "&" + "lt;";
    const gt = "&" + "gt;";
    const quot = "&" + "quot;";
    const amp = "&" + "amp;";
    assert.equal(esc(`<img src=x onerror="alert(1)">`), `${lt}img src=x onerror=${quot}alert(1)${quot}${gt}`);
    assert.equal(esc("a & b"), `a ${amp} b`);
  });
});
