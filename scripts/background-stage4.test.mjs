import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, delimiter } from 'node:path';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { AgentEngines } from '../electron/agent-engines.mjs';
import { AgentProjectRuntime } from '../electron/agent-project-runtime.mjs';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { AgentConnections } from '../electron/agent-connections.mjs';
import { runEngineCommand } from '../companion/engine-runtime.mjs';
import { installCliFixture } from './fixtures/background-connections.mjs';
import { buildAgentRuntime } from './build-agent-runtime.mjs';

await buildAgentRuntime();
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
const until=async check=>{for(let n=0;n<400;n++){if(check())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out');};
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const launch=()=>fork(resolve('agent-build/worker.mjs'),[],{stdio:['ignore','ignore','inherit','ipc']});

test('background engines reject stale drafts and arbitrary commands; owned ready processes remain stoppable',async()=>{
  const root=mkdtempSync(join(tmpdir(),'anvil-stage4-engine-'));
  const files={'project.godot':'config_version=5\n'};
  writeFileSync(join(root,'project.godot'),files['project.godot']);
  writeFileSync(join(root,'fixture.mjs'),'console.log("READY");setInterval(()=>{},1000);');
  const oldInstall=process.env.ANVIL_INSTALL_DIR;process.env.ANVIL_INSTALL_DIR=root;
  const env={...process.env,ANVIL_GODOT_BIN:process.execPath};let calls=0;
  const engines=new AgentEngines({environment:()=>env,run:(cwd,cmd,limit,opts)=>{
    calls++;assert.equal(cmd,'godot --path "."');
    return runEngineCommand(cwd,'godot "fixture.mjs"',limit,{...opts,readyMs:200});
  }});
  const runtime=new AgentProjectRuntime({engines});
  runtime.begin({project:root,files,model:{}},'fixture');
  const controller=new AbortController(),ctx={signal:controller.signal,files};
  try{
    assert.equal((await runtime.execute({kind:'engine',action:'status'},ctx)).engines[0].installed,true);
    const op={kind:'engine',action:'run',args:{engine:'godot',action:'play'}};
    await assert.rejects(runtime.execute(op,{...ctx,files:{'project.godot':'unsaved'}}),/gespeicherte Dateien/);
    await assert.rejects(runtime.execute({...op,args:{...op.args,cmd:'node arbitrary.js'}},ctx),/freie Befehle/);
    assert.equal(calls,0);
    const result=await runtime.execute(op,ctx);
    assert.equal(result.running,true);assert.match(result.status,/Noch kein erfolgreicher/);
    assert.equal(alive(result.pid),true);
    await assert.rejects(runtime.execute(op,ctx),/läuft bereits/);
    await runtime.close();
    assert.equal(alive(result.pid),false);
    assert.equal(engines.last.aborted,true);
    assert.equal(engines.jobs.size,0);
    runtime.begin({project:root,files,model:{},surface:{id:'other',mode:'exclusive'}},'next');
    await assert.rejects(runtime.execute(op,ctx),/Brücke/);
  }finally{await runtime.close();if(oldInstall===undefined)delete process.env.ANVIL_INSTALL_DIR;else process.env.ANVIL_INSTALL_DIR=oldInstall;}
});

test('real background loop transfers attachments over OpenAI and Ollama wires and restores the user image',async()=>{
  const bodies=[];
  const server=createServer(async(req,res)=>{
    let raw='';for await(const b of req)raw+=b;bodies.push(JSON.parse(raw));
    if(req.url.endsWith('/api/chat'))return res.writeHead(200,{'Content-Type':'application/x-ndjson'}).end(JSON.stringify({message:{role:'assistant',content:'IMAGE_OK'},done:true,done_reason:'stop'})+'\n');
    res.writeHead(200,{'Content-Type':'text/event-stream'}).end('data: '+JSON.stringify({choices:[{delta:{content:'IMAGE_OK'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const snapshotPath=join(mkdtempSync(join(tmpdir(),'anvil-stage4-image-')),'latest.json');
  const host=new AgentJobHost({snapshotPath,launch});
  const request={files:{},messages:[{role:'user',content:'Beschreibe das Bild.',images:[image]}],maxRounds:4,model:{provider:'custom',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture-vision',context:32768,thinking:'auto',hardStopMin:0,vision:true}};
  try{
    assert.throws(()=>host.start({...request,messages:[{role:'user',content:'x',images:['https://example.com/private.png']}]}),/Ungültiges/);
    assert.equal(host.state,null);
    for(const provider of ['custom','ollama']){
      host.start({...request,model:{...request.model,provider}});await until(()=>!host.busy());
      assert.equal(host.state.status,'done',host.state.error);assert.match(host.state.text,/IMAGE_OK/);
      const last=bodies.at(-1).messages.find(m=>m.role==='user');
      if(provider==='ollama')assert.deepEqual(last.images,[image.split(',')[1]]);
      else assert.equal(last.content.find(c=>c.type==='image_url').image_url.url,image);
      assert.deepEqual(JSON.parse(readFileSync(snapshotPath,'utf8')).images,[image]);
      host.dismiss(host.state.id);
      await host.waitForCleanup();
    }
  }finally{await host.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('worker forwards image bytes to the actual guarded CLI input',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'anvil-stage4-cli-'));await installCliFixture(dir);
  writeFileSync(join(dir,'cli-choice.json'),JSON.stringify({content:'CLI_IMAGE_OK',tool_calls:[]}));
  const oldPath=process.env.PATH;process.env.PATH=dir+delimiter+oldPath;
  const runtime=new AgentProjectRuntime({connections:new AgentConnections()});
  const host=new AgentJobHost({snapshotPath:join(dir,'latest.json'),launch,runtime});
  try{
    host.start({project:dir,execution:true,files:{},messages:[{role:'user',content:'Image fixture',images:[image]}],maxRounds:4,model:{cliKind:'claude',model:'claude-sonnet-4-20250514',context:32768,thinking:'low',hardStopMin:0,vision:true}});
    await until(()=>!host.busy());assert.equal(host.state.status,'done',host.state.error);
    const call=JSON.parse(readFileSync(join(dir,'cli-calls.jsonl'),'utf8').trim());
    const input=JSON.parse(call.input);
    assert.equal(input.message.content.find(c=>c.type==='image').source.data,image.split(',')[1]);
    assert.equal(call.thinking,'2048');
    assert.equal(call.args[call.args.indexOf('--tools')+1],'');
  }finally{await host.close();process.env.PATH=oldPath;}
});

test('MCP image results reach the background model only when vision is enabled',async()=>{
  let round=0;const bodies=[];
  const server=createServer(async(req,res)=>{
    let raw='';for await(const b of req)raw+=b;bodies.push(JSON.parse(raw));
    const choice=round++===0?{delta:{tool_calls:[{index:0,id:'mcp-image',function:{name:'mcp_call',arguments:JSON.stringify({server:'fixture',name:'frame',arguments:{}})}}]},finish_reason:'tool_calls'}:{delta:{content:'MCP_IMAGE_DONE'},finish_reason:'stop'};
    res.writeHead(200,{'Content-Type':'text/event-stream'}).end('data: '+JSON.stringify({choices:[choice]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let calls=0;
  const connections=new AgentConnections({mcp:{async request(_s,method){
    if(method==='tools/list')return {tools:[{name:'frame',inputSchema:{type:'object'}}]};
    assert.equal(method,'tools/call');calls++;
    return {content:[{type:'image',mimeType:'image/png',data:image.split(',')[1]}]};
  },stop(){}}});
  const host=new AgentJobHost({snapshotPath:join(mkdtempSync(join(tmpdir(),'anvil-stage4-mcp-')),'latest.json'),launch,runtime:new AgentProjectRuntime({connections})});
  try{
    for(const vision of [false,true]){
      round=0;bodies.length=0;
      host.start({execution:true,files:{},services:[{id:'fixture',name:'fixture',enabled:true,url:'http://127.0.0.1:1/mcp',allowedTools:['frame']}],messages:[{role:'user',content:'Lade frame vom Dienst.'}],maxRounds:4,model:{provider:'custom',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',context:32768,thinking:'auto',hardStopMin:0,vision}});
      await until(()=>!host.busy());assert.equal(host.state.status,'done',host.state.error);
      const transferred=bodies.at(-1).messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(c=>c.type==='image_url');
      assert.equal(transferred.length,vision?1:0);
      if(vision)assert.equal(transferred[0].image_url.url,image);
      host.dismiss(host.state.id);
      await host.waitForCleanup();
    }
    assert.equal(calls,2);
  }finally{await host.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
