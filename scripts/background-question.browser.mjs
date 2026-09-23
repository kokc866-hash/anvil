// Uses the already-built production desktop and worker. Never rebuild shared artifacts.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as socketServer} from 'node:net';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {_electron} from 'playwright';

assert.ok(existsSync(path.resolve('ui-build/server/index.mjs')),'Build the production UI before this test; this script never builds it.');
const output=path.resolve('artifacts/background-question');await mkdir(output,{recursive:true});
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
    if(n===2){assert.match(body.messages.at(-1).content,/Wahl: B\) Rot/);assert.match(JSON.stringify(body.messages),/QA_CHANGED_RULE/);resumeHeld=true;await new Promise(r=>releaseResume=r);}
    if(n>=3)assert.match(body.messages.at(-1).content,/QA_QUEUE/);
  }catch(error){issues.push(error.message);}
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const delta=n===1?{tool_calls:[{index:0,id:'question-fixture',function:{name:'ask_user',arguments:JSON.stringify({prompt:'Welche Farbe soll die Testnotiz erhalten?',choices:[{id:'A',label:'Blau'},{id:'B',label:'Rot'}],allow_text:true,why:'Isolierte Frageprüfung.'})}}]}:{content:n===2?'QA_ANSWER_OK: Rot wurde bestätigt.':'QA_QUEUE_OK: Warteschlangenauftrag beantwortet.'};
  res.end(`data: ${JSON.stringify({choices:[{delta,finish_reason:n===1?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const env={...process.env,ANVIL_DESKTOP_MODE:'production',ANVIL_PORT:String(port),ANVIL_QA_USER_DATA:profile,ANVIL_HOME:path.join(profile,'packages'),ANVIL_WATCHDOG:'0'};delete env.ELECTRON_RUN_AS_NODE;
const until=async(check,label)=>{for(let n=0;n<300;n++){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error(`Question desktop timeout: ${label}`);};
let app,proc,page;const errors=[];
try{
  app=await _electron.launch({args:[path.resolve('fixtures/electron-boot.mjs')],env,timeout:45000});proc=app.process();
  const editorUrl=`http://127.0.0.1:${port}/`;
  await until(()=>{page=app.windows().find(w=>w.url()===editorUrl);return page;},'main window');
  page.on('pageerror',error=>errors.push(error.message));
  await app.evaluate(({BrowserWindow},url)=>{const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url);win.setSize(1500,1000);},editorUrl);
  await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
  const evaluate=source=>app.evaluate(({BrowserWindow},{source,editorUrl})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===editorUrl).webContents.executeJavaScript(source),{source,editorUrl});
  const status=async()=>(await evaluate('window.anvilNative.agentJob("status")')).state;
  await until(async()=>(await evaluate('window.anvilNative.agentJob("status")')).available,'worker available');
  await page.evaluate(({project,files,baseUrl})=>window.__anvilIde.setState({setupDone:true,autoUpdate:false,locale:'de',backgroundAgent:true,backgroundWriteThrough:false,agentMode:'agent',files,dirty:{},editBases:{},pendingDiffs:[],chat:[],agentQueue:[],agentInbox:null,workspaceCwd:project,autoSaveDisk:false,llmProvider:'custom',llmAuthMode:'key',llmBaseUrl:baseUrl,llmModel:'fixture-question',llmApiKey:'',llmContext:32768,llmContextAuto:false,llmThinking:'off',llmHardStopMin:0,autoRunAgent:false,runLoop:false,graphLoop:false,testLoop:false,engineLoop:false,harnessAfterWrite:'none',harnessAutoContinue:false,planWho:'agent',agentRules:'QA_CURRENT_RULE: Preserve the selected color.'}),{project,files,baseUrl:`http://127.0.0.1:${server.address().port}/v1`});
  await page.locator('textarea').last().fill('QA_QUESTION: Frage mich nach einer Farbe. Keine Dateien ändern.');await page.locator('textarea').last().press('Enter');
  await until(async()=>(await status())?.status==='waiting-user','parked question');
  const first=await status();assert.ok(first.ask);assert.equal(first.finishedAt,undefined);assert.equal(requests.length,1);
  const pane=()=>page.locator('section[aria-label="Hintergrundauftrag"]');
  await pane().getByRole('button',{name:'Rot',exact:true}).waitFor();
  await page.evaluate(()=>window.__anvilIde.setState({agentQueue:[{text:'QA_QUEUE: Antworte kurz und ändere keine Dateien.',mode:'agent'}]}));
  await page.waitForTimeout(900); // Let profile persistence settle before the real reload.
  assert.equal((await page.evaluate(()=>window.__anvilIde.getState().agentQueue)).length,1);
  await page.reload();await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
  await pane().getByRole('button',{name:'Rot',exact:true}).waitFor();
  assert.equal((await status()).id,first.id);assert.equal(requests.length,1,'reload must not repeat the model request');
  assert.equal((await page.evaluate(()=>window.__anvilIde.getState().agentQueue)).length,1,'queued task survives reload');
  await pane().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'question-after-reload.png')});
  await page.evaluate(()=>window.__anvilIde.setState({agentRules:'QA_CHANGED_RULE: Apply the current rules when resuming.'}));
  await pane().getByRole('button',{name:'Rot',exact:true}).click();
  await until(()=>resumeHeld||issues.length,'answer reaches resumed worker');assert.deepEqual(issues,[]);
  const resumed=await status();assert.notEqual(resumed.id,first.id);assert.equal(resumed.resumedFrom,first.id);assert.equal(resumed.status,'running');
  assert.equal((await page.evaluate(()=>window.__anvilIde.getState().agentQueue)).length,1,'answering does not consume queued task');
  releaseResume();releaseResume=undefined;
  await until(async()=>(await status())?.status==='done','resumed answer done');
  await until(async()=>page.getByText(/QA_ANSWER_OK: Rot wurde bestätigt\./).last().isVisible(),'answer displayed');
  await page.waitForTimeout(650);
  assert.equal(requests.length,2,'queue still waits for explicit Finish');assert.equal((await page.evaluate(()=>window.__anvilIde.getState().agentQueue)).length,1);
  await pane().getByRole('button',{name:'Abschließen',exact:true}).click();
  await until(async()=>{const s=await status();return s?.id!==resumed.id&&s?.status==='done';},'queued task started after Finish');
  assert.equal((await page.evaluate(()=>window.__anvilIde.getState().agentQueue)).length,0);assert.equal(requests.length,3);
  await until(async()=>page.getByText(/QA_QUEUE_OK: Warteschlangenauftrag beantwortet\./).last().isVisible(),'queued result displayed');
  await page.screenshot({path:path.join(output,'question-and-queue-complete.png')});
  assert.deepEqual(issues,[]);assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'result.json'),JSON.stringify({ok:true,profile,requests:requests.length,checks:['real production desktop question appears','renderer reload retains pending question without new model call','choice button resumes via real IPC and host','current project rules reach resumed model','queue survives reload and waits through answer and done','Finish releases exactly one queued task','no renderer errors']},null,2));
  console.log('BACKGROUND_QUESTION_RELOAD_ANSWER_QUEUE_OK');
}catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),requests:requests.length,issues,errors},null,2));throw error;}
finally{releaseResume?.();if(app){const deadline=setTimeout(()=>proc?.kill(),8000);try{await app.close();}catch{}clearTimeout(deadline);}server.closeAllConnections();await new Promise(r=>server.close(r));}
