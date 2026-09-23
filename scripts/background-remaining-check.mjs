import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,writeFile,readFile,copyFile,cp} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {findInKind,resolveBin} from '../companion/toolchain.mjs';

/** Actual packaged bridge/worker plus real debugger and native formatter, isolated data only. */
export async function verifyBackgroundRemaining(page,fixture){
 const root=path.join(fixture,'remaining-project');await mkdir(root,{recursive:true});
 const files={'debug.cjs':'let x = 1;\nx += 2;\nconsole.log(x);\n','format.go':'package main\nfunc formatFixture(){println("formatter")}\n','trace.go':'package main\nimport "fmt"\nfunc main() {\n x := 1\n x += 2\n fmt.Println(x)\n}\n'};
 for(const [name,content]of Object.entries(files))await writeFile(path.join(root,name),content);
 const locations=await page.evaluate(()=>window.anvilNative.pathsGet());
 const relative=path.relative(path.resolve(fixture),path.resolve(locations.packages));
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'only isolated QA toolchain folder may be written');
 const gofmt=findInKind('go',['gofmt'])||resolveBin('gofmt');
 if(gofmt){const target=path.join(locations.packages,'toolchains','go','gofmt.exe');await mkdir(path.dirname(target),{recursive:true});await copyFile(gofmt,target);}
 const go=findInKind('go',['go'])||resolveBin('go');
 const goRoot=go&&path.resolve(path.dirname(go),'..');
 const canTrace=Boolean(goRoot&&existsSync(path.join(goRoot,'VERSION'))&&existsSync(path.join(goRoot,'src')));
 if(canTrace)await cp(goRoot,path.join(locations.packages,'toolchains','go','runtime'),{recursive:true});
 let factId='',release,releaseTrace,held=false,traceHeld=false,requests=0;const results=new Map(),errors=[];
 const calls=[
  ['debug_start',{path:'debug.cjs'}],['debug_step',{}],['debug_breakpoint',{path:'debug.cjs',line:3,on:true}],
  ['debug_eval',{expr:'x + 10'}],['debug_watch',{expr:'x * 2'}],['debug_continue',{}],['debug_state',{}],['debug_stop',{}],
  ['memory_add',{kind:'project',text:'QA_BACKGROUND_MEMORY: Use the synthetic fixture.'}],
  ['skill_write',{name:'qa-background-skill',when:'synthetic fixture verification',body:'1. read_file debug.cjs\n2. grep formatter\n3. run_file debug.cjs',scope:'project'}],
  ['skill_patch',{name:'qa-background-skill',body:'1. read_file debug.cjs\n2. grep formatter\n3. run_file debug.cjs\n4. Verify the synthetic result.'}],
  ['skill_run',{name:'qa-background-skill'}],['skill_outcome',{kind:'ok'}],['skill_read',{name:'qa-background-skill'}],
  ['memory_forget',()=>({id:factId})],['memory_list',{}],['format_file',{path:'format.go'}],
  ...(canTrace?[['debug_start',{path:'trace.go'}],['debug_step',{}],['debug_eval',{expr:'x'}],['debug_stop',{}]]:[]),
 ];
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),n=++requests;
  for(const message of body.messages||[])if(message.role==='tool'){
   try{const value=JSON.parse(message.content);results.set(message.tool_call_id,value);if(value.fact?.id)factId=value.fact.id;}catch{}
  }
  if(n===3){held=true;await new Promise(r=>release=r);}
  if(canTrace&&n===19){traceHeld=true;await new Promise(r=>releaseTrace=r);}
  const step=calls[n-1];const delta=step?{tool_calls:[{index:0,id:`remaining-${n}`,function:{name:step[0],arguments:JSON.stringify(typeof step[1]==='function'?step[1]():step[1])}}]}:{content:'Die isolierte Restanbindung wurde geprüft.'};
  res.writeHead(200,{'Content-Type':'text/event-stream'}).end(`data: ${JSON.stringify({choices:[{delta,finish_reason:step?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const until=async(fn,label)=>{for(let i=0;i<500;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('Remaining check timeout: '+label);};
 const status=async()=>(await page.evaluate(()=>window.anvilNative.agentJob('status'))).state;
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.evaluate(({root,files})=>window.__anvilIde.setState({setupDone:true,autoUpdate:false,locale:'de',backgroundAgent:true,workspaceCwd:root,files,dirs:[],dirty:{},pendingDiffs:[],chat:[],agentQueue:[],autoSaveDisk:false,activePath:'debug.cjs',openPaths:['debug.cjs'],planWho:'agent',autoRunAgent:false}),{root,files});
  await page.waitForTimeout(900);
  const workspace='v2:path:'+root.replaceAll('\\','/').toLowerCase();
  await page.evaluate(request=>window.anvilNative.agentJob('start',request),{project:root,files,execution:true,writeThrough:true,knowledge:{enabled:true,personEnabled:true,projectEnabled:true,skillsEnabled:true,skillBodies:true,pluginSkills:true,workspace,memories:[],skills:[],fileVersions:{},appliedEvents:[]},debug:{breakpoints:{},watches:[]},format:{tabSize:2,insertSpaces:true},messages:[{role:'user',content:'Prüfe die synthetischen Debug-, Wissens- und Formatierwerkzeuge. Nur Testdaten verwenden.'}],model:{provider:'custom',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',context:65536,thinking:'off',hardStopMin:1},maxRounds:30});
  await until(()=>held,'paused worker');const before=await status();assert.equal(before.lastDebug.paused,true);assert.equal(before.lastDebug.locals.x,'1');
  await page.reload();await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
  await until(async()=>await page.evaluate(()=>window.__anvilIde.getState().debug.paused),'debugger reconnect');
  const after=await status();assert.equal(after.lastDebug.pid,before.lastDebug.pid);assert.equal(requests,3,'renderer reload cannot repeat model call');
  await page.getByPlaceholder('x + 1',{exact:true}).fill('x + 9');await page.getByRole('button',{name:'Auswerten',exact:true}).click();
  await until(async()=>await page.evaluate(()=>window.__anvilIde.getState().debug.lastEval.includes('10')),'manual native evaluation');
  await page.locator('.monaco-editor').first().waitFor({state:'visible',timeout:30000});
  await page.screenshot({path:path.join(fixture,'remaining-debug-reconnect.png')});
  release();release=undefined;
  if(canTrace){
   await until(()=>traceHeld,'recorded Go trace');
   const explanation=page.getByText('Aufgezeichneter Programmlauf: Das Programm wurde bereits ausgeführt.',{exact:false});
   await explanation.waitFor({state:'visible',timeout:15000});
   assert.equal(await page.evaluate(()=>window.__anvilIde.getState().debug.mode),'replay');
   await explanation.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(fixture,'remaining-trace-replay.png')});
   releaseTrace();releaseTrace=undefined;
  }
  await until(async()=>['done','failed','stopped'].includes((await status()).status),'job completion');
  const state=await status();assert.equal(state.status,'done',state.error);assert.deepEqual(errors,[]);
  assert.equal(results.get('remaining-4')?.eval,'11');assert.equal(results.get('remaining-7')?.locals?.x,'3');assert.equal(results.get('remaining-7')?.watchValues?.['x * 2'],'6');
  for(let i=9;i<=16;i++)assert.equal(Boolean(results.get('remaining-'+i)?.error),false,JSON.stringify(results.get('remaining-'+i)));
  assert.ok(factId);assert.ok(results.get('remaining-14')?.uses===1);assert.ok(results.get('remaining-14')?.wins===1);assert.deepEqual(results.get('remaining-16')?.project,[]);
  const skillPath=Object.keys(state.drafts).find(p=>p.startsWith('.anvil/skills/'));assert.ok(skillPath,'skill file enters normal acknowledged drafts');
  assert.match(await readFile(path.join(root,skillPath),'utf8'),/Verify the synthetic result/);
  if(gofmt){assert.equal(results.get('remaining-17')?.ok,true,JSON.stringify(results.get('remaining-17')));assert.match(await readFile(path.join(root,'format.go'),'utf8'),/func formatFixture\(\) \{/);}
  else assert.match(results.get('remaining-17')?.error||'',/Formatter/);
  if(canTrace){
   assert.equal(results.get('remaining-18')?.mode,'replay',JSON.stringify(results.get('remaining-18')));
   assert.equal(results.get('remaining-18')?.runCompleted,true);
   assert.equal(results.get('remaining-19')?.locals?.x,'1');
   assert.equal(results.get('remaining-20')?.eval,'1');
  }
  await until(async()=>await page.evaluate(()=>JSON.parse(localStorage.getItem('anvil-learn')||'{}').state?.skills?.some(s=>s.name==='qa-background-skill'&&s.uses===1&&s.wins===1)),'renderer memory reconciliation');
  await page.reload();await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
  await page.waitForTimeout(650);assert.equal(requests,calls.length+1);
  await page.evaluate(id=>window.anvilNative.agentJob('restore',{id}),state.id);
  assert.equal(await readFile(path.join(root,'format.go'),'utf8'),files['format.go']);
  await page.evaluate(id=>window.anvilNative.agentJob('dismiss',{id}),state.id);
  return `real debugger reconnect/manual eval, memory add/forget, durable skill write/patch/run/outcome, ${gofmt?'real native Go formatting':'explicit missing formatter'}, ${canTrace?'real Go trace replay':'Go trace skipped (compiler unavailable)'}, draft restore passed`;
 }finally{release?.();releaseTrace?.();await page.evaluate(()=>window.anvilNative.agentJob('stop')).catch(()=>{});server.closeAllConnections();await new Promise(r=>server.close(r));}
}
