import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentKnowledge,knowledgePermissions} from '../electron/agent-knowledge.mjs';
import {knowledgeVersion,knowledgeFileVersion,knowledgeSkillKey,mergeKnowledgeEvent} from '../electron/agent-knowledge-state.mjs';
import {serializeKnowledgeSkill} from '../electron/knowledge-skill.mjs';
const workspace='v2:path:i:/knowledge-qa';
function fixture(t,extra={}){
 const dir=mkdtempSync(join(tmpdir(),'anvil-knowledge-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const storagePath=join(dir,'journal.json'),knowledge={enabled:true,personEnabled:true,projectEnabled:true,skillsEnabled:true,skillBodies:true,pluginSkills:true,workspace,memories:[],skills:[],forgotten:[],forgottenFacts:[],appliedEvents:[],...extra},request={project:'I:/knowledge-qa',knowledge};
 const host=new AgentKnowledge({storagePath});host.begin(request,'job-one');let serial=0;
 return {dir,storagePath,request,host,call:(action,args={},options={})=>host.execute({kind:'knowledge',action,args},{files:{},operationId:`job-one:${++serial}`,...options})};
}
test('disk-first memory survives restart, exact operation replay and id collisions',async t=>{
 const f=fixture(t);const result=await f.call('add',{kind:'project',text:'Use pytest for tests'},{operationId:'job-one:add'});
 assert.equal(result.ok,true);assert.equal(JSON.parse(readFileSync(f.storagePath,'utf8')).events.length,1);
 const fresh=new AgentKnowledge({storagePath:f.storagePath});assert.equal(fresh.events().length,1,'journal readable before begin');fresh.begin(f.request,'job-one');
 assert.equal((await fresh.execute({action:'list'},{operationId:'list'})).project.length,1);
 assert.deepEqual(await fresh.execute({action:'add',args:{kind:'project',text:'Use pytest for tests'}},{operationId:'job-one:add'}),result);
 assert.equal(fresh.events().length,1);await assert.rejects(fresh.execute({action:'add',args:{text:'different'}},{operationId:'job-one:add'}),/anderem Inhalt/);
});
test('fact forget preserves tombstones across restart and respects scope',async t=>{
 const f=fixture(t);const first=await f.call('add',{kind:'lesson',text:'Keep responses concise'});await f.call('forget',{id:first.fact.id});
 assert.match((await f.call('add',{kind:'lesson',text:'Keep responses concise'})).error,/vergessen/);
 const fresh=new AgentKnowledge({storagePath:f.storagePath});fresh.begin(f.request,'next');assert.equal((await fresh.execute({action:'list'},{operationId:'list'})).person.length,0);
 const other=fixture(t,{memories:[{id:'foreign',text:'Secret other project',scope:'project',ws:'other'}]});assert.match((await other.call('forget',{id:'foreign'})).error,/fehlt/);
});
test('all learning preference gates match foreground access',async t=>{
 for(const key of ['enabled','skillsEnabled','skillBodies','personEnabled','projectEnabled']){
  const f=fixture(t,{[key]:false});const action=key==='skillsEnabled'?'write':key==='skillBodies'?'run':'add';
  assert.ok((await f.call(action,{kind:key==='projectEnabled'?'project':'user',text:'Preference fact',name:'some-skill'})).error,key);
  assert.equal(f.host.events().length,0);
 }
 assert.notEqual(knowledgePermissions({}),knowledgePermissions({enabled:true}));
 const replay=fixture(t);const args={kind:'user',text:'Private preference'};await replay.call('add',args,{operationId:'replayed'});replay.host.begin({...replay.request,knowledge:{...replay.request.knowledge,enabled:false}},'job-one');assert.match((await replay.host.execute({action:'add',args},{operationId:'replayed'})).error,/aus/);
});
test('skill write, patch, run, outcome share durable state and safe file mirrors',async t=>{
 const f=fixture(t);let files={};const apply=result=>{for(const write of result.workspaceWrites||[])files[write.path]=write.content;};
 let r=await f.call('write',{name:'verify-python',when:'python verify',body:'1. Run the Python test suite.',kind:'plugin'},{files});assert.equal(r.ok,true);assert.equal(r.workspaceWrites.length,2);apply(r);
 const first=f.host.state.skills[0];assert.match(files[r.workspaceWrites[0].path],/scope: project/);
 r=await f.call('patch',{name:first.id,body:'1. Read tests.\n2. Run the Python suite.'},{files});assert.equal(r.ok,true);apply(r);
 r=await f.call('run',{name:first.id},{files});assert.match(r.body,/Read tests/);assert.equal(f.host.state.skills[0].uses,1);
 await f.call('outcome',{kind:'fail'},{files});await f.call('outcome',{kind:'fail'},{files});assert.match(f.host.state.skills[0].body,/Letzte Nutzung/);assert.equal(f.host.state.skills[0].fails,2);
 const fresh=new AgentKnowledge({storagePath:f.storagePath});fresh.begin({...f.request,knowledgeResumeFrom:'job-one'},'resumed');await fresh.execute({action:'outcome',args:{kind:'ok'}},{operationId:'resume:outcome',files});assert.equal(fresh.state.skills[0].wins,1);assert.doesNotMatch(fresh.state.skills[0].body,/Letzte Nutzung/);
});
test('concurrent frontend edit and explicit deletion cannot be overwritten or resurrected',async t=>{
 const skill={id:'one',name:'old-skill',when:'test verify',body:'Original instructions.',kind:'guide',scope:'project',ws:workspace,uses:0,score:.6,wins:0,fails:0};
 const f=fixture(t,{skills:[{...skill,version:knowledgeVersion(skill)}]});const r=await f.call('patch',{name:'one',body:'New instructions from agent.'});const event=r.knowledgeEvents[0];
 const state={facts:[],skills:[{...skill,body:'Manual edit'}],forgotten:[],forgottenFacts:[]};assert.equal(mergeKnowledgeEvent(state,event).conflict,true);assert.equal(state.skills[0].body,'Manual edit');
 assert.equal(mergeKnowledgeEvent({...state,skills:[]},event).conflict,true);
 const created={...event,before:null,beforeVersion:null};assert.equal(mergeKnowledgeEvent({...state,skills:[],forgotten:[knowledgeSkillKey(skill)]},created).conflict,true);
 assert.equal(mergeKnowledgeEvent({...state,skills:[skill]},event).conflict,false);
});
test('workspace skill file changes are collision checked before journal commit',async t=>{
 const skill={id:'one',name:'old-skill',when:'test verify',body:'Original instructions.',kind:'guide',scope:'project',ws:workspace,file:'.anvil/skills/one.md'};
 const original=serializeKnowledgeSkill(skill),f=fixture(t,{skills:[skill],fileVersions:{[skill.file]:knowledgeFileVersion(original)}});
 const result=await f.call('patch',{name:'one',body:'Updated instructions.'},{files:{[skill.file]:'Manual file edit'}});assert.match(result.error,/zwischenzeitlich/);assert.equal(f.host.events().length,0);
 const valid=await f.call('patch',{name:'one',body:'Updated instructions.'},{files:{[skill.file]:original}});assert.equal(valid.workspaceWrites[0].before,original);
});
test('user memories cross projects but project records remain isolated without a renderer',async t=>{
 const f=fixture(t);await f.call('add',{kind:'user',text:'Concise answers'});await f.call('add',{kind:'project',text:'Project preference'});
 const second=new AgentKnowledge({storagePath:f.storagePath});second.begin({project:'I:/other',knowledge:{...f.request.knowledge,workspace:'v2:path:i:/other'}},'second');
 const r=await second.execute({action:'list'},{operationId:'second:list'});assert.equal(r.person.length,1);assert.equal(r.project.length,0);
});
test('two host instances never discard each other’s newly committed entries',async t=>{
 const f=fixture(t);const second=new AgentKnowledge({storagePath:f.storagePath});second.begin(f.request,'second');await f.call('add',{kind:'user',text:'First fact'});await second.execute({action:'add',args:{kind:'user',text:'Second fact'}},{operationId:'second:add'});
 assert.equal(new AgentKnowledge({storagePath:f.storagePath}).events().length,2);assert.equal((await f.call('list')).person.length,2);
});
test('abort and corrupted journal fail without a false success',async t=>{
 const f=fixture(t);await assert.rejects(f.call('add',{text:'Never saved'},{signal:AbortSignal.abort()}));assert.equal(f.host.events().length,0);
 writeFileSync(f.storagePath,'{incomplete');assert.throws(()=>new AgentKnowledge({storagePath:f.storagePath}),SyntaxError);
});
test('explicit skill write can reinstall a previously forgotten name without ignoring a later removal',async t=>{
 const forgotten=JSON.stringify([workspace,'restored-skill']),f=fixture(t,{forgotten:[forgotten]});
 const r=await f.call('write',{name:'restored-skill',when:'test verify',body:'Run tests and inspect their result.'});
 const state={facts:[],skills:[],forgotten:[forgotten],forgottenFacts:[]};
 const merged=mergeKnowledgeEvent(state,r.knowledgeEvents[0]);assert.equal(merged.conflict,false);assert.equal(merged.state.forgotten.length,0);
});
