import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,unlinkSync,existsSync,symlinkSync,truncateSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {AgentJobHost} from '../electron/agent-job-host.mjs';
import {AgentProjectRuntime,readAgentProjectFile} from '../electron/agent-project-runtime.mjs';

const CSS='body { background: #f5f5f5; }\nheader { color: black; }\n';
const USER=CSS.replace('#f5f5f5','#242323');
const DARK=CSS.replace('#f5f5f5','#1a1a2e').replace('black','white');
function fixture(t){
 const root=resolve('artifacts/file-conflicts-2026-10-30/host');mkdirSync(root,{recursive:true});
 const dir=mkdtempSync(join(root,'case-'));const project=join(dir,'project');mkdirSync(project);
 writeFileSync(join(project,'notes.txt'),'original');
 let child;const sent=[];
 const launch=()=>{child=new EventEmitter();child.send=message=>sent.push(message);child.kill=()=>{};return child;};
 const host=new AgentJobHost({snapshotPath:join(dir,'job.json'),runtime:new AgentProjectRuntime(),launch});
 const request={project,execution:true,writeThrough:true,files:{'notes.txt':'original'},messages:[{role:'user',content:'Update header while preserving my CSS edits.'}],model:{provider:'custom',model:'synthetic-conflict'}};
 host.start(request);child.emit('message',{type:'ready'});
 let sequence=0;
 const action=async op=>{const id=++sequence;child.emit('message',{type:'operation',id,operation:op});await host.operation;return sent.findLast(m=>m.type==='operation-result'&&m.id===id)?.result;};
 t.after(()=>host.close());
 return {dir,project,host,request,launch,sent,action,send:m=>child.emit('message',m),resetSequence:()=>{sequence=0;}};
}

test('a real CSS conflict remains a tool error while the independent job keeps working',async t=>{
 const f=fixture(t);
 assert.equal((await f.action({kind:'write',path:'styles.css',content:CSS})).applied,true);
 writeFileSync(join(f.project,'styles.css'),USER);
 const rejected=await f.action({kind:'write',path:'styles.css',content:DARK});
 assert.equal(f.host.state.status,'running','A competing CSS change must not kill the job');
 assert.equal(rejected.ok,false);assert.equal(rejected.fileConflict.path,'styles.css');
 assert.equal(readFileSync(join(f.project,'styles.css'),'utf8'),USER);
 assert.equal(f.host.state.drafts['styles.css'].applied,false);
 assert.ok(f.host.state.drafts['styles.css'].conflict);
 assert.equal((await f.action({kind:'write',path:'other.txt',content:'independent work saved'})).applied,true);
 assert.equal(readFileSync(join(f.project,'other.txt'),'utf8'),'independent work saved');
});

test('fresh read enables an unrelated header edit but never authorizes replacing the user color',async t=>{
 const f=fixture(t);await f.action({kind:'write',path:'styles.css',content:CSS});
 writeFileSync(join(f.project,'styles.css'),USER);
 const fresh=await f.action({kind:'read',path:'styles.css'});
 assert.equal(fresh.content,USER,'read_file must refresh the actual source, not the old snapshot');
 const blocked=await f.action({kind:'write',path:'styles.css',content:USER.replace('#242323','#1a1a2e')});
 assert.equal(blocked.ok,false);assert.equal(blocked.fileConflict.kind,'protected');
 assert.equal(readFileSync(join(f.project,'styles.css'),'utf8'),USER);
 const safe=USER.replace('black','white');
 const saved=await f.action({kind:'write',path:'styles.css',content:safe});
 assert.equal(saved.applied,true);assert.equal(readFileSync(join(f.project,'styles.css'),'utf8'),safe);
 assert.equal(f.host.state.drafts['styles.css'].conflict,undefined);
 assert.equal(f.host.state.status,'running');
});

test('a second edit after reading is detected again without overwriting it or stopping other work',async t=>{
 const f=fixture(t);await f.action({kind:'write',path:'styles.css',content:CSS});
 writeFileSync(join(f.project,'styles.css'),USER);
 assert.equal((await f.action({kind:'read',path:'styles.css'})).content,USER);
 const newer=USER.replace('black','yellow');writeFileSync(join(f.project,'styles.css'),newer);
 const blocked=await f.action({kind:'write',path:'styles.css',content:USER.replace('black','white')});
 assert.equal(blocked.ok,false);assert.equal(readFileSync(join(f.project,'styles.css'),'utf8'),newer);
 assert.equal(f.host.state.status,'running');
 assert.equal((await f.action({kind:'read',path:'styles.css'})).content,newer);
 assert.equal((await f.action({kind:'write',path:'unrelated.txt',content:'kept going'})).applied,true);
});

test('stop and resume retain the current user file and its protected range',async t=>{
 const f=fixture(t);await f.action({kind:'write',path:'styles.css',content:CSS});
 writeFileSync(join(f.project,'styles.css'),USER);
 await f.action({kind:'write',path:'styles.css',content:DARK});
 const oldId=f.host.state.id;f.host.stop();await f.host.waitForCleanup();
 const request={...f.request,files:{'notes.txt':'original','styles.css':USER}};
 assert.doesNotThrow(()=>f.host.resume(oldId,request),'Resume must reconcile a saved competing user edit');
 f.resetSequence();f.send({type:'ready'});
 assert.equal((await f.action({kind:'read',path:'styles.css'})).content,USER);
 const blocked=await f.action({kind:'write',path:'styles.css',content:USER.replace('#242323','#1a1a2e')});
 assert.equal(blocked.ok,false);assert.equal(readFileSync(join(f.project,'styles.css'),'utf8'),USER);
 assert.equal(f.host.state.status,'running');
});

test('persisted protection survives a complete host restart and remains private in status replies',async t=>{
 const f=fixture(t);await f.action({kind:'write',path:'styles.css',content:CSS});
 writeFileSync(join(f.project,'styles.css'),USER);await f.action({kind:'read',path:'styles.css'});
 assert.ok(f.host.state.fileProtections['styles.css']);
 assert.equal(Object.hasOwn(f.host.snapshot().state,'fileProtections'),false);
 f.host.stop();await f.host.waitForCleanup();
 const restored=new AgentJobHost({snapshotPath:join(f.dir,'job.json'),runtime:new AgentProjectRuntime(),launch:f.launch});
 t.after(()=>restored.close());
 assert.ok(restored.state.fileProtections['styles.css']);
 restored.resume(restored.state.id,{...f.request,files:{'notes.txt':'original','styles.css':USER}});
 const id=restored.state.id;
 assert.notEqual(id,f.host.state.id);
 assert.equal(restored.state.fileProtections['styles.css'].content,USER);
 assert.equal(Object.hasOwn(restored.snapshot().state,'fileProtections'),false);
});

test('user deletion is not resurrected after read and an unrelated file can still be written',async t=>{
 const f=fixture(t);await f.action({kind:'write',path:'styles.css',content:CSS});
 unlinkSync(join(f.project,'styles.css'));
 const read=await f.action({kind:'read',path:'styles.css'});assert.equal(read.content,null);
 const blocked=await f.action({kind:'write',path:'styles.css',content:CSS});
 assert.equal(blocked.ok,false);assert.equal(blocked.fileConflict.kind,'deleted');assert.equal(existsSync(join(f.project,'styles.css')),false);
 assert.equal((await f.action({kind:'write',path:'elsewhere.txt',content:'still active'})).applied,true);
 assert.equal(f.host.state.status,'running');
});

test('restore cannot delete a user-edited new file after a successful narrow agent edit',async t=>{
 const f=fixture(t);await f.action({kind:'write',path:'styles.css',content:CSS});
 writeFileSync(join(f.project,'styles.css'),USER);await f.action({kind:'read',path:'styles.css'});
 const safe=USER.replace('black','white');await f.action({kind:'write',path:'styles.css',content:safe});
 assert.equal(f.host.state.drafts['styles.css'].conflict,undefined);
 f.host.stop();await f.host.waitForCleanup();
 assert.throws(()=>f.host.changeFiles(f.host.state.id,'restore'),/eigene Änderungen/);
 assert.equal(readFileSync(join(f.project,'styles.css'),'utf8'),safe);
});

test('legacy failed jobs resume with the complete acknowledged source rather than the rejected proposal',async t=>{
 const f=fixture(t);await f.action({kind:'write',path:'styles.css',content:CSS});
 writeFileSync(join(f.project,'styles.css'),USER);
 f.host.state.steps=[{name:'write_file',path:'styles.css',code:CSS,status:'ok'}];
 f.host.state.drafts['styles.css']={before:null,after:DARK,applied:false};
 delete f.host.state.fileProtections;
 f.host.stop();await f.host.waitForCleanup();
 assert.doesNotThrow(()=>f.host.resume(f.host.state.id,{...f.request,files:{'notes.txt':'original','styles.css':USER}}));
 f.resetSequence();f.send({type:'ready'});
 assert.equal((await f.action({kind:'read',path:'styles.css'})).content,USER);
 assert.equal((await f.action({kind:'write',path:'styles.css',content:USER.replace('black','white')})).applied,true);
 assert.equal(readFileSync(join(f.project,'styles.css'),'utf8'),USER.replace('black','white'));
});

test('protected files cannot be bypassed by renaming or deleting a directory',async t=>{
 const f=fixture(t);
 await f.action({kind:'write',path:'group/styles.css',content:CSS});
 await f.action({kind:'write',path:'group/untouched.txt',content:'also keep me'});
 writeFileSync(join(f.project,'group/styles.css'),USER);
 await f.action({kind:'read',path:'group/styles.css'});
 for(const op of [{kind:'rename',from:'group',to:'moved'},{kind:'delete',path:'group'}]){
  const reply=await f.action(op);
  assert.equal(reply.ok,false);assert.ok(reply.fileConflict);
  assert.equal(readFileSync(join(f.project,'group/styles.css'),'utf8'),USER);
  assert.equal(readFileSync(join(f.project,'group/untouched.txt'),'utf8'),'also keep me');
  assert.equal(existsSync(join(f.project,'moved')),false,'Preflight must reject the whole action before creating destinations');
  assert.equal(f.host.state.status,'running');
 }
 assert.equal((await f.action({kind:'write',path:'independent.txt',content:'can continue'})).applied,true);
});

test('an unknown user file in a directory rejects deletion without ending the job',async t=>{
 const f=fixture(t);
 await f.action({kind:'write',path:'group/known.txt',content:'known source'});
 writeFileSync(join(f.project,'group/user.txt'),'new user source');
 const reply=await f.action({kind:'delete',path:'group'});
 assert.equal(f.host.state.status,'running','Preflight conflicts must not terminate independent work');
 assert.equal(reply.ok,false);assert.ok(reply.fileConflict);
 assert.equal(readFileSync(join(f.project,'group/known.txt'),'utf8'),'known source');
 assert.equal(readFileSync(join(f.project,'group/user.txt'),'utf8'),'new user source');
 assert.equal((await f.action({kind:'write',path:'unrelated.txt',content:'can continue'})).applied,true);
});

test('unknown credentials block directory deletion without loading their content or ending the job',async t=>{
 const f=fixture(t);
 await f.action({kind:'write',path:'group/known.txt',content:'known source'});
 writeFileSync(join(f.project,'group/.env'),'SYNTHETIC_SECRET=never-load');
 const reply=await f.action({kind:'delete',path:'group'});
 assert.equal(f.host.state.status,'running');assert.equal(reply.ok,false);assert.ok(reply.fileConflict);
 assert.doesNotMatch(JSON.stringify(f.host.snapshot()),/never-load/);
 assert.doesNotMatch(JSON.stringify(reply),/never-load/);
 assert.equal(readFileSync(join(f.project,'group/.env'),'utf8'),'SYNTHETIC_SECRET=never-load');
 assert.equal(readFileSync(join(f.project,'group/known.txt'),'utf8'),'known source');
});

test('native refresh denies secrets and path escapes before returning source',t=>{
 const f=fixture(t);
 for(const path of ['credentials','id_rsa','server.pem','private.p12','api_key.json','.env','secrets.json']){
  writeFileSync(join(f.project,path),'synthetic protected content');
  assert.throws(()=>readAgentProjectFile(f.project,path),/darf nicht nachgeladen/);
 }
 for(const path of ['../notes.txt','C:/notes.txt','folder/../../notes.txt','__proto__/x'])
  assert.throws(()=>readAgentProjectFile(f.project,path),/darf nicht nachgeladen/);
 assert.throws(()=>readAgentProjectFile('relative-project','notes.txt'),/unverknüpften Projektordner/);
 writeFileSync(join(f.project,'credentials.ts'),'export const example = 1;');
 assert.equal(readAgentProjectFile(f.project,'credentials.ts'),'export const example = 1;','Ordinary code files keep their existing capture policy');
});

test('native refresh rejects a linked project root and linked child directory',t=>{
 const f=fixture(t),outside=join(f.dir,'outside');mkdirSync(outside);
 writeFileSync(join(outside,'outside.txt'),'must stay outside the project');
 symlinkSync(outside,join(f.project,'linked'),'junction');
 symlinkSync(f.project,join(f.dir,'linked-root'),'junction');
 assert.throws(()=>readAgentProjectFile(f.project,'linked/outside.txt'),/Verknüpfungen/);
 assert.throws(()=>readAgentProjectFile(join(f.dir,'linked-root'),'notes.txt'),/unverknüpften Projektordner/);
});

test('malformed persisted protection never reopens a job without its user-change guard',async t=>{
 const f=fixture(t);await f.action({kind:'write',path:'styles.css',content:CSS});
 writeFileSync(join(f.project,'styles.css'),USER);await f.action({kind:'read',path:'styles.css'});
 f.host.stop();await f.host.waitForCleanup();
 const snapshot=JSON.parse(readFileSync(join(f.dir,'job.json'),'utf8'));
 snapshot.fileProtections['styles.css'].ranges=[[-1,5000]];
 writeFileSync(join(f.dir,'corrupted-job.json'),JSON.stringify(snapshot));
 const restored=new AgentJobHost({snapshotPath:join(f.dir,'corrupted-job.json'),runtime:new AgentProjectRuntime(),launch:f.launch});
 t.after(()=>restored.close());
 assert.ok(restored.recoveryError);assert.equal(restored.state,null);
 assert.equal(readFileSync(join(f.project,'styles.css'),'utf8'),USER);
});

test('large uncaptured source refresh is bounded before buffering and remains a tool failure',async t=>{
 const f=fixture(t),large=join(f.project,'large.bin');writeFileSync(large,'');truncateSync(large,8*1024*1024);
 assert.throws(()=>readAgentProjectFile(f.project,'large.bin',undefined,2*1024*1024),/2 MiB/,'The native bounded reader must reject before producing the oversized source');
 const reply=await f.action({kind:'read',path:'large.bin'});
 assert.equal(f.host.state.status,'running');assert.equal(reply.ok,false);assert.match(reply.error,/2 MiB/);
 assert.equal(Object.hasOwn(reply,'content'),false);assert.equal(Object.hasOwn(f.host.state.fileProtections,'large.bin'),false);
 assert.equal((await f.action({kind:'write',path:'other.txt',content:'continues after size refusal'})).applied,true);
});

test('an externally created directory at a file destination is recoverable and untouched',async t=>{
 const f=fixture(t);await f.action({kind:'write',path:'source.txt',content:'source'});
 mkdirSync(join(f.project,'new-target'));writeFileSync(join(f.project,'new-target/user.txt'),'untouched');
 const renamed=await f.action({kind:'rename',from:'source.txt',to:'new-target'});
 assert.equal(f.host.state.status,'running');assert.equal(renamed.ok,false);assert.ok(renamed.fileConflict);
 const written=await f.action({kind:'write',path:'new-target',content:'must not replace a directory'});
 assert.equal(f.host.state.status,'running');assert.equal(written.ok,false);assert.ok(written.fileConflict);
 assert.equal(readFileSync(join(f.project,'source.txt'),'utf8'),'source');
 assert.equal(readFileSync(join(f.project,'new-target/user.txt'),'utf8'),'untouched');
 assert.equal((await f.action({kind:'write',path:'elsewhere.txt',content:'can continue'})).applied,true);
});
