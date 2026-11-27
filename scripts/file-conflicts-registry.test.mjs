import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,unlinkSync,existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {AgentJobHost} from '../electron/agent-job-host.mjs';
import {AgentProjectRuntime} from '../electron/agent-project-runtime.mjs';
const {AgentJobRegistry}=await import(process.env.ANVIL_CONFLICT_REGISTRY_BASELINE?pathToFileURL(path.resolve(process.env.ANVIL_CONFLICT_REGISTRY_BASELINE)).href:'../electron/agent-job-registry.mjs');
const CSS='body { background: #f5f5f5; }\nheader { color: black; }\n';
const USER=CSS.replace('#f5f5f5','#242323');
function fixture(t){
 const root=path.resolve('artifacts/file-conflicts-2026-10-30/registry');mkdirSync(root,{recursive:true});
 const area=mkdtempSync(path.join(root,'case-')),project=path.join(area,'project');mkdirSync(project);writeFileSync(path.join(project,'styles.css'),CSS);
 const children=new Map();
 const registry=new AgentJobRegistry({directory:path.join(area,'jobs'),createHost:({jobId,snapshotPath})=>new AgentJobHost({snapshotPath,runtime:new AgentProjectRuntime(),launch:()=>{
  const child=new EventEmitter();child.send=()=>{};child.kill=()=>{};children.set(jobId,child);return child;
 }})});
 t.after(()=>registry.close());
 const request={project,execution:true,writeThrough:true,files:{'styles.css':CSS},messages:[{role:'user',content:'Preserve my CSS and update only the header.'}],model:{provider:'custom',model:'synthetic-conflict',baseUrl:'http://synthetic.invalid/v1'}};
 const ready=jobId=>children.get(jobId).emit('message',{type:'ready'});
 const action=async(jobId,operation)=>{const host=registry.hostFor({jobId}),id=(host.lastOperation?.id||0)+1;children.get(jobId).emit('message',{type:'operation',id,operation});await host.operation;return host.lastOperation.reply?.result;};
 return {registry,request,project,ready,action,children};
}
async function protectedStart(f){
 const first=await f.registry.start(f.request);f.ready(first.jobId);
 writeFileSync(path.join(f.project,'styles.css'),USER);await f.action(first.jobId,{kind:'read',path:'styles.css'});return first;
}
test('neutral continuation resumes the original protected job instead of opening an unprotected slot',async t=>{
 const f=fixture(t),first=await protectedStart(f);f.registry.stop('test stop',first.jobId);await f.registry.waitForCleanup();
 const continued=await f.registry.start({...f.request,files:{'styles.css':USER},continuationId:first.state.id});
 assert.equal(continued.jobId,first.jobId);assert.equal(continued.state.resumedFrom,first.state.id);f.ready(continued.jobId);
 const refused=await f.action(continued.jobId,{kind:'write',path:'styles.css',content:USER.replace('#242323','#fff')});
 assert.equal(refused.ok,false);assert.equal(refused.fileConflict.kind,'protected');
 assert.equal(readFileSync(path.join(f.project,'styles.css'),'utf8'),USER);
});
test('continuing an ended task inherits protection while an explicit new task has its own baseline',async t=>{
 const f=fixture(t),first=await protectedStart(f);
 f.children.get(first.jobId).emit('message',{type:'result',result:{ok:true,reply:'Artificial end of task.'}});await f.registry.waitForCleanup();
 const next=await f.registry.start({...f.request,files:{'styles.css':USER},continuationId:first.state.id});f.ready(next.jobId);
 assert.notEqual(next.jobId,first.jobId);
 assert.equal((await f.action(next.jobId,{kind:'write',path:'styles.css',content:USER.replace('#242323','#fff')})).ok,false);
 assert.equal(readFileSync(path.join(f.project,'styles.css'),'utf8'),USER);
 f.registry.stop('test stop',next.jobId);await f.registry.waitForCleanup();
 const fresh=await f.registry.start({...f.request,files:{'styles.css':USER},messages:[{role:'user',content:'New task: explicitly change the background to white.'}]});f.ready(fresh.jobId);
 assert.equal((await f.action(fresh.jobId,{kind:'write',path:'styles.css',content:USER.replace('#242323','#fff')})).applied,true);
});
test('continuation cannot switch the original model or project',async t=>{
 const f=fixture(t),first=await protectedStart(f);f.registry.stop('test stop',first.jobId);await f.registry.waitForCleanup();
 await assert.rejects(f.registry.start({...f.request,files:{'styles.css':USER},continuationId:first.state.id,model:{...f.request.model,model:'different'}}),/Modell und Verbindung/);
 const other=path.join(f.project,'other');mkdirSync(other);
 await assert.rejects(f.registry.start({...f.request,project:other,files:{},continuationId:first.state.id}),/ursprünglichen Projektordner/);
 assert.equal(f.registry.jobs().jobs.length,1);
 assert.equal(readFileSync(path.join(f.project,'styles.css'),'utf8'),USER);
});

test('done continuation protects a new user edit that was never observed by the old job',async t=>{
 const f=fixture(t),first=await f.registry.start(f.request);f.ready(first.jobId);
 const acknowledged=CSS.replace('black','navy');
 assert.equal((await f.action(first.jobId,{kind:'write',path:'styles.css',content:acknowledged})).applied,true);
 assert.deepEqual(f.registry.hostFor({jobId:first.jobId}).state.fileProtections,{},'no conflict existed during the completed job');
 f.children.get(first.jobId).emit('message',{type:'result',result:{ok:true,reply:'Artificial completed work.'}});await f.registry.waitForCleanup();
 const userAfterDone=acknowledged.replace('#f5f5f5','#242323');
 writeFileSync(path.join(f.project,'styles.css'),userAfterDone);
 const next=await f.registry.start({...f.request,files:{'styles.css':userAfterDone},continuationId:first.state.id});f.ready(next.jobId);
 const denied=await f.action(next.jobId,{kind:'write',path:'styles.css',content:userAfterDone.replace('#242323','#fff')});
 assert.equal(denied.ok,false,'continuation must not reset ownership of user edits made after done');
 assert.equal(denied.fileConflict.kind,'protected');
 assert.equal(readFileSync(path.join(f.project,'styles.css'),'utf8'),userAfterDone);
 const independent=userAfterDone.replace('navy','white');
 assert.equal((await f.action(next.jobId,{kind:'write',path:'styles.css',content:independent})).applied,true,'independent remaining work can still continue');
 assert.equal(readFileSync(path.join(f.project,'styles.css'),'utf8'),independent);
});

test('done continuation cannot resurrect a user deletion made after acknowledged work',async t=>{
 const f=fixture(t),first=await f.registry.start(f.request);f.ready(first.jobId);
 assert.equal((await f.action(first.jobId,{kind:'write',path:'styles.css',content:CSS.replace('black','navy')})).applied,true);
 f.children.get(first.jobId).emit('message',{type:'result',result:{ok:true,reply:'Artificial completed work.'}});await f.registry.waitForCleanup();
 unlinkSync(path.join(f.project,'styles.css'));
 const next=await f.registry.start({...f.request,files:{},continuationId:first.state.id});f.ready(next.jobId);
 const denied=await f.action(next.jobId,{kind:'write',path:'styles.css',content:CSS});
 assert.equal(denied.ok,false,'continuation must preserve a newly deleted source file');
 assert.equal(denied.fileConflict.kind,'deleted');
 assert.equal(existsSync(path.join(f.project,'styles.css')),false);
});
