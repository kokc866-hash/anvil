import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as socketServer} from 'node:net';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {_electron} from 'playwright';
import {verifyPackageFingerprint} from './verify-package-fingerprint.mjs';
import {verifyBuild} from './build-fingerprint.mjs';

// Synthetic model choices exercise the real packaged worker, compiler process,
// preview, keyboard events, persistence and renderer. This is not model inference.
const argument=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const requested=argument('--executable')||process.env.ANVIL_QA_EXECUTABLE;
const executable=path.resolve(requested||'node_modules/electron/dist/electron.exe');
const output=path.resolve(argument('--output')||process.env.ANVIL_QA_OUTPUT||'artifacts/agent-behavior-desktop');
const manifest=requested?await verifyPackageFingerprint(path.join(path.dirname(executable),'resources/app')):await verifyBuild(process.cwd(),true);
await mkdir(output,{recursive:true});
const profile=await mkdtemp(path.join(output,'profile-'));
const negativeProject=path.join(profile,'negative-project'),canvasProject=path.join(profile,'canvas-project');
await mkdir(negativeProject);await mkdir(canvasProject);
const processCounter=path.join(profile,'actual-process-starts.log');
const negativeSource=`import('node:fs').then(({appendFileSync})=>{appendFileSync(${JSON.stringify(processCounter)},${JSON.stringify('NEGATIVE_PROCESS_STARTED\n')});console.error('EXPECTED_NEGATIVE_CASE');process.exit(7);});\n`;
const oldCondition='event.code === "KeyJ" || event.key === "j"';
const newCondition='event.code === "Space" || event.key === " "';
const canvasSource=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Keyboard function fixture</title>
<style>body{margin:30px;background:#17212b;color:#f3f5f7;font:22px sans-serif}canvas{display:block;margin:20px 0;border:2px solid #8bb8cc}output{font-size:28px}</style>
<h1>Keyboard function fixture</h1><p>Verify only the Space interaction.</p><canvas id="game" width="640" height="280"></canvas><output id="state">WAITING_FOR_SPACE</output>
<script src="game.js"></script></html>`;
const gameSource=`const canvas=document.getElementById('game'),ctx=canvas.getContext('2d'),status=document.getElementById('state');
function draw(jump){ctx.fillStyle='#0a1623';ctx.fillRect(0,0,640,280);ctx.fillStyle=jump?'#7cf2b0':'#9bb9ca';ctx.fillRect(80,jump?70:190,55,55);ctx.fillStyle='#f3f5f7';ctx.font='22px sans-serif';ctx.fillText(jump?'Jump input observed':'Waiting for the requested input',170,140);}
draw(false);window.addEventListener('keydown',event=>{if(${oldCondition}){event.preventDefault();status.textContent='JUMP_CONFIRMED';draw(true);}});`;
await writeFile(path.join(negativeProject,'negative.js'),negativeSource);
await writeFile(path.join(canvasProject,'index.html'),canvasSource);
await writeFile(path.join(canvasProject,'game.js'),gameSource);
const freePort=async()=>{const server=socketServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;};
const port=await freePort(),companionPort=await freePort();
const checks=[],errors=[],consoleErrors=[],fixtureErrors=[],requests=[];
const previewBases=new Set(),previewResources=[];
let scenario='negative',negativeTurns=0,canvasTurns=0,repairTemptations=0,interactionNudges=0,checklistNudges=0,app,page;
const text=value=>typeof value==='string'?value:Array.isArray(value)?value.filter(part=>part?.type==='text').map(part=>part.text).join('\n'):'';
const planEvidenceId=value=>{
 const content=text(value);let id;
 try{id=JSON.parse(content).plan_evidence_id;}catch{ /* Text results carry their evidence ID in a prefix. */ }
 id??=content.match(/Plan evidence ID:\s*(e\d+)\b/)?.[1];
 assert.match(id||'',/^e\d+$/,'The actual tool result supplies the checklist evidence ID');return id;
};
const toolResult=(messages,name)=>{
 const calls=new Map(messages.flatMap(message=>(message.tool_calls||[]).map(call=>[call.id,call.function?.name])));
 return messages.filter(message=>message.role==='tool'&&calls.get(message.tool_call_id)===name).at(-1);
};
const api=createServer(async(req,res)=>{
 try{
  if(req.url==='/v1/models'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'synthetic-behavior-vision'}]}));return;}
  assert.equal(req.url,'/v1/chat/completions');
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),turn=scenario==='negative'?++negativeTurns:++canvasTurns;
  const last=body.messages.at(-1),lastUser=body.messages.filter(message=>message.role==='user').at(-1);
  const record={scenario,turn,lastRole:last?.role,lastContent:text(last?.content).slice(0,1800)};requests.push(record);
  if(scenario==='negative')assert.ok(!body.messages.some(message=>message.tool_calls?.some(call=>call.function?.name==='set_plan')),'Negative observation must not need checklist continuation');
  let call,content;
  if(scenario==='negative'){
   assert.ok(turn<=3,'Negative case entered an unexpected continuation loop');
   if(turn===1)call={name:'run_file',arguments:JSON.stringify({path:'negative.js'})};
   else if(/Aktueller Nachweis:|Patch and run|Behebe die belegte|Error\. Patch|Prüfe die belegte Ursache/i.test(text(lastUser?.content))){
    repairTemptations++;
    call={name:'edit_file',arguments:JSON.stringify({path:'negative.js',old_string:'process.exit(7)',new_string:'process.exit(0)'})};
   }else{
    assert.match(text(toolResult(body.messages,'run_file')?.content),/EXPECTED_NEGATIVE_CASE/);
    assert.match(text(toolResult(body.messages,'run_file')?.content),/Exit(?: code|code):?\s*7/i);
    content='NEGATIVE_OBSERVED_7: The requested deliberate failure exited with code 7. I observed its error and left the source unchanged.';
   }
  }else{
   assert.ok(turn<=8,'Canvas case entered an unexpected repair or checklist loop');
   if(turn===1)call={name:'read_file',arguments:JSON.stringify({path:'game.js'})};
   else if(turn===2)call={name:'edit_file',arguments:JSON.stringify({path:'game.js',old_string:oldCondition,new_string:newCondition})};
   else if(turn===3)call={name:'run_file',arguments:JSON.stringify({path:'index.html'})};
   else if(turn===4){
    assert.match(text(toolResult(body.messages,'run_file')?.content),/WAITING_FOR_SPACE/);
    content='CANVAS_EARLY_RENDER_ONLY: The changed HTML loaded without a reported error. I am finished.';
   }else if(turn===5){
    assert.match(text(lastUser?.content),/gezielte Funktionsprüfung|geänderte Verhalten.*passenden Eingaben|keyboard|interaction/i,'Agent requests the missing interaction after the early final answer');
    interactionNudges++;
    call={name:'play',arguments:JSON.stringify({keys:['space'],hold_ms:80})};
   }else if(turn===6){
    const observed=text(toolResult(body.messages,'play')?.content);
    assert.match(observed,/JUMP_CONFIRMED/,'The actual post-key tool observation must contain the changed DOM output');
    content='CANVAS_INPUT_VERIFIED: Space produced JUMP_CONFIRMED in the observed preview. Only this keyboard interaction was checked; other controls and the full game were not tested.';
   }else if(turn===7){
    assert.match(text(lastUser?.content),/sichtbare To-do-Liste abgleichen|reconcile the visible checklist/i,'Anvil requests one bounded reconciliation instead of rerunning completed work');
    checklistNudges++;
    call={name:'set_plan',arguments:JSON.stringify({updates:[{step:3,kind:'check',status:'ok',evidence:[planEvidenceId(toolResult(body.messages,'play')?.content)],reason:'Space produced JUMP_CONFIRMED in the actual observed preview. Only this keyboard interaction was checked; other controls and the full game were not tested.'}]})};
   }else{
    const reconciled=JSON.parse(text(toolResult(body.messages,'set_plan')?.content));
    assert.equal(reconciled.ok,true,'The real checklist tool must accept the actual interaction evidence');
    content='CANVAS_INPUT_VERIFIED: Space produced JUMP_CONFIRMED in the observed preview. Only this keyboard interaction was checked; other controls and the full game were not tested.';
   }
  }
  if(call){
   assert.ok(body.tools?.some(tool=>tool.function?.name===call.name),`Required tool ${call.name} must be offered for this real worker turn`);
   record.responseTool=call.name;
  }else record.responseMarker=content.split(':')[0];
  const delta=call?{tool_calls:[{index:0,id:`behavior-${scenario}-${turn}`,type:'function',function:call}]}:{content};
  res.writeHead(200,{'content-type':'text/event-stream'}).end(`data: ${JSON.stringify({choices:[{delta,finish_reason:call?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
 }catch(error){fixtureErrors.push(error.message);if(!res.headersSent)res.writeHead(500);res.end('Synthetic behavior fixture assertion failed.');}
});
await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${api.address().port}/v1`;
const env={...process.env,ANVIL_DESKTOP_MODE:'production',ANVIL_PORT:String(port),ANVIL_COMPANION_PORT:String(companionPort),
 ANVIL_COMPANION_TOKEN:'behavior-qa-only',ANVIL_COMPANION_TOKEN_FILE:path.join(profile,'companion-token'),ANVIL_QA_USER_DATA:profile,ANVIL_USER_DATA:profile,ANVIL_HOME:path.join(profile,'packages')};
delete env.ELECTRON_RUN_AS_NODE;
const result={realModelInference:false,syntheticModelBehavior:'Early final answer after clean HTML load; a negative-case source repair is attempted only if Anvil itself asks for one.',profile,negativeProject,canvasProject,source:manifest.source,outputFingerprint:manifest.outputFingerprint,checks,errors,consoleErrors,fixtureErrors,requests,previewResources};
const until=async(predicate,label)=>{for(let n=0;n<750;n++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Agent behavior QA timed out: '+label);};
const job=async()=>(await page.evaluate(()=>window.anvilNative.agentJob('status'))).state;
async function displayedReply(marker){
 const message=page.locator('[data-chat-msg]').filter({hasText:marker}).last();
 await message.waitFor({state:'visible'});return message.innerText();
}
async function configure(project,files,epoch,autoRunAgent=false){
 await page.evaluate(({project,files,base,epoch,autoRunAgent})=>{
  const ide=window.__anvilIde;ide.setState({setupDone:true,settingsOpen:false,autoUpdate:false,companionKeep:false,locale:'de',workspaceCwd:project,workspaceEpoch:epoch,
   files,dirs:[],openPaths:Object.keys(files),activePath:Object.keys(files)[0],dirty:{},pendingDiffs:[],backgroundAgent:true,backgroundWriteThrough:true,agentMode:'agent',agentQueue:[],agentInbox:null,agentJob:null,agentBusy:false,
   chat:[],autoSaveDisk:false,autoPreview:false,autoRunAgent,runLoop:false,graphLoop:false,testLoop:false,engineLoop:false,harnessAfterWrite:'none',harnessAutoContinue:false,harnessMaxRounds:16,planWho:'agent',llmContextAuto:false,llmContext:131072,llmRetries:1,llmCompact:'off',llmMaxOut:2048,llmHardStopMin:2,mcpServers:[]});
  const state=ide.getState();state.setLlmProvider('custom','key');state.setLlmBaseUrl(base);state.setLlmModel('synthetic-behavior-vision');state.setLlmApiKey('');state.setLlmThinking('off');
 },{project,files,base,epoch,autoRunAgent});
}
async function submit(prompt,previousId){
 await page.locator('textarea').last().fill(prompt);await page.locator('textarea').last().press('Enter');
 let final;
 await until(async()=>{final=await job();return final?.id!==previousId&&['done','failed','stopped','interrupted'].includes(final?.status);},scenario+' completed');
 await page.waitForFunction(()=>!window.__anvilIde.getState().agentBusy);
 return final;
}
const watch=window=>{window.on('pageerror',error=>errors.push(error.message));window.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});};
try{
 app=await _electron.launch({executablePath:executable,args:requested?[]:[process.cwd()],env,timeout:45000});
 app.on('window',watch);
 await app.context().route('**/*',route=>{
  const url=new URL(route.request().url());
  // The real native preview serves all project resources below its fresh
  // token, not only index.html. Replacing game.js with metadata JSON would
  // silently remove the behavior this test is meant to verify.
  if(url.hostname==='127.0.0.1'&&/^\/[a-f\d-]{36}\/index\.html$/i.test(url.pathname))previewBases.add(new URL('.',url).href);
  if([...previewBases].some(prefix=>url.href.startsWith(prefix))){previewResources.push(url.pathname);return route.continue();}
  if([`http://127.0.0.1:${port}`,`http://127.0.0.1:${companionPort}`,new URL(base).origin].includes(url.origin)||['data:','blob:'].includes(url.protocol))return route.continue();
  return route.fulfill({status:200,contentType:'application/json',body:'{}'});
 });
 await until(()=>{page=app.windows().find(window=>window.url()===`http://127.0.0.1:${port}/`);return page;},'production window');
 watch(page);await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1000));
 await configure(negativeProject,{'negative.js':negativeSource},2);
 const negative=await submit('Run negative.js once as a deliberate test failure. Exit 7 is intentional. Do not make changes or repair the program. Report the actual exit and error.');
 assert.equal(negative.status,'done',negative.error);
 assert.equal(negative.lastRun.ok,false);assert.equal(negative.lastRun.code,7);
 assert.equal(negative.verification.state,'failed');assert.equal(negative.verification.observedFailure,true);assert.notEqual(negative.verification.tests,true);
 assert.equal(await readFile(processCounter,'utf8'),'NEGATIVE_PROCESS_STARTED\n');
 assert.equal(await readFile(path.join(negativeProject,'negative.js'),'utf8'),negativeSource);
 assert.equal(negative.steps.filter(step=>step.name==='run_file').length,1);assert.ok(!negative.steps.some(step=>/write_file|edit_file|append_file/.test(step.name)));
 assert.equal(repairTemptations,0);assert.equal(negativeTurns,2,'An explicit negative observation gets no repair/checklist continuation');
 assert.match(negative.text,/Fehler beobachtet; die Ausführung blieb fehlgeschlagen/);assert.doesNotMatch(negative.text,/Nicht abgeschlossen/);
 const negativeDisplayed=await displayedReply('NEGATIVE_OBSERVED_7');
 assert.match(negativeDisplayed,/Fehler beobachtet; die Ausführung blieb fehlgeschlagen/);assert.doesNotMatch(negativeDisplayed,/Nicht abgeschlossen/);
 checks.push('One real Node process exits 7; source stays byte-identical; no unsolicited repair; observation task completes while execution remains failed');
 await page.screenshot({path:path.join(output,'negative-observed.png')});
 await page.reload();await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
 await until(async()=>Boolean(await page.evaluate(id=>window.__anvilIde.getState().chat.find(message=>message.backgroundJobId===id)?.content.includes('NEGATIVE_OBSERVED_7'),negative.id)),'negative result rehydrated');
 const restored=await job();assert.equal(restored.id,negative.id);assert.equal(restored.verification.observedFailure,true);assert.equal(restored.verification.state,'failed');assert.equal(restored.lastRun.ok,false);
 const restoredText=await page.evaluate(id=>window.__anvilIde.getState().chat.find(message=>message.backgroundJobId===id)?.content,negative.id);
 assert.match(restoredText,/Fehler beobachtet; die Ausführung blieb fehlgeschlagen/);assert.doesNotMatch(restoredText,/Nicht abgeschlossen/);
 assert.match(await displayedReply('NEGATIVE_OBSERVED_7'),/Fehler beobachtet; die Ausführung blieb fehlgeschlagen/);
 await page.screenshot({path:path.join(output,'negative-after-reload.png')});
 checks.push('Renderer reload preserves the completed observation and honest failed-execution message without turning the run green');
 result.negative={id:negative.id,status:negative.status,verification:negative.verification,exitCode:negative.lastRun.code,modelTurns:negativeTurns,processStarts:1,sourceUnchanged:true};

 scenario='canvas';await configure(canvasProject,{'index.html':canvasSource,'game.js':gameSource},3,true);
 const canvas=await submit('Modify game.js in the HTML canvas game so that Space, rather than J, triggers its existing jump indicator. Check the changed keyboard behavior and report exactly what was tested.',negative.id);
 assert.equal(canvas.status,'done',canvas.error);
 assert.ok(previewResources.some(resource=>resource.endsWith('/game.js')),'The actual external game script is delivered by the native preview server');
 assert.equal(await readFile(path.join(canvasProject,'index.html'),'utf8'),canvasSource);
 assert.equal(await readFile(path.join(canvasProject,'game.js'),'utf8'),gameSource.replace(oldCondition,newCondition));
 assert.equal(interactionNudges,1);assert.equal(checklistNudges,1);assert.equal(canvasTurns,8);
 assert.equal(canvas.steps.filter(step=>step.name==='run_file').length,1);assert.equal(canvas.steps.filter(step=>step.name==='play'&&step.status==='ok').length,1);
 const runTargets=canvas.workflow.operations.filter(operation=>operation.name==='run_file').map(operation=>operation.target);
 assert.deepEqual(runTargets,['index.html'],'Automatic final checks must reuse the HTML entry instead of running its game.js in Node');
 for(const name of ['read_file','edit_file','run_file','play','set_plan'])assert.equal(canvas.steps.filter(step=>step.name===name&&step.status==='ok').length,1,`Exactly one successful ${name} operation`);
 assert.equal(canvas.plan.length,3);assert.ok(canvas.plan.every(step=>step.status==='ok'),'The actual saved checklist is complete from matching evidence');
 assert.equal(canvas.lastPreview.action,'play');assert.equal(canvas.lastPreview.ok,true);assert.match(canvas.lastPreview.state.text,/JUMP_CONFIRMED/);
 assert.equal(canvas.verification.state,'passed');assert.equal(canvas.verification.scope,'interaction');assert.notEqual(canvas.verification.tests,true);assert.ok(canvas.verification.limitations?.length);
 assert.match(canvas.text,/CANVAS_INPUT_VERIFIED/);assert.match(canvas.text,/Only this keyboard interaction|Weitere Funktionen/);assert.match(canvas.text,/Nicht geprüft:/);
 const canvasDisplayed=await displayedReply('CANVAS_INPUT_VERIFIED');
 assert.match(canvasDisplayed,/Prüfumfang:/);assert.match(canvasDisplayed,/Nicht geprüft:/);assert.match(canvasDisplayed,/Only this keyboard interaction|Weitere Funktionen/);
 assert.equal(requests.filter(request=>request.scenario==='canvas'&&request.responseTool==='set_plan').length,1);
 assert.ok(!requests.some(request=>request.scenario==='negative'&&request.responseTool==='set_plan'));
 const preview=app.windows().find(window=>/^http:\/\/127\.0\.0\.1:\d+\/[a-f\d-]{36}\/index\.html$/i.test(window.url()));
 assert.ok(preview,'Actual isolated HTML preview window exists');
 assert.match(await preview.locator('body').innerText(),/JUMP_CONFIRMED/);await preview.screenshot({path:path.join(output,'canvas-space-observed.png')});
 await page.screenshot({path:path.join(output,'canvas-honest-completion.png')});
 checks.push('External game.js edit loads through index.html; automatic final execution reuses the current HTML proof without a spurious Node run');
 checks.push('Real HTML canvas preview is followed by one Anvil-requested Space interaction; actual keyboard events change the observed DOM to JUMP_CONFIRMED');
 checks.push('Completion records interaction scope and explicit limits; one real checklist update cites the observed play evidence and the saved plan is 3/3');
 result.canvas={id:canvas.id,status:canvas.status,verification:canvas.verification,modelTurns:canvasTurns,interactionNudges,checklistNudges,observedText:canvas.lastPreview.state.text,plan:canvas.plan,automaticRunEnabled:true,runTargets};
 await page.evaluate(()=>window.__anvilIde.setState({activePath:'game.js',runPath:null}));
 await page.getByRole('button',{name:'Ausführen',exact:true}).click();
 await page.waitForFunction(()=>window.__anvilIde.getState().runPath==='index.html'&&!window.__anvilIde.getState().running);
 const editorRun=await page.evaluate(()=>window.__anvilIde.getState().output.at(-1));
 assert.equal(editorRun.ok,true,editorRun.stderr);assert.equal(editorRun.stage.kind,'html');
 checks.push('The editor Run button with game.js active starts its linked HTML entry and renders without a Node DOM error');
 result.editorRun={ok:editorRun.ok,label:editorRun.label,stage:editorRun.stage.kind};
 await page.screenshot({path:path.join(output,'editor-linked-script.png')});
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(fixtureErrors,[]);result.ok=true;
}catch(error){result.ok=false;result.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 if(page&&!result.ok){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});result.body=await page.locator('body').innerText().catch(()=>'');result.currentJob=await job().catch(()=>undefined);}
 await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));
 if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
 api.closeAllConnections();await new Promise(resolve=>api.close(resolve));
 console.log(JSON.stringify({ok:result.ok,checks,errors,consoleErrors,fixtureErrors,error:result.error?.message}));
}
