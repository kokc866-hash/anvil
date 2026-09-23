import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {execFileSync} from 'node:child_process';
import {AgentJobHost} from '../electron/agent-job-host.mjs';
import {AgentProjectRuntime} from '../electron/agent-project-runtime.mjs';
import {AgentCommands} from '../electron/agent-commands.mjs';
import {gitBin} from '../companion/git.mjs';
import {spawnRun} from '../companion/run-process.mjs';
const until=async f=>{for(let n=0;n<300;n++){if(f())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out');};
function fixture(files={}){
 const root=mkdtempSync(join(tmpdir(),'anvil-stage5-'));for(const [p,c]of Object.entries(files)){mkdirSync(join(root,p,'..'),{recursive:true});writeFileSync(join(root,p),c);}
 let child;const sent=[];
 const host=new AgentJobHost({snapshotPath:join(root,'state','latest.json'),runtime:new AgentProjectRuntime(),launch(){child=new EventEmitter();child.send=x=>sent.push(x);child.kill=()=>{};return child;}});
 const request={project:root,execution:true,writeThrough:true,files,model:{provider:'custom',model:'fixture'},messages:[{role:'user',content:'Fixture'}]};
 const start=()=>{host.start(request);child.emit('message',{type:'ready'});};let seq=0;
 const action=async operation=>{child.emit('message',{type:'operation',id:++seq,operation});await until(()=>!host.operation);return sent.at(-1);};
 return{root,host,request,start,action,sent,get child(){return child;}};
}
test('folder move/delete and empty directory actions restore original contents without overwriting a later edit',async()=>{
 const f=fixture({'old/a.txt':'alpha','old/sub/b.txt':'beta'});f.start();
 try{
  await f.action({kind:'rename',from:'old',to:'moved'});assert.equal(f.host.state.status,'running',f.host.state.error);
  assert.equal(existsSync(join(f.root,'old')),false);assert.equal(readFileSync(join(f.root,'moved/sub/b.txt'),'utf8'),'beta');
  await f.action({kind:'delete',path:'moved'});assert.equal(existsSync(join(f.root,'moved')),false);
  await f.action({kind:'mkdir',path:'empty/nested/leaf'});assert.ok(existsSync(join(f.root,'empty/nested/leaf')));
  f.child.emit('message',{type:'result',result:{ok:true,reply:'done'}});
  f.host.changeFiles(f.host.state.id,'restore');
  assert.equal(readFileSync(join(f.root,'old/a.txt'),'utf8'),'alpha');assert.equal(readFileSync(join(f.root,'old/sub/b.txt'),'utf8'),'beta');
  assert.equal(existsSync(join(f.root,'empty')),false);
 }finally{await f.host.close();}
 const g=fixture({'a.txt':'before'});g.start();
 try{await g.action({kind:'write',path:'a.txt',content:'after'});g.child.emit('message',{type:'result',result:{ok:true}});writeFileSync(join(g.root,'a.txt'),'user edit');assert.throws(()=>g.host.changeFiles(g.host.state.id,'restore'),/inzwischen/);assert.equal(readFileSync(join(g.root,'a.txt'),'utf8'),'user edit');}finally{await g.host.close();}
});
test('folder deletion fails before touching known files when disk contains an unknown child',async()=>{
 const f=fixture({'folder/known.txt':'keep'});writeFileSync(join(f.root,'folder/unknown.txt'),'user');f.start();
 try{await f.action({kind:'delete',path:'folder'});assert.equal(f.host.state.status,'failed');assert.match(f.host.state.error,/weitere Dateien/);assert.equal(readFileSync(join(f.root,'folder/known.txt'),'utf8'),'keep');}finally{await f.host.close();}
});
test('draft rename remains off disk until explicitly applied and retains a restore path',async()=>{
 const f=fixture({'a.txt':'before'});f.request.writeThrough=false;f.start();
 try{await f.action({kind:'rename',from:'a.txt',to:'b.txt'});assert.ok(existsSync(join(f.root,'a.txt')));f.child.emit('message',{type:'result',result:{ok:true}});f.host.changeFiles(f.host.state.id,'apply');assert.equal(existsSync(join(f.root,'a.txt')),false);assert.equal(readFileSync(join(f.root,'b.txt'),'utf8'),'before');f.host.changeFiles(f.host.state.id,'restore');assert.ok(existsSync(join(f.root,'a.txt')));assert.equal(existsSync(join(f.root,'b.txt')),false);}finally{await f.host.close();}
});
test('resume archives prior state, carries drafts and blocks an already started external action',async()=>{
 const f=fixture({'a.txt':'before'});f.start();
 try{
  await f.action({kind:'write',path:'a.txt',content:'after'});
  const op={kind:'shell',command:'node missing.js'};await f.action(op);assert.equal(f.host.state.status,'failed');
  const id=f.host.state.id;assert.throws(()=>f.host.resume(id,{...f.request,files:{'a.txt':'after'}},false),/unbestätigten Aktion/);
  f.host.resume(id,{...f.request,files:{'a.txt':'after'}},true);f.child.emit('message',{type:'ready'});
  assert.equal(f.host.state.resumedFrom,id);assert.equal(f.host.state.drafts['a.txt'].before,'before');assert.ok(existsSync(join(f.root,'state/history',id+'.json')));
  f.child.emit('message',{type:'operation',id:1,operation:op});assert.equal(f.host.state.status,'failed');assert.match(f.host.state.error,/nicht automatisch wiederholt/);
 }finally{await f.host.close();}
});
test('guarded shell captures output and cancels the real process without touching project files',async()=>{
 const root=mkdtempSync(join(tmpdir(),'anvil-stage5-shell-')),commands=new AgentCommands();commands.begin({project:root});
 const controller=new AbortController();
 const result=await commands.execute({kind:'shell',command:'node main.cjs'},{signal:controller.signal,files:{'main.cjs':'console.log("SHELL_OK")'}});
 assert.equal(result.ok,true,result.stderr);assert.match(result.stdout,/SHELL_OK/);assert.equal(existsSync(join(root,'main.cjs')),false);
 await assert.rejects(commands.execute({kind:'shell',command:'powershell -Command anything'},{signal:controller.signal,files:{}}),/Kein freies/);
 const pending=commands.execute({kind:'shell',command:'node wait.cjs'},{signal:controller.signal,files:{'wait.cjs':'setInterval(()=>{},1000)'}});setTimeout(()=>controller.abort(),300);
 const stopped=await pending;assert.equal(stopped.aborted,true);assert.throws(()=>process.kill(stopped.pid,0));
});

test('native negative test checks an explicit exit code and keeps real failures visible',async()=>{
 const root=mkdtempSync(join(tmpdir(),'anvil-exit-test-')),commands=new AgentCommands();commands.begin({project:root});
 const context={signal:new AbortController().signal,files:{'negative.cjs':'console.error("expected");process.exit(1)'}};
 const operation={kind:'shell',command:'node negative.cjs'};
 assert.equal((await commands.execute(operation,context)).ok,false);
 const matched=await commands.execute({...operation,expectedExitCode:1},context);
 assert.equal(matched.ok,true);assert.equal(matched.code,1);assert.equal(matched.exitExpectationMatched,true);
 assert.equal((await commands.execute({...operation,expectedExitCode:2},context)).ok,false);
 await assert.rejects(commands.execute({...operation,expectedExitCode:-1},context),/Exitcode/);
});

test('changing an exit expectation cannot replay a prior shell action after resume',async()=>{
 const f=fixture();f.start();let calls=0;
 f.host.runtime.execute=async()=>{calls++;throw Error('Outcome unknown');};
 try{
  await f.action({kind:'shell',command:'node work.cjs',expectedExitCode:1});
  f.host.resume(f.host.state.id,f.request,true);f.child.emit('message',{type:'ready'});
  await f.action({kind:'shell',command:'node work.cjs',expectedExitCode:0});
  assert.equal(calls,1);assert.equal(f.host.state.status,'failed');assert.match(f.host.state.error,/nicht automatisch wiederholt/);
 }finally{await f.host.close();}
});
test('an ambiguous service mutation is not repeated after resume when argument keys are reordered',async()=>{
 const f=fixture();f.start();let calls=0;
 f.host.runtime.execute=async()=>{calls++;throw Error('Reply lost after service side effect');};
 try{
  await f.action({kind:'mcp',action:'call',server:'fixture',name:'create',args:{title:'Test',fields:{a:1,b:2}}});
  const id=f.host.state.id;assert.equal(f.host.state.status,'failed');assert.equal(calls,1);
  assert.throws(()=>f.host.resume(id,f.request,false),/unbestätigten Aktion/);
  f.host.resume(id,f.request,true);f.child.emit('message',{type:'ready'});
  f.child.emit('message',{type:'operation',id:1,operation:{name:'create',args:{fields:{b:2,a:1},title:'Test'},server:'fixture',action:'call',kind:'mcp'}});
  assert.equal(f.host.state.status,'failed');assert.equal(calls,1);assert.match(f.host.state.error,/nicht automatisch wiederholt/);
 }finally{await f.host.close();}
});
test('local Git commits only this job paths and refuses an existing index',async()=>{
 const root=mkdtempSync(join(tmpdir(),'anvil-stage5-git-')),bin=gitBin();assert.ok(bin);
 const git=args=>execFileSync(bin,args,{cwd:root,encoding:'utf8',windowsHide:true});git(['init']);git(['config','user.name','Anvil Test']);git(['config','user.email','fixture@example.invalid']);
 writeFileSync(join(root,'a.txt'),'before');git(['add','a.txt']);git(['commit','-m','initial']);
 writeFileSync(join(root,'a.txt'),'after');writeFileSync(join(root,'private.txt'),'unrelated');
 const commands=new AgentCommands();commands.begin({project:root});const ctx={signal:new AbortController().signal,files:{'a.txt':'after'},changedPaths:['a.txt'],verifyFiles(){}};
 let result=await commands.execute({kind:'git',action:'commit',message:'agent change'},ctx);assert.equal(result.ok,true,result.stderr);
 assert.equal(git(['show','HEAD:a.txt']),'after');assert.match(git(['status','--short']),/\?\? private.txt/);
 git(['add','private.txt']);await assert.rejects(commands.execute({kind:'git',action:'commit',message:'blocked'},ctx),/vorgemerkte/);assert.equal(git(['diff','--cached','--name-only']).trim(),'private.txt');
});
test('a completed process does not hang when a helper inherits its output pipes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'anvil-stage5-pipes-'));
 const script='const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e","setTimeout(()=>{},6000)"],{stdio:["ignore",process.stdout,process.stderr],windowsHide:true});console.log(c.pid);c.unref();';
 const started=Date.now();
 const result=await spawnRun(process.execPath,['-e',script],root,12000,process.env);
 try{assert.equal(result.ok,true,result.stderr);assert.ok(Date.now()-started<5000,'Return after parent exits, before inherited pipe closes');}
 finally{const pid=Number(result.stdout.trim());if(Number.isInteger(pid)&&pid>0)try{process.kill(pid);}catch{}}
});
