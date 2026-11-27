import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as socketServer} from 'node:net';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {_electron} from 'playwright';
import {spawn} from 'node:child_process';
import {verifyPackageFingerprint} from './verify-package-fingerprint.mjs';
import {verifyBuild} from './build-fingerprint.mjs';

// Synthetic model replies drive the real packaged worker, file edits and Node
// function tests. This verifies UI/runtime wiring, not real model inference.
const argument=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const requested=argument('--executable')||process.env.ANVIL_QA_EXECUTABLE;
const executable=path.resolve(requested||'node_modules/electron/dist/electron.exe');
const output=path.resolve(argument('--output')||process.env.ANVIL_QA_OUTPUT||'artifacts/agent-flow-desktop');
const manifest=requested?await verifyPackageFingerprint(path.join(path.dirname(executable),'resources/app')):await verifyBuild(process.cwd(),true);
await mkdir(output,{recursive:true});
const profile=await mkdtemp(path.join(output,'profile-'));
const project=path.join(profile,'synthetic-project');await mkdir(project);
// Keep the independent execution counter outside the watched project inputs.
const counter=path.join(profile,'function-tests.log');
const files={
 'adder.cjs':'exports.add = (a, b) => a - b;\n',
 'adder.test.cjs':`const assert=require('node:assert/strict');const fs=require('node:fs');const {add}=require('./adder.cjs');assert.equal(add(2,3),5);assert.equal(add(-2,3),1);fs.appendFileSync(${JSON.stringify(counter)},'FUNCTION_TEST_OK\\n');console.log('FUNCTION_TEST_OK: positive and negative operands verified');\n`,
};
for(const[file,content]of Object.entries(files))await writeFile(path.join(project,file),content);
const freePort=async()=>{const server=socketServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;};
const port=await freePort(),companionPort=await freePort();
const checks=[],errors=[],consoleErrors=[],fixtureErrors=[],requests=[],companionPortAdaptations=[],gates=new Map();
let app,page,jobId,companion;
const until=async(predicate,label)=>{for(let n=0;n<450;n++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Agent flow QA timed out: '+label);};
const release=stage=>{const gate=gates.get(stage);assert.ok(gate,'expected held model stage '+stage);gates.delete(stage);gate();};
const api=createServer(async(req,res)=>{
 try{
  if(req.url==='/v1/models'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'synthetic-agent-flow'}]}));return;}
  assert.equal(req.url,'/v1/chat/completions');
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),stage=requests.length+1,last=body.messages.at(-1);
  requests.push({stage,lastRole:last?.role,lastContent:String(last?.content||'').slice(0,1500)});
  assert.ok(stage<=6,'unexpected model repair/reconciliation loop');
  assert.ok(body.messages.flatMap(message=>message.tool_calls||[]).filter(call=>call.function?.name==='set_plan').length<=1,'one concrete initial model plan; no repeated reconciliation');
  if(stage===2)assert.match(String(last.content),/a - b/);
  if(stage===3){assert.match(String(last.content),/Frühe Dateiprüfung|Early file check/);assert.doesNotMatch(String(last.content),/SyntaxError|nicht abgeschlossen/);}
  if(stage===4)assert.match(String(last.content),/FUNCTION_TEST_OK/);
  if(stage===6)assert.match(String(last.content),/FUNCTION_TEST_OK/,'the foreground test returns actual process output');
  if(stage<=3)await new Promise(resolve=>{gates.set(stage,resolve);res.once('close',resolve);});
  if(res.destroyed)return;
  const call=stage===1?{name:'read_file',arguments:'{"path":"adder.cjs"}'}
   :stage===2?{name:'edit_file',arguments:JSON.stringify({path:'adder.cjs',old_string:'a - b',new_string:'a + b'})}
   :stage===3||stage===5?{name:'shell',arguments:'{"command":"node --test adder.test.cjs"}'}:null;
  const initialPlan={index:0,id:'agent-flow-plan',type:'function',function:{name:'set_plan',arguments:JSON.stringify({steps:['Datei adder.cjs lesen','Datei adder.cjs ändern','Prüfe adder.test.cjs mit Tests'],kinds:['read','edit','check']})}};
  const delta=call?{tool_calls:[...(stage===1?[initialPlan]:[]),{index:stage===1?1:0,id:'agent-flow-'+stage,type:'function',function:call}]}:{content:stage===6?'FOREGROUND_TEST_OK: Die ausdrücklich angeforderten Funktionstests wurden für den bestätigten Dateistand ausgeführt.':'AGENT_FLOW_OK: Die Funktion wurde geändert. Die ausgeführten Funktionstests für positive und negative Operanden bestehen.'};
  res.writeHead(200,{'content-type':'text/event-stream'}).end(`data: ${JSON.stringify({choices:[{delta,finish_reason:call?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
 }catch(error){fixtureErrors.push(error.message);if(!res.headersSent)res.writeHead(500);res.end('Synthetic model fixture failed.');}
});
await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${api.address().port}/v1`;
const env={...process.env,ANVIL_DESKTOP_MODE:'production',ANVIL_PORT:String(port),ANVIL_COMPANION_PORT:String(companionPort),
 ANVIL_COMPANION_TOKEN:'agent-flow-qa-only',ANVIL_COMPANION_TOKEN_FILE:path.join(profile,'companion-token'),ANVIL_QA_USER_DATA:profile,ANVIL_USER_DATA:profile,ANVIL_HOME:path.join(profile,'packages')};
delete env.ELECTRON_RUN_AS_NODE;
const result={realModelInference:false,profile,project,source:manifest.source,outputFingerprint:manifest.outputFingerprint,checks,errors,consoleErrors,fixtureErrors,requests,companionPortAdaptations};
const job=async()=>(await page.evaluate(()=>window.anvilNative.agentJob('status'))).state;
const chatPlan=async()=>page.evaluate(id=>window.__anvilIde.getState().chat.find(message=>message.backgroundJobId===id)?.plan,jobId);
const todo=()=>page.getByRole('button',{name:/To-do/}).last();
async function expectVisible(statuses,label){
 await until(async()=>JSON.stringify((await chatPlan())?.map(step=>step.status))===JSON.stringify(statuses),label+' chat plan');
 await todo().waitFor({state:'visible'});
 assert.match(await todo().innerText(),new RegExp(`${statuses.filter(value=>value==='ok').length}\\/${statuses.length}`));
 assert.equal(await todo().getAttribute('aria-expanded'),'true','the current checklist is expanded');
 const rows=todo().locator('..').locator('ol > li'),plan=await chatPlan();
 assert.equal(await rows.count(),statuses.length,'every checklist item is rendered');
 for(let index=0;index<statuses.length;index++){
  const row=rows.nth(index);assert.ok(await row.isVisible(),'checklist item is visible');
  const rendered=await row.innerText();assert.ok(rendered.includes(plan[index].text),'the actual current step text is displayed');
  assert.equal(rendered.trim()[0],{todo:'☐',run:'…',ok:'☑',err:'✕'}[statuses[index]],'the displayed checkbox matches the actual evidence status');
 }
 assert.doesNotMatch(await todo().locator('..').innerText(),/OLD_COMPLETED_CHECKLIST/);
 assert.doesNotMatch(await page.locator('body').innerText(),/Gesamtabnahme|Prüfergebnis speichern/);
}
try{
 companion=spawn(process.execPath,[requested?path.join(path.dirname(executable),'resources/app/companion/server.mjs'):path.resolve('companion/server.mjs')],{env,stdio:'ignore',windowsHide:true});
 companion.once('error',error=>fixtureErrors.push('Owned Companion: '+error.message));
 await until(async()=>{try{return(await fetch(`http://127.0.0.1:${companionPort}/v1/ping`,{headers:{'x-anvil-token':'agent-flow-qa-only'},signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}},'owned Companion');
 app=await _electron.launch({executablePath:executable,args:requested?[]:[process.cwd()],env,timeout:45000});
 await app.context().route('**/*',route=>{
  const request=route.request(),url=new URL(request.url()),headers=request.headers(),target=headers['x-anvil-target'];
  // Keep the genuine native model pipe; only its local synthetic target is permitted.
  if(url.hostname==='127.0.0.1'&&url.pathname==='/pipe'&&target&&new URL(target).origin===new URL(base).origin)return route.continue();
  // The normal client asks its native lease to start the default Companion.
  // This QA process starts its own instance on the assigned free port instead.
  // Redirect before sending so the user's service on 7845 is never contacted.
  if(url.hostname==='127.0.0.1'&&url.port==='7845'){
   companionPortAdaptations.push(url.pathname);url.port=String(companionPort);
   return route.continue({url:url.href,headers:{...headers,'x-anvil-token':'agent-flow-qa-only'}});
  }
  if([`http://127.0.0.1:${port}`,`http://127.0.0.1:${companionPort}`,new URL(base).origin].includes(url.origin))return route.continue();
  return route.fulfill({status:200,contentType:'application/json',body:'{}'});
 });
 await until(()=>{page=app.windows().find(window=>window.url()===`http://127.0.0.1:${port}/`);return page;},'production window');
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
 await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1000));
 await page.evaluate(({project,files,base})=>{
  const ide=window.__anvilIde;ide.setState({setupDone:true,settingsOpen:false,autoUpdate:false,companionKeep:false,locale:'de',workspaceCwd:project,workspaceEpoch:2,
   files,dirs:[],openPaths:['adder.cjs'],activePath:'adder.cjs',dirty:{},pendingDiffs:[],backgroundAgent:true,backgroundWriteThrough:true,agentMode:'agent',agentQueue:[],agentInbox:null,
   chat:[{id:'old-checklist',role:'assistant',content:'An earlier synthetic task.',plan:[{text:'OLD_COMPLETED_CHECKLIST',status:'ok'}]}],
   autoSaveDisk:false,autoPreview:false,autoRunAgent:false,runLoop:false,graphLoop:false,testLoop:false,engineLoop:false,harnessAutoContinue:false,planWho:'agent',llmContextAuto:false,llmContext:131072,llmRetries:1,mcpServers:[]});
  const state=ide.getState();state.setLlmProvider('custom','key');state.setLlmBaseUrl(base);state.setLlmModel('synthetic-agent-flow');state.setLlmApiKey('');state.setLlmThinking('off');
 },{project,files,base});
 await page.locator('textarea').last().fill('Repariere die Addition in adder.cjs und prüfe positive sowie negative Operanden mit den vorhandenen Funktionstests.');
 await page.locator('textarea').last().press('Enter');
 await until(()=>gates.has(1),'first model request held');
 const initial=await job();jobId=initial.id;assert.ok(initial.plan.length===3);assert.equal(initial.steps.filter(step=>step.status==='ok').length,0);
 await expectVisible(['todo','todo','todo'],'initial checklist');
 await page.screenshot({path:path.join(output,'todo-before-tools.png')});
 checks.push('Agent-owned checklist is visible before the first completed tool or model plan; concrete model steps then progress from actual evidence');
 release(1);await until(()=>gates.has(2),'read completed');
 await expectVisible(['ok','todo','todo'],'read evidence');
 assert.equal((await chatPlan())[0].completedBy,'agent','actual read records who marked the step');
 release(2);await until(()=>gates.has(3),'edit completed');
 await expectVisible(['ok','ok','todo'],'edit evidence');
 assert.equal(await readFile(path.join(project,'adder.cjs'),'utf8'),'exports.add = (a, b) => a + b;\n');
 checks.push('Actual independent-worker read and saved edit update checklist statuses without fabricating a check');
 await page.reload();await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
 await until(async()=>Boolean((await chatPlan())?.length),'renderer reattached');
 const reattached=await job();assert.equal(reattached.id,jobId);assert.ok(['running','starting'].includes(reattached.status));
 await expectVisible(['ok','ok','todo'],'restored checklist');
 assert.deepEqual((await chatPlan()).slice(0,2).map(step=>step.completedBy),['agent','agent'],'known completion provenance survives a real renderer reconnect');
 await page.screenshot({path:path.join(output,'todo-after-reattach.png')});
 checks.push('Renderer reload reconnects to the same live worker task and retains its current checklist progress');
 release(3);let final;
 await until(async()=>{final=await job();return ['done','failed','stopped','interrupted'].includes(final.status);},'function test completion');
 assert.equal(final.status,'done',final.error);assert.match(final.text,/AGENT_FLOW_OK/);
 await expectVisible(['ok','ok','ok'],'functional test evidence');
 assert.equal(await readFile(counter,'utf8'),'FUNCTION_TEST_OK\n');
 assert.equal(final.steps.filter(step=>step.name==='shell'&&step.status==='ok').length,1);
 assert.equal(requests.length,4,'no extra repair or checklist loop');
 await page.screenshot({path:path.join(output,'todo-function-tests-passed.png')});
 checks.push('Real bundled Node function tests pass once, the visible checklist reaches 3/3, and no repair loop occurs');
 result.job={id:final.id,status:final.status,plan:final.plan};
 await page.evaluate(()=>window.__anvilIde.setState({backgroundAgent:false,agentJob:null,pendingAsk:null,agentInbox:null,agentQueue:[],dirty:{},pendingDiffs:[]}));
 await page.locator('textarea').last().fill('Prüfe die Addition mit node --test adder.test.cjs. Keine Änderungen; berichte das tatsächliche Testergebnis.');
 await page.locator('textarea').last().press('Enter');
 await page.waitForFunction(()=>!window.__anvilIde.getState().agentBusy&&window.__anvilIde.getState().chat.at(-1)?.content.includes('FOREGROUND_TEST_OK'));
 const foreground=await page.evaluate(()=>window.__anvilIde.getState().chat.at(-1));
 assert.ok(foreground.workflow?.verificationEvidence,'foreground chat retains its actual workflow evidence');
 const proof=JSON.parse(foreground.workflow.verificationEvidence);
 assert.equal(foreground.workflow.phase,'done');assert.equal(proof.version,1);
 assert.equal(proof.inputStamp,foreground.workflow.inputStamp);assert.ok(!proof.incompleteHistory);
 assert.deepEqual(proof.invalidCalls,[]);assert.deepEqual(proof.writes,[]);assert.ok(!proof.unconfirmedActions?.length);
 assert.equal(proof.runs.length,1);const actualTest=proof.runs[0][1];
 assert.equal(actualTest.ok,true);assert.equal(actualTest.tests,true);assert.equal(actualTest.scope,'tests');
 assert.ok(!actualTest.pending);assert.equal(actualTest.inputStamp,foreground.workflow.inputStamp);assert.equal(actualTest.revision,proof.revision);
 assert.deepEqual(foreground.plan.map(step=>step.status),['ok','ok']);
 await todo().waitFor({state:'visible'});assert.match(await todo().innerText(),/2\/2/);
 const foregroundRows=todo().locator('..').locator('ol > li');assert.equal(await foregroundRows.count(),2);
 for(let index=0;index<2;index++){assert.ok(await foregroundRows.nth(index).isVisible());assert.ok((await foregroundRows.nth(index).innerText()).includes(foreground.plan[index].text));}
 const foregroundMessage=page.locator('[data-chat-msg]').filter({hasText:'FOREGROUND_TEST_OK'}).last();await foregroundMessage.waitFor({state:'visible'});
 assert.doesNotMatch(await foregroundMessage.innerText(),/Nicht abgeschlossen|Noch nicht bestätigt/);
 assert.equal(await readFile(counter,'utf8'),'FUNCTION_TEST_OK\nFUNCTION_TEST_OK\n','exactly one real process execution per agent mode');
 assert.equal(requests.length,6,'no repair or reconciliation loop in either mode');
 await page.screenshot({path:path.join(output,'foreground-function-tests-passed.png')});
 checks.push('Foreground agent runs the same actual Node file test once and shows a completed 2/2 checklist for the confirmed snapshot');
 result.foreground={workflow:foreground.workflow,verificationEvidence:proof,plan:foreground.plan};
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(fixtureErrors,[]);result.ok=true;
}catch(error){result.ok=false;result.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 if(page&&!result.ok){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});result.body=await page.locator('body').innerText().catch(()=>'');}
 if(page&&!result.ok)await page.evaluate(()=>window.anvilNative.agentJob('stop')).catch(()=>{});
 if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
 for(const resolve of gates.values())resolve();
 if(companion){const ended=companion.exitCode!==null||companion.signalCode!==null?Promise.resolve():new Promise(resolve=>companion.once('exit',resolve));if(companion.exitCode===null&&companion.signalCode===null)companion.kill();await Promise.race([ended,new Promise(resolve=>setTimeout(resolve,5000))]);if(companion.exitCode===null&&companion.signalCode===null){fixtureErrors.push('Owned Companion did not exit');result.ok=false;process.exitCode=1;}result.companionExit={pid:companion.pid,code:companion.exitCode,signal:companion.signalCode};}
 api.closeAllConnections();await new Promise(resolve=>api.close(resolve));
 await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({ok:result.ok,checks,errors,consoleErrors,fixtureErrors,error:result.error?.message}));
}
