import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fork} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {AgentJobHost} from '../electron/agent-job-host.mjs';
import {AgentProjectRuntime} from '../electron/agent-project-runtime.mjs';
import {AgentKnowledge} from '../electron/agent-knowledge.mjs';
import {AgentConnections} from '../electron/agent-connections.mjs';
import {McpHost} from '../electron/mcp-host.mjs';
import {McpOAuth,oauthKey} from '../electron/mcp-oauth.mjs';
import {serviceFixture} from '../scripts/fixtures/background-connections.mjs';

export async function discoveryWorkerScenario({worker,mode='standard',legacy=false,output='artifacts/context-discovery-2026-10-18/workers'}){
 const directory=resolve(output);mkdirSync(directory,{recursive:true});const root=mkdtempSync(join(directory,`${legacy?'legacy':mode}-`));
 const service=await serviceFixture(),config={...service.config,name:'FreeCAD Fixture'},issuer=new URL(service.url).origin;
 const credentials={issuer,clients:{},tokens:{[issuer]:{access_token:'fixture-access',token_type:'Bearer'}},expiresAt:{[issuer]:Date.now()+60000}};
 const oauth=new McpOAuth({read:async key=>key===oauthKey(config)?credentials:undefined,write:async()=>{},open:()=>assert.fail('No login in discovery test')});
 const connections=new AgentConnections({mcp:new McpHost({oauth})});
 const knowledge=new AgentKnowledge({storagePath:join(root,'knowledge.json')});
 const runtime=new AgentProjectRuntime({connections,knowledge});
 const guide='CURRENT_PLUGIN_GUIDE_BODY\n'+('Use only the artificial fixture. Verify its actual result.\n'.repeat(45));
 const skill={id:'fixture-plugin-guide',name:'fixture-plugin-guide',when:'FreeCAD CAD geometry fixture guide',description:'FreeCAD CAD geometry fixture guide',body:guide,
  file:'.anvil/skills/package-fixture/guide/SKILL.md',baseDirectory:'.anvil/skills/package-fixture/guide',scope:'project',ws:'fixture-workspace',
  resources:['references/requested.md','references/unrequested.md'],resourceContents:{'references/requested.md':'ONLY_REQUESTED_REFERENCE','references/unrequested.md':'NEVER_SEND_UNREQUESTED_REFERENCE'}};
 const calls=[
  {name:legacy?'mcp_list':'select_tools',args:legacy?{server:config.id,limit:12}:{scope:'all',query:'FreeCAD CAD geometry'}},
  {name:'mcp_call',args:{server:config.id,name:'record',arguments:{text:'discovery fixture'}}},
  {name:'skill_read',args:{name:skill.id}},
  {name:legacy?'mcp_list':'select_tools',args:legacy?{server:config.id,limit:12}:{scope:'mcp',server:config.id,query:'record'}},
  {name:'skill_read',args:{name:skill.id,resource:'references/requested.md'}},
 ];
 const payloads=[],errors=[];let child,closed,stderr='',host;
 const api=createServer(async(req,res)=>{
  try{
   assert.equal(req.url,'/v1/chat/completions');let raw='';for await(const chunk of req)raw+=chunk;
   const payload=JSON.parse(raw);payloads.push(payload);
   assert.equal(payload.model,'discovery-fixture');assert.equal(payloads.length<=6,true,'No repair/discovery loop');
   const text=JSON.stringify(payload.messages);assert.ok(!text.includes('NEVER_SEND_UNREQUESTED_REFERENCE'));
   if(payloads.length===1){assert.ok(!text.includes('Record one test value'));if(!legacy)assert.ok(!text.includes('CURRENT_PLUGIN_GUIDE_BODY'));}
   if(payloads.length===2)assert.ok(text.includes('inputSchema')&&text.includes('record'),'Actual catalog result includes the granted schema');
   if(payloads.length>=4)assert.ok(text.includes('CURRENT_PLUGIN_GUIDE_BODY'),'Guide body arrives only after explicit read');
   const call=calls[payloads.length-1];
   if(call&&Array.isArray(payload.tools))assert.ok(payload.tools.some(tool=>tool.function?.name===call.name),`${call.name} must be offered`);
   let delta;
   if(call)delta=Array.isArray(payload.tools)?{tool_calls:[{index:0,id:`discovery-${payloads.length}`,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]}:{content:JSON.stringify({name:call.name,arguments:call.args})};
   else delta={content:'Fixture finished: the artificial service recorded one value. The requested guide and reference were read. No real CAD model was tested.'};
   res.writeHead(200,{'content-type':'text/event-stream'}).end(`data: ${JSON.stringify({choices:[{delta,finish_reason:call?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
  }catch(error){errors.push(error.message);res.writeHead(500,{'content-type':'application/json'}).end(JSON.stringify({error:error.message}));}
 });
 await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
 try{
  host=new AgentJobHost({snapshotPath:join(root,'job.json'),runtime,launch:()=>{
   child=fork(resolve(worker),[],{stdio:['ignore','ignore','pipe','ipc']});closed=new Promise(resolve=>child.once('close',resolve));
   child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});return child;
  }});
  const initial=host.start({project:root,execution:true,writeThrough:false,files:{'notes.txt':'Artificial fixture only.',[skill.file]:`---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n${skill.body}`},locale:'en',maxRounds:12,autoContinue:false,
   services:[config],surface:{id:'anvil',mode:'bridge'},
   knowledge:{enabled:true,memoryEnabled:false,skillsEnabled:true,skillBodies:true,workspace:'fixture-workspace',memories:[],skills:[skill]},
   memory:legacy?`Selected skill instructions:\n${guide}`:'Preselected skill: fixture-plugin-guide. Load its guide with skill_read(name="fixture-plugin-guide") before applying it.',
   messages:[{role:'user',content:'Use the FreeCAD MCP fixture and fixture-plugin-guide skill: record exactly one artificial value, inspect the service catalog again, and read only references/requested.md. Report the actual outcome. No project changes.'}],
   automation:{autoRunAgent:false,runLoop:false,testLoop:false,graphLoop:false,afterWrite:'none'},
   model:{provider:'custom',baseUrl:`http://127.0.0.1:${api.address().port}/v1`,model:'discovery-fixture',toolMode:mode,context:131072,thinking:'off',maxOut:1000,hardStopMin:1,retries:1},
  });
  const deadline=Date.now()+12000;
  while(!['done','failed','stopped','interrupted'].includes(host.state?.status)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(host.state?.status,'done',`${host.state?.error}\n${stderr}`);assert.deepEqual(errors,[]);
  assert.equal(payloads.length,6);assert.equal(service.state.calls.length,1);assert.equal(service.state.calls[0].arguments.text,'discovery fixture');
  assert.ok(host.state.steps.every(step=>step.status==='ok'));assert.equal(host.state.id,initial.state.id);
  assert.ok(!host.state.steps.some(step=>/write_file|edit_file|shell/.test(step.name)));
  assert.deepEqual(host.state.drafts,{},'Read-only skill/catalog work must leave the acknowledged project files unchanged');
  if(!legacy)assert.ok(!host.state.verification?.limitations?.length,'A service action without file edits must not invent untested saved file changes');
  const rows=payloads.map((payload,index)=>({request:index+1,bytes:Buffer.byteLength(JSON.stringify(payload)),estimatedTokens:Math.ceil(JSON.stringify(payload).length/4),offered:payload.tools?.map(tool=>tool.function.name)||[],context:payload.options?.num_ctx||payload.options?.n_ctx||payload.n_ctx}));
  const result={ok:true,mode,legacy,realModelInference:false,requests:rows,requestCount:payloads.length,totalBytes:rows.reduce((sum,row)=>sum+row.bytes,0),totalEstimatedTokens:rows.reduce((sum,row)=>sum+row.estimatedTokens,0),
   firstRequestBytes:rows[0].bytes,catalogRpcs:service.state.requests.filter(request=>request.method==='tools/list').length,serviceActions:service.state.calls.length,jobId:host.state.id,projectFilesUnchanged:true,errors};
  writeFileSync(join(root,'requests.json'),JSON.stringify(payloads,null,2));writeFileSync(join(root,'result.json'),JSON.stringify(result,null,2));
  return {...result,root};
 }finally{
  if(host)await host.close();if(child?.exitCode===null&&!child.killed)child.kill();if(closed)await closed;
  await connections.close();api.closeAllConnections();await new Promise(resolve=>api.close(resolve));await service.close();
 }
}
