import assert from "node:assert/strict";
import { test } from "node:test";
import { jwtExpMs, parseClaudeAuth, parseCodexAuth, parseCopilotConfig, parseGeminiAuth, parseGhHosts, parseHfToken, previewToken, isClaudeOauth } from "./sub-auth.ts";

function jwt(payload: object): string {
  const b = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${b}.x`;
}

test("parseCodexAuth tokens block", () => {
  const tok = jwt({ exp: 2000000000, email: "a@b.c" });
  const raw = JSON.stringify({
    tokens: { access_token: tok, refresh_token: "r1", account_id: "acc-9" },
  });
  const a = parseCodexAuth(raw);
  assert.ok(a);
  assert.equal(a.token, tok);
  assert.equal(a.refresh, "r1");
  assert.equal(a.accountId, "acc-9");
  assert.ok((a.expiresAt ?? 0) > 1e12);
});

test("parseCodexAuth rejects empty", () => {
  assert.equal(parseCodexAuth("{}"), null);
  assert.equal(parseCodexAuth("nope"), null);
});

test("jwtExpMs and preview", () => {
  const tok = jwt({ exp: 1700000000 });
  assert.equal(jwtExpMs(tok), 1700000000 * 1000);
  assert.equal(previewToken("abcdefghijklmnop"), "abcdef…mnop");
});

test("parseClaudeAuth", () => {
  const a = parseClaudeAuth(
    JSON.stringify({ claudeAiOauth: { accessToken: "sk-ant-oat01-abc", refreshToken: "sk-ant-ort01-x", expiresAt: 9 } }),
  );
  assert.ok(a);
  assert.equal(a.token, "sk-ant-oat01-abc");
  assert.equal(a.refresh, "sk-ant-ort01-x");
  assert.equal(isClaudeOauth(a.token), true);
});

test("parseGeminiAuth", () => {
  const a = parseGeminiAuth(JSON.stringify({ access_token: "ya29.abc", refresh_token: "1//x", expiry_date: 99 }));
  assert.ok(a);
  assert.equal(a.token, "ya29.abc");
  assert.equal(a.refresh, "1//x");
});

test("parseGhHosts", () => {
  const a = parseGhHosts("github.com:\n  user: kim\n  oauth_token: gho_abc123\n");
  assert.ok(a);
  assert.equal(a.token, "gho_abc123");
  assert.equal(a.email, "kim");
});

test("parseCopilotConfig and hf token", () => {
  const c = parseCopilotConfig(JSON.stringify({ github_token: "gho_zz", user: "a" }));
  assert.equal(c?.token, "gho_zz");
  assert.equal(parseHfToken("hf_abcdefghijklmnop\n")?.token, "hf_abcdefghijklmnop");
  assert.equal(parseHfToken("nope"), null);
});
