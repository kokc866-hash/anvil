import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron } from 'playwright';

const executable=path.resolve('artifacts/background-integrated-packages/win-unpacked/AnvilInstallerQA.exe');
const output=path.resolve('artifacts');await mkdir(output,{recursive:true});
const fixture=await mkdtemp(path.join(output,'formatter-package-'));
const profile=path.join(fixture,'data'),project=path.join(fixture,'project'),temporary=path.join(fixture,'temporary');
for(const dir of [profile,project,temporary])await mkdir(dir,{recursive:true});
const files={'example.py':'def example( x:int=1):\n  return {"message":"Grüße 🐣", "values":[x,2,3]}\n','example.cpp':'// Grüße 🐣\nint main(){if(true){return 1;}return 0;}\n'};
for(const [name,content]of Object.entries(files))await writeFile(path.join(project,name),content);
const freePort=async()=>{const s=netServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;};
const port=await freePort(),companion=await freePort();
const env={...process.env};
for(const key of Object.keys(env))if(/^(path|ELECTRON_RUN_AS_NODE|ANVIL_QA_USER_DATA|ANVIL_USER_DATA|ANVIL_HOME|ANVIL_INSTALL_DIR|ANVIL_TOOLCHAIN_HOME|ANVIL_LSP_HOME)$/i.test(key))delete env[key];
Object.assign(env,{Path:`${path.resolve('artifacts/formatter-qa-tools/Scripts')};${process.env.SystemRoot}\\System32;${process.env.SystemRoot};${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`,
  ANVIL_PORT:String(port),ANVIL_COMPANION_PORT:String(companion),ANVIL_QA_USER_DATA:profile,ANVIL_INSTALL_DIR:fixture,
  ANVIL_HOME:path.join(profile,'packages'),ANVIL_HOME_FILE:path.join(profile,'home.txt'),ANVIL_WATCHDOG:'0',TEMP:temporary,TMP:temporary,TMPDIR:temporary});
const result={fixture,executable,checks:[],errors:[],modelRequests:0,toolResults:{}};
let app,page,proc;
const server=createServer(async(req,res)=>{
  try{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);result.modelRequests++;
    for(const message of body.messages||[])if(message.role==='tool')result.toolResults[message.tool_call_id]=JSON.parse(message.content);
    const step=['example.py','example.cpp'][result.modelRequests-1];
    const delta=step?{tool_calls:[{index:0,id:'formatter-'+result.modelRequests,function:{name:'format_file',arguments:JSON.stringify({path:step})}}]}:{content:'Python und C++ wurden formatiert. Beide Testdateien sind gespeichert.'};
    res.writeHead(200,{'Content-Type':'text/event-stream'}).end(`data: ${JSON.stringify({choices:[{delta,finish_reason:step?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
  }catch(error){res.writeHead(500).end(String(error));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const until=async(fn,label)=>{for(let n=0;n<600;n++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout: '+label);};
try{
  app=await _electron.launch({executablePath:executable,args:[`--user-data-dir=${profile}`],env,timeout:60000});proc=app.process();
  await until(()=>{page=app.windows().find(w=>w.url()===`http://127.0.0.1:${port}/`);return page;},'packaged window');
  page.on('pageerror',error=>result.errors.push(error.message));
  await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated(),null,{timeout:60000});
  assert.equal(path.resolve(await app.evaluate(({app})=>app.getPath('userData'))),profile);
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http://127.0.0.1:'));window?.setSize(1440,1000);});
  assert.ok((await page.locator('body').innerText()).length>80,'packaged UI visibly loaded');
  await page.evaluate(({project,files})=>window.__anvilIde.setState({setupDone:true,autoUpdate:false,locale:'de',backgroundAgent:true,workspaceCwd:project,files,dirs:[],dirty:{},pendingDiffs:[],chat:[],agentQueue:[],autoSaveDisk:false,activePath:'example.py',openPaths:['example.py','example.cpp'],planWho:'agent',autoRunAgent:false}),{project,files});
  await page.waitForTimeout(900);
  const workspace='v2:path:'+project.replaceAll('\\','/').toLowerCase();
  await page.evaluate(request=>window.anvilNative.agentJob('start',request),{
    project,files,execution:true,writeThrough:true,
    knowledge:{enabled:true,personEnabled:true,projectEnabled:true,skillsEnabled:true,skillBodies:true,pluginSkills:true,workspace,memories:[],skills:[],fileVersions:{},appliedEvents:[]},
    format:{tabSize:4,insertSpaces:true},messages:[{role:'user',content:'Formatiere ausschließlich example.py und example.cpp im Testprojekt.'}],
    model:{provider:'custom',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'formatter-fixture',context:65536,thinking:'off',hardStopMin:1},maxRounds:8
  });
  const status=async()=>(await page.evaluate(()=>window.anvilNative.agentJob('status'))).state;
  await until(async()=>['done','failed','stopped'].includes((await status())?.status),'native formatter worker completion');
  const state=await status();assert.equal(state.status,'done',state.error);assert.equal(result.modelRequests,3);
  for(const id of ['formatter-1','formatter-2'])assert.equal(result.toolResults[id]?.ok,true,JSON.stringify(result.toolResults[id]));
  const formatted={};
  for(const name of Object.keys(files)){
    formatted[name]=await readFile(path.join(project,name),'utf8');assert.notEqual(formatted[name],files[name]);
    assert.equal(state.drafts[name].applied,true);assert.equal(state.drafts[name].after,formatted[name]);
  }
  assert.match(formatted['example.py'],/def example\(x: int = 1\):/);assert.match(formatted['example.cpp'],/\n    if/);
  await until(async()=>await page.evaluate(expected=>Object.entries(expected).every(([name,content])=>window.__anvilIde.getState().files[name]===content),formatted),'editor acknowledged formatted files');
  await page.locator('.monaco-editor').first().waitFor({state:'visible',timeout:15000});
  await page.screenshot({path:path.join(fixture,'formatted.png')});
  result.checks.push('packaged EXE launched with isolated profile and Windows plus formatter-only PATH; no external Node');
  result.checks.push('actual bundled worker called format_file for Python/Ruff and C++/clang-format; both writes acknowledged on disk and in editor');
  await page.reload();await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());await page.waitForTimeout(700);
  assert.equal(result.modelRequests,3,'reload must not repeat model or formatter requests');
  await page.evaluate(id=>window.anvilNative.agentJob('restore',{id}),state.id);
  for(const [name,content]of Object.entries(files))assert.equal(await readFile(path.join(project,name),'utf8'),content);
  await until(async()=>await page.evaluate(expected=>Object.entries(expected).every(([name,content])=>window.__anvilIde.getState().files[name]===content),files),'editor restored original files');
  await page.screenshot({path:path.join(fixture,'restored.png')});
  result.checks.push('renderer reload preserved job without replay; real Restore action recovered original Python/C++ files on disk and in editor');
  assert.deepEqual(result.errors,[]);result.checks.push('visible editor before/after restore; no uncaught page errors');
  await page.evaluate(id=>window.anvilNative.agentJob('dismiss',{id}),state.id);result.ok=true;
}catch(error){result.ok=false;result.failure=String(error.stack||error);await page?.screenshot({path:path.join(fixture,'failure.png')}).catch(()=>{});throw error;}
finally{
  if(app){const timer=setTimeout(()=>proc?.kill(),8000);try{await page?.evaluate(()=>window.anvilNative.agentJob('stop')).catch(()=>{});await app.close();}catch{}clearTimeout(timer);}
  server.closeAllConnections();await new Promise(r=>server.close(r));
  await writeFile(path.join(fixture,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
