import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium} from 'playwright';

test('real foreground question button resumes its bound job ahead of unrelated queued tasks and retains the write ban',{timeout:60000},async t=>{
  const output=path.resolve('artifacts/cursor-adoption-2026-10-19/review/foreground-question');await mkdir(output,{recursive:true});
  const root=await mkdtemp(path.join(output,'ui-'));
  const html=`<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Foreground question regression</title><style>body{margin:0;background:#0a0a0b;color:#ececec}#root{width:min(720px,100vw);height:950px;margin:auto}</style></head><body><div id="root"></div><script type="module">
  import React from 'react';import {createRoot} from 'react-dom/client';import '/src/styles.css';
  import {ChatPane} from '/src/components/ide/chat-pane.tsx';import {useIde} from '/src/store/ide.ts';
  import {useBrain} from '/src/lib/brain/store.ts';import {useIntern} from '/src/lib/intern.ts';import {useLearn} from '/src/lib/learn.ts';
  import {sendChat} from '/src/lib/chat-session.ts';
  await useIde.persist.rehydrate();await useLearn.persist.rehydrate();
  useBrain.setState({on:false,autoLoad:false,autoUpdate:false,autonomy:'off',jobs:Object.fromEntries(Object.keys(useBrain.getState().jobs).map(key=>[key,false]))});
  useIntern.getState().setPrefs({on:false,autoHeal:false});useLearn.setState({on:false});
  useIde.setState({setupDone:true,autoUpdate:false,workspaceCwd:'',memoryWorkspace:'synthetic-question-ui',workspaceEpoch:1,files:{'note.txt':'one'},dirs:[],openPaths:[],recentPaths:[],activePath:null,attached:[],dirty:{},editBases:{},pendingDiffs:[],checkpoints:[],chat:[],agentBusy:false,agentJob:null,agentInbox:null,agentQueue:[],agentDraft:'',backgroundAgent:false,agentMode:'agent',locale:'de',llmProvider:'custom',llmModel:'synthetic-question',llmAuthMode:'key',llmBaseUrl:'http://127.0.0.1:19381/v1',llmApiKey:'',llmThinking:'off',llmRetries:1,llmContextAuto:false,llmContext:131072,llmCompact:'off',llmToolModes:{},llmToolLearning:{},planWho:'agent',mcpServers:[],activeSurfaceId:'anvil',surfaceMode:'bridge',autoSaveDisk:false,autoAcceptDiffs:true,autoPreview:false,autoRunAgent:false,testLoop:false,runLoop:false,graphLoop:false,engineLoop:false,harnessMaxRounds:8,harnessAutoContinue:false,harnessAfterWrite:'none'});
  const requests=[];let attempted=false;const originalFetch=window.fetch.bind(window);
  const tool=(name,args)=>({tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  window.fetch=async(url,init)=>{
    const target=String(url).endsWith('/__lan')?new Headers(init?.headers).get('x-anvil-target'):String(url);
    if(!target?.startsWith('http://127.0.0.1:19381/'))return originalFetch(url,init);
    if(target.endsWith('/models'))return new Response('{"data":[{"id":"synthetic-question"}]}',{headers:{'content-type':'application/json'}});
    const payload=JSON.parse(init.body);requests.push(payload);let choice;
    if(requests.length===1)choice=tool('ask_user',{prompt:'Which fixture matters?',choices:[{id:'A',label:'Clock'},{id:'B',label:'Temperature'}],allow_text:true});
    else if(!attempted&&!payload.tools?.some(tool=>tool.function.name==='edit_file'))choice=tool('select_tools',{names:['edit_file']});
    else if(!attempted){attempted=true;choice=tool('edit_file',{path:'note.txt',old_string:'one',new_string:'two'});}
    else choice={content:'The synthetic question was answered. The actual tool result remains authoritative.'};
    const delta=choice.tool_calls?{tool_calls:choice.tool_calls.map((call,index)=>({index,...call}))}:{content:choice.content};
    return new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:choice.tool_calls?'tool_calls':'stop'}]})+'\\n\\ndata: [DONE]\\n\\n',{headers:{'content-type':'text/event-stream','x-anvil-lan':'1'}});
  };
  await sendChat({draft:'Only inspect note.txt. Do not change or repair files.',images:[],title:'Synthetic question',setTitle(){},setDraft(){},setImages(){},setMention(){}},{mode:'agent'});
  const parkedId=useIde.getState().agentJob?.id;
  useIde.setState({backgroundAgent:true});
  useIde.getState().pushAgent('Queued later question.',false,'ask');
  window.fixture={ide:useIde,requests,parkedId};
  createRoot(document.getElementById('root')).render(React.createElement(ChatPane));
  </script></body></html>`;
  const rpc={agent:['grokRound','chatWithAgent','completePrompt'],github:['cloneGithub','pushGithub'],'llm-proxy':['proxyLlm','toAnthropicMessages'],'run-server':['runRemote'],'web-fetch':['fetchWeb','readWebPage','isPrivateHost']};
  const boot=[];
  const server=await createServer({configFile:false,root:process.cwd(),publicDir:false,cacheDir:path.join(root,'vite-cache'),resolve:{alias:{'@':path.resolve('src')}},optimizeDeps:{noDiscovery:true,include:['react','react-dom','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime','zustand','zustand/vanilla','zustand/middleware','js-yaml','zod','ajv','ajv/dist/2020.js','ajv/dist/2019.js','ajv-formats','lucide-react']},server:{host:'127.0.0.1',port:0,hmr:false,watch:null},appType:'custom',plugins:[tailwindcss(),{
    name:'foreground-question-fixture',enforce:'pre',transform(_code,id){const normalized=id.replaceAll('\\','/');for(const [name,exports]of Object.entries(rpc))if(normalized.endsWith('/src/lib/'+name+'.ts'))return exports.map(name=>`export function ${name}(){throw Error('Unexpected server RPC in the synthetic question fixture: ${name}');}`).join('\n');},
    configureServer(server){server.middlewares.use('/__foreground_question',async(_req,res,next)=>{try{boot.push({event:'html-start',at:Date.now()});res.setHeader('content-type','text/html');res.end(await server.transformIndexHtml('/__foreground_question',html));boot.push({event:'html-sent',at:Date.now()});}catch(error){next(error);}});},
  }]});
  let browser;t.after(async()=>{await browser?.close();await server.close();});await server.listen();
  const origin='http://127.0.0.1:'+server.httpServer.address().port;
  // A bound HTTP port does not mean Vite's cold dependency optimizer is ready.
  // Complete that startup phase before timing the question/queue interaction.
  const client=await fetch(origin+'/@vite/client',{signal:AbortSignal.timeout(20000)});
  assert.equal(client.ok,true,'the isolated Vite client must be ready');await client.arrayBuffer();
  // The HTML proxy discovers this fixture's imports after /@vite/client is
  // ready. Warm that entry too; dependency bundling is not a button timeout.
  const bootstrap=await fetch(origin+'/__foreground_question',{signal:AbortSignal.timeout(45000)});
  assert.equal(bootstrap.ok,true);
  const transformed=await bootstrap.text();
  for(const match of transformed.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)){
    const entry=await fetch(new URL(match[1].replaceAll('&amp;','&'),origin),{signal:AbortSignal.timeout(45000)});
    assert.equal(entry.ok,true,'the isolated question entry must be ready');await entry.arrayBuffer();
  }
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  const page=await browser.newPage({viewport:{width:760,height:1000}}),errors=[];
  const pending=new Map(),completed=[];
  page.on('request',request=>pending.set(request,{url:request.url(),at:Date.now()}));
  page.on('requestfinished',request=>{const entry=pending.get(request);if(entry)completed.push({...entry,elapsed:Date.now()-entry.at});pending.delete(request);});
  page.on('requestfailed',request=>{const entry=pending.get(request);if(entry)completed.push({...entry,elapsed:Date.now()-entry.at,error:request.failure()});pending.delete(request);});
  page.setDefaultTimeout(20000);
  page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});page.on('console',message=>{if(message.type()==='error'){errors.push(message.text());console.error(message.text());}});
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  try { await page.goto(origin+'/__foreground_question',{waitUntil:'domcontentloaded'}); }
  catch(error){
    const diagnostic={boot,pending:[...pending.values()].map(entry=>({...entry,elapsed:Date.now()-entry.at})),slowest:completed.sort((a,b)=>b.elapsed-a.elapsed).slice(0,20),errors,url:page.url(),dom:await page.content().catch(()=>''),fixture:await page.evaluate(()=>window.fixture?{requests:window.fixture.requests,job:window.fixture.ide.getState().agentJob}:null).catch(()=>null)};
    await writeFile(path.join(root,'navigation-error.json'),JSON.stringify(diagnostic,null,2));
    await page.screenshot({path:path.join(root,'navigation-error.png'),fullPage:true}).catch(()=>{});
    console.log('Foreground question navigation diagnostics: '+root);throw error;
  }
  await page.getByRole('button',{name:'A Clock',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.requests.length),1,'Unrelated queued tasks wait for the question');
  await page.getByRole('button',{name:'A Clock',exact:true}).click();
  await page.waitForTimeout(400);
  await page.screenshot({path:path.join(root,'question-after-click.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>window.fixture.requests.length>1),'The actual question button must resume, rather than leave its answer behind the parked question');
  await page.waitForFunction(()=>{const state=window.fixture.ide.getState();return !state.agentBusy&&!state.agentJob&&!state.agentQueue.length;},{timeout:15000});
  const result=await page.evaluate(()=>({file:window.fixture.ide.getState().files['note.txt'],queue:window.fixture.ide.getState().agentQueue,requests:window.fixture.requests.map(payload=>payload.messages.findLast(message=>message.role==='user')?.content),steps:window.fixture.ide.getState().chat.flatMap(message=>message.steps||[])}));
  assert.equal(result.file,'one');assert.ok(result.steps.some(step=>step.name==='edit_file'&&step.status==='err'));
  const answer=result.requests.findIndex(text=>text?.includes('Antwort auf: Which fixture matters?'));
  const later=result.requests.findIndex(text=>text?.endsWith('Queued later question.'));
  assert.ok(answer>0&&later>answer,'The bound answer runs before the unrelated queued task');
  assert.deepEqual(errors,[]);await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'question-complete-narrow.png'),fullPage:true});
  await writeFile(path.join(root,'result.json'),JSON.stringify({synthetic:true,errors,boot,...result},null,2));
  console.log('Foreground question UI evidence: '+root);
});
