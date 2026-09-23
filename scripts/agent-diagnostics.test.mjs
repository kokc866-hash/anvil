import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { verifyAgentSnapshot } from '../electron/agent-diagnostics.mjs';
import { AgentProjectRuntime } from '../electron/agent-project-runtime.mjs';
import { spawnRun } from '../companion/run-process.mjs';
import { resolveBin } from '../companion/toolchain.mjs';

mkdirSync('artifacts',{recursive:true});
const root=mkdtempSync(resolve('artifacts','agent-diagnostics-'));
process.env.ANVIL_INSTALL_DIR=root;
const signal=new AbortController().signal;

test('fresh JavaScript and TypeScript diagnostics fail invalid code then pass acknowledged correction without execution',async()=>{
 const marker=join(root,'USER_CODE_EXECUTED');
 const first=await verifyAgentSnapshot({'broken.js':'const item = ;','typed.ts':'let n: number = "wrong";'},['broken.js','typed.ts'],{signal});
 assert.equal(first.ok,false);assert.deepEqual(first.checked,['broken.js','typed.ts']);
 assert.ok(first.hits.some(x=>x.path==='broken.js'&&x.severity==='error'));
 assert.ok(first.hits.some(x=>x.path==='typed.ts'&&x.message.includes('not assignable')));
 const corrected=await verifyAgentSnapshot({'broken.js':`require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');`,'typed.ts':'import {n} from "./values"; const result:number=n;','values.ts':'export const n:number=2;'},['broken.js','typed.ts'],{signal});
 assert.equal(corrected.ok,true,corrected.detail);assert.deepEqual(corrected.hits,[]);
 assert.deepEqual(corrected.scopes.types,['typed.ts']);assert.equal(existsSync(marker),false);
 const warnings=await verifyAgentSnapshot({'typed.ts':'let n: number = "wrong";'},['typed.ts'],{signal});
 assert.equal(warnings.hits[0].severity,'error','compiler errors cannot become warnings');
});

test('missing compilers, unsupported files and unavailable dependencies stay explicitly unchecked or failed',async()=>{
 const missing=await verifyAgentSnapshot({'main.py':'print(1)','main.ts':'const n=1;','page.html':'<h1>Hi</h1>'},['main.py','main.ts','page.html'],{signal,tools:{python:null,typescript:null}});
 assert.equal(missing.ok,false);assert.deepEqual(missing.checked,[]);assert.equal(missing.unchecked.length,3);
 assert.match(missing.detail,/Nicht geprüft/);
 const dependencies=await verifyAgentSnapshot({'main.ts':'import {value} from "./missing";const n:number=value;'},['main.ts'],{signal});
 assert.equal(dependencies.ok,false);assert.match(dependencies.detail,/Cannot find module/);
 await assert.rejects(()=>verifyAgentSnapshot({},['../outside.ts'],{signal}),/Ungültige/);
});

test('Python syntax checking does not import project modules or execute project top-level code',async t=>{
 const python=resolveBin('python');if(!python){t.skip('Python not installed');return;}
 const invalid=await verifyAgentSnapshot({'main.py':'def broken(:\n pass'},['main.py'],{signal,tools:{python}});
 assert.equal(invalid.ok,false);assert.ok(invalid.hits.some(x=>x.severity==='error'));
 const valid=await verifyAgentSnapshot({'main.py':'raise RuntimeError("must not execute")'},['main.py'],{signal,tools:{python}});
 assert.equal(valid.ok,true,valid.detail);assert.deepEqual(valid.scopes.types,[]);
 assert.match(valid.detail,/keine Python-Typprüfung/);
});

test('abort terminates diagnostic parser and its descendant process',async()=>{
 const compiler=join(root,'blocked-compiler.cjs'),pidFile=join(root,'descendant.pid');
 writeFileSync(compiler,`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit',windowsHide:true});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(child.pid));while(true){}`);
 const controller=new AbortController();let parent;
 const check=verifyAgentSnapshot({'main.ts':'const n=1;'},['main.ts'],{signal:controller.signal,tools:{typescript:compiler},run:(...args)=>{args[5]={...args[5],onStart:pid=>parent=pid};return spawnRun(...args);}});
 try {
  for(let i=0;i<100&&!existsSync(pidFile);i++)await new Promise(r=>setTimeout(r,25));
  assert.equal(existsSync(pidFile),true,'test parser spawned its descendant');
  const child=Number(readFileSync(pidFile,'utf8'));
  controller.abort();await assert.rejects(check,error=>error.name==='AbortError');
  const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
  for(let i=0;i<100&&(alive(parent)||alive(child));i++)await new Promise(r=>setTimeout(r,25));
  assert.equal(alive(parent),false);assert.equal(alive(child),false);
 }finally{controller.abort();await check.catch(()=>{});}
});

test('project runtime connects current diagnostics and custom input map',async()=>{
 let forwarded;
 const preview={run:async(...args)=>{forwarded=args;return {ok:true};}};
 const runtime=new AgentProjectRuntime({preview});
 const inputMap={left:{keys:['q'],pad:[]}};
 runtime.begin({files:{},model:{vision:true},inputMap},'diagnostics-qa');
 const files={'main.js':'const x = ;','index.html':'<h1>Demo</h1>'};
 const result=await runtime.execute({kind:'verify',paths:['main.js']},{files,signal});
 assert.equal(result.ok,false);assert.deepEqual(result.checked,['main.js']);
 await runtime.execute({kind:'run',path:'index.html'},{files,signal});
 assert.equal(forwarded[3],true);assert.deepEqual(forwarded[4],inputMap);
});
