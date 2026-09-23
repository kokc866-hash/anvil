import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as socketServer} from 'node:net';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {_electron} from 'playwright';
import {execFileSync} from 'node:child_process';
import {gitBin} from '../companion/git.mjs';
await import('./pack-ui.mjs');
const output=path.resolve('artifacts/background-stage5');await mkdir(output,{recursive:true});
const profile=await mkdtemp(path.join(output,'profile-')),project=path.join(profile,'project');await mkdir(project);
await writeFile(path.join(project,'before.txt'),'original');
const git=args=>execFileSync(gitBin(),args,{cwd:project,encoding:'utf8',windowsHide:true});git(['init']);git(['config','user.name','Anvil Fixture']);git(['config','user.email','fixture@example.invalid']);git(['add','before.txt']);git(['commit','-m','initial']);
const sock=socketServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
let phase='initial',n=0,held=false,release;const ops=[];
const server=createServer(async(req,res)=>{
 let raw='';for await(const b of req)raw+=b;if(!req.url.endsWith('/chat/completions'))return res.writeHead(200,{'Content-Type':'application/json'}).end('{"data":[]}');
 const payload=JSON.parse(raw);n++;res.writeHead(200,{'Content-Type':'text/event-stream'});
 if(phase==='initial'&&n===3){held=true;await new Promise(r=>release=r);if(res.destroyed)return;}
 let call;
 if(phase==='initial'&&n===1)call={name:'set_plan',arguments:JSON.stringify({steps:['Datei verschieben','Datei lesen','Node Programm schreiben','Node ausführen','Git-Status prüfen','Commit erstellen','Ergebnisse berichten'],kinds:['edit','read','edit','run','read','service','report']})};
 if(phase==='initial'&&n===2)call={name:'rename',arguments:JSON.stringify({from:'before.txt',to:'renamed.txt'})};
 if(phase==='resume'&&n===1){assert.match(JSON.stringify(payload.messages),/Kontrollierte Wiederaufnahme/);call={name:'read_file',arguments:JSON.stringify({path:'renamed.txt'})};}
 if(phase==='resume'&&n===2)call={name:'write_file',arguments:JSON.stringify({path:'verified.cjs',content:'console.log("RESUME_AFTER_APP_CRASH_OK")'})};
 if(phase==='resume'&&n===3)call={name:'shell',arguments:JSON.stringify({command:'node verified.cjs'})};
 if(phase==='resume'&&n===4)call={name:'git_status',arguments:'{}'};
 if(phase==='resume'&&n===5)call={name:'git_commit',arguments:JSON.stringify({message:'resumed change'})};
 if(call)ops.push(call.name);
 const value=call?{delta:{tool_calls:[{index:0,id:phase+n,function:call}]},finish_reason:'tool_calls'}:{delta:{content:'Nach vollständigem Neustart abgeschlossen.'},finish_reason:'stop'};
 res.end('data: '+JSON.stringify({choices:[value]})+'\n\ndata: [DONE]\n\n');
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const env={...process.env,ANVIL_DESKTOP_MODE:'production',ANVIL_QA_USER_DATA:profile,ANVIL_HOME:path.join(profile,'packages'),ANVIL_PORT:String(port),ANVIL_WATCHDOG:'0'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;
const until=async f=>{for(let i=0;i<300;i++){if(await f())return;await new Promise(r=>setTimeout(r,100));}throw Error('Stage 5 timed out');};
async function launch(){app=await _electron.launch({args:[path.resolve('fixtures/electron-boot.mjs')],env,timeout:45000});await until(()=>{page=app.windows().find(p=>p.url()===`http://127.0.0.1:${port}/`);return page;});await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());}
try{
 await launch();await page.evaluate(({project,baseUrl})=>window.__anvilIde.setState({setupDone:true,autoUpdate:false,backgroundAgent:true,backgroundWriteThrough:true,agentMode:'agent',files:{'before.txt':'original'},dirs:[],dirty:{},pendingDiffs:[],editBases:{},chat:[],workspaceCwd:project,autoSaveDisk:false,llmProvider:'custom',llmAuthMode:'key',llmBaseUrl:baseUrl,llmModel:'fixture',llmApiKey:'',llmContext:32768,llmContextAuto:false,llmHardStopMin:1}),{project,baseUrl:`http://127.0.0.1:${server.address().port}/v1`});
 await page.locator('textarea').last().fill('Benenne before.txt um und prüfe danach einen kleinen Node-Lauf.');await page.locator('textarea').last().press('Enter');await until(()=>held);
 const initial=(await page.evaluate(()=>window.anvilNative.agentJob('status'))).state;
 assert.equal(await readFile(path.join(project,'renamed.txt'),'utf8'),'original');
 const proc=app.process();await app.evaluate(({app})=>app.exit(91));await until(()=>proc.exitCode!==null);app=null;release();release=undefined;
 phase='resume';n=0;
 await launch();await until(async()=>await page.getByRole('button',{name:'Fortsetzen',exact:true}).count()>0);
 const interrupted=(await page.evaluate(()=>window.anvilNative.agentJob('status'))).state;assert.equal(interrupted.status,'interrupted');assert.equal(interrupted.id,initial.id);
 await page.getByRole('button',{name:'Fortsetzen',exact:true}).click();
 await until(async()=>(await page.evaluate(()=>window.anvilNative.agentJob('status'))).state.status==='done');
 const done=(await page.evaluate(()=>window.anvilNative.agentJob('status'))).state;assert.equal(done.resumedFrom,initial.id);assert.equal(git(['log','-1','--format=%s']).trim(),'resumed change');assert.equal(ops.filter(x=>x==='rename').length,1);assert.ok(done.plan.every(s=>s.status==='ok'),JSON.stringify(done.plan));
 await page.getByRole('button',{name:'Dateien wiederherstellen',exact:true}).click();await until(async()=>(await page.evaluate(()=>window.anvilNative.agentJob('status'))).state.restored);
 assert.equal(await readFile(path.join(project,'before.txt'),'utf8'),'original');await assert.rejects(readFile(path.join(project,'renamed.txt')),/ENOENT/);await assert.rejects(readFile(path.join(project,'verified.cjs')),/ENOENT/);
 await page.screenshot({path:path.join(output,'restored.png')});
 await writeFile(path.join(output,'result.json'),JSON.stringify({ok:true,checks:['actual app exit and restart','explicit resume via UI','no repeated rename','new utility executes guarded Node shell','UI restores pre-original-job files'],ops},null,2));console.log('BACKGROUND_STAGE5_FULL_RESTART_AND_RESTORE_OK');
}finally{release?.();if(app)await app.close().catch(()=>{});server.closeAllConnections();await new Promise(r=>server.close(r));}
