import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listToolchains, pullToolchain, removeToolchain, abortPull, toolchainProgress, TOOLS, zigArchiveName, zigGithubUrl, toolEnv } from "./toolchain.mjs";
import { resolveToolchainArtifact, verifyToolchainDownload } from './toolchain-download.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';

const hash = 'a'.repeat(64);
function metadataFetch(entries) {
  return async (url) => {
    assert.ok(Object.hasOwn(entries, url), `unexpected metadata URL: ${url}`);
    const value=entries[url];return new Response(typeof value==='string'?value:JSON.stringify(value));
  };
}

describe('publisher-verified toolchain downloads',()=>{
  it('Python uses current same-series release and the exact architecture manifest pair',async()=>{
    for(const [arch,suffix] of [['x64','64'],['arm64','arm64']]){
      const url=`https://www.python.org/ftp/python/3.14.9/python-3.14.9-embeddable-${arch==='x64'?'amd64':'arm64'}.zip`;
      const fetchImpl=metadataFetch({
        'https://www.python.org/downloads/windows/':'Python 3.15.1 Python 3.14.10rc1 Python 3.14.9 Python 3.14.8',
        'https://www.python.org/ftp/python/3.14.9/windows-3.14.9.json':{versions:[{id:`pythonembed-3.14-${suffix}`,'sort-version':'3.14.9',url,hash:{sha256:hash}}]},
      });
      assert.deepEqual(await resolveToolchainArtifact('python',{platform:'win32',arch,fetchImpl}),{url,sha256:hash,version:'3.14.9'});
    }
  });
  it('missing Python manifest and stale metadata cannot reinstall an obsolete interpreter',async()=>{
    const fetchImpl=metadataFetch({'https://www.python.org/downloads/windows/':'Python 3.14.8 Python 3.12.10'});
    await assert.rejects(resolveToolchainArtifact('python',{platform:'win32',arch:'x64',fetchImpl}),/korrigierte/);
    const newer=metadataFetch({'https://www.python.org/downloads/windows/':'Python 3.14.9','https://www.python.org/ftp/python/3.14.9/windows-3.14.9.json':{versions:[]}});
    await assert.rejects(resolveToolchainArtifact('python',{platform:'win32',arch:'x64',fetchImpl:newer}),/Manifest/);
  });
  it('Go skips previews and selects the matching archive with its publisher checksum',async()=>{
    const fetchImpl=metadataFetch({'https://go.dev/dl/?mode=json':[
      {version:'go1.28rc1',stable:false,files:[]},
      {version:'go1.27.3',stable:true,files:[{os:'windows',arch:'amd64',kind:'archive',filename:'go1.27.3.windows-amd64.zip',sha256:hash}]},
    ]});
    const result=await resolveToolchainArtifact('go',{platform:'win32',arch:'x64',fetchImpl});
    assert.equal(result.version,'1.27.3');assert.equal(result.sha256,hash);
  });
  it('Node selects LTS and the matching checksum rather than the first line or a current preview',async()=>{
    const name='node-v24.22.1-win-x64.zip';
    const fetchImpl=metadataFetch({'https://nodejs.org/dist/index.json':[{version:'v27.0.0',lts:false},{version:'v24.22.1',lts:'Krypton'}],'https://nodejs.org/dist/v24.22.1/SHASUMS256.txt':`${'b'.repeat(64)}  node-v24.22.1-win-arm64.zip\n${hash}  ${name}\n`});
    assert.deepEqual(await resolveToolchainArtifact('node',{platform:'win32',arch:'x64',fetchImpl}),{url:`https://nodejs.org/dist/v24.22.1/${name}`,sha256:hash,version:'24.22.1'});
  });
  it('PHP preserves its maintenance branch and NTS x64 archive',async()=>{
    const fetchImpl=metadataFetch({'https://downloads.php.net/~windows/releases/releases.json':{'8.3':{version:'8.3.36','nts-vs16-x64':{zip:{path:'php-8.3.36-nts-Win32-vs16-x64.zip',sha256:hash}}},'8.5':{version:'8.5.0'}}});
    const result=await resolveToolchainArtifact('php',{platform:'win32',arch:'x64',fetchImpl});assert.equal(result.version,'8.3.36');
    await assert.rejects(resolveToolchainArtifact('php',{platform:'win32',arch:'arm64',fetchImpl}),/Architektur/);
  });
  it('Zig does not silently fall back to a hardcoded old release when metadata is unavailable',async()=>{
    let count=0;await assert.rejects(resolveToolchainArtifact('zig',{fetchImpl:async()=>{count++;throw Error('offline');}}),/offline/);assert.equal(count,1);
  });
  it('Ruby resolves a stable maintained branch, ignoring drafts and previews',async()=>{
    const tag='RubyInstaller-4.0.9-1',name='rubyinstaller-4.0.9-1-x64.exe';
    const fetchImpl=metadataFetch({'https://api.github.com/repos/oneclick/rubyinstaller2/releases?per_page=100':[
      {tag_name:'RubyInstaller-4.0.10-1',draft:true},{tag_name:'RubyInstaller-4.0.10-1',prerelease:true},
      {tag_name:tag,draft:false,prerelease:false,assets:[{name,browser_download_url:`https://github.com/oneclick/rubyinstaller2/releases/download/${tag}/${name}`,digest:'sha256:'+hash}]},
    ]});
    assert.equal((await resolveToolchainArtifact('ruby',{platform:'win32',arch:'x64',fetchImpl})).version,'4.0.9');
  });
  it('rustup uses a versioned corrected initializer and checks its publisher hash',async()=>{
    const url='https://static.rust-lang.org/rustup/archive/1.29.2/x86_64-pc-windows-msvc/rustup-init.exe';
    const fetchImpl=metadataFetch({'https://static.rust-lang.org/rustup/release-stable.toml':'schema-version = "1"\nversion = "1.29.2"\n',[url+'.sha256']:hash+'  rustup-init.exe'});
    assert.deepEqual(await resolveToolchainArtifact('rustup',{platform:'win32',arch:'x64',fetchImpl}),{url,sha256:hash,version:'1.29.2'});
    await assert.rejects(resolveToolchainArtifact('rustup',{platform:'win32',arch:'x64',fetchImpl:metadataFetch({'https://static.rust-lang.org/rustup/release-stable.toml':'version = "1.29.1"'})}),/korrigierte/);
  });
  it('rejects foreign URLs, URL traversal and missing checksums in metadata',async()=>{
    for(const [url,sha256] of [['https://attacker.invalid/archive.zip',hash],['https://ziglang.org/download/0.17.0/../../other/archive.zip',hash],['https://ziglang.org/download/0.17.0/a.zip',undefined]]){
      const fetchImpl=metadataFetch({'https://ziglang.org/download/index.json':{'0.17.0':{'x86_64-windows':{tarball:url,shasum:sha256}}}});
      await assert.rejects(resolveToolchainArtifact('zig',{platform:'win32',arch:'x64',fetchImpl}),/Herstelleradresse|Prüfsumme/);
    }
  });
  it('rejects metadata failures instead of reporting a successful download',async()=>{
    await assert.rejects(resolveToolchainArtifact('go',{fetchImpl:async()=>new Response('offline',{status:503})}),/HTTP 503/);
    await assert.rejects(resolveToolchainArtifact('go',{fetchImpl:async()=>new Response('x',{headers:{'content-length':'999999999'}})}),/groß/);
  });
  it('verifies bytes and rejects a tampered archive',async()=>{
    const dir=mkdtempSync(path.join(os.tmpdir(),'anvil-checksum-'));const file=path.join(dir,'download.zip');
    try{writeFileSync(file,'correct content');const sha256=createHash('sha256').update('correct content').digest('hex');await verifyToolchainDownload(file,{sha256});writeFileSync(file,'tampered');await assert.rejects(verifyToolchainDownload(file,{sha256}),/stimmt nicht/);}finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('the actual Python installer consults publisher metadata and preserves existing files on checksum failure',{skip:process.platform!=='win32'||process.arch!=='x64'},async()=>{
    const dir=mkdtempSync(path.join(os.tmpdir(),'anvil-installer-'));const previous=process.env.ANVIL_TOOLCHAIN_HOME;process.env.ANVIL_TOOLCHAIN_HOME=dir;
    const installed=path.join(dir,'python','marker.txt');mkdirSync(path.dirname(installed),{recursive:true});writeFileSync(installed,'keep installed runtime');
    const calls=[];const url='https://www.python.org/ftp/python/3.14.9/python-3.14.9-embeddable-amd64.zip';
    const fake=metadataFetch({'https://www.python.org/downloads/windows/':'Python 3.14.9','https://www.python.org/ftp/python/3.14.9/windows-3.14.9.json':{versions:[{id:'pythonembed-3.14-64','sort-version':'3.14.9',url,hash:{sha256:hash}}]},[url]:'tampered bytes'});
    const oldFetch=globalThis.fetch;globalThis.fetch=async(input,init)=>{calls.push(String(input));return fake(input,init);};
    try{
      const module=process.env.ANVIL_TOOLCHAIN_TEST_MODULE?await import(process.env.ANVIL_TOOLCHAIN_TEST_MODULE):{pullToolchain};
      const result=await module.pullToolchain('python');assert.equal(result.ok,false);
      assert.ok(calls.includes('https://www.python.org/ftp/python/3.14.9/windows-3.14.9.json'),`actual requests: ${calls.join(', ')}`);
      assert.match(result.error,/SHA256/);assert.equal(readFileSync(installed,'utf8'),'keep installed runtime');
    }finally{globalThis.fetch=oldFetch;if(previous===undefined)delete process.env.ANVIL_TOOLCHAIN_HOME;else process.env.ANVIL_TOOLCHAIN_HOME=previous;rmSync(dir,{recursive:true,force:true});}
  });
});

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
