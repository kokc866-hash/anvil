import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as socketServer} from 'node:net';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {_electron} from 'playwright';
import {inspectAgentPlugin} from '../src/lib/agent-plugin-package.ts';
import {agentPluginInstallFiles,pluginRecord} from '../src/lib/agent-plugin-registry.ts';
import {verifyPackageFingerprint} from './verify-package-fingerprint.mjs';
import {verifyBuild} from './build-fingerprint.mjs';

// A real packaged UI, plugin import, HTTP MCP client and independent worker.
// Model responses are synthetic; the fixture is not a real CAD/model benchmark.
const argument=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const requested=argument('--executable')||process.env.ANVIL_QA_EXECUTABLE;
const executable=path.resolve(requested||'node_modules/electron/dist/electron.exe');
const output=path.resolve(argument('--output')||'artifacts/context-discovery-2026-10-18/desktop');await mkdir(output,{recursive:true});
const manifest=requested?await verifyPackageFingerprint(path.join(path.dirname(executable),'resources/app')):await verifyBuild(process.cwd(),true);
const profile=await mkdtemp(path.join(output,'profile-')),project=path.join(profile,'synthetic-project');await mkdir(project);
const bodyMarker='ONLY_EXPLICITLY_LOADED_PLUGIN_GUIDE',referenceMarker='ONLY_REQUESTED_PLUGIN_REFERENCE',privateMarker='UNREQUESTED_PLUGIN_REFERENCE_MUST_STAY_PRIVATE';
const plugin=inspectAgentPlugin({'.codex-plugin/plugin.json':JSON.stringify({name:'discovery-desktop-fixture',license:'MIT'}),
 'skills/discovery-geometry/SKILL.md':`---\nname: discovery-geometry\ndescription: FreeCAD Fixture CAD geometry instructions for the artificial discovery test.\n---\n${bodyMarker}\nRead references/requested.md, then check only the artificial part through the named MCP fixture. Report measured dimensions and limits.\n`+'Never claim that a real CAD engine was tested.\n'.repeat(35),
 'skills/discovery-geometry/references/requested.md':referenceMarker+'\nThe artificial part must measure 20 x 30 x 40 mm.',
 'skills/discovery-geometry/references/private.md':privateMarker});
const files={...agentPluginInstallFiles(plugin,'artificial-desktop-fixture',{}),'notes.txt':'Artificial discovery project. No private files.\n'};
files[pluginRecord(plugin.id)]=JSON.stringify({...JSON.parse(files[pluginRecord(plugin.id)]),enabled:true});
for(const[file,content]of Object.entries(files)){const destination=path.join(project,file);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,content);}
const freePort=async()=>{const server=socketServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;};
const port=await freePort(),companionPort=await freePort(),checks=[],errors=[],consoleErrors=[],fixtureErrors=[],payloads=[],serviceCalls=[],serviceRequests=[];
let app,page,lane='foreground',skillId,holdRelease;
const until=async(predicate,label)=>{for(let n=0;n<450;n++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Discovery UI QA timed out: '+label);};
const service=createServer(async(req,res)=>{
 try{
  if(req.method!=='POST'){res.writeHead(req.method==='DELETE'?200:405).end();return;}
  let raw='';for await(const chunk of req)raw+=chunk;const message=JSON.parse(raw);serviceRequests.push(message.method);
  if(message.id===undefined){res.writeHead(202).end();return;}
  if(message.method==='server/discover'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}}));return;}
  let result;
  if(message.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'FreeCAD Fixture',version:'1'}};
  else if(message.method==='tools/list')result={tools:[{name:'check_geometry',description:'Check artificial FreeCAD fixture geometry and return its dimensions.',annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{part:{type:'string',enum:['fixture-part']}},required:['part'],additionalProperties:false}}]};
  else if(message.method==='resources/list')result={resources:[]};
  else if(message.method==='resources/templates/list')result={resourceTemplates:[]};
  else if(message.method==='tools/call'){
   assert.equal(message.params.name,'check_geometry');assert.deepEqual(message.params.arguments,{part:'fixture-part'});serviceCalls.push({lane,...message.params});
   result={content:[{type:'text',text:JSON.stringify({ok:true,fixtureOnly:true,dimensions:[20,30,40]})}],structuredContent:{ok:true,fixtureOnly:true,dimensions:[20,30,40]}};
  }else throw Error('Unexpected fixture method '+message.method);
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
 }catch(error){fixtureErrors.push(error.message);res.writeHead(500).end('Fixture failure');}
});
await new Promise(resolve=>service.listen(0,'127.0.0.1',resolve));
const serverConfig={id:'discovery-fixture',name:'FreeCAD Fixture',url:`http://127.0.0.1:${service.address().port}/mcp`,enabled:true,transport:'http',auth:'none',allowedTools:['check_geometry'],allowResources:false};
const api=createServer(async(req,res)=>{
 try{
  if(req.url==='/v1/models'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'synthetic-discovery'}]}));return;}
  assert.equal(req.url,'/v1/chat/completions');let raw='';for await(const chunk of req)raw+=chunk;const payload=JSON.parse(raw);
  const stage=payloads.filter(row=>row.lane===lane).length+1;payloads.push({lane,stage,payload});
  assert.ok(stage<8,'No repair/reconciliation loop');const wire=JSON.stringify(payload.messages);assert.ok(!wire.includes(privateMarker));
  const offered=payload.tools.map(tool=>tool.function.name);for(const name of ['select_tools','set_plan','ask_user'])assert.ok(offered.includes(name),name);
  if(stage===1){
   assert.ok(wire.includes('discovery-geometry'));assert.ok(!wire.includes(bodyMarker));
   if(lane==='foreground')assert.ok(!wire.includes('fixture-part'),'Cold catalog schema must not be injected');
   else assert.ok(wire.includes('fixture-part')&&wire.includes('inputSchema'),'Warm task-relevant schema is automatically preselected');
  }
  if(lane==='foreground'&&stage===3){
   const content=String(payload.messages.at(-1).content),result=JSON.parse(content.slice(content.indexOf('{')));
   skillId=result.skills.items.find(skill=>skill.name==='discovery-geometry')?.id;assert.ok(skillId);assert.ok(result.mcp.tools.some(tool=>tool.name==='check_geometry'));
  }
  const guideStage=lane==='foreground'?3:2,referenceStage=guideStage+1,actionStage=referenceStage+1;
  if(stage>guideStage)assert.ok(wire.includes(bodyMarker));
  if(stage>referenceStage)assert.ok(wire.includes(referenceMarker));
  let call;
  if(stage===1)call={name:'set_plan',args:{steps:['Skill-Anleitung lesen','Skill-Referenz lesen','Künstliche Geometrie prüfen'],kinds:['read','read','check']}};
  else if(lane==='foreground'&&stage===2)call={name:'select_tools',args:{scope:'all',query:'FreeCAD Fixture discovery geometry'}};
  else if(stage===guideStage)call={name:'skill_read',args:{name:skillId}};
  else if(stage===referenceStage)call={name:'skill_read',args:{name:skillId,resource:'references/requested.md'}};
  else if(stage===actionStage)call={name:'mcp_call',args:{server:serverConfig.id,name:'check_geometry',arguments:{part:'fixture-part'}}};
  else assert.equal(stage,actionStage+1);
  if(call)assert.ok(offered.includes(call.name),call.name+' must be offered');
  if(stage===guideStage){await new Promise(resolve=>{holdRelease=resolve;res.once('close',resolve);});if(res.destroyed)return;}
  const delta=call?{tool_calls:[{id:`${lane}-${stage}`,index:0,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]}:{content:`DISCOVERY_${lane.toUpperCase()}_OK: Die künstliche Geometrie misst 20 × 30 × 40 mm. Anleitung und angeforderte Referenz wurden gelesen. Das prüft die Anbindung; eine echte CAD-Engine war nicht beteiligt.`};
  res.writeHead(200,{'content-type':'text/event-stream'}).end(`data: ${JSON.stringify({choices:[{delta,finish_reason:call?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
 }catch(error){fixtureErrors.push(error.message);if(!res.headersSent)res.writeHead(500);res.end('Synthetic discovery fixture failed.');}
});
await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${api.address().port}/v1`;
const env={...process.env,ANVIL_DESKTOP_MODE:'production',ANVIL_PORT:String(port),ANVIL_COMPANION_PORT:String(companionPort),ANVIL_COMPANION_TOKEN:'discovery-qa-only',ANVIL_COMPANION_TOKEN_FILE:path.join(profile,'companion-token'),ANVIL_QA_USER_DATA:profile,ANVIL_USER_DATA:profile,ANVIL_HOME:path.join(profile,'packages')};delete env.ELECTRON_RUN_AS_NODE;
const result={realModelInference:false,profile,project,source:manifest.source,outputFingerprint:manifest.outputFingerprint,checks,errors,consoleErrors,fixtureErrors,serviceCalls};
try{
 app=await _electron.launch({executablePath:executable,args:requested?[]:[process.cwd()],env,timeout:45000});
 await app.context().route('**/*',route=>{const request=route.request(),url=new URL(request.url()),headers=request.headers();
  const target=headers['x-anvil-target'];
  if(url.hostname==='127.0.0.1'&&url.pathname==='/pipe'&&target&&new URL(target).origin===new URL(base).origin)return route.continue();
  if(url.hostname==='127.0.0.1'&&url.port==='7845'){url.port=String(companionPort);return route.continue({url:url.href,headers:{...headers,'x-anvil-token':'discovery-qa-only'}});}
  if([`http://127.0.0.1:${port}`,`http://127.0.0.1:${companionPort}`,new URL(base).origin,new URL(serverConfig.url).origin].includes(url.origin))return route.continue();
  return route.fulfill({status:200,contentType:'application/json',body:'{}'});
 });
 await until(()=>{page=app.windows().find(window=>window.url()===`http://127.0.0.1:${port}/`);return page;},'production window');
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
 await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1000));
 await page.evaluate(()=>{localStorage.setItem('anvil-learn',JSON.stringify({state:{on:false,prefs:{skills:true,skillBodies:true,skillAuto:true},skills:[]},version:0}));localStorage.setItem('anvil-brain',JSON.stringify({state:{on:false,autoLoad:false},version:0}));});
 await page.reload();await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
 await page.evaluate(({project,files,base,serverConfig})=>{const ide=window.__anvilIde;ide.setState({setupDone:true,settingsOpen:false,autoUpdate:false,companionKeep:false,locale:'de',workspaceCwd:project,workspaceEpoch:2,workspaceMemoryId:'discovery-desktop-fixture',
  files,dirs:[],openPaths:['notes.txt'],activePath:'notes.txt',dirty:{},pendingDiffs:[],backgroundAgent:false,backgroundWriteThrough:true,agentMode:'agent',agentQueue:[],agentInbox:null,chat:[],
  autoSaveDisk:false,suggestOn:false,liveRun:false,helperOn:false,autoPreview:false,autoRunAgent:false,runLoop:false,graphLoop:false,testLoop:false,engineLoop:false,harnessAutoContinue:false,planWho:'agent',llmContextAuto:false,llmContext:131072,llmRetries:1,mcpServers:[serverConfig],activeSurfaceId:'anvil',surfaceMode:'bridge'});
  const state=ide.getState();state.setLlmProvider('custom','key');state.setLlmBaseUrl(base);state.setLlmModel('synthetic-discovery');state.setLlmApiKey('');state.setLlmThinking('off');
 },{project,files,base,serverConfig});
 await until(()=>page.evaluate(()=>{const files=window.__anvilIde.getState().files;if(window.__qaStableFiles!==files){window.__qaStableFiles=files;window.__qaStableAt=Date.now();return false;}return Date.now()-window.__qaStableAt>600;}),'initial editor state settled');
 for(const current of ['foreground','background']){
  lane=current;holdRelease=undefined;
  await page.evaluate(background=>window.__anvilIde.setState({backgroundAgent:background,agentJob:null,agentInbox:null,agentQueue:[],chat:[],dirty:{},pendingDiffs:[]}),lane==='background');
  await page.locator('textarea').last().fill('Verwende $discovery-geometry: Skill-Anleitung und angeforderte Referenz lesen, dann die künstliche Geometrie über FreeCAD Fixture MCP prüfen. Keine Änderungen. Ergebnis und Grenzen berichten.');
  await page.locator('textarea').last().press('Enter');
  await until(async()=>{if(holdRelease)return true;const stopped=await page.evaluate(()=>{const state=window.__anvilIde.getState(),last=state.chat.at(-1);return !state.agentBusy&&last?.role==='assistant'&&last.content;});if(stopped)throw Error('Agent ended before guide read: '+stopped);return false;},'guide read held');
  const status=page.getByTestId('skill-status');await status.getByRole('button',{name:/^Skills/}).click();
  const popup=page.getByRole('dialog',{name:'Skills des letzten Auftrags'});await popup.waitFor({state:'visible'});
  assert.match(await popup.innerText(),/Vorausgewählt; Anleitung noch nicht geladen/);await page.screenshot({path:path.join(output,`${lane}-preselected.png`)});await page.keyboard.press('Escape');
  holdRelease();holdRelease=undefined;
  const marker=`DISCOVERY_${lane.toUpperCase()}_OK`;
  await until(()=>page.evaluate(marker=>{const s=window.__anvilIde.getState();return !s.agentBusy&&s.chat.at(-1)?.content.includes(marker);},marker),lane+' finished');
  const chat=await page.evaluate(()=>window.__anvilIde.getState().chat.at(-1));assert.ok(chat.plan?.length===3);assert.ok(chat.plan.every(step=>step.status==='ok'),JSON.stringify(chat.plan));
  assert.doesNotMatch(chat.content,/gespeicherten Änderungen wurden nicht/,'A service-only task must not claim that untested files were changed');
  assert.ok(chat.skillSelection.find(skill=>skill.id===skillId&&skill.loaded===true),'The actual guide load updates the preselected skill');
  await status.getByRole('button',{name:/^Skills/}).click();await popup.waitFor({state:'visible'});assert.match(await popup.innerText(),/Anleitung geladen/);await page.screenshot({path:path.join(output,`${lane}-loaded.png`)});await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(),0,'No additional selection/approval window');
  assert.doesNotMatch(await page.locator('body').innerText(),/Gesamtabnahme|Prüfergebnis speichern/);
  await page.screenshot({path:path.join(output,`${lane}-finished.png`)});
  checks.push(`${lane}: automatic metadata selection, explicit guide/reference load, actual MCP schema check and one artificial service call; checklist 3/3; no additional selection window`);
 }
 assert.equal(serviceCalls.length,2);for(const[file,content]of Object.entries(files))assert.equal(await readFile(path.join(project,file),'utf8'),content);
 assert.equal(payloads.filter(row=>row.lane==='foreground').length,6);assert.equal(payloads.filter(row=>row.lane==='background').length,5,'Warm preselection avoids the discovery round');
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(fixtureErrors,[]);result.ok=true;
 result.requestSizes=payloads.map(({lane,stage,payload})=>({lane,stage,bytes:Buffer.byteLength(JSON.stringify(payload)),tools:payload.tools.length}));result.serviceRequests=serviceRequests;
}catch(error){result.ok=false;result.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 holdRelease?.();if(page&&!result.ok){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});result.body=await page.locator('body').innerText().catch(()=>'');}
 await writeFile(path.join(output,'requests.json'),JSON.stringify(payloads,null,2));await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));
 if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
 for(const server of [api,service]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 console.log(JSON.stringify({ok:result.ok,checks,errors,consoleErrors,fixtureErrors,error:result.error?.message}));
}
