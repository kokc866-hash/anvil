import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  allowCorsOrigin,
  blockedCwd,
  homeOk,
  isLanHost,
  llmHeaders,
  mcpProtocol,
  pairTarget,
  runAllowed,
  tokenOk,
} from "./guard.mjs";

describe("cors / pair", () => {
  it("server.mjs parses", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const r = spawnSync(process.execPath, ["--check", path.join(dir, "server.mjs")], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  });
  it("allows loopback origin, rejects public", () => {
    assert.equal(allowCorsOrigin("http://127.0.0.1:5173"), "http://127.0.0.1:5173");
    assert.equal(allowCorsOrigin("http://localhost:4173"), "http://localhost:4173");
    assert.equal(allowCorsOrigin("https://evil.example"), "");
    assert.equal(allowCorsOrigin("http://192.168.1.9:5173"), "http://192.168.1.9:5173");
  });
  it("pair target is loopback only", () => {
    assert.equal(pairTarget("http://127.0.0.1:4173/app"), "http://127.0.0.1:4173");
    assert.equal(pairTarget("https://evil.example"), "");
    assert.equal(pairTarget("http://192.168.1.9:5173"), "");
  });
});

describe("lan / llm", () => {
  it("blocks 0.0.0.0 and metadata", () => {
    assert.equal(isLanHost("127.0.0.1"), true);
    assert.equal(isLanHost("10.0.0.2"), true);
    assert.equal(isLanHost("0.0.0.0"), false);
    assert.equal(isLanHost("169.254.169.254"), false);
    assert.equal(isLanHost("8.8.8.8"), false);
  });
  it("keeps only llm headers", () => {
    const h = llmHeaders({ Cookie: "x", Host: "evil", authorization: "Bearer k", "content-type": "application/json" });
    assert.equal(h.Cookie, undefined);
    assert.equal(h.Host, undefined);
    assert.equal(h.authorization, "Bearer k");
    assert.equal(h["content-type"], "application/json");
  });
});

describe("token / cwd / tools", () => {
  it("token compare rejects mismatch", () => {
    assert.equal(tokenOk("abc", "abc"), true);
    assert.equal(tokenOk("abd", "abc"), false);
    assert.equal(tokenOk("", "abc"), false);
    assert.equal(tokenOk("abc", ""), false);
  });
  it("blocks system and ssh paths", () => {
    assert.equal(blockedCwd("/etc/passwd"), true);
    assert.equal(blockedCwd("C:\\Windows\\System32"), true);
    assert.equal(blockedCwd(path.join(os.homedir(), ".ssh")), true);
    assert.equal(blockedCwd(os.tmpdir()), false);
  });
  it("home only under user or temp", () => {
    assert.equal(homeOk(path.join(os.homedir(), ".anvil-test-home")), true);
    assert.equal(homeOk(path.join(os.tmpdir(), "pkgs")), true);
    assert.equal(homeOk("/etc/anvil"), false);
  });
  it("run allowlist covers languages", () => {
    assert.equal(runAllowed("python"), true);
    assert.equal(runAllowed("go"), true);
    assert.equal(runAllowed("cargo"), true);
    assert.equal(runAllowed("bash"), false);
    assert.equal(runAllowed("cmd.exe"), false);
  });
  it("mcp protocol prefers 2025", () => {
    assert.equal(mcpProtocol("2024-11-05"), "2024-11-05");
    assert.equal(mcpProtocol(""), "2025-03-26");
    assert.equal(mcpProtocol("nope"), "2025-03-26");
  });
});
