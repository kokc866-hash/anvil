import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as socketServer} from 'node:net';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {_electron} from 'playwright';
import {verifyPackageFingerprint} from './verify-package-fingerprint.mjs';
const flag=(key,fallback)=>{const i=process.argv.indexOf(key);return path.resolve(i<0?fallback:process.argv[i+1]);};
const exe=flag('--executable','node_modules/electron/dist/electron.exe');
const out=flag('--output','artifacts/followup-repair-2026-11-01/desktop');await mkdir(out,{recursive:true});
const foreground=process.argv.includes('--foreground');
const manifest=await verifyPackageFingerprint(path.join(path.dirname(exe),'resources/app'));
const profile=await mkdtemp(path.join(out,'profile-')),project=path.join(profile,'project');await mkdir(project);
const js='document.querySelector("#start").onclick=()=>{document.querySelector("#robot").textContent="Ziel erreicht";document.querySelector("#done").textContent="1";};';
const updated=js.replace('};','document.querySelector("#status").textContent="Abgeschlossen";};');
const files={'index.html':'<!doctype html><html><head><meta charset="utf-8"><title>Folgeauftrag QA</title></head><body style="background:#172131;color:#eef;font:22px system-ui;padding:30px"><h1>Transportprüfung</h1><button id="start">Start</button><p id="robot" role="status">Wartet</p><output id="done">0</output><p id="status"></p><script src="ui.js"></script></body></html>','ui.js':js};
for(const [name,text]of Object.entries(files))await writeFile(path.join(project,name),text);
const correction='Korrektur: die Roboter sollten sich auch bewegen und auftrag ausführen.';
const repair='Korrektur: Repariere jetzt die Statusanzeige und prüfe sie.';
let app,page,phase=0,round=0,editEvidence,playEvidence,done=false;const checks=[],requests=[],issues=[],errors=[],consoleErrors=[],humans=[];
const value=(body,id)=>{const raw=body.messages.find(m=>m.role==='tool'&&m.tool_call_id===id)?.content;assert.equal(typeof raw,'string');return raw;};
const state=async()=>foreground?page.evaluate(()=>({plan:window.__anvilIde.getState().chat.at(-1)?.plan,human:window.__anvilIde.getState().agentJob?.human,status:window.__anvilIde.getState().agentBusy?'running':'idle'})):(await page.evaluate(()=>window.anvilNative.agentJob('status'))).state;
const server=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 if(!req.url.endsWith('/chat/completions')){res.writeHead(200,{'Content-Type':'application/json'}).end('{"data":[]}');return;}
 const body=JSON.parse(raw),n=++round,id=`followup-${phase}-${n}`;let name,args,content;
 requests.push({phase,round:n,names:(body.tools||[]).map(t=>t.function.name)});
 try{
  assert.ok(n<=7,'bounded synthetic correction task');
  if(n===1){const snapshot=await state();humans.push(foreground?snapshot.human:{request:snapshot.humanPrompt,corrections:snapshot.humanCorrections});
   name='edit_file';args={path:'ui.js',old_string:js,new_string:updated};}
  if(n===2){const previous=JSON.parse(value(body,`followup-${phase}-1`));
   if(phase===0){assert.equal(previous.rejected,true);assert.equal(previous.definitelyNotExecuted,true);checks.push('test correction preserves the write restriction');}
   else{assert.equal(previous.ok,true,previous.error);editEvidence=previous.plan_evidence_id;checks.push('a later explicit human repair authorizes its actual narrow edit');}
   name='run_file';args={path:'index.html'};}
  if(n===3){const rendered=value(body,`followup-${phase}-2`);assert.match(rendered,/Next preview check/);assert.match(rendered,/Roboter|Statusanzeige/);assert.ok(requests.at(-1).names.includes('play'));
   name='see_run';args={};}
  if(n===4){const seen=JSON.parse(value(body,`followup-${phase}-3`));assert.equal(seen.functionalChecks,false);assert.ok(seen.testing.tools.includes('play'));assert.ok(seen.testing.unchanged>=1);
   const snapshot=await state(),i=snapshot.plan.findIndex(step=>step.kind==='check');
   name='set_plan';args={updates:[{step:i+1,status:'ok',evidence:[seen.plan_evidence_id],reason:'Only observed the unchanged preview.'}]};}
  if(n===5){assert.ok(JSON.parse(value(body,`followup-${phase}-4`)).error);const snapshot=await state();assert.ok(snapshot.plan.some(step=>step.kind==='check'&&step.status!=='ok'));checks.push('a repeated picture cannot complete the actual function checklist');
   name='play';args={actions:[{type:'click',selector:'#start'},{type:'assert',selector:'#robot',text:'Ziel erreicht'},{type:'assert',selector:'#done',text:'1'},...(phase?[{type:'assert',selector:'#status',text:'Abgeschlossen'}]:[])]};}
  if(n===6){const played=JSON.parse(value(body,`followup-${phase}-5`));assert.equal(played.ok,true,played.error);assert.equal(played.functionalChecks,true);playEvidence=played.plan_evidence_id;
   const snapshot=await state();name='set_plan';args={updates:snapshot.plan.flatMap((step,i)=>step.kind==='report'?[]:[{step:i+1,status:'ok',evidence:step.kind==='edit'?[editEvidence,playEvidence]:[playEvidence],reason:'Confirmed by actual current input/assertion and any required acknowledged edit.'}])};}
  if(n===7){assert.equal(JSON.parse(value(body,`followup-${phase}-6`)).ok,true);content=phase?'FOLLOWUP_REPAIR_OK: Statusanzeige und Transport bestätigt.':'FOLLOWUP_CHECK_OK: Bewegung und Transport bestätigt; keine Datei geändert.';}
 }catch(error){issues.push(error.stack);content='FOLLOWUP_FAILURE: '+error.message;}
 const delta=name?{tool_calls:[{index:0,id,function:{name,arguments:JSON.stringify(args)}}]}:{content};
 res.writeHead(200,{'Content-Type':'text/event-stream'}).end('data: '+JSON.stringify({choices:[{delta,finish_reason:name?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const socket=socketServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const until=async(fn,label)=>{for(let i=0;i<400;i++){if(issues.length)throw Error(issues[0]);if(await fn())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Timed out: '+label);};
try{
 const env={...process.env,ANVIL_DESKTOP_MODE:'production',ANVIL_QA_USER_DATA:profile,ANVIL_PORT:String(port),ANVIL_HOME:path.join(profile,'packages')};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:exe,args:[],env,timeout:45000});
 await app.context().route('**/*',route=>{const req=route.request(),type=req.resourceType();return new URL(req.url()).hostname==='127.0.0.1'?route.continue():route.fulfill({status:200,contentType:type==='script'?'application/javascript':type==='stylesheet'?'text/css':'application/json',body:['script','stylesheet'].includes(type)?'':'{}'});});
 const editorUrl=`http://127.0.0.1:${port}/`;await until(()=>{page=app.windows().find(window=>window.url()===editorUrl);return page;},'editor');
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
 await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
 assert.equal(await page.evaluate(async()=>Boolean((await window.anvilNative.companionEnsure()).ok)),true,'local helper ready for the full QA lifetime');
 await app.evaluate(({BrowserWindow},url)=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url).setSize(1500,1000),editorUrl);
 await page.evaluate(({project,files,base,foreground})=>window.__anvilIde.setState({setupDone:true,settingsOpen:false,autoUpdate:false,locale:'de',agentMode:'agent',activeSurfaceId:'anvil',surfaceMode:'bridge',mcpServers:[],helpPreferences:{tips:false,pointer:false,delay:900},backgroundAgent:!foreground,backgroundWriteThrough:true,files,dirs:[],openPaths:['index.html'],activePath:'index.html',dirty:{},editBases:{},pendingDiffs:[],chat:[{id:'previous-user',role:'user',content:'teste alle durch'},{id:'previous-assistant',role:'assistant',content:'Unterbrochen.',plan:[{text:'Angefragte Projektinformationen prüfen',kind:'read',status:'ok'},{text:'Ergebnis und Grenzen berichten',kind:'report',status:'todo'}]}],agentQueue:[],agentInbox:null,workspaceCwd:project,workspaceEpoch:2,autoSaveDisk:false,autoAcceptDiffs:true,autoPreview:false,llmProvider:'custom',llmAuthMode:'key',llmBaseUrl:base,llmModel:'synthetic-followup',llmApiKey:'',llmContext:32768,llmContextAuto:false,llmThinking:'off',llmHardStopMin:0,autoRunAgent:false,runLoop:false,graphLoop:true,testLoop:false,engineLoop:false,harnessAfterWrite:'none',harnessAutoContinue:false,planWho:'agent',agentRules:''}),{project,files,base:`http://127.0.0.1:${server.address().port}/v1`,foreground});
 await page.locator('.monaco-editor .view-line').first().waitFor({state:'visible'});
 // Seeding the workspace is asynchronous with editor mounting. Do not race its
 // initial change events against the real disk-checkpoint guard.
 await page.evaluate(()=>new Promise((resolve,reject)=>{
   const store=window.__anvilIde;let previous=store.getState().files,timer,deadline;
   const finish=()=>{clearTimeout(timer);clearTimeout(deadline);unsubscribe();resolve();};
   const unsubscribe=store.subscribe(state=>{if(state.files!==previous){previous=state.files;clearTimeout(timer);timer=setTimeout(finish,350);}});
   timer=setTimeout(finish,350);deadline=setTimeout(()=>{clearTimeout(timer);unsubscribe();reject(Error('QA editor did not settle'));},5000);
 }));
 assert.deepEqual(await page.evaluate(()=>window.__anvilIde.getState().files),files,'seeded files are intact before sending');
 await page.locator('textarea').last().fill(correction);await page.locator('textarea').last().press('Enter');
 await until(async()=>!await page.evaluate(()=>window.__anvilIde.getState().agentBusy)&&(await page.locator('body').innerText()).includes('FOLLOWUP_CHECK_OK'),'test correction completed');
 assert.equal(round,7);assert.equal(await readFile(path.join(project,'ui.js'),'utf8'),js);checks.push('a real composer correction keeps the original task and completes fresh functional assertions');
 await page.screenshot({path:path.join(out,'checked.png')});
 phase=1;round=0;await page.locator('textarea').last().fill(repair);await page.locator('textarea').last().press('Enter');
 await until(async()=>!await page.evaluate(()=>window.__anvilIde.getState().agentBusy)&&(await page.locator('body').innerText()).includes('FOLLOWUP_REPAIR_OK'),'authorized repair completed');
 assert.equal(round,7);assert.deepEqual(issues,[]);
 const final=await state();assert.ok(final.plan.every(step=>step.status==='ok'));
 assert.equal(humans[0].request,'teste alle durch');assert.equal(humans[1].request,'teste alle durch');
 const corrections=human=>human.corrections.map(row=>typeof row==='string'?row:row.text);
 assert.deepEqual(corrections(humans[0]),[correction]);assert.deepEqual(corrections(humans[1]),[correction,repair]);checks.push('both jobs preserve ordered, real human instructions separately from model replies');
 assert.equal(await page.evaluate(()=>window.__anvilIde.getState().files['ui.js']),updated);
 assert.equal(await page.getByRole('dialog',{name:'Auftragsdetails'}).count(),0);checks.push('no additional confirmation window');
 if(!foreground){assert.equal(await readFile(path.join(project,'ui.js'),'utf8'),updated);assert.equal(final.toolContracts.at(-1).sequence,7);assert.ok(final.toolContracts.some(row=>row.names.includes('play')));checks.push('the independent worker persists the actual advertised tools');}
 await page.screenshot({path:path.join(out,'repaired.png')});
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);done=true;
 await writeFile(path.join(out,'result.json'),JSON.stringify({ok:true,foreground,source:manifest.source,realModelInference:false,checks,requests,humans,errors,consoleErrors},null,2));
 console.log(JSON.stringify({ok:true,foreground,checks:checks.length,requests:requests.length}));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await writeFile(path.join(out,'failure.json'),JSON.stringify({error:error.stack,foreground,phase,round,issues,requests,errors,consoleErrors},null,2));throw error;}
finally{if(app){const proc=app.process(),timer=setTimeout(()=>proc?.kill(),8000);try{await app.close();}catch{/* Close only this isolated QA process. */}clearTimeout(timer);}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(!done)process.exitCode=1;}
