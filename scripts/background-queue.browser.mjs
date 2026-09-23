/** Real ChatPane effects in an isolated built browser fixture. No desktop/profile/model touched. */
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {build,preview} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {chromium} from 'playwright';

const output=path.resolve('artifacts/background-queue');await mkdir(output,{recursive:true});
const fixture=await mkdtemp(path.join(output,'fixture-'));
await writeFile(path.join(fixture,'index.html'),'<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Anvil Queue Fixture</title><style>body{margin:0;background:#151515;color:#eee;font:16px sans-serif}#root{height:900px;width:950px;margin:auto}textarea{min-width:650px}button{min-height:28px}svg{width:18px;height:18px}</style></head><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>');
await writeFile(path.join(fixture,'fixture.css'),'@import "../../../src/styles.css";\n@source "../../../src";\n');
await writeFile(path.join(fixture,'fixture.tsx'),`
import React from 'react';
import './fixture.css';
import {createRoot} from 'react-dom/client';
import {ChatPane} from '@/components/ide/chat-pane';
import {useIde} from '@/store/ide';
import {useBrain} from '@/lib/brain/store';
import {useIntern} from '@/lib/intern';
import {startBackgroundAgentMonitor,useBackgroundAgent} from '@/lib/background-agent';
import {stopAgent} from '@/lib/abort';
await useIde.persist.rehydrate();
useBrain.setState({on:false,autoLoad:false,autoUpdate:false,autonomy:'off',jobs:Object.fromEntries(Object.keys(useBrain.getState().jobs).map(k=>[k,false]))});
useIntern.getState().setPrefs({on:false,autoHeal:false});
useIde.setState({setupDone:true,autoUpdate:false,workspaceCwd:'',memoryWorkspace:'browser-queue-project',workspaceEpoch:1,files:{'notes.txt':'Synthetic note'},dirs:[],openPaths:[],recentPaths:[],activePath:null,attached:[],dirty:{},pendingDiffs:[],chat:[],agentBusy:false,agentJob:null,agentInbox:null,agentQueue:[],agentDraft:'',backgroundAgent:true,backgroundWriteThrough:false,agentMode:'agent',locale:'de',llmProvider:'ollama',llmModel:'qwen3-vl',llmAuthMode:'key',llmBaseUrl:'http://127.0.0.1:1',llmApiKey:'',llmRetries:1,planWho:'agent',mcpServers:[],activeSurfaceId:'anvil',surfaceMode:'bridge',autoSaveDisk:false,autoPreview:false});
const native={mode:'hold',calls:[] as any[],state:null as any,pending:null as any};let id=0;
const job=(payload:any)=>({id:'browser-'+(++id),revision:1,project:payload.project,prompt:payload.userPrompt,status:'running',startedAt:Date.now(),text:'',thinking:'',steps:[],plan:[],drafts:{},harness:'',error:'',dismissed:false});
(window as any).anvilNative={agentJob:async(action:string,payload:any)=>{
 if(action==='start'){
  native.calls.push(payload);
  if(native.mode==='refuse')return{error:'Synthetic start refusal'};
  if(native.mode==='hold')return new Promise(resolve=>native.pending=()=>{native.state=job(payload);resolve({state:native.state});});
  native.state=job(payload);return{state:native.state};
 }
 if(action==='status')return{available:true,state:native.state};
 if(action==='dismiss'){native.state={...native.state,revision:native.state.revision+1,dismissed:true};return{state:native.state};}
 if(action==='stop'){if(native.state)native.state={...native.state,status:'stopped',revision:native.state.revision+1};return{state:native.state};}
 return{unchanged:true};
}};
useBackgroundAgent.setState({available:true,job:null,error:''});
(window as any).fixture={native,ide:useIde,bg:useBackgroundAgent,stop:stopAgent};
startBackgroundAgentMonitor();
createRoot(document.getElementById('root')!).render(<ChatPane/>);
`);
const config={configFile:false,root:fixture,publicDir:false,logLevel:'warn',resolve:{alias:{'@':path.resolve('src')}},plugins:[{
 name:'isolate-server-boundaries-and-hold-preparation',enforce:'pre',transform(code,id){
  const normalized=id.replaceAll('\\','/');
  // These are TanStack server RPC boundaries, absent from this component-only
  // harness. Fail on any use; no foreground/model execution is silently faked.
  const rpc={agent:['grokRound','chatWithAgent','completePrompt'],github:['cloneGithub','pushGithub'],'llm-proxy':['proxyLlm','toAnthropicMessages'],'run-server':['runRemote'],'web-fetch':['fetchWeb','readWebPage','isPrivateHost']};
  for(const [name,exports]of Object.entries(rpc))if(normalized.endsWith('/src/lib/'+name+'.ts'))return exports.map(name=>`export function ${name}(){throw new Error('Unexpected server RPC in background queue fixture: ${name}');}`).join('\n');
  if(!normalized.endsWith('/src/lib/background-context.ts'))return;
  const needle='export async function prepareBackgroundContext(prompt:string,images:string[]){';
  assert.ok(code.includes(needle),'preparation boundary changed: update fixture');
  return code.replace(needle,needle+'\nif ((globalThis as any).fixtureHoldPreparation) await (globalThis as any).fixtureHoldPreparation();');
 }
},react(),tailwindcss()],build:{outDir:path.join(fixture,'dist'),emptyOutDir:true,target:'esnext',minify:false}};
let server,browser;const results=[];
try{
 await build(config);
 server=await preview({...config,preview:{host:'127.0.0.1',port:0}});
 const url=server.resolvedUrls.local[0];
 browser=await chromium.launch({executablePath:process.env.ANVIL_CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const run=async(name,fn)=>{
  const context=await browser.newContext({viewport:{width:1100,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>{errors.push(error.message);console.error(name+': '+error.message);});
  page.setDefaultTimeout(10000);
  await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
  try{await page.goto(url);await page.waitForFunction(()=>window.fixture&&document.querySelector('textarea'));await fn(page);assert.deepEqual(errors,[]);await page.screenshot({path:path.join(output,name+'.png')});results.push({name,ok:true});}
  catch(error){const state=await page.evaluate(()=>window.fixture?{draft:window.fixture.ide.getState().agentDraft,queue:window.fixture.ide.getState().agentQueue,inbox:window.fixture.ide.getState().agentInbox,starts:window.fixture.native.calls.length}:null).catch(()=>null);results.push({name,ok:false,error:String(error),errors,state});console.error(name+': '+String(error)+' '+JSON.stringify(state));await page.screenshot({path:path.join(output,name+'-failed.png')}).catch(()=>{});}
  finally{await context.close();}
 };
 await run('acceptance-and-dismiss',async page=>{
  await page.evaluate(()=>window.fixture.ide.setState({agentQueue:[{text:'First queued synthetic order',mode:'agent'},{text:'Second queued synthetic order',mode:'agent'}]}));
  await page.waitForFunction(()=>window.fixture.native.calls.length===1&&window.fixture.native.pending);
  assert.equal(await page.evaluate(()=>window.fixture.ide.getState().agentQueue.length),2,'queue remains until host acceptance');
  await page.evaluate(()=>window.fixture.native.pending());
  await page.waitForFunction(()=>window.fixture.ide.getState().agentQueue.length===1);
  assert.equal(await page.evaluate(()=>window.fixture.native.calls.length),1);
  await page.evaluate(()=>{window.fixture.native.state={...window.fixture.native.state,status:'done',finishedAt:Date.now(),revision:2};});
  await page.getByRole('button',{name:'Abschließen',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.native.calls.length),1,'finished but unreviewed job blocks next');
  await page.getByRole('button',{name:'Abschließen',exact:true}).click();
  await page.waitForFunction(()=>window.fixture.native.calls.length===2);
  assert.equal(await page.evaluate(()=>window.fixture.ide.getState().agentQueue.length),1);
  await page.evaluate(()=>window.fixture.native.pending());await page.waitForFunction(()=>window.fixture.ide.getState().agentQueue.length===0);
  assert.deepEqual(await page.evaluate(()=>window.fixture.native.calls.map(p=>p.userPrompt)),['First queued synthetic order','Second queued synthetic order']);
 });
 await run('refused-queue',async page=>{
  await page.evaluate(()=>{window.fixture.native.mode='refuse';window.fixture.ide.setState({agentQueue:[{text:'Keep rejected queue order',mode:'agent'}]});});
  await page.waitForFunction(()=>window.fixture.native.calls.length===1&&!window.fixture.ide.getState().agentBusy);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>window.fixture.native.calls.length),1,'rejection must not cause retry loop');
  assert.equal(await page.evaluate(()=>window.fixture.ide.getState().agentQueue[0].text),'Keep rejected queue order');
  await page.evaluate(()=>{window.fixture.native.mode='accept';window.fixture.ide.setState({agentBusy:true});});
  await page.waitForTimeout(30);await page.evaluate(()=>window.fixture.ide.setState({agentBusy:false}));
  await page.waitForFunction(()=>window.fixture.native.calls.length===2&&window.fixture.ide.getState().agentQueue.length===0);
 });
 await run('queued-order-preserves-composer',async page=>{
  await page.locator('textarea').fill('Unsent new request must remain in the composer');
  await page.locator('input[type="file"]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+c2VQAAAAASUVORK5CYII=','base64')});
  await page.getByRole('button',{name:'Bild 1 entfernen',exact:true}).waitFor();
  await page.evaluate(()=>{window.fixture.native.mode='hold';window.fixture.ide.setState({agentQueue:[{text:'Previously queued text-only request',mode:'agent'}]});});
  await page.waitForFunction(()=>window.fixture.native.calls.length===1&&window.fixture.native.pending);
  assert.deepEqual(await page.evaluate(()=>window.fixture.native.calls[0].userImages),[],'queued task must never receive a newly attached image');
  await page.evaluate(()=>window.fixture.native.pending());await page.waitForFunction(()=>window.fixture.ide.getState().agentQueue.length===0);
  assert.equal(await page.locator('textarea').inputValue(),'Unsent new request must remain in the composer');
  assert.equal(await page.getByRole('button',{name:'Bild 1 entfernen',exact:true}).count(),1,'new image remains available for its own request');
 });
 await run('foreground-question-blocks-queue',async page=>{
  await page.evaluate(()=>{window.fixture.native.mode='accept';window.fixture.ide.setState({agentJob:{id:'question',status:'ask',goal:'Clarify',rounds:1,at:1,mode:'agent',ask:{id:'q',prompt:'Which fixture?',why:'Need a choice',choices:[{id:'A',label:'A'},{id:'B',label:'B'}],allowText:false,blocking:'hard'}},agentQueue:[{text:'Keep behind question',mode:'agent'}]});});
  await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.fixture.native.calls.length),0);assert.equal(await page.evaluate(()=>window.fixture.ide.getState().agentQueue.length),1);
  await page.evaluate(()=>window.fixture.ide.setState({agentJob:null}));
  await page.waitForFunction(()=>window.fixture.native.calls.length===1&&window.fixture.ide.getState().agentQueue.length===0);
 });
 await run('background-question-blocks-queue',async page=>{
  await page.evaluate(()=>{
   window.fixture.native.mode='accept';
   window.fixture.native.state={id:'waiting-fixture',revision:1,project:'browser-queue-project',prompt:'Initial request',status:'waiting-user',startedAt:1000,text:'',thinking:'',steps:[],plan:[],drafts:{},harness:'',error:'',dismissed:false,ask:{id:'question',prompt:'Which fixture colour?',why:'Choose before continuing.',choices:[{id:'A',label:'Blue fixture'},{id:'B',label:'Green fixture'}],allowText:false,blocking:'hard'}};
  });
  await page.getByText('Which fixture colour?',{exact:true}).waitFor();
  await page.evaluate(()=>window.fixture.ide.setState({agentQueue:[{text:'Keep behind background question',mode:'agent'}]}));
  await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.fixture.native.calls.length),0);assert.equal(await page.evaluate(()=>window.fixture.ide.getState().agentQueue.length),1);
 });
 await run('stop-during-preparation',async page=>{
  await page.evaluate(()=>{
   window.fixture.native.mode='accept';
   const wait=new Promise(resolve=>window.fixtureReleasePreparation=resolve);
   window.fixtureHoldPreparation=()=>{window.fixturePreparationEntered=true;return wait;};
  });
  await page.locator('textarea').fill('Start then stop while the context is being prepared');await page.locator('textarea').press('Enter');
  await page.waitForFunction(()=>window.fixturePreparationEntered);
  // Actual ChatPane button: no fixture call to the stop function.
  await page.getByRole('button',{name:'Abbrechen',exact:true}).click();
  await page.waitForFunction(()=>!window.fixture.ide.getState().agentBusy);
  await page.evaluate(()=>window.fixtureReleasePreparation());await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>window.fixture.native.calls.length),0,'Stop during asynchronous preparation must prevent native start');
  assert.equal(await page.locator('textarea').inputValue(),'Start then stop while the context is being prepared','cancelled preparation preserves the input');
 });
 await run('stop-during-native-acceptance',async page=>{
  await page.locator('textarea').fill('Stop while native acceptance is pending');await page.locator('textarea').press('Enter');
  await page.waitForFunction(()=>window.fixture.native.pending&&window.fixture.native.calls.length===1);
  await page.getByRole('button',{name:'Abbrechen',exact:true}).click();
  await page.waitForFunction(()=>!window.fixture.ide.getState().agentBusy);
  await page.evaluate(()=>window.fixture.native.pending());
  await page.waitForFunction(()=>window.fixture.native.state?.status==='stopped');
  assert.equal(await page.locator('textarea').inputValue(),'Stop while native acceptance is pending');
  assert.equal(await page.evaluate(()=>window.fixture.ide.getState().agentBusy),false);
 });
 await writeFile(path.join(output,'result.json'),JSON.stringify({ok:results.every(r=>r.ok),results},null,2));
 console.log(JSON.stringify(results,null,2));assert.ok(results.every(r=>r.ok),'Background queue browser scenarios failed');
}finally{await browser?.close();await server?.httpServer.close();}
