// Opt-in, real local-model soak. All writes and Git commits use synthetic projects.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,appendFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer,isIP} from 'node:net';
import {_electron} from 'playwright';
import {gitBin} from '../companion/git.mjs';

const endpoint=process.env.ANVIL_QA_MODEL_URL,model=process.env.ANVIL_QA_MODEL;
assert.ok(endpoint&&model,'Explicit local endpoint and model required');
const url=new URL(endpoint),parts=url.hostname.split('.').map(Number);
assert.ok(!url.username&&!url.password&&url.protocol==='http:'&&(url.hostname==='localhost'||(isIP(url.hostname)===4&&(parts[0]===127||parts[0]===10||(parts[0]===192&&parts[1]===168)||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)))),'Local endpoint only');
const minutes=Number(process.env.ANVIL_QA_SOAK_MINUTES||120);
assert.ok(minutes>=1&&minutes<=480,'Bounded test window required');
const output=path.resolve('artifacts/background-soak');await mkdir(output,{recursive:true});
const fixture=await mkdtemp(path.join(output,'profile-'));
const sock=createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
const env={...process.env,ANVIL_DESKTOP_MODE:'production',ANVIL_QA_USER_DATA:fixture,ANVIL_HOME:path.join(fixture,'packages'),ANVIL_PORT:String(port),ANVIL_WATCHDOG:'0'};delete env.ELECTRON_RUN_AS_NODE;
const result={fixture,model,minutes,started:new Date().toISOString(),jobs:[],samples:0,reloads:[],pageErrors:[],failure:null};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function bounded(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(label+' timed out')),ms))]);}finally{clearTimeout(timer);}}
const git=(project,args)=>execFileSync(gitBin(),args,{cwd:project,encoding:'utf8',windowsHide:true,timeout:30000});
let app,page,started,job,stoppedByBudget=false,closing=false;
const log=async value=>{await appendFile(path.join(fixture,'watcher.jsonl'),JSON.stringify({at:new Date().toISOString(),...value})+'\n');};
async function save(){await writeFile(path.join(fixture,'result.json'),JSON.stringify(result,null,2));await writeFile(path.join(output,'latest-result.json'),JSON.stringify(result,null,2));}
async function status(){return bounded(page.evaluate(async()=>{const value=await window.anvilNative.agentJob('status');return {busy:value.busy,state:value.state};}),20000,'Agent status');}
async function createJob(index){
 const project=path.join(fixture,'project-'+index);await mkdir(project);
 const price=199+index;
 const files={
  'src/inventory.cjs':'exports.summarize = rows => ({ valueCents: rows.reduce((sum, row) => sum + row.priceCents, 0) });\n',
  'data/items.json':JSON.stringify([{category:'hardware',quantity:3,priceCents:price},{category:'stationery',quantity:2,priceCents:250},{category:'hardware',quantity:1,priceCents:1200},{category:'stationery',quantity:0,priceCents:600},{category:'invalid',quantity:-1,priceCents:10},{category:'invalid',quantity:'4',priceCents:10}],null,2),
  'debug.cjs':'let quantity = 3;\nlet price = 7;\nlet total = quantity * price;\nconsole.log(total);\n',
  'format.py':'values= [1,2,3]\nprint(sum(values))\n',
  'format.cpp':'int main(){return 0;}\n',
  'notes-old.txt':'Synthetic inventory example. Preserve this exact text.\n',
  'obsolete.txt':'Synthetic obsolete file.\n','README.md':'# Synthetic inventory\nImplementation incomplete.\n',
 };
 for(const [name,content]of Object.entries(files)){await mkdir(path.dirname(path.join(project,name)),{recursive:true});await writeFile(path.join(project,name),content);}
 git(project,['init']);git(project,['config','user.name','Anvil Fixture']);git(project,['config','user.email','fixture@example.invalid']);git(project,['add','.']);git(project,['commit','-m','initial fixture']);
 await page.evaluate(({project,files,endpoint,model})=>window.__anvilIde.setState({setupDone:true,autoUpdate:false,locale:'de',backgroundAgent:true,workspaceCwd:project,files,dirs:['src','data'],dirty:{},editBases:{},pendingDiffs:[],chat:[],agentQueue:[],autoSaveDisk:false,activePath:'src/inventory.cjs',openPaths:['src/inventory.cjs'],planWho:'agent',autoRunAgent:false,provider:'ollama',baseUrl:endpoint,model}),{project,files,endpoint,model});
 await sleep(1000);
 const workspace='v2:path:'+project.replaceAll('\\','/').toLowerCase();
 const request={project,files,execution:true,writeThrough:true,locale:'de',maxRounds:256,autoContinue:true,
  knowledge:{enabled:true,personEnabled:true,projectEnabled:true,skillsEnabled:true,skillBodies:true,pluginSkills:true,workspace,memories:[],skills:[],fileVersions:{},appliedEvents:[]},
  format:{tabSize:2,insertSpaces:true},debug:{breakpoints:{},watches:[]},
  messages:[{role:'user',content:`Vervollständige dieses künstliche Inventarprojekt sorgfältig. Keine Downloads, externen Dienste oder Pushes. Du darfst alle bereitgestellten lokalen Projektwerkzeuge verwenden. Kein Zeitdruck; arbeite bis zum Abschluss.
1. Lies die Dateien und führe eine Checkliste. Implementiere summarize(rows) in src/inventory.cjs. Gültig sind Objekte mit nichtleerem category-String und ganzzahligen nichtnegativen quantity und priceCents. Strings nicht in Zahlen umwandeln. Ungültige Zeilen ignorieren. Ergebnis: {validRows,ignoredRows,units,valueCents,categories}; categories alphabetisch nach name sortieren, je Kategorie {name,units,valueCents}. valueCents ist quantity * priceCents aufsummiert. Die Eingabe unverändert lassen.
2. Implementiere cli.cjs, die die JSON-Datei aus dem ersten Argument liest und ausschließlich die JSON-Auswertung ausgibt. Fehlendes Argument oder ungültige Datei: Meldung auf stderr und Exitcode 1. Schreibe tests/inventory.test.cjs mit Node assert ohne zusätzliche Pakete. Prüfe Beispieldaten, leere Eingabe, ungültige Zeilen, quantity null und nullwertige Felder, quantity 0 sowie unveränderte Eingabe.
3. Führe die Tests tatsächlich mit shell aus. Prüfe node cli.cjs data/items.json. Erwartet: validRows 4, ignoredRows 2, units 6, valueCents ${3*price+1700}. Bei einem absichtlich erwarteten Exitcode 1 setze expected_exit_code:1; repariere keinen erwarteten Fehler.
4. Prüfe debug.cjs mit debug_start, Haltepunkt, Schritten, debug_eval und debug_watch. Prüfe total=21 nach dessen Zuweisung. Beende die Debug-Sitzung danach mit debug_stop. Falls ein Debugger wegen Zeitlimit schließt, melde dies korrekt und setze die anderen Aufgaben fort.
5. Formatiere format.py und format.cpp mit format_file. Beide Dateien sollen dieselbe Funktion behalten. Falls ein Werkzeug fehlt, dokumentiere das ehrlich; keine Installation versuchen.
6. Speichere mit memory_add eine projektbezogene Regel: Geldbeträge in diesem Test sind ganzzahlige Cent. Schreibe mit skill_write einen Projekt-Skill zur Prüfung dieser Inventarauswertung, ergänze ihn mit skill_patch, nutze ihn mit skill_run und melde erst nach tatsächlichem Prüfen skill_outcome.
7. Verschiebe notes-old.txt unverändert nach docs/notes.md und lösche obsolete.txt. Dokumentiere Anwendung, Tests und Grenzen in README.md. Prüfe git_status und erstelle mit git_commit einen lokalen Commit mit Nachricht Inventory completed. Keine Dateiänderungen nach dem abschließenden Commit.
8. Aktualisiere die Checkliste ehrlich anhand der tatsächlichen Ergebnisse und antworte kurz mit Ergebnis und noch offenen Punkten. Endlosschleifen vermeiden: nach zwei gleichen erfolglosen Versuchen Ursache benennen und andere Punkte fortsetzen.`}],
  model:{provider:'ollama',baseUrl:endpoint,model,apiKey:'',context:65536,thinking:'low',temperature:0,maxOut:8192,hardStopMin:0,toolMode:'standard'}};
 const response=await page.evaluate(request=>window.anvilNative.agentJob('start',request),request);
 assert.ok(response.state?.id,'Real background job started');
 const current={index,project,id:response.state.id,started:new Date().toISOString(),price,files};
 await log({event:'job-started',id:current.id,index});return current;
}
async function checkJob(current,state){
 const checks={},errors={};
 const check=async(name,fn)=>{try{await fn();checks[name]=true;}catch(error){checks[name]=false;errors[name]=String(error.message||error).slice(0,1200);}};
 const expected={validRows:4,ignoredRows:2,units:6,valueCents:3*current.price+1700,categories:[{name:'hardware',units:4,valueCents:3*current.price+1200},{name:'stationery',units:2,valueCents:500}]};
 await check('calculation',()=>execFileSync(process.execPath,['-e',`const a=require('node:assert/strict');const {summarize}=require('./src/inventory.cjs');const rows=require('./data/items.json'),before=JSON.stringify(rows);a.deepEqual(summarize(rows),${JSON.stringify(expected)});a.equal(JSON.stringify(rows),before);a.deepEqual(summarize([]),{validRows:0,ignoredRows:0,units:0,valueCents:0,categories:[]});a.deepEqual(summarize([null,{}, {category:'x',quantity:null,priceCents:3},{category:'x',quantity:1,priceCents:null}]),{validRows:0,ignoredRows:4,units:0,valueCents:0,categories:[]});`],{cwd:current.project,timeout:15000,windowsHide:true,stdio:'pipe'}));
 await check('cli',()=>assert.deepEqual(JSON.parse(execFileSync(process.execPath,['cli.cjs','data/items.json'],{cwd:current.project,timeout:15000,windowsHide:true,encoding:'utf8'})),expected));
 await check('files',async()=>{assert.equal(await readFile(path.join(current.project,'docs/notes.md'),'utf8'),current.files['notes-old.txt']);assert.ok(!existsSync(path.join(current.project,'notes-old.txt'))&&!existsSync(path.join(current.project,'obsolete.txt')));});
 await check('commit',()=>{assert.equal(git(current.project,['log','-1','--format=%s']).trim(),'Inventory completed');assert.equal(git(current.project,['diff','--name-only','HEAD']).trim(),'');});
 await check('pythonFormat',async()=>assert.match(await readFile(path.join(current.project,'format.py'),'utf8'),/values = \[1, 2, 3\]/));
 await check('cppFormat',async()=>assert.match(await readFile(path.join(current.project,'format.cpp'),'utf8'),/int main\(\) \{/));
 const okTools=state.steps.filter(s=>s.status==='ok').map(s=>s.name);
 for(const name of ['shell','debug_start','debug_eval','debug_stop','memory_add','skill_write','skill_patch','skill_run','skill_outcome'])checks[name]=okTools.includes(name);
 checks.plan=state.plan?.length>0&&state.plan.every(p=>p.status==='ok');
 return {index:current.index,id:current.id,project:current.project,started:current.started,ended:new Date().toISOString(),status:state.status,error:state.error,checks,errors,allChecksPassed:Object.values(checks).every(Boolean),steps:state.steps,plan:state.plan,reply:state.text};
}
try{
 app=await _electron.launch({args:[path.resolve('fixtures/electron-boot.mjs')],env,timeout:60000});
 for(let i=0;i<600;i++){page=app.windows().find(w=>w.url()===`http://127.0.0.1:${port}/`);if(page)break;await sleep(100);}
 assert.ok(page,'Production desktop window present');
 page.on('pageerror',error=>result.pageErrors.push({at:new Date().toISOString(),message:error.message}));
 await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated(),null,{timeout:60000});
 started=Date.now();job=await createJob(1);let nextReload=30*60000,nextSample=0;
 await save();console.log(JSON.stringify({event:'SOAK_STARTED',fixture,model,minutes,pid:app.process().pid}));
 while(Date.now()-started<minutes*60000){
  const {state}=await status();
  if(Date.now()-started>=nextSample){
   const health=await bounded(page.evaluate(()=>({visible:document.body.innerText.length,context:document.body.innerText.match(/Kontext[^\n]*/)?.[0],debug:window.__anvilIde.getState().debug.active})),15000,'Renderer health');
   assert.ok(health.visible>100,'Visible application remains rendered');
   const metrics=await bounded(app.evaluate(({app})=>app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,cpu:p.cpu.percentCPUUsage,memory:p.memory.workingSetSize}))),15000,'Process metrics');
   const sample={event:'sample',seconds:Math.round((Date.now()-started)/1000),id:state.id,status:state.status,steps:state.steps.length,lastTool:state.steps.at(-1)?.name,thinking:state.thinking.length,health,metrics};
   await log(sample);await writeFile(path.join(fixture,'last-state.json'),JSON.stringify(state,null,2));
   result.samples++;result.elapsedSeconds=sample.seconds;result.current={id:state.id,status:state.status,steps:state.steps.length};await save();console.log(JSON.stringify({seconds:sample.seconds,status:state.status,steps:sample.steps,lastTool:sample.lastTool}));nextSample+=60000;
  }
  if(['done','failed','stopped','interrupted'].includes(state.status)){
   result.jobs.push(await checkJob(job,state));await save();await log({event:'job-ended',id:state.id,status:state.status});
   await page.screenshot({path:path.join(fixture,'job-'+job.index+'.png')});
   if(state.status!=='done'){result.endReason='job-'+state.status;break;}
   await page.evaluate(id=>window.anvilNative.agentJob('dismiss',{id}),state.id);job=await createJob(job.index+1);
  }
  if(Date.now()-started>=nextReload){
   const before=(await status()).state;await page.reload();await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated(),null,{timeout:60000});
   const after=(await status()).state;assert.equal(after.id,before.id,'Window reload preserves same background job');
   result.reloads.push({at:new Date().toISOString(),id:after.id,stepsBefore:before.steps.length,stepsAfter:after.steps.length});await log({event:'renderer-reloaded',id:after.id});nextReload+=30*60000;
  }
  await sleep(5000);
 }
 if(!result.endReason){
  result.endReason='time-window-ended';stoppedByBudget=true;
  await bounded(page.evaluate(()=>window.anvilNative.agentJob('stop')),20000,'Stop');
  for(let i=0;i<30;i++){const current=await status();if(['done','stopped','failed'].includes(current.state.status)&&!current.busy)break;await sleep(1000);}
  const final=(await status()).state;assert.ok(['done','stopped','failed'].includes(final.status),'Job stops at test boundary');
  result.jobs.push(await checkJob(job,final));
 }
 await page.screenshot({path:path.join(fixture,'final.png')});
 result.stabilityPassed=result.pageErrors.length===0&&result.endReason==='time-window-ended';
 result.durationCompleted=Date.now()-started>=minutes*60000;
}catch(error){result.failure=String(error.stack||error);result.stabilityPassed=false;process.exitCode=1;await log({event:'failure',error:result.failure});await page?.screenshot({path:path.join(fixture,'failure.png'),timeout:5000}).catch(()=>{});}
finally{
 result.stoppedByBudget=stoppedByBudget;result.elapsedSeconds=started?Math.round((Date.now()-started)/1000):0;result.ended=new Date().toISOString();
 if(app&&!closing){closing=true;try{await bounded(app.close(),20000,'Close desktop');result.closedCleanly=true;}catch(error){result.closedCleanly=false;result.closeError=String(error);app.process()?.kill();}}
 await save();console.log(JSON.stringify({event:'SOAK_FINISHED',fixture,stabilityPassed:result.stabilityPassed,seconds:result.elapsedSeconds,jobs:result.jobs.length,failure:result.failure}));
}
