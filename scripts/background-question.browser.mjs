// Uses the already-built production desktop and worker. Never rebuild shared artifacts.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as socketServer} from 'node:net';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {_electron} from 'playwright';
import {verifyPackageFingerprint} from './verify-package-fingerprint.mjs';
import {verifyBuild} from './build-fingerprint.mjs';

assert.ok(existsSync(path.resolve('ui-build/server/index.mjs')),'Build the production UI before this test; this script never builds it.');
const outputFlag=process.argv.indexOf('--output');
const executableFlag=process.argv.indexOf('--executable');
const executable=executableFlag<0?undefined:path.resolve(process.argv[executableFlag+1]);
const output=path.resolve(outputFlag<0?'artifacts/background-question':process.argv[outputFlag+1]);await mkdir(output,{recursive:true});
const manifest=executable?await verifyPackageFingerprint(path.join(path.dirname(executable),'resources/app')):await verifyBuild(process.cwd(),true);
const profile=await mkdtemp(path.join(output,'profile-')),project=path.join(profile,'project');await mkdir(project);
const files={'notes.txt':'Synthetic question and queue fixture. No user data.'};await writeFile(path.join(project,'notes.txt'),files['notes.txt']);
const sock=socketServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
let releaseResume,resumeHeld=false;const requests=[],issues=[];
const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  if(!req.url.endsWith('/chat/completions')){res.writeHead(200,{'Content-Type':'application/json'}).end('{"data":[]}');return;}
  const body=JSON.parse(raw),n=requests.push(body);
  try{
    if(n===1)assert.match(JSON.stringify(body.messages),/QA_QUESTION/);
    if(n===3){assert.match(body.messages.at(-1).content,/Wahl: B\) Rot/);assert.match(JSON.stringify(body.messages),/QA_CHANGED_RULE/);resumeHeld=true;await new Promise(r=>releaseResume=r);}
    if(n===5)assert.match(body.messages.at(-1).content,/QA_QUEUE/);
    assert.ok(n<=6,"Question flow must remain bounded");
  }catch(error){issues.push(error.message);}
  res.writeHead(200,{"Content-Type":"text/event-stream"});
  const toolCall=(name,args)=>({tool_calls:[{index:0,id:"question-fixture-"+n,function:{name,arguments:JSON.stringify(args)}}]});
  const isTool=[1,2,3,5].includes(n);
  const delta=[1,3,5].includes(n)?toolCall("read_file",{path:"notes.txt"}):n===2?toolCall("ask_user",{prompt:"Welche Farbe soll die Testnotiz erhalten?",choices:[{id:"A",label:"Blau"},{id:"B",label:"Rot"}],allow_text:true,why:"Isolierte Frageprüfung."}):{content:n===4?"QA_ANSWER_OK: Rot wurde bestätigt. Die Testnotiz wurde gelesen.":"QA_QUEUE_OK: Warteschlangenauftrag beantwortet. Die Testnotiz wurde gelesen."};
  res.end(`data: ${JSON.stringify({choices:[{delta,finish_reason:isTool?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const env={...process.env,ANVIL_DESKTOP_MODE:'production',ANVIL_PORT:String(port),ANVIL_QA_USER_DATA:profile,ANVIL_HOME:path.join(profile,'packages')};delete env.ELECTRON_RUN_AS_NODE;
const until=async(check,label)=>{for(let n=0;n<300;n++){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error(`Question desktop timeout: ${label}`);};
let app,proc,page;const errors=[],consoleErrors=[];
try{
  app=await _electron.launch({...(executable?{executablePath:executable,args:[]}:{args:[path.resolve('fixtures/electron-boot.mjs')]}),env,timeout:45000});proc=app.process();
  await app.context().route('**/*',route=>{const request=route.request(),url=new URL(request.url());return [`http://127.0.0.1:${port}`,`http://127.0.0.1:${server.address().port}`].includes(url.origin)?route.continue():route.fulfill({status:200,contentType:request.resourceType()==='script'?'application/javascript':request.resourceType()==='stylesheet'?'text/css':'application/json',body:['script','stylesheet'].includes(request.resourceType())?'':'{}'});});
  const editorUrl=`http://127.0.0.1:${port}/`;
  await until(()=>{page=app.windows().find(w=>w.url()===editorUrl);return page;},'main window');
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  await app.evaluate(({BrowserWindow},url)=>{const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url);win.setSize(1500,1000);},editorUrl);
  await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
  const evaluate=source=>app.evaluate(({BrowserWindow},{source,editorUrl})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===editorUrl).webContents.executeJavaScript(source),{source,editorUrl});
  const status=async()=>(await evaluate('window.anvilNative.agentJob("status")')).state;
  await until(async()=>(await evaluate('window.anvilNative.agentJob("status")')).available,'worker available');
  await page.evaluate(({project,files,baseUrl})=>window.__anvilIde.setState({setupDone:true,autoUpdate:false,locale:'de',backgroundAgent:true,backgroundWriteThrough:false,agentMode:'agent',files,dirs:[],openPaths:[],activePath:null,dirty:{},editBases:{},pendingDiffs:[],chat:[],agentQueue:[],agentInbox:null,workspaceCwd:project,autoSaveDisk:false,llmProvider:'custom',llmAuthMode:'key',llmBaseUrl:baseUrl,llmModel:'fixture-question',llmApiKey:'',llmContext:32768,llmContextAuto:false,llmThinking:'off',llmHardStopMin:0,autoRunAgent:false,runLoop:false,graphLoop:false,testLoop:false,engineLoop:false,harnessAfterWrite:'none',harnessAutoContinue:false,planWho:'agent',agentRules:'QA_CURRENT_RULE: Preserve the selected color.'}),{project,files,baseUrl:`http://127.0.0.1:${server.address().port}/v1`});
  await page.locator('textarea').last().fill('QA_QUESTION: Lies notes.txt und frage mich nach einer Farbe. Keine Dateien ändern.');await page.locator('textarea').last().press('Enter');
  await until(async()=>(await status())?.status==='waiting-user','parked question');
  const first=await status();assert.ok(first.ask);assert.equal(first.finishedAt,undefined);assert.equal(requests.length,2);
  const pane=()=>page.getByRole('group',{name:'Rückfrage',exact:true});
  assert.equal(await page.getByRole('dialog',{name:'Auftragsdetails',exact:true}).count(),0);
  assert.equal(await page.getByRole('region',{name:'Hintergrundauftrag',exact:true}).count(),0);
  await pane().getByRole('button',{name:/Rot/}).waitFor();
  await page.evaluate(()=>window.__anvilIde.setState({agentQueue:[{text:'QA_QUEUE: Antworte kurz und ändere keine Dateien.',mode:'agent'}]}));
  await page.waitForTimeout(900); // Let profile persistence settle before the real reload.
  assert.equal((await page.evaluate(()=>window.__anvilIde.getState().agentQueue)).length,1);
  await page.reload();await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
  await pane().getByRole('button',{name:/Rot/}).waitFor();
  assert.equal((await status()).id,first.id);assert.equal(requests.length,2,'reload must not repeat the model request');
  assert.equal((await page.evaluate(()=>window.__anvilIde.getState().agentQueue)).length,1,'queued task survives reload');
  await pane().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'question-after-reload.png')});
  await page.evaluate(()=>window.__anvilIde.setState({agentRules:'QA_CHANGED_RULE: Apply the current rules when resuming.'}));
  await pane().getByRole('button',{name:/Rot/}).click();
  await until(()=>resumeHeld||issues.length,'answer reaches resumed worker');assert.deepEqual(issues,[]);
  const resumed=await status();assert.notEqual(resumed.id,first.id);assert.equal(resumed.resumedFrom,first.id);assert.equal(resumed.status,'running');
  assert.equal((await page.evaluate(()=>window.__anvilIde.getState().agentQueue)).length,1,'answering does not consume queued task');
  releaseResume();releaseResume=undefined;
  await until(async()=>page.getByText(/QA_ANSWER_OK: Rot wurde bestätigt\./).last().isVisible(),'answer displayed');
  await until(async()=>{const s=await status();return s?.id!==resumed.id&&s?.status==='done';},'queued task starts automatically after answer completion');
  assert.equal((await page.evaluate(()=>window.__anvilIde.getState().agentQueue)).length,0);assert.equal(requests.length,6);
  await until(async()=>page.getByText(/QA_QUEUE_OK: Warteschlangenauftrag beantwortet\./).last().isVisible(),'queued result displayed');
  await page.screenshot({path:path.join(output,'question-and-queue-complete.png')});
  assert.deepEqual(issues,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
  await writeFile(path.join(output,'result.json'),JSON.stringify({ok:true,profile,source:manifest.source,outputFingerprint:manifest.outputFingerprint,realModelInference:false,errors,consoleErrors,fixtureErrors:issues,requests:requests.length,checks:['real production desktop question appears inline without a details dialog','renderer reload retains pending question without new model call','choice button resumes via real IPC and host','current project rules reach resumed model','queue survives reload and waits for the actual answer','completion releases exactly one queued task without Finish or confirmation','no renderer errors']},null,2));
  console.log('BACKGROUND_QUESTION_RELOAD_ANSWER_QUEUE_OK');
}catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),requests:requests.length,issues,errors},null,2));throw error;}
finally{releaseResume?.();if(app){const deadline=setTimeout(()=>proc?.kill(),8000);try{await app.close();}catch{ /* The app may already be closed; the deadline handles a hung process. */ }clearTimeout(deadline);}server.closeAllConnections();await new Promise(r=>server.close(r));}
