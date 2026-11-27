import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
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
test('folder deletion rejects the action but keeps the job alive when disk contains an unknown child',async()=>{
 const f=fixture({'folder/known.txt':'keep'});writeFileSync(join(f.root,'folder/unknown.txt'),'user');f.start();
 try{const reply=await f.action({kind:'delete',path:'folder'});assert.equal(f.host.state.status,'running');assert.equal(reply.result.ok,false);assert.match(reply.result.error,/weitere Dateien/);assert.ok(reply.result.fileConflict);assert.equal(readFileSync(join(f.root,'folder/known.txt'),'utf8'),'keep');assert.equal(readFileSync(join(f.root,'folder/unknown.txt'),'utf8'),'user');}finally{await f.host.close();}
});
test('draft rename remains off disk until explicitly applied and retains a restore path',async()=>{
 const f=fixture({'a.txt':'before'});f.request.writeThrough=false;f.start();
 try{await f.action({kind:'rename',from:'a.txt',to:'b.txt'});assert.ok(existsSync(join(f.root,'a.txt')));f.child.emit('message',{type:'result',result:{ok:true}});f.host.changeFiles(f.host.state.id,'apply');assert.equal(existsSync(join(f.root,'a.txt')),false);assert.equal(readFileSync(join(f.root,'b.txt'),'utf8'),'before');f.host.changeFiles(f.host.state.id,'restore');assert.ok(existsSync(join(f.root,'a.txt')));assert.equal(existsSync(join(f.root,'b.txt')),false);}finally{await f.host.close();}
});
test('resume archives prior state, carries drafts and permits new work without confirmation',async()=>{
 const f=fixture({'a.txt':'before'});f.start();
 try{
  await f.action({kind:'write',path:'a.txt',content:'after'});
  const op={kind:'shell',command:'node missing.js'};const rejected=await f.action(op);assert.equal(f.host.state.status,'running');assert.equal(rejected.result.definitelyNotExecuted,true);
  f.host.stop();await f.host.waitForCleanup();assert.equal(f.host.state.status,'stopped');
  const id=f.host.state.id;let calls=0;f.host.runtime.execute=async()=>{calls++;return {ok:true,code:0};};
  f.host.resume(id,{...f.request,files:{'a.txt':'after'}});f.child.emit('message',{type:'ready'});
  assert.equal(f.host.state.resumedFrom,id);assert.equal(f.host.state.drafts['a.txt'].before,'before');assert.ok(existsSync(join(f.root,'state/history',id+'.json')));
  assert.equal(calls,0,'Resume does not redispatch old commands');
  f.child.emit('message',{type:'operation',id:1,operation:op});await until(()=>!f.host.operation);
  assert.equal(calls,1);assert.equal(f.host.state.status,'running');
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

test('builtin Node tests execute acknowledged cjs and mjs snapshots, retaining genuine assertion failures',async()=>{
 mkdirSync('artifacts/agent-flow-2026-10-18',{recursive:true});
 const root=mkdtempSync(resolve('artifacts/agent-flow-2026-10-18/node-native-')),commands=new AgentCommands();commands.begin({project:root});
 writeFileSync(join(root,'adder.cjs'),'throw Error("PROJECT_DISK_MUST_NOT_RUN");');
 const files={
  'adder.cjs':'exports.add=(a,b)=>a+b;',
  'adder.test.cjs':'const assert=require("node:assert/strict"),fs=require("node:fs"),{add}=require("./adder.cjs");assert.equal(add(2,3),5);assert.equal(add(-2,3),1);fs.appendFileSync("test-executions.log","CJS_ASSERTIONS_PASSED\\n");console.log("NODE_CJS_ASSERTIONS_PASSED");',
  'nested/esm.test.mjs':'import assert from "node:assert/strict";assert.equal(2*3,6);console.log("NODE_MJS_ASSERTIONS_PASSED");',
 };
 const context={signal:new AbortController().signal,files};
 const result=await commands.execute({kind:'shell',command:'node --test adder.test.cjs nested/esm.test.mjs'},context);
 assert.equal(result.ok,true,result.stderr);assert.equal(result.code,0);
 assert.match(result.stdout,/NODE_CJS_ASSERTIONS_PASSED/);assert.match(result.stdout,/NODE_MJS_ASSERTIONS_PASSED/);
 assert.equal(readFileSync(join(result.stage.out,'test-executions.log'),'utf8'),'CJS_ASSERTIONS_PASSED\n');
 assert.equal(readFileSync(join(root,'adder.cjs'),'utf8'),'throw Error("PROJECT_DISK_MUST_NOT_RUN");');
 assert.equal(existsSync(join(root,'test-executions.log')),false);
 const failed=await commands.execute({kind:'shell',command:'node --test adder.test.cjs'},{...context,files:{...files,'adder.cjs':'exports.add=(a,b)=>a-b;'}});
 assert.equal(failed.ok,false);assert.notEqual(failed.code,0);assert.match(failed.stdout+failed.stderr,/ERR_ASSERTION|AssertionError/);
});

test('builtin Node test launches remain independent inside a real parent Node test context',()=>{
 mkdirSync('artifacts/agent-flow-2026-10-18',{recursive:true});
 const root=mkdtempSync(resolve('artifacts/agent-flow-2026-10-18/node-parent-context-'));
 const parent=join(root,'parent.test.mjs');
 const source=`import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {AgentCommands} from ${JSON.stringify(new URL('../electron/agent-commands.mjs',import.meta.url).href)};
import {nodeTestInput} from ${JSON.stringify(new URL('../src/lib/test-wrap.ts',import.meta.url).href)};
test('fresh CLI tests execute instead of recursively skipping files',async()=>{
 assert.ok(process.env.NODE_TEST_CONTEXT,'The regression must run in a real Node test context');
 const inheritedContext=process.env.NODE_TEST_CONTEXT;
 process.env.ANVIL_NODE_TEST_ENV_PROBE='preserved';
 const root=${JSON.stringify(root)},commands=new AgentCommands();commands.begin({project:root});
 const files={
  'pass.test.cjs':'const assert=require("node:assert/strict");assert.equal(process.env.ANVIL_NODE_TEST_ENV_PROBE,"preserved");if(process.env.ANVIL_NODE_TEST_REQUIRE_ELECTRON)assert.equal(process.env.ELECTRON_RUN_AS_NODE,"1");console.log("FRESH_NODE_CONTEXT_PASSED");',
  'fail.test.cjs':'if(require.main===module)require("node:assert/strict").equal(1,2,"FRESH_NODE_CONTEXT_REAL_FAILURE");',
 };
 const ctx={signal:new AbortController().signal,files};
 const passed=await commands.execute({kind:'shell',command:'node --test pass.test.cjs'},ctx);
 assert.equal(passed.ok,true,passed.stdout+'\\n'+passed.stderr);assert.match(passed.stdout,/FRESH_NODE_CONTEXT_PASSED/);
 assert.doesNotMatch(passed.stderr,/recursively|skipping running files/);
 const failed=await commands.execute({kind:'shell',command:'node --test fail.test.cjs'},ctx);
 assert.equal(failed.ok,false);assert.notEqual(failed.code,0);assert.match(failed.stdout+failed.stderr,/FRESH_NODE_CONTEXT_REAL_FAILURE/);
 for(const [path,success] of [['pass.test.cjs',true],['fail.test.cjs',false]]){
  const input=nodeTestInput(files,path);
  for(const [path,source] of Object.entries(input.files)){const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,source);}
  const child=spawnSync(process.execPath,[input.entry],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',ANVIL_NODE_TEST_REQUIRE_ELECTRON:'1'},encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(child.error,undefined);assert.equal(child.signal,null);
  if(success){assert.equal(child.status,0,child.stdout+'\\n'+child.stderr);assert.match(child.stdout,/FRESH_NODE_CONTEXT_PASSED/);}
  else{assert.notEqual(child.status,0);assert.match(child.stdout+child.stderr,/FRESH_NODE_CONTEXT_REAL_FAILURE/);}
  assert.doesNotMatch(child.stderr,/recursively|skipping running files/);
 }
 assert.equal(process.env.NODE_TEST_CONTEXT,inheritedContext,'The caller environment must not be mutated');
 console.log('NATIVE_AND_FOREGROUND_CONTEXT_ISOLATED');
});`;
 writeFileSync(parent,source);
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const stdout=execFileSync(process.execPath,['--experimental-strip-types','--test',parent],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:30000});
 assert.match(stdout,/NATIVE_AND_FOREGROUND_CONTEXT_ISOLATED/);
});

test('builtin Node test commands require explicit snapshot files and reject loaders, evaluation and escaping paths',async()=>{
 mkdirSync('artifacts/agent-flow-2026-10-18',{recursive:true});
 const root=mkdtempSync(resolve('artifacts/agent-flow-2026-10-18/node-guards-')),commands=new AgentCommands();commands.begin({project:root});
 const context={signal:new AbortController().signal,files:{'safe.test.cjs':'throw Error("MUST_NOT_RUN");'}};
 for(const command of ['node --test','node --test missing.test.cjs','node --test ../outside.test.cjs','node --test /outside.test.cjs','node --test C:/outside.test.cjs','node --test "\\\\server\\share\\outside.test.cjs"','node --test --import ./safe.test.cjs','node --test --require safe.test.cjs','node --test -e "process.exit(0)"','node --test --test-reporter ./safe.test.cjs','node --test safe.test.cjs --import safe.test.cjs']){
  await assert.rejects(commands.execute({kind:'shell',command},context),undefined,command);
 }
});

test('a resumed task can correct its shell call while duplicate current call IDs execute once',async()=>{
 const f=fixture();f.start();let calls=0;
 f.host.runtime.execute=async()=>{if(++calls===1)throw Error('Outcome unknown');return {ok:true,code:0};};
 try{
  await f.action({kind:'shell',command:'node work.cjs',expectedExitCode:1});
  f.host.resume(f.host.state.id,f.request);f.child.emit('message',{type:'ready'});
  assert.equal(calls,1);
  const message={type:'operation',id:1,operation:{kind:'shell',command:'node work.cjs',expectedExitCode:0}};
  f.child.emit('message',message);f.child.emit('message',message);await until(()=>!f.host.operation);f.child.emit('message',message);
  assert.equal(calls,2);assert.equal(f.host.state.status,'running');
 }finally{await f.host.close();}
});

test('old service uncertainty does not block new calls and reordered duplicate current arguments are deduplicated',async()=>{
 const f=fixture();f.start();let calls=0;
 f.host.runtime.execute=async()=>{if(++calls===1)throw Error('Reply lost after service side effect');return {ok:true};};
 try{
  await f.action({kind:'mcp',action:'call',server:'fixture',name:'create',args:{title:'Test',fields:{a:1,b:2}}});
  const id=f.host.state.id;assert.equal(f.host.state.status,'failed');assert.equal(calls,1);
  f.host.resume(id,f.request);f.child.emit('message',{type:'ready'});assert.equal(calls,1);
  f.child.emit('message',{type:'operation',id:1,operation:{name:'create',args:{fields:{b:2,a:1},title:'Test'},server:'fixture',action:'call',kind:'mcp'}});
  await until(()=>!f.host.operation);
  f.child.emit('message',{type:'operation',id:1,operation:{kind:'mcp',action:'call',server:'fixture',name:'create',args:{title:'Test',fields:{a:1,b:2}}}});
  assert.equal(f.host.state.status,'running');assert.equal(calls,2);
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
 finally{const pid=Number(result.stdout.trim());if(Number.isInteger(pid)&&pid>0)try{process.kill(pid);}catch{ /* The fixture child may already have exited. */ }}
});
