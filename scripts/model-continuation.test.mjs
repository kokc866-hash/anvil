import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLoopFixture, tool } from '../fixtures/agent-loop-fixture.mjs';

const options = { context:131072, compact:'off', observeOnly:true, locale:'en', runLoop:false, graphLoop:false, maxRounds:8, files:[] };
const model = () => ({ provider:'custom',baseUrl:'http://127.0.0.1:19381/v1',model:'synthetic-reasoning-model',apiKey:'',context:131072,thinking:'high',temperature:0.3,maxOut:1000,hardStopMin:0,retries:4 });
const sse = (message, finish='stop') => new Response(`data: ${JSON.stringify({choices:[{delta:message,finish_reason:finish}]})}\n\ndata: [DONE]\n\n`, {headers:{'content-type':'text/event-stream'}});

test('backend missing-user-query after a real tool turn switches only the rejected transport and retains task/results',async t=>{
 const f=await agentLoopFixture(t);f.beginAgent();
 const {completeRuntime}=await f.server.ssrLoadModule('/src/agent-runtime/transport.ts');
 const {ToolSession}=await f.server.ssrLoadModule('/src/lib/tool-compat.ts');
 const {AGENT_TOOLS}=await f.server.ssrLoadModule('/src/lib/agent-tools.ts');
 const offered=AGENT_TOOLS.filter(t=>t.function.name==='read_file');
 const session=new ToolSession('standard','Read only'), config=model(), requests=[];
 globalThis.fetch=async(_url,init)=>{
  const body=JSON.parse(init.body);requests.push(body);
  assert.equal(body.model,config.model);
  assert.ok(body.messages.some(m=>m.role==='user'&&String(m.content).includes('Read note.txt once. Do not change files.')));
  if(requests.length===1){const c=tool('read_file',{path:'note.txt'}).tool_calls[0];return sse({tool_calls:[{index:0,...c}]},'tool_calls');}
  if(body.messages.some(m=>m.role==='tool'))return new Response(JSON.stringify({error:{message:'Modelllaufzeit: {"error":{"message":"no user query found in messages","type":"api_error"}}',code:'backend_request_failed'}}),{status:500});
  assert.equal(body.tools,undefined);
  assert.match(String(body.messages.at(-1).content),/Read note.txt once. Do not change files./,'the same real task also survives a backend retaining only the newest turn');
  assert.match(JSON.stringify(body.messages),/Tool result/);
  assert.match(JSON.stringify(body.messages),/note-content-marker/);
  return sse({content:'Read-only result: note-content-marker. No changes were requested or made.'});
 };
 const result=await f.runAgentLoop({...options,files:[{path:'note.txt',content:'note-content-marker'}],messages:[{role:'user',content:'Read note.txt once. Do not change files.'}]},async(messages)=>{
  const choice=await completeRuntime(config,messages,offered,new AbortController().signal,()=>{},session);
  return {...choice,toolContract:session.contract};
 });
 assert.equal(requests.length,3,'one tool request, one explicit rejection, one adapted continuation');
 assert.equal(result.tools.filter(name=>name==='read_file').length,1,'confirmed file read is not replayed');
 assert.equal(result.files.find(file=>file.path==='note.txt').content,'note-content-marker');
 assert.equal(config.context,131072,'no hidden context or server change');
 assert.equal(config.capabilities.tools,'text');
});

test('a consumed reasoning-only length response reaches the loop with its real finish reason',async t=>{
 const f=await agentLoopFixture(t);
 const {completeRuntime}=await f.server.ssrLoadModule('/src/agent-runtime/transport.ts');
 let requests=0;
 globalThis.fetch=async()=>{requests++;return sse({reasoning_content:'A model is still working on the requested answer.'},'length');};
 const choice=await completeRuntime(model(),[{role:'user',content:'Synthetic read-only question.'}],[],new AbortController().signal,()=>{});
 assert.equal(choice.finish_reason,'length');assert.match(choice.reasoning,/still working/);assert.equal(requests,1);
});

test('read-only planning continues an explicit output limit and combines the answer without authorizing tools',async t=>{
 const f=await agentLoopFixture(t);f.beginAgent();let calls=0;
 const result=await f.runAgentLoop({...options,messages:[{role:'user',content:'Only explain this synthetic example. Never change files.'}]},async messages=>{
  calls++;
  if(calls===1)return {content:'First part of the read-only explanation. ',finish_reason:'length',toolContract:{transport:'native',names:[]}};
  assert.match(String(messages.at(-1).content),/continu|Fortsetz/i);
  return {content:'Second part completes the explanation.',finish_reason:'stop',toolContract:{transport:'native',names:[]}};
 });
 assert.equal(calls,2);assert.match(result.reply,/First part/);assert.match(result.reply,/Second part/);assert.deepEqual(result.tools,[]);
});

test('repeated output limits are bounded and never reported as completed',async t=>{
 const f=await agentLoopFixture(t);f.beginAgent();let calls=0;
 const result=await f.runAgentLoop({...options,messages:[{role:'user',content:'Explain only. Do not edit anything.'}]},async()=>{calls++;return {reasoning:'Thinking about the synthetic answer.',content:'',finish_reason:'length',toolContract:{transport:'native',names:[]}};});
 assert.ok(calls>=2&&calls<=3);assert.equal(result.ok,false);assert.match(result.error,/output|Ausgabe/i);assert.deepEqual(result.tools,[]);
});

test('foreground retries cannot replay a consumed stream network failure',async t=>{
 const f=await agentLoopFixture(t);
 const {shouldRetryLocalLlm}=await f.server.ssrLoadModule('/src/lib/agent-abort.ts');
 const {withModelFailureContext}=await f.server.ssrLoadModule('/electron/agent-failure.mjs');
 assert.equal(shouldRetryLocalLlm(withModelFailureContext(new TypeError('Failed to fetch'),{phase:'stream',attempt:1,status:200})),false);
 assert.equal(shouldRetryLocalLlm(new TypeError('Failed to fetch')),true);
});

test('truncated native tool arguments can never leave the independent transport as an executable call',async t=>{
 const f=await agentLoopFixture(t);
 const {completeRuntime}=await f.server.ssrLoadModule('/src/agent-runtime/transport.ts');
 globalThis.fetch=async()=>sse({tool_calls:[{index:0,id:'partial',function:{name:'read_file',arguments:'{"path":"note'}}]},'length');
 await assert.rejects(completeRuntime(model(),[{role:'user',content:'Read the synthetic note.'}],[],new AbortController().signal,()=>{}),/unterbrochen|unvollständig|limit/i);
});

test('missing-query rejection without a native continuation is not retried as an outage or granted invented tools',async t=>{
 const f=await agentLoopFixture(t);
 const {completeRuntime}=await f.server.ssrLoadModule('/src/agent-runtime/transport.ts');
 let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('{"error":{"message":"no user query found in messages"}}',{status:500});};
 await assert.rejects(completeRuntime(model(),[{role:'user',content:'Explain only.'}],[],new AbortController().signal,()=>{}),/no user query/);
 assert.equal(calls,1);
});

test('real foreground JSON completion preserves the output limit and reasoning before a bounded continuation',async t=>{
 const f=await agentLoopFixture(t);f.beginAgent();
 window.location={pathname:'/',origin:'http://127.0.0.1:19381',hostname:'127.0.0.1',protocol:'http:'};
 f.useIde.setState({llmRetries:1,llmHardStopMin:0,llmTemperature:0.3,llmMaxOut:1000,autoRunAgent:false,autoPreview:false,runLoop:false,testLoop:false,graphLoop:false,engineLoop:false,harnessAfterWrite:'none',mcpServers:[]});
 const {setCap}=await f.server.ssrLoadModule('/src/lib/model-caps.ts');
 setCap('custom','json-continuation',{noStreamTools:true},model().baseUrl);
 const {chatWithProvider}=await f.server.ssrLoadModule('/src/lib/agent-client.ts');
 let calls=0;
 globalThis.fetch=async(_url,init)=>{
  calls++;const body=JSON.parse(init.body);assert.equal(body.stream,false);
  const message=calls===1?{role:'assistant',content:'First explanation. ',reasoning_content:'Synthetic reasoning.'}:{role:'assistant',content:'Final explanation.'};
  return new Response(JSON.stringify({choices:[{message,finish_reason:calls===1?'length':'stop'}]}),{headers:{'content-type':'application/json','x-anvil-lan':'1'}});
 };
 const result=await chatWithProvider({...options,provider:'custom',baseUrl:model().baseUrl,model:'json-continuation',apiKey:'',thinking:'off',messages:[{role:'user',content:'Explain only. Do not edit files.'}]});
 assert.equal(calls,2,JSON.stringify({error:result.error,reply:result.reply}));assert.match(result.reply,/First explanation/);assert.match(result.reply,/Final explanation/);assert.deepEqual(result.tools,[]);
});
