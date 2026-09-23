import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {verifyBackgroundRemaining} from './background-remaining-check.mjs';

/** Runs against an installed/extracted EXE without external Node on PATH. */
export async function verifyBackgroundPackage(page,fixture){
 const root=path.join(fixture,'background-project');await mkdir(root,{recursive:true});
 const files={
  'main.cjs':'console.log("PACKAGED_BACKGROUND_OK")',
  'negative.cjs':'console.error("EXPECTED_NEGATIVE");process.exit(1)',
  'format.ts':'export const n:number=2;',
  'index.html':'<!doctype html><html><head><title>Packaged Canvas</title><script>window.packageBoot=typeof Anvil.run;</script></head><body><h1>Packaged Canvas</h1><p id="status">Waiting</p><script type="module" src="./game.mjs"></script></body></html>',
  'settings.mjs':'export const color="#71e8be";',
  'game.mjs':'import {color} from "./settings.mjs";if(window.packageBoot!=="function")throw Error("Engine booted too late");let moves=0;Anvil.run({width:320,height:180,pixel:true,update(){if(this.input.left)moves++;document.getElementById("status").textContent="PACKAGED_CANVAS_READY moves:"+moves;},draw(){this.ctx.fillStyle=color;this.ctx.fillRect(20,20,100,80);}});',
 };
 for(const [name,content]of Object.entries(files))await writeFile(path.join(root,name),content);
 let negativeConfirmed=false,shellConfirmed=false,canvasConfirmed=false,playConfirmed=false,seeConfirmed=false,imageConfirmed=false;
 const calls=[
  ['shell',{command:'node negative.cjs',expected_exit_code:1}],
  ['rename',{from:'main.cjs',to:'checked.cjs'}],
  ['shell',{command:'node checked.cjs'}],
  ['format_file',{path:'format.ts'}],
  ['run_file',{path:'index.html'}],
  ['play',{keys:['left'],hold_ms:150}],
  ['see_run',{}],
 ];
 let round=0;
 const server=createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;const n=++round;
  for(const message of JSON.parse(body).messages||[]){
   if(Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url'&&part.image_url?.url?.startsWith('data:image/')))imageConfirmed=true;
   if(message.role!=='tool')continue;
   let result;try{result=JSON.parse(message.content);}catch{continue;}
   if(result.code===1&&result.expectedExitCode===1&&result.ok===true&&result.exitExpectationMatched===true)negativeConfirmed=true;
   if(result.ok===true&&String(result.stdout).includes('PACKAGED_BACKGROUND_OK'))shellConfirmed=true;
   if(result.ok===true&&result.state?.canvas?.state==='running'){
    canvasConfirmed=true;
    if(message.tool_call_id==='package-6'&&/moves:[1-9]\d*/.test(result.stdout||''))playConfirmed=true;
    if(message.tool_call_id==='package-7'&&/moves:[1-9]\d*/.test(result.stdout||''))seeConfirmed=true;
   }
  }
  if(n===1)await new Promise(r=>setTimeout(r,1200));
  const step=calls[n-1],call=step?{name:step[0],arguments:JSON.stringify(step[1])}:null;
  const value=call?{delta:{tool_calls:[{index:0,id:'package-'+n,function:call}]},finish_reason:'tool_calls'}:{delta:{content:'Paket-Hintergrundprüfung fertig.'},finish_reason:'stop'};
  res.writeHead(200,{'Content-Type':'text/event-stream'}).end('data: '+JSON.stringify({choices:[value]})+'\n\ndata: [DONE]\n\n');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const initial=await page.evaluate(async request=>await window.anvilNative.agentJob('start',request),{project:root,files,execution:true,writeThrough:true,knowledge:{enabled:true,personEnabled:true,projectEnabled:true,skillsEnabled:true,skillBodies:true,pluginSkills:true,workspace:'package-fixture',memories:[],skills:[]},inputMap:{left:{keys:['q'],pad:[]}},format:{tabSize:2,insertSpaces:true},messages:[{role:'user',content:'Prüfe den erwarteten negativen Exit, verschiebe main.cjs nach checked.cjs und führe es aus. Formatiere format.ts. Starte index.html, spiele links und kontrolliere die Vorschau.'}],model:{provider:'custom',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',context:32768,thinking:'auto',hardStopMin:1,vision:true},maxRounds:12});
  await page.waitForFunction(()=>window.__anvilIde.getState().agentBusy===true);
  let state;for(let i=0;i<300;i++){state=(await page.evaluate(()=>window.anvilNative.agentJob('status'))).state;if(['done','failed','stopped'].includes(state.status))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(state.status,'done',state.error);assert.equal(state.id,initial.state.id);assert.equal(state.lastRun.path,'index.html');assert.equal(state.lastRun.ok,true,state.lastRun.stderr);
  assert.ok(negativeConfirmed,'Bundled runtime must verify the explicit expected exit code');
  assert.ok(shellConfirmed,'Shell must run with the bundled Node runtime');
  assert.ok(canvasConfirmed,'Packaged shared Canvas engine must load before classic and ES-module project scripts');
  assert.ok(playConfirmed,'Play must reach configured custom input binding');
  assert.ok(seeConfirmed,'See must verify the running interacted Canvas');
  assert.ok(imageConfirmed,'Actual preview screenshot must reach the vision-enabled local fixture');
  assert.match(await readFile(path.join(root,'format.ts'),'utf8'),/export const n: number = 2;/);
  assert.equal(await readFile(path.join(root,'checked.cjs'),'utf8'),files['main.cjs']);
  await page.evaluate(id=>window.anvilNative.agentJob('restore',{id}),state.id);assert.equal(await readFile(path.join(root,'main.cjs'),'utf8'),files['main.cjs']);
  await page.evaluate(id=>window.anvilNative.agentJob('dismiss',{id}),state.id);
  await page.waitForFunction(()=>window.__anvilIde.getState().agentBusy===false);
  const remaining=await verifyBackgroundRemaining(page,fixture);
  return 'packaged utility process, expected negative exit, rename, bundled Node shell, formatter, shared Canvas ES modules, mapped play, screenshot, see and restore passed; '+remaining;
 }finally{await page.evaluate(()=>window.anvilNative.agentJob('stop')).catch(()=>{});server.closeAllConnections();await new Promise(r=>server.close(r));}
}
