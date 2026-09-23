import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { AgentProjectRuntime, safeAgentPath } from '../electron/agent-project-runtime.mjs';

const until = async check => { for (let i=0;i<300;i++) { if (check()) return; await new Promise(r=>setTimeout(r,20)); } throw new Error('condition timed out'); };
test('stage 2 owns file writes, deduplicates actions, checks conflicts and cancels real native runs', { timeout:30000 }, async () => {
  const dir=mkdtempSync(join(tmpdir(),'anvil-stage2-')), project=join(dir,'project'); mkdirSync(project);
  const previousInstall=process.env.ANVIL_INSTALL_DIR; process.env.ANVIL_INSTALL_DIR=dir;
  const initial='console.log("BEFORE");'; writeFileSync(join(project,'main.js'),initial);
  let child, sends=[];
  const runtime=new AgentProjectRuntime();
  const host=new AgentJobHost({ runtime, snapshotPath:join(dir,'jobs','latest.json'), launch() {
    child=new EventEmitter(); child.send=msg=>sends.push(msg); child.kill=()=>{}; return child;
  }});
  const request={project,execution:true,writeThrough:true,files:{'main.js':initial},model:{model:'fixture'},messages:[{role:'user',content:'Test'}]};
  const start=req=>{ host.start(req); child.emit('message',{type:'ready'}); };
  const op=(id,operation)=>child.emit('message',{type:'operation',id,operation});
  try {
    start(request);
    op(1,{kind:'write',path:'main.js',content:'console.log("AFTER");'});
    op(1,{kind:'write',path:'main.js',content:'console.log("AFTER");'});
    await until(()=>!host.operation);
    assert.equal(readFileSync(join(project,'main.js'),'utf8'),'console.log("AFTER");');
    assert.equal(host.state.drafts['main.js'].applied,true);
    const backupDir=join(dir,'jobs','backups',host.state.id);
    assert.equal(JSON.parse(readFileSync(join(backupDir,readdirSync(backupDir)[0]),'utf8')).before,initial);
    assert.equal(sends.filter(m=>m.type==='operation-result').length,1);
    const retainedId=host.state.id;
    host.removeAllListeners('change'); // No editor is connected.
    op(2,{kind:'run',path:'main.js'}); await until(()=>!host.operation);
    assert.equal(host.state.lastRun.ok,true,host.state.error||host.state.lastRun?.stderr);
    assert.match(host.state.lastRun.stdout,/AFTER/);
    assert.equal(host.state.lastRun.code,0);
    assert.equal(host.state.id,retainedId);
    const runId=host.state.lastRun.stage.id;
    op(2,{kind:'run',path:'main.js'});
    assert.equal(host.state.lastRun.stage.id,runId,'duplicate native request never launches again');
    writeFileSync(join(project,'main.js'),'USER CHANGE');
    op(3,{kind:'write',path:'main.js',content:'SHOULD NOT LAND'}); await until(()=>!host.operation);
    assert.equal(host.state.status,'failed'); assert.match(host.state.error,/inzwischen geändert/);
    assert.equal(readFileSync(join(project,'main.js'),'utf8'),'USER CHANGE');
    assert.equal(host.state.drafts['main.js'].after,'SHOULD NOT LAND');
    assert.equal(host.state.drafts['main.js'].applied,false);
    host.dismiss(host.state.id);
    await host.waitForCleanup();
    const marker=join(dir,'pid.txt');
    const code=`require('fs').writeFileSync(${JSON.stringify(marker)},String(process.pid)); setInterval(()=>{},1000);`;
    start({...request,writeThrough:false,files:{'wait.cjs':code}});
    op(1,{kind:'run',path:'wait.cjs'}); await until(()=>existsSync(marker));
    const pid=Number(readFileSync(marker,'utf8'));
    host.stop(); assert.equal(host.state.status,'stopping'); assert.equal(host.busy(),true);
    assert.throws(()=>host.start(request),/läuft bereits/);
    await host.close();
    assert.equal(host.state.status,'stopped'); assert.equal(host.busy(),false);
    assert.throws(()=>process.kill(pid,0),'native child must actually be gone');
    const saved=JSON.parse(readFileSync(join(dir,'jobs','latest.json'),'utf8'));
    saved.status='running'; saved.operation={id:1,kind:'run',status:'pending'};
    writeFileSync(join(dir,'interrupted.json'),JSON.stringify(saved));
    const restored=new AgentJobHost({snapshotPath:join(dir,'interrupted.json'),launch(){assert.fail('must not replay');}});
    assert.equal(restored.state.status,'interrupted'); restored.close();
  } finally { await host.close(); if(previousInstall===undefined)delete process.env.ANVIL_INSTALL_DIR;else process.env.ANVIL_INSTALL_DIR=previousInstall; }
});

test('direct saves require a matching disk baseline and reject unsafe or linked targets',()=>{
  for(const p of ['../x','/x','C:/x','.env','a/.git/config','constructor','a\\b']) assert.equal(safeAgentPath(p),false,p);
  const dir=mkdtempSync(join(tmpdir(),'anvil-conflict-'));
  writeFileSync(join(dir,'file.txt'),'disk');
  const runtime=new AgentProjectRuntime();
  assert.throws(()=>runtime.begin({writeThrough:true,project:dir,files:{'file.txt':'editor'}},'test'),/unterscheiden/);
  const outside=mkdtempSync(join(tmpdir(),'anvil-outside-'));
  symlinkSync(outside,join(dir,'linked'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>runtime.begin({writeThrough:true,project:dir,files:{'linked/new.txt':'x'}},'test'),/Verknüpfungen/);
});

test('persistence failure during a pending operation stops once without recursive Stop',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'anvil-save-failure-'));
  const blocked=join(dir,'not-a-directory');writeFileSync(blocked,'blocker');
  let child,started=false;
  const host=new AgentJobHost({snapshotPath:join(dir,'latest.json'),runtime:{begin(){},close(){},execute(_op,{signal}){
    started=true;return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({ok:false}),{once:true}));
  }},launch(){child=new EventEmitter();child.send=()=>{};child.kill=()=>{};return child;}});
  host.start({execution:true,project:'fixture',files:{},model:{model:'fixture'},messages:[{role:'user',content:'Wait'}]});
  child.emit('message',{type:'ready'});child.emit('message',{type:'operation',id:1,operation:{kind:'run',path:'test.cjs'}});
  await until(()=>started);
  host.snapshotPath=join(blocked,'latest.json');
  assert.doesNotThrow(()=>host.persist());
  await host.close();
  assert.equal(host.state.status,'stopped');assert.ok(host.state.persistenceError);assert.equal(host.busy(),false);
});

test('binary assets retain their bytes in direct saves and native run snapshots',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'anvil-assets-'));
  const bytes=Buffer.from([0,255,128,65]);
  const encoded='data:application/octet-stream;base64,'+bytes.toString('base64');
  writeFileSync(join(dir,'asset.bin'),bytes);
  const runtime=new AgentProjectRuntime();
  runtime.begin({writeThrough:true,project:dir,files:{'asset.bin':encoded}},'asset-test');
  await runtime.execute({kind:'write',path:'asset.bin',content:encoded},{before:encoded,files:{},signal:new AbortController().signal,backupPath:join(dir,'backup.json')});
  assert.deepEqual(readFileSync(join(dir,'asset.bin')),bytes);
  const previousInstall=process.env.ANVIL_INSTALL_DIR;process.env.ANVIL_INSTALL_DIR=dir;
  try {
    const result=await runtime.execute({kind:'run',path:'check.cjs'},{signal:new AbortController().signal,files:{'asset.bin':encoded,'check.cjs':"console.log(require('fs').readFileSync('asset.bin').toString('hex'))"}});
    assert.equal(result.ok,true,result.stderr);assert.match(result.stdout,/00ff8041/);
  } finally { if(previousInstall===undefined)delete process.env.ANVIL_INSTALL_DIR;else process.env.ANVIL_INSTALL_DIR=previousInstall; }
});
