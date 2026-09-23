import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listToolchains, pullToolchain, removeToolchain, abortPull, toolchainProgress, TOOLS, zigArchiveName, zigGithubUrl, toolEnv } from "./toolchain.mjs";

describe("toolchain", () => {
  it("catalog has go rust jdk zig php", () => {
    assert.ok(TOOLS.go);
    assert.equal(TOOLS.rustc.kind, TOOLS.cargo.kind);
    assert.equal(TOOLS.cc.kind, "zig");
    assert.equal(TOOLS.javac.kind, TOOLS.java.kind);
  });
  it("list returns unique kinds", () => {
    const list = listToolchains();
    const kinds = list.map((x) => x.kind);
    assert.equal(new Set(kinds).size, kinds.length);
    assert.ok(list.every((x) => typeof x.ready === "boolean"));
    assert.ok(list.every((x) => "via" in x && Array.isArray(x.ids)));
  });
  it("unknown pull fails", async () => {
    const r = await pullToolchain("rm");
    assert.equal(r.ok, false);
  });
  it("unknown remove fails", () => {
    const r = removeToolchain("rm");
    assert.equal(r.ok, false);
  });
  it("progress idle and abort idle", () => {
    const p = toolchainProgress();
    assert.equal(p.busy, false);
    assert.equal(typeof p.pct, "number");
    const a = abortPull();
    assert.equal(a.ok, false);
  });
  it("zig archive names", () => {
    assert.equal(zigArchiveName("0.14.1", "x86_64-windows"), "zig-x86_64-windows-0.14.1.zip");
    assert.equal(zigArchiveName("0.13.0", "x86_64-windows"), "zig-windows-x86_64-0.13.0.zip");
    assert.equal(zigArchiveName("0.15.2", "x86_64-linux"), "zig-x86_64-linux-0.15.2.tar.xz");
    assert.match(zigGithubUrl("0.14.1", "x86_64-windows"), /github.com\/ziglang\/zig\/releases/);
  });
  it("toolEnv keeps PATH", () => {
    const e = toolEnv({ PATH: "/usr/bin", HOME: "/tmp" });
    assert.ok(typeof e.PATH === "string" && e.PATH.includes("/usr/bin"));
  });
  it('Go root follows a system symlink and never mistakes generic lib/src folders for Go', {skip:process.platform==='win32'}, () => {
    const root=mkdtempSync(path.join(os.tmpdir(),'anvil-go-env-'));
    const bin=path.join(root,'bin'), sdk=path.join(root,'sdk');
    for(const dir of [bin,path.join(root,'lib'),path.join(sdk,'bin'),path.join(sdk,'src','runtime'),path.join(sdk,'src','fmt')])mkdirSync(dir,{recursive:true});
    writeFileSync(path.join(sdk,'bin','go'),'');symlinkSync(path.join(sdk,'bin','go'),path.join(bin,'go'));
    const previous=process.env.PATH;
    try{
      process.env.PATH=bin;
      assert.equal(toolEnv({PATH:bin}).GOROOT,sdk);
      process.env.PATH=path.join(root,'plain','bin');mkdirSync(process.env.PATH,{recursive:true});
      mkdirSync(path.join(root,'plain','lib'));writeFileSync(path.join(process.env.PATH,'go'),'');
      assert.equal(toolEnv({PATH:process.env.PATH}).GOROOT,undefined);
    }finally{process.env.PATH=previous;}
  });
});
