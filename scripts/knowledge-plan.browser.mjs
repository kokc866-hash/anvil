// Real built desktop + native knowledge journal + worker checklist reconciliation.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as socketServer} from 'node:net';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {_electron} from 'playwright';

const base=path.resolve('artifacts/knowledge-plan');await mkdir(base,{recursive:true});
const fixture=await mkdtemp(path.join(base,'profile-')),project=path.join(fixture,'project'),temporary=path.join(fixture,'temp');
await mkdir(project);await mkdir(temporary);
const files={'README.md':'# Synthetic knowledge checklist\n'};await writeFile(path.join(project,'README.md'),files['README.md']);
const freePort=async()=>{const s=socketServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;};
const port=await freePort(),companion=await freePort(),label='memory_add, skill_write/patch/run/outcome';
const calls=[
 ['set_plan',{steps:[label,'Ergebnis berichten'],kinds:['service','report']}],
 ['memory_add',{kind:'project',text:'QA: Geldbeträge sind ganzzahlige Cent.'}],
 ['skill_write',{name:'qa-knowledge-proof',scope:'project',when:'synthetic checklist test',body:'1. read_file README.md\n2. Verify the project notes.'}],
 ['skill_patch',{name:'qa-knowledge-proof',body:'1. read_file README.md\n2. Verify the project notes.\n3. Keep integer cents.'}],
 ['skill_run',{name:'qa-knowledge-proof'}],['skill_outcome',{kind:'ok'}],
 ['edit_file',{path:'README.md',old_string:'Synthetic knowledge checklist',new_string:'Verified knowledge checklist'}],
];
const evidence=[],results=[],result={fixture,requests:0,errors:[],checks:[]};
const server=createServer(async(req,res)=>{try{
 let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw),n=++result.requests;
 for(const message of body.messages||[]){if(message.role!=='tool'||results.some(row=>row.id===message.tool_call_id))continue;
  let value;try{value=JSON.parse(message.content);}catch{continue;}
  results.push({id:message.tool_call_id,value});
  if(/^knowledge-[2-6]$/.test(message.tool_call_id))evidence.push(value.plan_evidence_id);
 }
 let call=calls[n-1];
 if(n===8){assert.equal(evidence.length,5);assert.ok(evidence.every(Boolean));call=['set_plan',{updates:[{step:1,status:'ok',evidence,reason:'All five native knowledge operations succeeded; README was edited afterwards.'}]}];}
 const delta=call?{tool_calls:[{index:0,id:'knowledge-'+n,function:{name:call[0],arguments:JSON.stringify(call[1])}}]}:{content:'Gedächtnis und Skill sind gespeichert. Der Checklistenpunkt ist bestätigt.'};
 res.writeHead(200,{'Content-Type':'text/event-stream'}).end(`data: ${JSON.stringify({choices:[{delta,finish_reason:call?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
}catch(error){res.writeHead(500).end(String(error));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const env={...process.env,ANVIL_DESKTOP_MODE:'production',ANVIL_QA_USER_DATA:fixture,ANVIL_HOME:path.join(fixture,'packages'),ANVIL_HOME_FILE:path.join(fixture,'home.txt'),ANVIL_INSTALL_DIR:fixture,ANVIL_PORT:String(port),ANVIL_COMPANION_PORT:String(companion),ANVIL_WATCHDOG:'0',TEMP:temporary,TMP:temporary,TMPDIR:temporary};delete env.ELECTRON_RUN_AS_NODE;
let app,page;
const until=async(fn)=>{for(let i=0;i<500;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Knowledge desktop timeout');};
try{
 app=await _electron.launch({args:[path.resolve('fixtures/electron-boot.mjs')],env,timeout:60000});
 await until(()=>{page=app.windows().find(w=>w.url()===`http://127.0.0.1:${port}/`);return page;});
 page.on('pageerror',e=>result.errors.push(e.message));await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
 await page.evaluate(({project,files,companion})=>window.__anvilIde.setState({setupDone:true,autoUpdate:false,locale:'de',backgroundAgent:true,workspaceCwd:project,files,dirs:[],dirty:{},pendingDiffs:[],chat:[],agentQueue:[],activePath:'README.md',openPaths:['README.md'],autoRunAgent:false,autoSaveDisk:false,planWho:'agent',previewOpen:false,runPath:null,companionUrl:`http://127.0.0.1:${companion}`}),{project,files,companion});
 await page.waitForTimeout(800);
 await page.evaluate(request=>window.anvilNative.agentJob('start',request),{project,files,execution:true,writeThrough:true,locale:'de',maxRounds:14,knowledge:{enabled:true,personEnabled:true,projectEnabled:true,skillsEnabled:true,skillBodies:true,pluginSkills:true,workspace:'v2:path:'+project.replaceAll('\\','/').toLowerCase(),memories:[],skills:[],fileVersions:{},appliedEvents:[]},messages:[{role:'user',content:'Prüfe die Gedächtnis- und Skill-Aktionen mit einer gemeinsamen Checkliste.'}],model:{provider:'custom',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'controlled-fixture',context:65536,thinking:'off',hardStopMin:1}});
 const status=async()=>(await page.evaluate(()=>window.anvilNative.agentJob('status'))).state;
 await until(async()=>['done','failed','stopped'].includes((await status()).status));
 const state=await status();assert.equal(state.status,'done',state.error);assert.equal(result.requests,9,'No repeated work/reconciliation loop');
 assert.equal(state.plan.length,2);assert.equal(state.plan[0].text,label);assert.ok(state.plan.every(step=>step.status==='ok'));
 for(const name of ['memory_add','skill_write','skill_patch','skill_run','skill_outcome'])assert.equal(state.steps.filter(s=>s.name===name&&s.status==='ok').length,1,name+' executed once');
 assert.equal(results.find(r=>r.id==='knowledge-8')?.value.ok,true,'Explicit compound update accepted after README edit');
 const skill=Object.keys(state.drafts).find(p=>p.startsWith('.anvil/skills/'));assert.ok(skill);assert.match(await readFile(path.join(project,skill),'utf8'),/integer cents/);
 await until(async()=>await page.evaluate(()=>window.__anvilIde.getState().chat.some(m=>m.plan?.length===2&&m.plan.every(p=>p.status==='ok'))));
 await page.getByText(label,{exact:true}).first().waitFor({state:'visible'});
 await page.screenshot({path:path.join(fixture,'completed.png')});
 await page.reload();await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
 await until(async()=>await page.evaluate(()=>window.__anvilIde.getState().chat.some(m=>m.plan?.length===2&&m.plan.every(p=>p.status==='ok'))));
 assert.equal((await status()).id,state.id);assert.equal(result.requests,9);assert.deepEqual(result.errors,[]);
 result.checks.push('Five real native knowledge operations executed exactly once','Compound checklist accepted after unrelated README write','Actual persisted skill file exists','Visible completed checklist survives renderer reload without replay');
 result.ok=true;await page.evaluate(id=>window.anvilNative.agentJob('dismiss',{id}),state.id);
}catch(error){result.ok=false;result.error=String(error.stack||error);await page?.screenshot({path:path.join(fixture,'failure.png')}).catch(()=>{});throw error;}
finally{
 if(app){const timer=setTimeout(()=>app.process()?.kill(),10000);try{await app.close();}catch{}clearTimeout(timer);}
 server.closeAllConnections();await new Promise(r=>server.close(r));
 await writeFile(path.join(fixture,'result.json'),JSON.stringify(result,null,2));await writeFile(path.join(base,'latest-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
