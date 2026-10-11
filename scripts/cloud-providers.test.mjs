import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { buildAgentRuntime } from './build-agent-runtime.mjs';

async function until(check) {
  for (let i=0;i<500;i++) { if (check()) return; await new Promise(r=>setTimeout(r,20)); }
  throw new Error('Synthetic cloud-provider worker did not settle.');
}

test('Qwen and DeepSeek preserve full reasoning through real worker tool turns and cancel the owned connection', {timeout:45000}, async t=>{
  const artifacts=path.resolve('artifacts/provider-models-2026-10-11');mkdirSync(artifacts,{recursive:true});
  const root=mkdtempSync(path.join(artifacts,'cloud-worker-')),build=path.join(root,'build');
  await buildAgentRuntime(build);
  for(const provider of ['qwen','deepseek'])await t.test(provider,async()=>{
    const thoughts='BEGIN_COMPLETE_THOUGHT_'+('synthetic reasoning. '.repeat(55000))+'_END_COMPLETE_THOUGHT';
    const requests=[],serverErrors=[];
    let blocking=false,waiting=false,closed=false;
    const api=createServer(async(req,res)=>{
      try {
        assert.equal(req.url,'/v1/chat/completions');
        assert.equal(req.headers.authorization,'Bearer fixture-key');
        let body='';for await(const chunk of req)body+=chunk;
        const payload=JSON.parse(body);requests.push(payload);
        assert.equal(payload.model,provider==='qwen'?'qwen3.8-flash':'deepseek-flash');
        assert.equal(payload.tool_choice,'auto');assert.ok(payload.tools.length>0);
        assert.equal(payload.stream_options.include_usage,true);
        assert.equal(payload.reasoning_effort,provider==='qwen'?'medium':'high');
        assert.equal(Object.hasOwn(payload,'thinking_budget'),false);
        if(provider==='deepseek')assert.deepEqual(payload.thinking,{type:'enabled'});
        if(blocking){waiting=true;res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': fixture waiting\n\n');res.on('close',()=>{closed=true;});return;}
        const n=requests.length;
        if(n===2){
          const assistant=payload.messages.find(m=>m.tool_calls?.some(c=>c.id==='fixture-read'));
          assert.equal(assistant?.reasoning_content,thoughts,'Never truncate the reasoning required on the next tool turn.');
          assert.equal(Object.hasOwn(assistant,'reasoning'),false);
          assert.ok(payload.messages.some(m=>m.role==='tool'&&m.tool_call_id==='fixture-read'&&m.content.includes('Artificial provider note')));
        }
        res.writeHead(200,{'Content-Type':'text/event-stream'});
        const event=value=>res.write('data: '+JSON.stringify(value)+'\n\n');
        if(n===1){
          for(let i=0;i<thoughts.length;i+=8000)event({choices:[{delta:{reasoning_content:thoughts.slice(i,i+8000)}}]});
          event({choices:[{delta:{tool_calls:[{index:0,id:'fixture-read',type:'function',function:{name:'read_file',arguments:'{"path":"notes.txt"}'}}]},finish_reason:'tool_calls'}]});
        }else event({choices:[{delta:{reasoning_content:'The artificial note is read.',content:'Read the artificial note. No edits were requested.'},finish_reason:'stop'}]});
        event({choices:[],usage:{prompt_tokens:n===1?100:200,completion_tokens:30}});
        res.end('data: [DONE]\n\n');
      }catch(e){serverErrors.push(e);if(!res.headersSent)res.writeHead(500);res.end('Synthetic assertion failed.');}
    });
    await new Promise(r=>api.listen(0,'127.0.0.1',r));
    const host=new AgentJobHost({snapshotPath:path.join(root,provider,'state.json'),launch:()=>fork(path.join(build,'worker.mjs'),[],{stdio:['ignore','ignore','inherit','ipc']})});
    const request={project:`fixture-${provider}`,files:{'notes.txt':'Artificial provider note'},messages:[{role:'user',content:'Read notes.txt and explain it briefly. Do not make changes.'}],maxRounds:8,autoContinue:false,model:{provider,baseUrl:`http://127.0.0.1:${api.address().port}/v1`,apiKey:'fixture-key',model:provider==='qwen'?'qwen3.8-flash':'deepseek-flash',context:2097152,thinking:provider==='qwen'?'medium':'high',maxOut:2048,hardStopMin:1,retries:1}};
    try {
      host.start(request);await until(()=>!host.busy());
      assert.deepEqual(serverErrors,[]);assert.equal(host.state.status,'done',host.state.error);assert.equal(requests.length,2);
      assert.equal(host.state.connection,provider==='qwen'?'Qwen AI API':'DeepSeek API');
      assert.deepEqual(host.state.usage,{prompt:300,completion:60,estimated:false});
      assert.equal(Object.keys(host.state.drafts).length,0);
      host.dismiss(host.state.id);await host.waitForCleanup();
      blocking=true;host.start(request);await until(()=>waiting);host.stop();await host.waitForCleanup();
      await until(()=>closed);assert.equal(host.state.status,'stopped');assert.equal(requests.length,3,'Stop must not retry the request.');
      assert.deepEqual(serverErrors,[]);
    }finally{await host.close();api.closeAllConnections();await new Promise(r=>api.close(r));}
  });
});
