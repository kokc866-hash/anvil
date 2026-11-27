import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as socketServer} from 'node:net';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {_electron} from 'playwright';
import {verifyBuild} from './build-fingerprint.mjs';
import {verifyPackageFingerprint} from './verify-package-fingerprint.mjs';
import {previewInputFiles as files} from '../fixtures/preview-input-fixture.mjs';

const flag=(name,fallback)=>{const i=process.argv.indexOf(name);return path.resolve(i<0?fallback:process.argv[i+1]);};
const executable=process.argv.includes('--executable')?flag('--executable'):undefined;
const output=flag('--output','artifacts/preview-input-2026-10-30/desktop');await mkdir(output,{recursive:true});
const manifest=executable?await verifyPackageFingerprint(path.join(path.dirname(executable),'resources/app')):await verifyBuild(process.cwd(),true);
const profile=await mkdtemp(path.join(output,'profile-')),project=path.join(profile,'synthetic-project'),temp=path.join(profile,'temp');
await Promise.all([mkdir(project),mkdir(temp)]);
for(const [name,content]of Object.entries(files))await writeFile(path.join(project,name),content);
const socket=socketServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const requests=[],issues=[],checks=[],errors=[],consoleErrors=[];let playResult,held=false,release;
const findResult=(body,toolId)=>{
  const content=body.messages.find(m=>m.role==='tool'&&m.tool_call_id===toolId)?.content;
  assert.equal(typeof content,'string',toolId+' tool result');
  const controlsHeading='HTML preview controls (CSS pixels):\n';
  const controlsIndex=content.indexOf(controlsHeading);
  if(controlsIndex>=0) {
    // The controls payload occupies one line. Observations and next-check hints can follow it.
    const [controls]=content.slice(controlsIndex+controlsHeading.length).split('\n',1);
    const state=JSON.parse(controls);
    return {ok:/\bRUN OK\b/.test(content),state,plan_evidence_id:/Plan evidence ID: (e\d+)/.exec(content)?.[1]};
  }
  return JSON.parse(content);
};
const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  if(!req.url.endsWith('/chat/completions')){res.writeHead(200,{'Content-Type':'application/json'}).end('{"data":[]}');return;}
  const body=JSON.parse(raw),n=requests.push({at:Date.now(),tools:(body.tools||[]).map(t=>t.function.name)});
  let name,args;
  try{
    assert.ok(n<=6,'bounded test must not repeat calls');
    if(n===1){name='select_tools';args={names:['read_file','run_file','play','set_plan']};}
    if(n===2){name='read_file';args={path:'index.html'};}
    if(n===3){name='run_file';args={path:'index.html'};}
    if(n===4){
      const loaded=findResult(body,'input-3');assert.equal(loaded.ok,true);const rect=loaded.state.elements.find(e=>e.selector==='#drag').rect;
      const schema=body.tools.find(t=>t.function.name==='play').function.parameters;assert.ok(schema.properties.actions);assert.ok(!(schema.required||[]).includes('keys'));
      name='play';args={actions:[
        {type:'click',selector:'#start'},{type:'assert',selector:'#status',text:'Running'},
        {type:'key',selector:'#name',key:'a',modifiers:['Control']},{type:'type',selector:'#name',text:'Agent-Test'},{type:'assert',selector:'#name',value:'Agent-Test'},
        {type:'click',selector:'#agree'},{type:'assert',selector:'#agree',checked:true},
        {type:'click',selector:'#add',count:2},{type:'assert',selector:'#count',text:'2'},
        {type:'key',selector:'#drag',key:'Delete'},{type:'assert',selector:'#item',count:0},
        {type:'drag',x:rect.x+30,y:rect.y+30,to_x:rect.x+230,to_y:rect.y+40,duration_ms:120},{type:'assert',selector:'#drag-result',text:'Released'},
      ]};
    }
    if(n===5){
      playResult=findResult(body,'input-4');assert.equal(playResult.ok,true,playResult.error);assert.equal(playResult.functionalChecks,true);assert.equal(playResult.input.mode,'native-preview');assert.equal(playResult.input.assertions,6);
      assert.equal(typeof playResult.plan_evidence_id,'string');
      name='set_plan';args={updates:[{step:1,status:'ok',kind:'check',evidence:[playResult.plan_evidence_id],reason:'Six explicit DOM expectations passed after actual keyboard and mouse interactions.'}]};
    }
    if(n===6){assert.equal(findResult(body,'input-5').ok,true);held=true;await new Promise(r=>release=r);}
  }catch(error){issues.push(error.stack);}
  const call=name?{tool_calls:[{index:0,id:'input-'+n,function:{name,arguments:JSON.stringify(args)}}]}:{content:'PREVIEW_INPUT_OK: Sechs gezielte Vorschauerwartungen nach Tastatur-, Maus- und Texteingaben geprüft. Keine Dateien geändert. Kein vollständiger Anwendungstest behauptet.'};
  res.writeHead(200,{'Content-Type':'text/event-stream'}).end(`data: ${JSON.stringify({choices:[{delta:call,finish_reason:name?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const env={...process.env,TEMP:temp,TMP:temp,ANVIL_DESKTOP_MODE:'production',ANVIL_PORT:String(port),ANVIL_QA_USER_DATA:profile,ANVIL_HOME:path.join(profile,'packages')};delete env.ELECTRON_RUN_AS_NODE;
const until=async(fn,label)=>{for(let i=0;i<450;i++){if(issues.length)throw Error(issues.join('\n'));if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Preview desktop QA timeout: '+label);};
let app,proc,page;
try{
  app=await _electron.launch({...(executable?{executablePath:executable,args:[]}:{args:[path.resolve('fixtures/electron-boot.mjs')]}),env,timeout:45000});proc=app.process();
  await app.context().route('**/*',route=>{const req=route.request(),url=new URL(req.url()),type=req.resourceType();return url.hostname==='127.0.0.1'?route.continue():route.fulfill({status:200,contentType:type==='script'?'application/javascript':type==='stylesheet'?'text/css':'application/json',body:['script','stylesheet'].includes(type)?'':'{}'});});
  const editorUrl=`http://127.0.0.1:${port}/`;await until(()=>{page=app.windows().find(w=>w.url()===editorUrl);return page;},'editor');
  page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
  await app.evaluate(({BrowserWindow},url)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url).setSize(1500,1000),editorUrl);
  await page.evaluate(({project,files,base})=>window.__anvilIde.setState({setupDone:true,settingsOpen:false,autoUpdate:false,locale:'de',backgroundAgent:true,backgroundWriteThrough:false,agentMode:'agent',files,dirs:[],openPaths:['index.html'],activePath:'index.html',dirty:{},editBases:{},pendingDiffs:[],chat:[],agentQueue:[],agentInbox:null,workspaceCwd:project,workspaceEpoch:2,autoSaveDisk:false,autoPreview:false,llmProvider:'custom',llmAuthMode:'key',llmBaseUrl:base,llmModel:'synthetic-vision-preview',llmApiKey:'',llmContext:32768,llmContextAuto:false,llmThinking:'off',llmHardStopMin:0,autoRunAgent:false,runLoop:false,graphLoop:false,testLoop:false,engineLoop:false,harnessAfterWrite:'none',harnessAutoContinue:false,planWho:'agent',agentRules:''}),{project,files,base:`http://127.0.0.1:${server.address().port}/v1`});
  await page.locator('textarea').last().fill('Prüfe Tastatur, Maus und Texteingabe in der künstlichen HTML-Anwendung. Vergleiche sechs ausdrücklich erwartete DOM-Zustände. Keine Dateien ändern. Berichte nur die tatsächlich geprüften Fälle und ihre Grenzen.');await page.locator('textarea').last().press('Enter');
  await until(()=>held,'controlled final response');checks.push('actual play schema, action-only call and six expectations pass through model transport, worker, IPC and native Chromium');
  const snapshot=()=>page.evaluate(async()=>(await window.anvilNative.agentJob('status')).state);
  const state=await snapshot();assert.equal(state.lastPreview.functionalChecks,true);assert.equal(state.lastPreview.input.assertions,6);
  assert.equal(state.lastPreview.state.elements.find(e=>e.selector==='#name').value,'Agent-Test');
  assert.equal(state.plan[0].status,'ok');checks.push('current successful assertions support the existing checklist without a confirmation dialog');
  assert.equal(await page.getByRole('dialog',{name:'Auftragsdetails'}).count(),0);
  const preview=app.windows().find(w=>w!==page && w.url().includes('/index.html'));assert.ok(preview,'real independent preview window');
  await preview.screenshot({path:path.join(output,'native-preview.png')});
  assert.ok(await preview.evaluate(()=>window.fixture.double===1 && window.fixture.moves>=5 && !window.fixture.dragging && !window.fixtureControls.mouse.down));
  checks.push('real double-click and continuous pointer drag leave no held mouse buttons');
  await page.reload();await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());assert.equal((await snapshot()).id,state.id);assert.equal(requests.length,6);
  checks.push('renderer reload does not replay any preview action or model request');
  release();release=undefined;await until(async()=>{const s=await snapshot();return s?.status==='done';},'honest completion');
  await page.getByText(/PREVIEW_INPUT_OK:/).last().waitFor();
  await page.getByText(/angegebene Vorschauerwartungen nach der Bedienung geprüft/).last().waitFor();
  checks.push('completion describes actual checked expectations instead of merely delivered keys');
  await page.screenshot({path:path.join(output,'completed-agent.png')});
  for(const [name,content]of Object.entries(files))assert.equal(await readFile(path.join(project,name),'utf8'),content);
  checks.push('read-only test preserves every project file byte-for-byte');
  assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(issues,[]);
  const final=await snapshot();await writeFile(path.join(output,'result.json'),JSON.stringify({ok:true,source:manifest.source,outputFingerprint:manifest.outputFingerprint,profile,realModelInference:false,requests,checks,errors,consoleErrors,fixtureErrors:issues,final:{id:final.id,status:final.status,plan:final.plan,previewInput:final.lastPreview.input}},null,2));
  console.log(JSON.stringify({ok:true,checks:checks.length,output}));
}catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'failure.json'),JSON.stringify({error:error.stack,issues,requests,errors,consoleErrors},null,2));throw error;}
finally{release?.();if(app){const timer=setTimeout(()=>proc?.kill(),8000);try{await app.close();}catch{/* deadline owns this isolated QA process */}clearTimeout(timer);}server.closeAllConnections();await new Promise(r=>server.close(r));}
