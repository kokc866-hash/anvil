import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {createServer as httpServer} from 'node:http';
import {createServer} from 'vite';
let vite, completeRuntime, ToolSession;
before(async()=>{
  vite=await createServer({configFile:false,root:process.cwd(),server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
  ({completeRuntime}=await vite.ssrLoadModule('/src/agent-runtime/transport.ts'));
  ({ToolSession}=await vite.ssrLoadModule('/src/lib/tool-compat.ts'));
});
after(async()=>{await vite?.close();});
const response=(res,text='ready',usage={prompt_tokens:123,completion_tokens:8})=>{
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.end(`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}],usage})}\n\ndata: [DONE]\n\n`);
};
async function fixture(t,handle,opts={}){
  const requests=[];
  const api=httpServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;
    const body=JSON.parse(raw);requests.push(body);
    await handle(body,res,requests.length,req);
  });
  await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{api.closeAllConnections();await new Promise(resolve=>api.close(resolve));});
  const model={provider:'custom',baseUrl:`http://127.0.0.1:${api.address().port}/v1`,model:'fixture',apiKey:'',context:32768,thinking:'off',temperature:0.3,maxOut:1000,hardStopMin:1,retries:3,...opts};
  const estimates=[],deltas=[];
  const run=(tools=[],signal=new AbortController().signal,session)=>completeRuntime(model,[{role:'user',content:'Synthetic test.'}],tools,signal,(s,k)=>deltas.push([s,k]),session,tokens=>estimates.push(tokens));
  return{run,requests,model,estimates,deltas};
}
const tool={type:'function',function:{name:'read_file',description:'Read a synthetic file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}};

test('configured attempts retry transient HTTP errors and report each pending request before final usage',async t=>{
 const f=await fixture(t,(_body,res,n)=>n<3?(res.writeHead(503),res.end('Model is loading')):response(res));
 const choice=await f.run();
 assert.equal(f.requests.length,3);assert.equal(f.estimates.length,3);
 assert.ok(f.estimates.every(v=>v.estimated&&v.prompt>0&&v.limit===32768));
 assert.deepEqual(choice.usage,{prompt:123,completion:8,estimated:false});
 assert.deepEqual(choice.requestTokens,{prompt:123,limit:32768,estimated:false});
 assert.deepEqual(f.deltas,[['ready','text']]);
});

test('one configured attempt and authentication errors are never retried',async t=>{
 for(const [status,retries]of[[503,1],[401,8]]){
  const f=await fixture(t,(_body,res)=>{res.writeHead(status);res.end('Specific fixture error');},{retries});
  await assert.rejects(f.run(),new RegExp(`HTTP ${status}.*Specific fixture error`));
  assert.equal(f.requests.length,1);
 }
});

test('abort and whole-request deadline stop backoff instead of resetting per attempt',async t=>{
 const controller=new AbortController();
 const f=await fixture(t,(_body,res)=>{res.writeHead(503);res.end('loading');setTimeout(()=>controller.abort(new Error('User stop')),20);});
 await assert.rejects(f.run([],controller.signal),/User stop/);assert.equal(f.requests.length,1);
 const timed=await fixture(t,(_body,res)=>{res.writeHead(503);res.end('loading');},{hardStopMin:0.002,retries:8});
 await assert.rejects(timed.run(),error=>error.name==='TimeoutError');assert.equal(timed.requests.length,1);
});

test('partial or empty successful streams are not repeated',async t=>{
 for(const partial of[true,false]){
  const f=await fixture(t,(_body,res)=>{
   res.writeHead(200,{'Content-Type':'text/event-stream'});
   res.end(partial?'data: '+JSON.stringify({choices:[{delta:{content:'Already shown'}}]})+'\n\n':'');
  },{retries:8});
  await assert.rejects(f.run(),/unterbrochen|keine Antwort/);assert.equal(f.requests.length,1);
  assert.equal(f.deltas.length,partial?1:0);
 }
});

test('server stream error after a tool fragment cannot replay the request',async t=>{
 const f=await fixture(t,(_body,res)=>{
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.end('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'tool',function:{name:'read_file',arguments:'{"path":'}}]}}]})+'\n\ndata: '+JSON.stringify({error:'busy'})+'\n\n');
 });
 await assert.rejects(f.run([tool]),/Fehler im Antwortstrom/);assert.equal(f.requests.length,1);
});

test('VRAM rejection reduces the native context, updates estimates and preserves requested options',async t=>{
 const f=await fixture(t,(body,res,n)=>{
  if(n===1){res.writeHead(500);res.end('unable to allocate KV cache');return;}
  assert.equal(body.options.num_ctx,16384);assert.equal(body.options.temperature,0.7);assert.equal(body.think,false);
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({message:{role:'assistant',content:'ready'},done:true,prompt_eval_count:321,eval_count:5}));
 },{provider:'ollama',temperature:0.7});
 const choice=await f.run();assert.equal(f.requests.length,2);
 assert.deepEqual(f.estimates.map(v=>v.limit),[32768,16384]);
 assert.equal(choice.requestTokens.limit,16384);assert.equal(choice.usage.prompt,321);
});

test('learned native-tool and thinking capabilities are honored before the first request',async t=>{
 const f=await fixture(t,(body,res)=>{
  assert.equal(body.stream,false);assert.ok(body.tools);assert.equal(body.think,false);assert.equal(body.enable_thinking,false);
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'ready',reasoning_content:'checked'},finish_reason:'stop'}],usage:{prompt_tokens:50,completion_tokens:10}}));
 },{provider:'lmstudio',thinking:'high',capabilities:{tools:'ok',noThinkWithTools:true,noStreamTools:true,noRequired:true,responsesApi:false,note:'saved',at:1}});
 const choice=await f.run([tool]);assert.equal(choice.usage.prompt,50);
 assert.deepEqual(f.deltas,[['checked','think'],['ready','text']]);
});

test('unsupported streaming retries as JSON and propagates final finish reason and usage',async t=>{
 const f=await fixture(t,(body,res,n)=>{
  if(n===1){assert.equal(body.stream,true);res.writeHead(400);res.end('Streaming is not supported');return;}
  assert.equal(body.stream,false);res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({choices:[{message:{content:'JSON works'},finish_reason:'length'}],usage:{prompt_tokens:90,completion_tokens:20}}));
 });
 const choice=await f.run();assert.equal(f.requests.length,2);assert.equal(choice.finish_reason,'length');assert.equal(choice.usage.completion,20);
});

test('unsupported native tools switch to text contracts and keep learning for subsequent requests',async t=>{
 const session=new ToolSession('standard','Read');
 const f=await fixture(t,(body,res,n)=>{
  if(n===1){res.writeHead(400);res.end('Model does not support tools');return;}
  assert.equal(body.tools,undefined);assert.match(JSON.stringify(body.messages),/Allowed tools and arguments/);
  response(res,'{"name":"read_file","arguments":{"path":"notes.txt"}}');
 });
 await f.run([tool],new AbortController().signal,session);
 assert.equal(f.model.capabilities.tools,'text');assert.equal(session.contract.transport,'text');assert.deepEqual(session.contract.names,['read_file']);
 await f.run([tool],new AbortController().signal,session);assert.equal(f.requests.length,3);
});

test('explicitly unsupported options are removed while unknown bad requests stay visible',async t=>{
 const f=await fixture(t,(body,res,n)=>{
  if(n===1){res.writeHead(422);res.end('unknown field reasoning_effort');return;}
  assert.equal(body.reasoning_effort,undefined);assert.equal(body.max_completion_tokens,1000);response(res);
 },{model:'gpt-5',thinking:'high'});
 await f.run();assert.equal(f.requests.length,2);
 const bad=await fixture(t,(_body,res)=>{res.writeHead(400);res.end('Bad image encoding');});
 await assert.rejects(bad.run(),/Bad image encoding/);assert.equal(bad.requests.length,1);
});

test('failed connection before response headers can retry without repeating output',async t=>{
 const f=await fixture(t,(_body,res,n,req)=>n===1?req.socket.destroy():response(res));
 const choice=await f.run();assert.equal(choice.content,'ready');assert.equal(f.requests.length,2);assert.deepEqual(f.deltas,[['ready','text']]);
});

test('context rejection reduces response budget and can recover without repeating model output',async t=>{
 const f=await fixture(t,(body,res,n)=>{
  if(n===1){res.writeHead(400);res.end('maximum context length exceeded');return;}
  assert.equal(body.max_tokens,500);response(res);
 });
 await f.run();assert.equal(f.requests.length,2);assert.equal(f.estimates.length,2);
});

test('an unsupported native option is removed from the actual Ollama wire payload',async t=>{
 const f=await fixture(t,(body,res,n)=>{
  if(n===1){res.writeHead(422);res.end('temperature is not supported');return;}
  assert.equal(body.options.temperature,undefined);assert.equal(body.options.num_ctx,32768);
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({message:{content:'ready'},done:true}));
 },{provider:'ollama'});
 await f.run();assert.equal(f.requests.length,2);
});

test('invalid JSON success is consumed once and never replayed',async t=>{
 const f=await fixture(t,(_body,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end('{');});
 await assert.rejects(f.run(),SyntaxError);assert.equal(f.requests.length,1);
});
