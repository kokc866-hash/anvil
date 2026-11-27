import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {verifyBackgroundRemaining} from './background-remaining-check.mjs';
import {fixturePlanUpdates} from './fixtures/background-plan.mjs';

/** Runs against an installed/extracted EXE without external Node on PATH. */
export async function verifyBackgroundPackage(page,fixture){
 const root=path.join(fixture,'background-project');await mkdir(root,{recursive:true});
 const files={
  'main.cjs':'console.log("PACKAGED_BACKGROUND_OK")',
  'negative.cjs':'console.error("EXPECTED_NEGATIVE");process.exit(1)',
  'format.ts':'export const n:number=2;',
  'index.html':'<!doctype html><html><head><title>Packaged Canvas</title><script>window.packageBoot=typeof Anvil.run;</script></head><body><h1>Packaged Canvas</h1><p id="status">Waiting</p><script type="module" src="./game.mjs"></script></body></html>',
  'settings.mjs':'export const color="#71e8be";',
  'game.mjs':'import {color} from "./settings.mjs";if(window.packageBoot!=="function")throw Error("Engine booted too late");let moves=0;Anvil.run({width:320,height:180,pixel:true,update(){if(this.input.left)moves=1;document.getElementById("status").textContent="PACKAGED_CANVAS_READY moves:"+moves;},draw(){this.ctx.fillStyle=color;this.ctx.fillRect(20,20,100,80);}});',
 };
 for(const [name,content]of Object.entries(files))await writeFile(path.join(root,name),content);
 let negativeConfirmed=false,shellConfirmed=false,canvasConfirmed=false,playConfirmed=false,seeConfirmed=false,imageConfirmed=false;
 const calls=[
  // Complete writes before execution checks: formatting after a shell check
  // correctly invalidates that check for the current project input stamp.
  ['rename',{from:'main.cjs',to:'checked.cjs'}],
  ['format_file',{path:'format.ts'}],
  ['shell',{command:'node negative.cjs',expected_exit_code:1}],
  ['shell',{command:'node checked.cjs'}],
  ['run_file',{path:'index.html'}],
  ['play',{keys:['left'],hold_ms:150,actions:[{type:'assert',selector:'#status',text:'PACKAGED_CANVAS_READY moves:1'}]}],
  ['see_run',{}],
 ];
 let round=0;
 const server=createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;const n=++round;
  const messages=JSON.parse(body).messages||[];
  for(const message of messages){
   if(Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url'&&part.image_url?.url?.startsWith('data:image/')))imageConfirmed=true;
   if(message.role!=='tool')continue;
   let result;try{result=JSON.parse(message.content);}catch{continue;}
   if(result.code===1&&result.expectedExitCode===1&&result.ok===true&&result.exitExpectationMatched===true)negativeConfirmed=true;
   if(result.ok===true&&String(result.stdout).includes('PACKAGED_BACKGROUND_OK'))shellConfirmed=true;
   if(result.ok===true&&result.state?.canvas?.state==='running'){
    canvasConfirmed=true;
    if(message.tool_call_id==='package-6'&&result.functionalChecks===true&&/moves:1/.test(result.stdout||''))playConfirmed=true;
    if(message.tool_call_id==='package-7'&&/moves:[1-9]\d*/.test(result.stdout||''))seeConfirmed=true;
   }
  }
  if(n===1)await new Promise(r=>setTimeout(r,1200));
  const step=calls[n-1];
  const call=step?{name:step[0],arguments:JSON.stringify(step[1])}:n===calls.length+1?{name:'set_plan',arguments:JSON.stringify({updates:fixturePlanUpdates(messages,[
   {callId:'package-1',kind:'edit',reason:'main.cjs nach checked.cjs verschoben.'},
   {callId:'package-2',kind:'edit',reason:'format.ts formatiert.'},
   {callId:'package-6',kind:'check',reason:'Links ausgelöst und den Canvas-Zählerstand 1 bestätigt.'},
  ])})}:null;
  const value=call?{delta:{tool_calls:[{index:0,id:'package-'+n,function:call}]},finish_reason:'tool_calls'}:{delta:{content:'Paket-Hintergrundprüfung fertig.'},finish_reason:'stop'};
  res.writeHead(200,{'Content-Type':'text/event-stream'}).end('data: '+JSON.stringify({choices:[value]})+'\n\ndata: [DONE]\n\n');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let identity;
 const plan = [
  {text:'main.cjs nach checked.cjs verschieben',kind:'edit',status:'todo'},
  {text:'format.ts formatieren',kind:'edit',status:'todo'},
  {text:'Mit play prüfen, dass Links den Canvas-Zähler auf 1 setzt',kind:'check',status:'todo'},
  {text:'Ergebnisse berichten',kind:'report',status:'todo'},
 ];
 const callJob = action => page.evaluate(({action,identity})=>window.anvilNative.agentJob(action,identity),{action,identity});
 try{
  const initial=await page.evaluate(async request=>await window.anvilNative.agentJob('start',request),{project:root,files,plan,execution:true,writeThrough:true,knowledge:{enabled:true,personEnabled:true,projectEnabled:true,skillsEnabled:true,skillBodies:true,pluginSkills:true,workspace:'package-fixture',memories:[],skills:[]},inputMap:{left:{keys:['q'],pad:[]}},format:{tabSize:2,insertSpaces:true},messages:[{role:'user',content:'Verschiebe main.cjs nach checked.cjs und formatiere format.ts. Prüfe den erwarteten Exitcode 1 von negative.cjs mit Shell. Führe checked.cjs aus. Starte index.html und bestätige mit play, dass Links den Canvas-Zähler auf 1 setzt.'}],model:{provider:'custom',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',context:32768,thinking:'auto',hardStopMin:1,vision:true},maxRounds:12});
   assert.ok(initial.jobId && initial.state?.id,'Native start must return both job identifiers');
   identity = {jobId:initial.jobId,id:initial.state.id};
   // A direct IPC job can belong to a different workspace than the rendered editor.
   let state;
   for(let i=0;i<300;i++){
    const reply = await callJob('status');
    assert.equal(reply.jobId,identity.jobId);
    assert.equal(reply.state?.id,identity.id);
    state = reply.state;
    if(['done','failed','stopped','interrupted','waiting-user'].includes(state.status))break;
    await new Promise(r=>setTimeout(r,100));
   }
   assert.equal(state.status,'done',state.error || `Background job ${identity.id} had status ${state.status}`);
   assert.equal(state.lastRun.path,'index.html');assert.equal(state.lastRun.ok,true,state.lastRun.stderr);
  assert.ok(negativeConfirmed,'Bundled runtime must verify the explicit expected exit code');
  assert.ok(shellConfirmed,'Shell must run with the bundled Node runtime');
  assert.ok(canvasConfirmed,'Packaged shared Canvas engine must load before classic and ES-module project scripts');
  assert.ok(playConfirmed,'Play must reach configured custom input binding');
  assert.ok(seeConfirmed,'See must verify the running interacted Canvas');
  assert.ok(imageConfirmed,'Actual preview screenshot must reach the vision-enabled local fixture');
  assert.match(await readFile(path.join(root,'format.ts'),'utf8'),/export const n: number = 2;/);
  assert.equal(await readFile(path.join(root,'checked.cjs'),'utf8'),files['main.cjs']);
   await callJob('restore');assert.equal(await readFile(path.join(root,'main.cjs'),'utf8'),files['main.cjs']);
   const dismissed = await callJob('dismiss');
   assert.equal(dismissed.state?.dismissed,true);
  const remaining=await verifyBackgroundRemaining(page,fixture);
  return 'packaged utility process, expected negative exit, rename, bundled Node shell, formatter, shared Canvas ES modules, mapped play, screenshot, see and restore passed; '+remaining;
 }finally{if(identity)await callJob('stop').catch(()=>{});server.closeAllConnections();await new Promise(r=>server.close(r));}
}
