import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {buildAgentRuntime} from './build-agent-runtime.mjs';
import {discoveryWorkerScenario} from '../fixtures/discovery-worker.mjs';
import {AgentConnections} from '../electron/agent-connections.mjs';
import {withLoadedSkill} from '../electron/skill-access.mjs';

test('native, compact and text workers discover actual MCP schemas and plugin guides without repeating actions',{timeout:60000},async t=>{
 const root=resolve('artifacts/context-discovery-2026-10-18');mkdirSync(root,{recursive:true});
 const build=mkdtempSync(join(root,'runtime-'));await buildAgentRuntime(build);
 for(const mode of ['standard','compact','text'])await t.test(mode,async()=>{
  const result=await discoveryWorkerScenario({worker:join(build,'worker.mjs'),mode});
  assert.equal(result.ok,true);assert.equal(result.serviceActions,1);assert.equal(result.catalogRpcs,2,'Two server pages are read once; subsequent discovery reuses the catalog');
  if(mode!=='text')assert.ok(result.requests.every(row=>row.offered.includes('select_tools')&&row.offered.includes('set_plan')&&row.offered.includes('ask_user')));
 });
});

test('targeted MCP refresh replaces schemas, rejects stale pages and does not execute actions',async()=>{
 let revision='a',reads=0;
 const connections=new AgentConnections({mcp:{async request(_server,method){
  assert.equal(method,'tools/list');reads++;
  return {tools:['check_geometry','check_dimensions','forbidden'].map(name=>({name,inputSchema:{type:'object',properties:{revision:{type:'string',enum:[revision]}}}}))};
 },stop(){}}});
 const server={id:'refresh-fixture',name:'FreeCAD Fixture',enabled:true,url:'http://127.0.0.1:1/mcp',transport:'http',auth:'oauth',service:'custom',allowedTools:['check_geometry','check_dimensions'],allowResources:false};
 connections.begin({services:[server],surface:{id:'anvil',mode:'bridge'},model:{}});
 const lookup=args=>connections.execute({kind:'mcp',action:'list',server:server.id,args:{catalogSearch:true,query:'FreeCAD',limit:1,...args}},{signal:new AbortController().signal});
 try{
  const first=await lookup({});assert.equal(first.total,2,JSON.stringify(first));assert.ok(first.nextCursor);assert.equal(reads,1);
  revision='b';const cached=await lookup({});assert.equal(reads,1);assert.deepEqual(cached.tools[0].inputSchema.properties.revision.enum,['a']);
  await assert.rejects(lookup({cursor:first.nextCursor,refresh:true}),/Cursor/);assert.equal(reads,2);
  const current=await lookup({});assert.deepEqual(current.tools[0].inputSchema.properties.revision.enum,['b']);assert.equal(reads,2);
 }finally{await connections.close();}
});

test('an actual skill read upgrades preselection without duplicating or replacing its reason',()=>{
 const entries=[{id:'fixture',name:'fixture',reason:'Passt zum Auftrag.',loaded:false}];
 const loaded=withLoadedSkill(entries,{id:'fixture',name:'fixture'},'skill_read');
 assert.equal(entries[0].loaded,false);assert.equal(loaded.length,1);assert.equal(loaded[0].loaded,true);assert.equal(loaded[0].reason,entries[0].reason);
 assert.equal(withLoadedSkill(loaded,{id:'fixture',name:'fixture'},'skill_read'),loaded);
});
