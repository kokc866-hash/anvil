// Full desktop integration: the real model loop writes, runs and previews while
// the editor renderer is killed. All files and processes belong to this fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as socketServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright';
await import('./pack-ui.mjs');
const output=path.resolve('artifacts/background-stage2'); await mkdir(output,{recursive:true});
const profile=await mkdtemp(path.join(output,'profile-')), project=path.join(profile,'project'); await mkdir(project);
const marker=path.join(profile,'native.pid'), proceed=path.join(profile,'proceed');
const original=`const fs=require('fs'); fs.writeFileSync(${JSON.stringify(marker)},String(process.pid)); const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(proceed)})){clearInterval(timer);console.log('BEFORE');}},50);`;
const edited=original.replace('BEFORE','NATIVE_CHECK_OK');
const files={'main.cjs':original,'index.html':'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><title>Background QA</title></head><body><h1>Hintergrundprüfung</h1><p id="count">0</p><button id="add">Erhöhen</button><script src="app.js"></script></body></html>',
  'style.css':'body{background:#15181d;color:#fafafa;font:24px system-ui;padding:40px}button{font:inherit;padding:12px}',
  'app.js':'let n=0;document.querySelector("#add").onclick=()=>document.querySelector("#count").textContent=String(++n);'};
for(const [name,content]of Object.entries(files))await writeFile(path.join(project,name),content);
const sock=socketServer(); await new Promise(r=>sock.listen(0,'127.0.0.1',r)); const port=sock.address().port; await new Promise(r=>sock.close(r));
let rounds=0, phaseRound=0, phase='main', release, held=false;
const server=createServer(async(req,res)=>{
  let raw=''; for await(const b of req)raw+=b;
  if(!req.url.endsWith('/chat/completions')){res.writeHead(200,{'Content-Type':'application/json'}).end('{"data":[]}');return;}
  const payload=JSON.parse(raw); rounds++; const n=++phaseRound;
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const emit=value=>res.write(`data: ${JSON.stringify({choices:[value]})}\n\n`);
  let name='',args={};
  if(phase==='main') {
  if(n===1){name='read_file';args={path:'main.cjs'};}
  if(n===2){name='edit_file';args={path:'main.cjs',old_string:'BEFORE',new_string:'NATIVE_CHECK_OK'};}
  if(n===3){name='run_file';args={path:'main.cjs'};}
  if(n===4){assert.ok(JSON.stringify(payload.messages).includes('NATIVE_CHECK_OK'));name='run_file';args={path:'index.html'};}
  if(n===5){held=true;emit({delta:{reasoning_content:'Vorschau bleibt während der Wiederverbindung geöffnet.'}});await new Promise(r=>{release=r;});name='play';args={keys:['enter'],hold:40};}
  if(n===6){name='see_run';}
  }
  if(phase==='error'&&n===1){name='run_file';args={path:'index.html'};}
  if(phase==='close'&&(n===1||n===2)){name='run_file';args={path:n===1?'index.html':'wait.cjs'};}
  if(name){emit({delta:{tool_calls:[{index:0,id:`stage2-${n}`,function:{name,arguments:JSON.stringify(args)}}]}});emit({delta:{},finish_reason:'tool_calls'});}
  else {emit({delta:{content:'Native Ausführung erfolgreich, HTML und Bedienelement geprüft.'}});emit({delta:{},finish_reason:'stop'});}
  res.end('data: [DONE]\n\n');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const env={...process.env,ANVIL_DESKTOP_MODE:'production',ANVIL_PORT:String(port),ANVIL_QA_USER_DATA:profile,ANVIL_HOME:path.join(profile,'packages'),ANVIL_WATCHDOG:'0'};delete env.ELECTRON_RUN_AS_NODE;
const until=async check=>{for(let n=0;n<200;n++){if(await check())return;await new Promise(r=>setTimeout(r,150));}throw new Error('Stage 2 QA timed out');};
let app,proc;
try{
  app=await _electron.launch({args:[path.resolve('fixtures/electron-boot.mjs')],env,timeout:45000});proc=app.process();
  const editorUrl=`http://127.0.0.1:${port}/`;
  let page;await until(()=>{page=app.windows().find(w=>w.url()===editorUrl);return page;});
  await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(({project,files,baseUrl})=>window.__anvilIde.setState({setupDone:true,autoUpdate:false,backgroundAgent:true,backgroundWriteThrough:true,agentMode:'agent',files,dirty:{},editBases:{},pendingDiffs:[],chat:[],workspaceCwd:project,autoSaveDisk:false,
    llmProvider:'custom',llmAuthMode:'key',llmBaseUrl:baseUrl,llmModel:'qa-local',llmApiKey:'',llmContext:32768,llmContextAuto:false,llmThinking:'auto',llmHardStopMin:0,autoRunAgent:false,runLoop:false,graphLoop:false}),{project,files,baseUrl:`http://127.0.0.1:${server.address().port}/v1`});
  const evalEditor=source=>app.evaluate(({BrowserWindow},{source,editorUrl})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===editorUrl).webContents.executeJavaScript(source),{source,editorUrl});
  await until(async()=> (await evalEditor('window.anvilNative.agentJob("status")')).available);
  await page.locator('textarea').last().fill('Lies main.cjs, ersetze BEFORE durch NATIVE_CHECK_OK, führe main.cjs aus und prüfe danach index.html.');await page.locator('textarea').last().press('Enter');
  await until(()=>existsSync(marker));
  const nativePid=Number(await readFile(marker,'utf8'));
  const running=(await evalEditor('window.anvilNative.agentJob("status")')).state;
  assert.equal(running.operation.kind,'run');assert.equal(running.operation.status,'pending');
  assert.equal(await readFile(path.join(project,'main.cjs'),'utf8'),edited);
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0});});
  const crash=()=>app.evaluate(({BrowserWindow},editorUrl)=>new Promise(resolve=>{const wc=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===editorUrl).webContents;wc.once('did-finish-load',resolve);wc.forcefullyCrashRenderer();}),editorUrl);
  await crash();
  assert.doesNotThrow(()=>process.kill(nativePid,0));assert.equal(rounds,3);
  assert.equal((await evalEditor('window.anvilNative.agentJob("status")')).state.id,running.id);
  await writeFile(proceed,'continue');await until(()=>held);
  assert.throws(()=>process.kill(nativePid,0));
  const preview=app.windows().find(w=>w.url().includes('/index.html'));assert.ok(preview,'separate preview exists');
  await preview.waitForSelector('h1');assert.equal(await preview.locator('h1').innerText(),'Hintergrundprüfung');
  const previewPid=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/index.html')).webContents.getOSProcessId());
  await crash();
  assert.equal(rounds,5);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/index.html')).webContents.getOSProcessId()),previewPid);
  assert.equal(await preview.evaluate(()=>typeof window.anvilNative),'undefined');
  assert.equal(await preview.evaluate(()=>typeof require),'undefined');
  await preview.locator('button').click();assert.equal(await preview.locator('#count').innerText(),'1');
  await preview.screenshot({path:path.join(output,'preview.png')});
  release();release=undefined;
  await until(async()=> (await evalEditor('window.anvilNative.agentJob("status")')).state.status==='done');
  const done=(await evalEditor('window.anvilNative.agentJob("status")')).state;
  assert.equal(done.id,running.id);assert.equal(rounds,7);assert.match(done.lastPreview.stdout,/2/);assert.equal(done.lastPreview.ok,true,done.lastPreview.stderr);
  assert.equal(await preview.locator('#count').innerText(),'2','agent play really presses the focused button');
  await until(async()=>await evalEditor(`window.__anvilIde.getState().files['main.cjs']===${JSON.stringify(edited)}`));
  await until(async()=>await evalEditor('document.body.innerText.includes("Auftrag beendet") && window.__anvilIde.getState().chat.at(-1)?.content.includes("Native Ausführung erfolgreich")'));
  await preview.screenshot({path:path.join(output,'preview.png')});
  const shot=await app.evaluate(async({BrowserWindow},editorUrl)=>(await BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===editorUrl).webContents.capturePage()).toDataURL(),editorUrl);
  await writeFile(path.join(output,'editor.png'),Buffer.from(shot.split(',')[1],'base64'));
  assert.deepEqual(errors,[]);
  // Browser-side failures are real failed checks, not successful load claims.
  await evalEditor(`window.anvilNative.agentJob('dismiss',{id:${JSON.stringify(done.id)}})`);
  phase='error';phaseRound=0;
  const errorRequest={project,execution:true,writeThrough:false,files:{'index.html':'<script>console.error("EXPECTED_ERROR")</script><p>Error fixture</p>'},messages:[{role:'user',content:'Prüfe index.html.'}],model:{provider:'custom',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'qa-local',context:32768,thinking:'auto',hardStopMin:0},maxRounds:8};
  await evalEditor(`window.anvilNative.agentJob('start',${JSON.stringify(errorRequest)})`);
  await until(async()=>Boolean((await evalEditor('window.anvilNative.agentJob("status")')).state.lastRun));
  const checks=(await evalEditor('window.anvilNative.agentJob("status")')).state.lastRun;
  assert.equal(checks.ok,false);assert.match(checks.stderr,/EXPECTED_ERROR/);
  await until(async()=>['done','failed'].includes((await evalEditor('window.anvilNative.agentJob("status")')).state.status));
  await evalEditor('window.anvilNative.agentJob("status").then(r=>window.anvilNative.agentJob("dismiss",{id:r.state.id}))');
  const stopMarker=path.join(profile,'stop.pid');
  const closeRequest={...errorRequest,files:{'index.html':'<h1>Close fixture</h1>','wait.cjs':`require('fs').writeFileSync(${JSON.stringify(stopMarker)},String(process.pid));setInterval(()=>{},1000);`},messages:[{role:'user',content:'Öffne index.html und starte wait.cjs.'}]};
  phase='close';phaseRound=0;
  await evalEditor(`window.anvilNative.agentJob('start',${JSON.stringify(closeRequest)})`);
  await until(()=>existsSync(stopMarker));
  const stopPid=Number(await readFile(stopMarker,'utf8'));
  await evalEditor('window.__anvilIde.setState({dirty:{},pendingDiffs:[]})');
  await app.evaluate(({BrowserWindow},editorUrl)=>{BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===editorUrl).close();},editorUrl);
  await until(()=>proc.exitCode!==null);
  assert.throws(()=>process.kill(stopPid,0));
  assert.equal(JSON.parse(await readFile(path.join(profile,'agent-jobs','latest.json'),'utf8')).status,'stopped');
  await writeFile(path.join(output,'result.json'),JSON.stringify({ok:true,rounds,checks:['actual utility loop','durable direct write','native run survives editor crash','no duplicate native execution','separate preview survives second crash','agent keyboard interaction','no editor preload','real console errors detected','editor reattaches','closing editor with preview stops native child and entire app']},null,2));
  console.log('BACKGROUND_STAGE2_NATIVE_AND_PREVIEW_RECOVERY_OK');
}finally{
  release?.();
  if(app){
    try{await app.evaluate(async({BrowserWindow})=>{const wc=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/'))?.webContents;if(wc&&!wc.isCrashed())await wc.executeJavaScript('window.anvilNative.agentJob("stop")');});}catch{}
    const deadline=setTimeout(()=>proc?.kill(),8000);
    try{await app.close();}catch{}clearTimeout(deadline);
  }
  server.closeAllConnections();await new Promise(r=>server.close(r));
}
