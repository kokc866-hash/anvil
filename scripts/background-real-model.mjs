import {AgentJobHost} from '../electron/agent-job-host.mjs';
import {AgentProjectRuntime} from '../electron/agent-project-runtime.mjs';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fork,execFileSync} from 'node:child_process';
import {gitBin} from '../companion/git.mjs';
import assert from 'node:assert/strict';
const endpoint=process.env.ANVIL_QA_MODEL_URL,model=process.env.ANVIL_QA_MODEL;
assert.ok(endpoint&&model,'Explicit local test model required');
const started=Date.now(),output=resolve('artifacts/stage5-real-model');mkdirSync(output,{recursive:true});const project=mkdtempSync(join(output,'project-'));
const files={'check.cjs':'console.log("MIXED_TEST_OK")\n','notes.txt':'Noch offen\n'};
for(const [p,c]of Object.entries(files))writeFileSync(join(project,p),c);
const git=args=>execFileSync(gitBin(),args,{cwd:project,encoding:'utf8',windowsHide:true});
git(['init']);git(['config','user.name','Anvil Fixture']);git(['config','user.email','fixture@example.invalid']);git(['add','check.cjs','notes.txt']);git(['commit','--allow-empty','-m','initial fixture']);
const host=new AgentJobHost({snapshotPath:join(project,'job-state','latest.json'),runtime:new AgentProjectRuntime(),launch:()=>fork(resolve('agent-build/worker.mjs'),[],{stdio:['ignore','ignore','inherit','ipc']})});
const image='data:image/png;base64,'+readFileSync(resolve('artifacts/background-stage4/preview.png')).toString('base64');
let last='';host.on('change',()=>{const s=host.state,progress=JSON.stringify({status:s.status,step:s.steps.at(-1)?.name,count:s.steps.length,chars:s.thinking.length});if(progress!==last){last=progress;console.log(progress);}});
const timer=setTimeout(()=>host.stop('Praxistest-Zeitbudget erreicht.'),20*60000);
try{
 host.start({project,execution:true,writeThrough:true,files,messages:[{role:'user',content:'Arbeite diese kleine Prüfaufgabe vollständig ab: 1. Lies das beigefügte Bild und schreibe dessen große Überschrift sowie den angezeigten Zählerwert in notes.txt. 2. Benenne check.cjs in verified.cjs um. 3. Führe node verified.cjs mit shell aus. 4. Prüfe git_status und erstelle einen lokalen Commit mit git_commit (Nachricht: Bild und Ablauf geprüft). Keine Netzwerkdienste und kein Push. Antworte zum Schluss kurz mit den tatsächlichen Ergebnissen.',images:[image]}],model:{provider:'ollama',baseUrl:endpoint,model,vision:true,apiKey:'',context:32768,thinking:'low',temperature:0,maxOut:4096,hardStopMin:5,toolMode:'standard'},maxRounds:24,autoContinue:false,locale:'de'});
 while(host.busy())await new Promise(r=>setTimeout(r,1000));
 const state=host.state,notes=readFileSync(join(project,'notes.txt'),'utf8');
 const checks={finished:state.status==='done',imageRead:/Bild im Hintergrund/i.test(notes)&&/0/.test(notes),renamed:Object.hasOwn(state.drafts,'verified.cjs'),shell:state.steps.some(s=>s.name==='shell'&&s.status==='ok'),commit:state.steps.some(s=>s.name==='git_commit'&&s.status==='ok')};
 const report=JSON.stringify({checks,status:state.status,error:state.error,reply:state.text,notes,model,steps:state.steps,plan:state.plan,durationSeconds:Math.round((Date.now()-started)/1000)},null,2);writeFileSync(join(output,'result.json'),report);writeFileSync(join(project,'result.json'),report);console.log(JSON.stringify(checks));
 assert.ok(Object.values(checks).every(Boolean),'Inspect real model result for incomplete steps');
}finally{clearTimeout(timer);await host.close();}
