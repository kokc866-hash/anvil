import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatAgentFile } from '../electron/agent-format.mjs';
import { AgentProjectRuntime } from '../electron/agent-project-runtime.mjs';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { spawnRun } from '../companion/run-process.mjs';

// Optional isolated QA tools. No installation or download takes place in tests.
const toolsRoot=resolve(process.env.ANVIL_FORMATTER_QA_ROOT||'artifacts/formatter-qa-tools');
const binDir=join(toolsRoot,process.platform==='win32'?'Scripts':'bin');
const binary=name=>join(binDir,name+(process.platform==='win32'?'.exe':''));
const none={gofmt:null,rustfmt:null,'clang-format':null,ruff:null,black:null,python:null};
mkdirSync('artifacts',{recursive:true});
const root=mkdtempSync(resolve('artifacts','agent-format-real-'));
process.env.ANVIL_INSTALL_DIR=root;
const source='def example( x:int=1):\n  return {"message":"Grüße 🐣", "values":[x,2,3]}\n';
const until=async check=>{for(let n=0;n<500;n++){if(check())return;await new Promise(r=>setTimeout(r,20));}throw Error('formatter operation timed out');};

for(const name of ['ruff','black'])test(`actual ${name} executable formats Unicode, rejects incomplete Python and is idempotent`,async t=>{
  if(!existsSync(binary(name))){t.skip('Optional isolated '+name+' QA installation is absent.');return;}
  const opts={tools:{...none,[name]:binary(name)}};
  const first=await formatAgentFile({path:'example.py',content:source},opts);
  assert.equal(first.ok,true,first.error);assert.equal(first.via,name);
  assert.match(first.content,/def example\(x: int = 1\):/);assert.match(first.content,/Grüße 🐣/);
  assert.equal((await formatAgentFile({path:'example.py',content:first.content},opts)).content,first.content);
  const bad='def broken( :\n';
  const failure=await formatAgentFile({path:'example.py',content:bad},opts);
  assert.equal(failure.ok,false);assert.equal(failure.content,bad);assert.ok(failure.error);
});

test('actual isolated Python module selection runs Ruff and falls back to Black when Ruff is absent',async t=>{
  if(!existsSync(binary('python'))||!existsSync(binary('black'))||!existsSync(binary('ruff'))){t.skip('Optional isolated Python formatter QA installation is absent.');return;}
  const check=async(python,expected)=>{
    const calls=[];
    const result=await formatAgentFile({path:'example.pyi',content:'def example( x:int=1)->str: ...\n'},{tools:{...none,python},run:async(...args)=>{
      calls.push(args[1]);return spawnRun(...args);
    }});
    assert.equal(result.ok,true,result.error);assert.equal(result.via,expected);
    assert.deepEqual(calls[1].slice(0,3),['-I','-m',expected]);
    assert.match(result.content,/def example\(x: int = 1\) -> str:/);
  };
  await check(binary('python'),'ruff');
  // A genuine Black-only interpreter avoids mocking discovery or formatter output.
  const blackOnly=join(root,'black-only');
  const created=await spawnRun(binary('python'),['-I','-m','venv','--without-pip',blackOnly],root,30000,process.env);
  assert.equal(created.ok,true,created.stderr);
  const python=join(blackOnly,process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const site=async executable=>{
    const result=await spawnRun(executable,['-I','-c','import sysconfig; print(sysconfig.get_paths()["purelib"])'],root,10000,process.env);
    assert.equal(result.ok,true,result.stderr);return result.stdout.trim();
  };
  const from=await site(binary('python')),to=await site(python);
  for(const entry of readdirSync(from)){
    if(/^(ruff|clang_format|pip|setuptools|__pycache__)(?:[-_.]|$)/i.test(entry))continue;
    cpSync(join(from,entry),join(to,entry),{recursive:true});
  }
  await check(python,'black');
});

test('actual clang-format obeys indentation, preserves Unicode and does not claim compiler verification',async t=>{
  if(!existsSync(binary('clang-format'))){t.skip('Optional isolated clang-format QA installation is absent.');return;}
  const opts={tools:{...none,'clang-format':binary('clang-format')}};
  const content='// Grüße 🐣\nint main(){if(true){return 1;}return 0;}\n';
  const result=await formatAgentFile({path:'example.cpp',content,options:{tabSize:4,insertSpaces:true}},opts);
  assert.equal(result.ok,true,result.error);assert.match(result.content,/\n    if/);assert.match(result.content,/Grüße 🐣/);
  assert.equal((await formatAgentFile({path:'example.cpp',content:result.content,options:{tabSize:4,insertSpaces:true}},opts)).content,result.content);
  const incomplete='int main( {';
  const rejected=await formatAgentFile({path:'example.cpp',content:incomplete},opts);
  assert.equal(rejected.ok,false);assert.equal(rejected.content,incomplete);
  const unresolved=await formatAgentFile({path:'example.cpp',content:'int main(){unknown_function();}\n'},opts);
  assert.equal(unresolved.ok,true,'A formatter may accept code a compiler would reject.');
  assert.match(unresolved.content,/unknown_function/);
});

test('real Python and C++ native host formatting writes only after acknowledgement and restores after reopen',async t=>{
  if(!existsSync(binary('ruff'))||!existsSync(binary('clang-format'))){t.skip('Optional isolated formatter QA installation is absent.');return;}
  const previousPath=process.env.PATH;process.env.PATH=binDir+(process.platform==='win32'?';':':')+(previousPath||'');
  const project=join(root,'project');mkdirSync(project);
  const files={'example.py':source,'example.cpp':'int main(){return 0;}\n'};
  for(const [path,content]of Object.entries(files))writeFileSync(join(project,path),content);
  const snapshotPath=join(root,'jobs','latest.json');
  let child;const sent=[];
  const host=new AgentJobHost({snapshotPath,runtime:new AgentProjectRuntime(),launch(){
    child=new EventEmitter();child.send=msg=>sent.push(msg);child.kill=()=>{};return child;
  }});
  let reopened;
  try{
    host.start({project,execution:true,writeThrough:true,files,model:{model:'fixture'},messages:[{role:'user',content:'Format the synthetic fixtures.'}]});
    child.emit('message',{type:'ready'});
    let id=0;
    for(const path of Object.keys(files)){
      child.emit('message',{type:'operation',id:++id,operation:{kind:'format',path}});
      await until(()=>sent.some(msg=>msg.type==='operation-result'&&msg.id===id));
      const formatted=sent.find(msg=>msg.type==='operation-result'&&msg.id===id).result;
      assert.equal(formatted.ok,true,formatted.error);assert.notEqual(formatted.content,files[path]);
      assert.equal(readFileSync(join(project,path),'utf8'),files[path],'formatting is read-only until acknowledgement');
      child.emit('message',{type:'operation',id:++id,operation:{kind:'write',path,content:formatted.content}});
      await until(()=>!host.operation);
      assert.equal(readFileSync(join(project,path),'utf8'),formatted.content);
      assert.equal(host.state.drafts[path].applied,true);
    }
    await host.close();
    reopened=new AgentJobHost({snapshotPath,launch(){assert.fail('Restoration must not launch a model or formatter.');}});
    reopened.changeFiles(reopened.state.id,'restore');
    for(const [path,content]of Object.entries(files))assert.equal(readFileSync(join(project,path),'utf8'),content);
    assert.equal(reopened.state.restored,true);
  }finally{
    await host.close();await reopened?.close();
    if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;
  }
});
