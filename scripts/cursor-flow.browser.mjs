import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as socketServer} from 'node:net';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {_electron} from 'playwright';
import {verifyBuild} from './build-fingerprint.mjs';
import {verifyPackageFingerprint} from './verify-package-fingerprint.mjs';
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const requested=arg('--executable'),executable=path.resolve(requested||'node_modules/electron/dist/electron.exe');
const output=path.resolve(arg('--output')||'artifacts/cursor-adoption-2026-10-19/desktop-flow');await mkdir(output,{recursive:true});
const manifest=requested?await verifyPackageFingerprint(path.join(path.dirname(executable),'resources/app')):await verifyBuild(process.cwd(),true);
const profile=await mkdtemp(path.join(output,'profile-')),project=path.join(profile,'project');await mkdir(project);
const files={'notes.txt':'Artificial note stays unchanged.\n','AGENTS.md':'ROOT_RULE_MARKER: preserve unrelated files.\n',
 '.cursor/rules/front.mdc':'---\ndescription: Rules for frontend files.\nglobs: src/ui/**\n---\nFRONT_RULE_BODY_MARKER: use const declarations.\n',
 '.cursor/rules/back.mdc':'---\ndescription: Rules for backend files.\nglobs: src/server/**\n---\nBACK_RULE_BODY_MUST_NOT_APPEAR\n',
 'src/ui/original.ts':'export const existing = 1;\n'};
for(const[p,body]of Object.entries(files)){const target=path.join(project,p);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,body);}
const freePort=async()=>{const s=socketServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;};
const port=await freePort(),companionPort=await freePort();
let scenario='plan',holdRelease,app,page;const payloads=[],checks=[],errors=[],consoleErrors=[],consoleLocations=[],networkFailures=[],fixtureErrors=[],rejections=[];
const until=async(predicate,label)=>{for(let i=0;i<450;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw Error('Cursor adoption UI timed out: '+label);};
const api=createServer(async(req,res)=>{
 try{
  if(req.url==='/v1/models'){res.writeHead(200,{'content-type':'application/json'}).end('{"data":[{"id":"synthetic-cursor-flow"}]}');return;}
  assert.equal(req.url,'/v1/chat/completions');let raw='';for await(const chunk of req)raw+=chunk;const payload=JSON.parse(raw),stage=payloads.filter(p=>p.scenario===scenario).length+1;
  payloads.push({scenario,stage,payload});const wire=JSON.stringify(payload.messages);assert.ok(stage<=9,'Unbounded reconciliation');
  let call,content;
  if(scenario==='plan'){
   for(const tool of payload.tools||[])assert.doesNotMatch(tool.function.name,/^(?:write|append|edit|delete|rename|mkdir|mcp_call|run_file|shell|git_commit|engine_run)/);
   content='PLAN_V1: Read the artificial note, create result.txt, and inspect its exact content. Do not change unrelated files.';
  }else if(scenario==='execute'){
   assert.match(wire,/ONLY_VERSION_TWO/);assert.doesNotMatch(wire,/ONLY_VERSION_THREE/);
   if(stage===1)call={name:'write_file',args:{path:'result.txt',content:'ONLY_VERSION_TWO\n'}};
   else content='PLAN_EXECUTION_DONE: result.txt contains the selected version. No executable functionality was tested.';
  }else if(scenario==='rules'){
   assert.ok(!wire.includes('BACK_RULE_BODY_MUST_NOT_APPEAR'));
   if(stage===1){assert.ok(!wire.includes('FRONT_RULE_BODY_MARKER'));call={name:'write_file',args:{path:'src/ui/new.ts',content:'export const scoped = 1;\n'}};}
   else if(stage===2){assert.match(wire,/FRONT_RULE_BODY_MARKER/);assert.match(wire,/not executed/);call={name:'write_file',args:{path:'src/ui/new.ts',content:'export const scoped = 2;\n'}};}
   else content='SCOPED_RULES_DONE: created only the scoped fixture file. No functional check was performed.';
  }else{
   if(stage===1){await new Promise(resolve=>{holdRelease=resolve;res.once('close',resolve);});if(res.destroyed)return;call={name:'edit_file',args:{path:'notes.txt',old_string:'Artificial note stays unchanged.',new_string:'OBSOLETE_WRITE_MUST_NOT_HAPPEN'}};}
   else {assert.match(wire,/Keine Dateien ändern/);content='STEERING_DONE: the note is preserved; only its current contents were described.';}
  }
  if(call)assert.ok(payload.tools.some(t=>t.function.name===call.name),call.name+' offered');
  const delta=call?{tool_calls:[{id:`${scenario}-${stage}`,index:0,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]}:{content};
  res.writeHead(200,{'content-type':'text/event-stream'}).end(`data: ${JSON.stringify({choices:[{delta,finish_reason:call?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
 }catch(error){fixtureErrors.push(error.message);if(!res.headersSent)res.writeHead(500);res.end('Synthetic fixture error');}
});await new Promise(r=>api.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${api.address().port}/v1`;
const env={...process.env,ANVIL_DESKTOP_MODE:'production',ANVIL_PORT:String(port),ANVIL_COMPANION_PORT:String(companionPort),ANVIL_COMPANION_TOKEN:'cursor-flow-only',ANVIL_COMPANION_TOKEN_FILE:path.join(profile,'companion-token'),ANVIL_QA_USER_DATA:profile,ANVIL_USER_DATA:profile,ANVIL_HOME:path.join(profile,'packages')};delete env.ELECTRON_RUN_AS_NODE;
const result={ok:false,realModelInference:false,profile,project,source:manifest.source,outputFingerprint:manifest.outputFingerprint,checks,errors,consoleErrors,consoleLocations,networkFailures,fixtureErrors,rejections};
try{
 app=await _electron.launch({executablePath:executable,args:requested?[]:[process.cwd()],env,timeout:45000});
 result.launcherPid=app.process().pid;result.pid=await app.evaluate(()=>process.pid);result.uiPort=port;result.companionPort=companionPort;
 await app.context().addInitScript(()=>{window.__cursorQaRejections=[];window.addEventListener('unhandledrejection',event=>window.__cursorQaRejections.push(String(event.reason?.stack||event.reason)));});
 await app.context().route('**/*',route=>{const url=new URL(route.request().url()),headers=route.request().headers();
  const target=headers['x-anvil-target'];
  if(url.hostname==='127.0.0.1'&&url.pathname==='/pipe'&&target&&new URL(target).origin===new URL(base).origin)return route.continue();
  if(url.hostname==='127.0.0.1'&&url.port==='7845'){url.port=String(companionPort);return route.continue({url:url.href,headers:{...headers,'x-anvil-token':'cursor-flow-only'}});}
  if(url.origin===`http://127.0.0.1:${companionPort}`)return route.continue({headers:{...headers,'x-anvil-token':'cursor-flow-only'}});
  if([`http://127.0.0.1:${port}`,`http://127.0.0.1:${companionPort}`,new URL(base).origin].includes(url.origin))return route.continue();
  return route.fulfill({status:200,contentType:'application/json',body:'{}'});
 });
 await until(()=>{page=app.windows().find(w=>w.url()===`http://127.0.0.1:${port}/`);return page;},'production UI');
 page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error'){consoleErrors.push(message.text());consoleLocations.push({text:message.text(),location:message.location()});}});page.on('requestfailed',request=>networkFailures.push({url:request.url(),error:request.failure()?.errorText}));
 await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1000));
 await page.evaluate(()=>{localStorage.setItem('anvil-learn',JSON.stringify({state:{on:false,prefs:{skills:false,skillBodies:false,skillAuto:false},skills:[]},version:0}));localStorage.setItem('anvil-brain',JSON.stringify({state:{on:false,autoLoad:false},version:0}));});
 await page.reload();await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
 assert.equal(await page.evaluate(async()=>Boolean((await window.anvilNative.companionEnsure()).ok)),true,'QA Companion is running before any workspace request');
 assert.equal(await page.evaluate(async({project,companionPort})=>(await(await fetch(`http://127.0.0.1:${companionPort}/v1/workspace`,{method:'POST',headers:{'content-type':'application/json','x-anvil-token':'cursor-flow-only'},body:JSON.stringify({cwd:project})})).json()).ok,{project,companionPort}),true,'QA Companion is bound to the artificial workspace');
 await page.evaluate(({project,files,base,companionPort})=>{const ide=window.__anvilIde;ide.setState({setupDone:true,settingsOpen:false,autoUpdate:false,locale:'de',workspaceCwd:project,workspaceEpoch:2,workspaceMemoryId:'cursor-flow-fixture',companionUrl:`http://127.0.0.1:${companionPort}`,
  files,dirs:['src','src/ui','.cursor','.cursor/rules'],openPaths:['notes.txt'],activePath:'notes.txt',recentPaths:[],dirty:{},pendingDiffs:[],backgroundAgent:false,backgroundWriteThrough:true,agentMode:'agent',agentQueue:[],agentInbox:null,chat:[],
  autoSaveDisk:false,autoAcceptDiffs:true,suggestOn:false,liveRun:false,helperOn:false,autoPreview:false,autoRunAgent:false,runLoop:false,graphLoop:false,testLoop:false,engineLoop:false,harnessAutoContinue:false,harnessMaxRounds:8,planWho:'agent',llmContextAuto:false,llmContext:131072,llmRetries:1,mcpServers:[],activeSurfaceId:'anvil',surfaceMode:'bridge'});
  const s=ide.getState();s.setLlmProvider('custom','key');s.setLlmBaseUrl(base);s.setLlmModel('synthetic-cursor-flow');s.setLlmApiKey('');s.setLlmThinking('off');
 },{project,files,base,companionPort});
 await until(()=>page.evaluate(()=>{const files=window.__anvilIde.getState().files;if(window.__qaFiles!==files){window.__qaFiles=files;window.__qaAt=Date.now();return false;}return Date.now()-window.__qaAt>700;}),'editor settled');
 const input=()=>page.locator('#anvil-chat');
 await page.getByRole('button',{name:'Planen',exact:true}).click();await input().fill('Plan a small artificial note improvement.');await input().press('Enter');
 await until(async()=>await page.evaluate(()=>!window.__anvilIde.getState().agentBusy)&&await page.getByTestId('task-plan').isVisible(),'plan created');
 const plan=page.getByTestId('task-plan');await plan.locator('summary').click();assert.match(await plan.innerText(),/PLAN_V1/);
 assert.equal(await page.evaluate(()=>window.__anvilIde.getState().files['result.txt']),undefined,'planning must not write');
 await plan.getByRole('button',{name:'Bearbeiten',exact:true}).click();await plan.getByRole('textbox',{name:'Plan bearbeiten'}).fill('ONLY_VERSION_TWO: Create result.txt with exactly ONLY_VERSION_TWO and keep other files.');await plan.getByRole('button',{name:'Plan speichern',exact:true}).click();
 await page.evaluate(()=>window.__anvilIde.setState({agentBusy:true}));await plan.getByRole('button',{name:'Version 2 umsetzen',exact:true}).click();
 await plan.getByRole('button',{name:'Bearbeiten',exact:true}).click();await plan.getByRole('textbox',{name:'Plan bearbeiten'}).fill('ONLY_VERSION_THREE: This must not change the already queued implementation.');await plan.getByRole('button',{name:'Plan speichern',exact:true}).click();
 scenario='execute';await page.evaluate(()=>window.__anvilIde.setState({agentBusy:false}));
 await until(()=>page.evaluate(()=>!window.__anvilIde.getState().agentBusy&&window.__anvilIde.getState().files['result.txt']==='ONLY_VERSION_TWO\n'),'frozen plan version executed');
 assert.equal(await page.getByRole('dialog').count(),0);await page.screenshot({path:path.join(output,'plan-version.png')});checks.push('Optional read-only plan; edit/version selection; queued V2 remains immutable after V3; explicit implementation without confirmation');
 await page.getByRole('button',{name:'Planen',exact:true}).locator('..').getByRole('button',{name:'Agent',exact:true}).click();scenario='rules';
 await page.evaluate(()=>{window.__anvilIde.setState({activePath:'notes.txt',openPaths:['notes.txt'],recentPaths:[],chat:[],agentJob:null,agentInbox:null,agentQueue:[],dirty:{},pendingDiffs:[]});});
 await input().fill('Create src/ui/new.ts with a const export; keep unrelated files unchanged.');await input().press('Enter');
 await until(()=>page.evaluate(()=>!window.__anvilIde.getState().agentBusy&&window.__anvilIde.getState().files['src/ui/new.ts']==='export const scoped = 2;\n'),'scoped rules before write');checks.push('New write target receives applicable MDC rule before first write; sibling rule body omitted');
 // The foreground assertions concern editor changes. Save these artificial
 // fixture bytes before the separate native write-through/background scenario.
 const preparedFiles=await page.evaluate(()=>window.__anvilIde.getState().files);
 for(const[p,body]of Object.entries(preparedFiles)){const target=path.resolve(project,p);assert.ok(target.startsWith(project+path.sep));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,body);}
 for(const background of [false,true]){
  scenario=background?'steer-background':'steer-foreground';holdRelease=undefined;
  await page.evaluate(background=>window.__anvilIde.setState({backgroundAgent:background,chat:[],agentBusy:false,agentJob:null,agentInbox:null,agentQueue:[],dirty:{},pendingDiffs:[],activePath:'notes.txt',openPaths:['notes.txt'],recentPaths:[]}),background);
  if(background)await until(()=>page.evaluate(()=>Boolean(window.anvilNative?.agentJob)),'background bridge');
  await input().fill('Update notes.txt with a better artificial sentence.');await input().press('Enter');await until(()=>Boolean(holdRelease),'held '+scenario);
  await page.getByLabel('Nachricht',{exact:true}).selectOption('steer');await input().fill('Keine Dateien ändern. Nur den vorhandenen Inhalt erklären.');await input().press('Enter');
  await until(()=>input().inputValue().then(v=>!v),'correction accepted');holdRelease();holdRelease=undefined;
  await until(()=>page.evaluate(()=>{const s=window.__anvilIde.getState();return !s.agentBusy&&s.chat.some(m=>m.role==='assistant'&&m.content.includes('STEERING_DONE'));}),'steering delivered '+scenario);
  const state=await page.evaluate(()=>{const s=window.__anvilIde.getState();return {note:s.files['notes.txt'],queue:s.agentQueue,chat:s.chat};});
  assert.equal(state.note,files['notes.txt']);assert.equal(state.queue.length,0);assert.ok(state.chat.some(m=>m.role==='user'&&m.content.includes('Korrektur:')));assert.equal(await readFile(path.join(project,'notes.txt'),'utf8'),files['notes.txt']);
  assert.equal(await page.getByRole('dialog').count(),0);await page.screenshot({path:path.join(output,`${scenario}.png`)});checks.push(`${scenario}: user correction delivered through UI once, obsolete write skipped, queue stays empty, no dialog`);
 }
 rejections.push(...await page.evaluate(()=>window.__cursorQaRejections||[]));assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(fixtureErrors,[]);assert.deepEqual(rejections,[]);result.ok=true;
}catch(error){result.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 holdRelease?.();if(page&&!result.ok){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});result.body=await page.locator('body').innerText().catch(()=>'');}
 await writeFile(path.join(output,'requests.json'),JSON.stringify(payloads,null,2));await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));
 // These are disposable artificial files, not a user profile. A forced QA exit
 // avoids invoking the ordinary unsaved-file dialog during test cleanup.
 if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});api.closeAllConnections();await new Promise(r=>api.close(r));console.log(JSON.stringify(result));
}
