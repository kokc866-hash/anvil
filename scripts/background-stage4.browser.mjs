// Actual production app, image upload and utility process. Optional real Godot
// project stays inside the fixture; no existing user project or account is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as socketServer } from 'node:net';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { _electron } from 'playwright';
await import('./pack-ui.mjs');
const output=path.resolve('artifacts/background-stage4');await mkdir(output,{recursive:true});
const profile=await mkdtemp(path.join(output,'profile-')),project=path.join(profile,'project');await mkdir(project);
const godot=process.env.ANVIL_QA_GODOT;
if(godot)assert.ok(existsSync(godot));
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
const files={
 'index.html':'<!doctype html><html><head><meta charset="utf-8"><title>Bildprüfung</title><style>body{background:#112936;color:#fff;font:28px system-ui;padding:40px}button{font:inherit;padding:20px;background:#91ded1}</style></head><body><h1>Bild im Hintergrund</h1><p>Die Vorschau bleibt beim Fensterabsturz erhalten.</p><button>Zähler: 0</button><script>let n=0;document.querySelector("button").onclick=e=>e.target.textContent="Zähler: "+(++n)</script></body></html>',
 'project.godot':'config_version=5\n[application]\nconfig/name="Anvil isolierter Engine-Test"\nrun/main_scene="res://main.tscn"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n',
 'main.tscn':'[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="AnvilStage4" type="Node"]\nscript = ExtResource("1")\n',
 'main.gd':'extends Node\nfunc _ready():\n\tvar marker = FileAccess.open("res://engine.pid", FileAccess.WRITE)\n\tmarker.store_string(str(OS.get_process_id()))\n\tmarker.close()\n\tprint("ANVIL_ENGINE_READY")\n',
};
for(const [p,s]of Object.entries(files))await writeFile(path.join(project,p),s);
const sock=socketServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
let phase='image',round=0,release,held=false;const requests=[],issues=[];
const server=createServer(async(req,res)=>{
 let raw='';for await(const b of req)raw+=b;
 if(!req.url.endsWith('/chat/completions'))return res.writeHead(200,{'Content-Type':'application/json'}).end('{"data":[]}');
 const body=JSON.parse(raw);requests.push(body);const n=++round;
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const emit=value=>res.write(`data: ${JSON.stringify({choices:[value]})}\n\n`);
 let name='',args={};
 try{
  if(phase==='image'){
   if(n===1){assert.ok(JSON.stringify(body.messages).includes(image),'uploaded image reached model');name='run_file';args={path:'index.html'};}
   if(n===2){assert.ok(JSON.stringify(body.messages).includes('data:image/jpeg;base64,'),'actual preview screenshot reached model');held=true;await new Promise(r=>release=r);name='see_run';}
   if(n===3)assert.ok(JSON.stringify(body.messages).includes('data:image/jpeg;base64,'));
  }else if(phase==='engine'){
   if(n===1){name='engine_detect';}
   if(n===2){assert.ok(JSON.stringify(body.messages).includes('project.godot'));name='engine_run';args={engine:'godot',action:'check'};}
   if(n===3){assert.equal(JSON.parse(body.messages.filter(m=>m.role==='tool').at(-1).content).ok,true,'real Godot check passed');name='engine_run';args={engine:'godot',action:'play'};}
   if(n===4){held=true;await new Promise(r=>release=r);}
  }else if(phase==='engineclose'){
   if(n===1){name='engine_run';args={engine:'godot',action:'play'};}
   if(n===2){held=true;await new Promise(r=>release=r);}
  }
 }catch(e){issues.push(e.message);}
 if(name){emit({delta:{tool_calls:[{index:0,id:`stage4-${phase}-${n}`,function:{name,arguments:JSON.stringify(args)}}]}});emit({delta:{},finish_reason:'tool_calls'});}
 else emit({delta:{content:'Hintergrundprüfung abgeschlossen.'},finish_reason:'stop'});
 res.end('data: [DONE]\n\n');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const env={...process.env,ANVIL_DESKTOP_MODE:'production',ANVIL_PORT:String(port),ANVIL_QA_USER_DATA:profile,ANVIL_HOME:path.join(profile,'packages'),ANVIL_WATCHDOG:'0'};
delete env.ELECTRON_RUN_AS_NODE;delete env.ANVIL_GODOT_BIN;
// Exercise the saved engine path used by the production IPC, not just an env override.
await mkdir(path.join(profile,'packages','toolchains'),{recursive:true});
if(godot)await writeFile(path.join(profile,'packages','toolchains','engine-paths.json'),JSON.stringify({godot}));
const until=async check=>{for(let n=0;n<300;n++){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error('Stage 4 desktop timed out');};
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
let app,proc,enginePid;
try{
 app=await _electron.launch({args:[path.resolve('fixtures/electron-boot.mjs')],env,timeout:45000});proc=app.process();
 const editorUrl=`http://127.0.0.1:${port}/`;let page;
 await until(()=>{page=app.windows().find(w=>w.url()===editorUrl);return page;});
 await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(({project,files,baseUrl})=>window.__anvilIde.setState({setupDone:true,autoUpdate:false,backgroundAgent:true,backgroundWriteThrough:false,agentMode:'agent',files,dirty:{},editBases:{},pendingDiffs:[],chat:[],workspaceCwd:project,autoSaveDisk:false,llmProvider:'custom',llmAuthMode:'key',llmBaseUrl:baseUrl,llmModel:'fixture-vision',llmApiKey:'',llmContext:32768,llmContextAuto:false,llmThinking:'auto',llmHardStopMin:0,autoRunAgent:false,runLoop:false,graphLoop:false}),{project,files,baseUrl:`http://127.0.0.1:${server.address().port}/v1`});
 const evaluate=source=>app.evaluate(({BrowserWindow},{source,editorUrl})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===editorUrl).webContents.executeJavaScript(source),{source,editorUrl});
 const status=async()=>(await evaluate('window.anvilNative.agentJob("status")')).state;
 await until(async()=>(await evaluate('window.anvilNative.agentJob("status")')).available);
 await page.locator('input[type=file][accept="image/*"]').setInputFiles({name:'probe.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
 await page.getByRole('button',{name:'Bild 1 entfernen',exact:true}).waitFor();
 await page.locator('textarea').last().fill('Prüfe den Bildanhang und öffne die HTML-Vorschau.');await page.locator('textarea').last().press('Enter');
 await until(()=>held||issues.length);assert.deepEqual(issues,[]);
 const initial=await status();assert.equal(initial.images.length,1);
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0});});
 const crash=()=>app.evaluate(({BrowserWindow},url)=>new Promise(r=>{const wc=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url).webContents;wc.once('did-finish-load',r);wc.forcefullyCrashRenderer();}),editorUrl);
 await crash();assert.equal((await status()).id,initial.id);assert.equal(round,2);
 release();release=undefined;await until(async()=>(await status()).status==='done');
 assert.deepEqual(issues,[]);
 await until(async()=>await evaluate('window.__anvilIde.getState().chat.some(m=>m.role==="user"&&m.images?.length===1)'));
 const preview=app.windows().find(w=>w.url().includes('/index.html'));assert.ok(preview);
 await preview.screenshot({path:path.join(output,'preview.png')});
 const shot=await app.evaluate(async({BrowserWindow},url)=>(await BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url).webContents.capturePage()).toDataURL(),editorUrl);
 await writeFile(path.join(output,'editor.png'),Buffer.from(shot.split(',')[1],'base64'));
 assert.deepEqual(errors,[]);
 if(godot){
  await evaluate('window.anvilNative.agentJob("status").then(r=>window.anvilNative.agentJob("dismiss",{id:r.state.id}))');
  phase='engine';round=0;held=false;
  const request={project,execution:true,files,messages:[{role:'user',content:'Erkenne Godot, prüfe das Projekt und starte es.'}],maxRounds:8,model:{provider:'custom',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',context:32768,thinking:'auto',hardStopMin:0}};
  await evaluate(`window.anvilNative.agentJob('start',${JSON.stringify(request)})`);
  await until(()=>held||issues.length);assert.deepEqual(issues,[]);
  const running=await status();assert.equal(running.lastEngine.running,true,JSON.stringify(running.lastEngine));
  enginePid=Number(await readFile(path.join(project,'engine.pid'),'utf8'));assert.ok(alive(enginePid));
  await crash();assert.ok(alive(enginePid));assert.equal((await status()).id,running.id);assert.equal(round,4);
  await evaluate('window.anvilNative.agentJob("stop")');await until(()=>!alive(enginePid));
  assert.equal((await status()).status,'stopped');release();release=undefined;
  await evaluate('window.anvilNative.agentJob("status").then(r=>window.anvilNative.agentJob("dismiss",{id:r.state.id}))');
  phase='engineclose';round=0;held=false;
  await evaluate(`window.anvilNative.agentJob('start',${JSON.stringify(request)})`);
  await until(()=>held);enginePid=Number(await readFile(path.join(project,'engine.pid'),'utf8'));
  assert.ok(alive(enginePid));
  await evaluate('window.__anvilIde.setState({dirty:{},pendingDiffs:[]})');
  await app.evaluate(({BrowserWindow},url)=>{BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url).close();},editorUrl);
  await until(()=>proc.exitCode!==null);await until(()=>!alive(enginePid));release();release=undefined;
 }
 await writeFile(path.join(output,'result.json'),JSON.stringify({ok:true,checks:['UI image upload reaches actual utility model request','preview JPEG reaches model','renderer crash does not repeat tool/model call','chat image reattaches','clean browser console',...(godot?['real Godot import check','saved engine executable path','real Godot play survives renderer crash','Stop kills owned Godot process','normal editor close kills owned Godot process']:[])],godot:godot?'tested':'not installed in this fixture'},null,2));
 console.log('BACKGROUND_STAGE4_IMAGES_AND_ENGINES_OK');
}finally{
 release?.();
 if(app){const deadline=setTimeout(()=>proc?.kill(),8000);try{await app.close();}catch{}clearTimeout(deadline);}
 server.closeAllConnections();await new Promise(r=>server.close(r));
 if(enginePid)assert.equal(alive(enginePid),false,'engine must not outlive test');
}
