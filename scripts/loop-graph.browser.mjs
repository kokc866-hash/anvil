import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { _electron } from 'playwright';
import { rebuildBoardFromGraph, filesFromBoard } from '../src/lib/harness-board.ts';
import { AgentWorkflow } from '../src/lib/agent-workflow.ts';
import { workflowJournalPath } from '../electron/workflow-journal.mjs';

// Only synthetic workspace content and a separate native profile. No model request.
const output=path.resolve('artifacts/loop-graph-implementation-2026-10-06/browser');await mkdir(output,{recursive:true});
const profile=await mkdtemp(path.join(output,'profile-'));
const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const url=`http://127.0.0.1:${port}/`;
const settings={runLoop:true,graphLoop:true,testLoop:true,engineLoop:false,afterWrite:'run',loopTries:3,maxRounds:12};
const sources={'main.py':'print(1)','test_main.py':'def test_ok():\n    assert True','index.html':'<p>Synthetic preview</p>','project.godot':'config_version=5\n[application]\nconfig/name="Synthetic QA"'};
const board=rebuildBoardFromGraph([
  {id:'fixture-disabled',edge:'preview',tool:'see_run',phase:'see',condition:'success',when:'Bewusst ausgeschaltete Aufnahme',glob:'*.html',enabled:false},
  {id:'fixture-disconnected',edge:'run',tool:'run_file',phase:'observe',condition:'changed',when:'Bewusst getrennte Ausführung',glob:'*.py',args:{path:'main.py'}},
],settings);
board.wires=board.wires.filter(wire=>wire.to!=='fixture-disconnected');
const files={...sources,...filesFromBoard(board,settings)};
const workflow=new AgentWorkflow(sources,settings,['run_file','mcp_call'],undefined,'fixture-renderer');await workflow.update(sources);
const check=await workflow.begin('run_file',{path:'test_main.py'},'fixture-check');workflow.finish(check.id,'run_file',{path:'test_main.py'},{ok:true,running:true});
await workflow.begin('mcp_call',{server:'fixture',name:'create',arguments:{synthetic:true}});
const snapshot=JSON.parse(JSON.stringify(workflow.snapshot()));snapshot.operations.at(-1).status='unclear';snapshot.phase='patch';
const env={...process.env,ANVIL_DESKTOP_MODE:'production',ANVIL_PORT:String(port),ANVIL_QA_USER_DATA:profile,ANVIL_HOME:path.join(profile,'packages')};delete env.ELECTRON_RUN_AS_NODE;
let app,checking=false;const errors=[],consoleErrors=[],blockedRequests=[],failedRequests=[];
const deadline=setTimeout(()=>{app?.process()?.kill();process.exitCode=1;},90000);
const prefs=state=>({runLoop:state.runLoop,graphLoop:state.graphLoop,testLoop:state.testLoop,engineLoop:state.engineLoop,afterWrite:state.afterWrite});
try{
  app=await _electron.launch({args:[path.resolve('fixtures/electron-boot.mjs')],env});
  let page;
  for(let i=0;i<240;i++){page=app.windows().find(item=>item.url()===url);if(page)break;await new Promise(resolve=>setTimeout(resolve,250));}
  assert.ok(page,'Production main window must appear');page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(checking&&message.type()==='error')consoleErrors.push({message:message.text(),resource:message.location().url});});
  page.on('requestfailed',request=>failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
  await page.route('**/*',route=>{const target=new URL(route.request().url());
    // The isolated QA uses Anvil's existing system-font fallback. No remote font download.
    if(target.hostname==='fonts.googleapis.com')return route.fulfill({status:200,contentType:'text/css',body:'/* Offline QA: platform fonts. */'});
    if(target.protocol==='http:'&&!['127.0.0.1','localhost'].includes(target.hostname)||target.protocol==='https:'){blockedRequests.push(target.origin+target.pathname);return route.abort();}return route.continue();});
  checking=true;await page.reload();
  await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(item=>!item.isDestroyed());window?.setSize(1800,1000);});
  await page.evaluate(({files,snapshot,settings})=>{
    const store=window.__anvilIde;
    store.setState({setupDone:true,autoUpdate:false,workspaceCwd:'',workspaceMemoryId:'workflow-qa',files,dirty:{},autoSaveDisk:false,autoRunAgent:false,autoPreview:false,mcpServers:[],agentBusy:false,agentJob:null,
      runLoop:settings.runLoop,graphLoop:settings.graphLoop,testLoop:settings.testLoop,engineLoop:settings.engineLoop,harnessAfterWrite:settings.afterWrite,harnessMaxRounds:settings.maxRounds,
      panels:{editor:true,agent:false,trail:false,output:false},sidebar:null,chat:[{id:'qa-assistant',role:'assistant',content:'Diese Anzeige verwendet künstliche Prüfdaten.',workflow:snapshot}]});
    store.getState().setHarnessBoardOpen(true);
  },{files,snapshot,settings});
  await page.getByLabel('Ablaufvorlage',{exact:true}).waitFor();
  const before=await page.evaluate(()=>{const state=window.__anvilIde.getState();return {runLoop:state.runLoop,graphLoop:state.graphLoop,testLoop:state.testLoop,engineLoop:state.engineLoop,afterWrite:state.harnessAfterWrite};});
  for(const [id,target] of [['code-tests','main.py'],['html-preview','index.html'],['engine-check','godot:']]){
    await page.getByLabel('Ablaufvorlage',{exact:true}).selectOption(id);
    await page.getByLabel('Projektziel',{exact:true}).selectOption(target);
    await page.getByRole('button',{name:'Vorlage ergänzen',exact:true}).click();
    await page.getByRole('button',{name:'Speichern',exact:true}).first().click();
    const saved=await page.evaluate(()=>{const state=window.__anvilIde.getState();return {graph:JSON.parse(state.files['.anvil/graph.json']),board:JSON.parse(state.files['.anvil/board.json']),runLoop:state.runLoop,graphLoop:state.graphLoop,testLoop:state.testLoop,engineLoop:state.engineLoop,afterWrite:state.harnessAfterWrite};});
    assert.deepEqual(prefs(saved),before,'Import must preserve current settings');assert.ok(saved.graph.recipes.some(recipe=>recipe.id===id&&recipe.version===1));
    assert.equal(saved.graph.edges.some(edge=>['fixture-disabled','fixture-disconnected'].includes(edge.id)),false);
    assert.equal(saved.board.nodes.find(node=>node.id==='fixture-disabled').edge.enabled,false);assert.equal(saved.board.wires.some(wire=>wire.to==='fixture-disconnected'),false);
    await page.evaluate(()=>window.__anvilIde.getState().setHarnessBoardOpen(false));
    await page.evaluate(()=>window.__anvilIde.getState().setHarnessBoardOpen(true));
    await page.getByLabel('Ablaufvorlage',{exact:true}).waitFor();
  }
  assert.ok(await page.getByLabel('Gesicherter Ablauf').getByText('Wartet auf Nachweis',{exact:true}).count());
  await page.getByText('Ein Aktionsabschluss ist unbestätigt.',{exact:false}).waitFor();
  const native=await page.evaluate(async({project,snapshot})=>{
    const written=await window.anvilNative.agentJob('workflow-write',{project,snapshot});
    const loaded=await window.anvilNative.agentJob('workflow-read',{project,id:snapshot.id});
    const other=await window.anvilNative.agentJob('workflow-read',{project:project+'-other',id:snapshot.id});
    return {written,loaded,other};
  },{project:profile,snapshot});
  assert.equal(native.written.ok,true);assert.deepEqual(native.loaded.snapshot,snapshot);assert.equal(native.other.snapshot,null);
  assert.deepEqual(JSON.parse(await readFile(workflowJournalPath(path.join(profile,'agent-workflows'),profile,snapshot.id),'utf8')),snapshot);
  await page.getByRole('button',{name:'Einpassen (0)'}).click();
  const rectangles=await page.locator('[data-node]').evaluateAll(nodes=>nodes.map(node=>{const rect=node.getBoundingClientRect();return {id:node.getAttribute('data-node'),left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom};}));
  for(let i=0;i<rectangles.length;i++)for(let j=i+1;j<rectangles.length;j++){
    const a=rectangles[i],b=rectangles[j];assert.equal(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,false,`Rendered nodes overlap: ${a.id} / ${b.id}`);
  }
  await page.screenshot({path:path.join(output,'desktop.png')});
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(item=>!item.isDestroyed());window?.setSize(1120,800);});
  await page.getByRole('button',{name:'Einpassen (0)'}).click();
  await page.screenshot({path:path.join(output,'smaller-window.png')});
  const visible=await page.evaluate(()=>({text:document.body.innerText.length,width:innerWidth,height:innerHeight,vite:Boolean(document.querySelector('script[src*="@vite/client"]')),horizontalOverflow:document.documentElement.scrollWidth>innerWidth}));
  await writeFile(path.join(output,'requests.json'),JSON.stringify({blockedRequests,failedRequests,errors,consoleErrors},null,2));
  // Only the exact deliberately blocked template asset may generate an expected
  // offline resource message. Runtime errors and every other resource error fail QA.
  const expectedOfflineResourceErrors=consoleErrors.filter(error=>error.message==='Failed to load resource: net::ERR_FAILED'&&error.resource==='https://grok.com/grok-app-builder/extensions.js'&&blockedRequests.includes(error.resource));
  const unexpectedConsoleErrors=consoleErrors.filter(error=>!expectedOfflineResourceErrors.includes(error));
  assert.ok(visible.text>200);assert.equal(visible.vite,false);assert.equal(visible.horizontalOverflow,false);assert.deepEqual(errors,[]);assert.deepEqual(unexpectedConsoleErrors,[]);
  const result={ok:true,production:true,syntheticModelOnly:true,externalFonts:'disabled in QA; existing system fallback',recipes:['code-tests','html-preview','engine-check'],settingsPreserved:true,disabledAndDisconnectedPreserved:true,renderedNodes:rectangles.length,nodeOverlap:false,nativeJournalConfirmed:true,isolatedProjectScopes:true,errors,consoleErrors:unexpectedConsoleErrors,expectedOfflineResourceErrors,visible};
  await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
  clearTimeout(deadline);
  if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
}
