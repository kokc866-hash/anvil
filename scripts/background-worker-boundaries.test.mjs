import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {fork} from 'node:child_process';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {AgentJobHost} from '../electron/agent-job-host.mjs';
import {AgentKnowledge} from '../electron/agent-knowledge.mjs';
import {buildAgentRuntime} from './build-agent-runtime.mjs';

test('worker learns safe tool dialects, parks questions and performs final autorun at most once per snapshot',async()=>{
  mkdirSync('artifacts',{recursive:true});const root=mkdtempSync(resolve('artifacts','worker-boundaries-')),build=join(root,'worker');await buildAgentRuntime(build);
  const counts=new Map(),payloads=new Map();
  const api=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const payload=JSON.parse(body),scenario=payload.model,n=(counts.get(scenario)||0)+1;counts.set(scenario,n);
    payloads.set(scenario,[...(payloads.get(scenario)||[]),payload]);
    let call;
    if(scenario==='learning'&&n===1)call={name:'read_file',arguments:{filename:'main.cjs'}};
    if(scenario==='question'&&n===1)call={name:'ask_user',arguments:{prompt:'Welche Farbe verwenden?',choices:[{id:'A',label:'Blau'},{id:'B',label:'Rot'}],allow_text:false}};
    if((scenario==='autorun'||scenario==='already-ran')&&n===1)call={name:'edit_file',arguments:{path:'main.cjs',old_string:'old',new_string:'new'}};
    if(scenario==='already-ran'&&n===2)call={name:'run_file',arguments:{path:'main.cjs'}};
    if(scenario==='format'&&n===1)call={name:'format_file',arguments:{path:'main.cjs'}};
    if(scenario==='knowledge'&&n<=3)call={name:['memory_list','skill_list','skill_read'][n-1],arguments:n===3?{name:'fixture'}:{}};
    if(scenario==='fetch'&&n===1)call={name:'fetch_url',arguments:{url:'https://example.test/docs'}};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end('data: '+JSON.stringify({choices:[{delta:call?{tool_calls:[{index:0,id:'call-'+n,function:{name:call.name,arguments:JSON.stringify(call.arguments)}}]}:{content:'Erledigt.'},finish_reason:call?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(r=>api.listen(0,'127.0.0.1',r));
  try{
    for(const scenario of ['learning','question','autorun','already-ran','python-types','js-types','ts-types','background-ts-types','background-py-syntax','background-json-syntax','format','knowledge','knowledge-disabled','knowledge-no-bodies','knowledge-no-skills','fetch']){
      const operations=[];
      const knowledge=new AgentKnowledge({storagePath:join(root,scenario+'-knowledge.json')}),workspace=`v2:path:${root.replaceAll('\\','/').toLowerCase()}`;
      const host=new AgentJobHost({snapshotPath:join(root,scenario+'.json'),runtime:{begin(request,id){knowledge.begin(request,id);},knowledgeEvents(){return knowledge.events();},finish(){},close(){knowledge.close();},async execute(op,context){operations.push(op);if(op.kind==='knowledge')return knowledge.execute(op,context);return op.kind==='fetch'?{ok:true,text:'SYNTHETIC_WEB_CONTENT'}:op.kind==='verify'?{ok:true,detail:'Synthetic syntax check passed',scopes:{syntax:op.paths,types:scenario.endsWith('ts-types')?op.paths:[]}}:{ok:true,applied:true,code:0,stdout:'passed',stderr:''};}},launch:()=>fork(join(build,'worker.mjs'),[],{stdio:['ignore','ignore','inherit','ipc']})});
      try{
        const path=scenario==='python-types'||scenario==='background-py-syntax'?'main.py':scenario==='background-json-syntax'?'main.json':scenario.endsWith('ts-types')?'main.ts':'main.cjs',source=scenario==='python-types'?'pyright':scenario==='background-py-syntax'?'background:py':scenario==='background-json-syntax'?'background:json-syntax':scenario==='background-ts-types'?'background:typescript':scenario==='ts-types'?'tsc':'typescript';
        host.start({project:root,execution:true,files:{[path]:'console.log("old");'},format:{tabSize:4},knowledge:scenario.startsWith('knowledge')?{enabled:scenario!=='knowledge-disabled',skillsEnabled:scenario!=='knowledge-no-skills',skillBodies:scenario!=='knowledge-no-bodies',workspace,memories:[{id:'m1',text:'SYNTHETIC_MEMORY_MARKER',scope:'project',ws:workspace}],skills:[{id:'s1',name:'fixture',description:'Synthetic skill',body:'SYNTHETIC_SKILL_BODY',scope:'project',ws:workspace}]}:undefined,messages:[{role:'user',content:(scenario.endsWith('-types')||scenario.endsWith('-syntax'))?`Behebe diese Probleme im Workspace:\n${path}:1 [error · ${source}] Incompatible assignment`:scenario==='learning'?'Lies main.cjs und antworte kurz. Keine Änderungen.':scenario==='question'?'Frage mich nach der Farbe.':scenario.startsWith('knowledge')?'Lies Gedächtnis und den Skill fixture. Keine Änderungen.':'Ändere main.cjs.'}],maxRounds:6,autoContinue:false,toolLearning:{mode:'auto',rules:[]},automation:{autoRunAgent:true},plan:scenario==='question'?[{text:'Noch zu erledigen',status:'todo',kind:'edit'}]:[],model:{provider:'custom',baseUrl:`http://127.0.0.1:${api.address().port}/v1`,model:scenario,context:32768,thinking:'off',maxOut:1000,hardStopMin:1}});
        for(let i=0;i<600&&host.busy();i++)await new Promise(r=>setTimeout(r,20));
        assert.equal(host.busy(),false,scenario);
        if(scenario==='learning'){
          assert.equal(host.state.status,'done',host.state.error);assert.equal(host.state.toolLearning.rules.length,1);
          assert.equal(host.state.toolLearning.rules[0].successes,1);assert.equal(host.state.toolLearningInitial.rules.length,0);
          assert.equal(host.state.steps[0].name,'read_file');assert.equal(host.state.steps[0].detail,'main.cjs');
        }else if(scenario==='question'){
          assert.equal(host.state.status,'waiting-user',host.state.error);assert.equal(host.state.ask.choices[1].label,'Rot');assert.equal(host.state.plan[0].status,'todo');assert.equal(host.state.finishedAt,undefined);
        }else if(scenario.endsWith('-types')||scenario.endsWith('-syntax')){
          if(scenario.endsWith('ts-types')||scenario.endsWith('-syntax')){assert.equal(host.state.status,'done',host.state.error);assert.equal(host.state.verification.state,'passed');}
          else {assert.equal(host.state.status,'failed');assert.equal(host.state.verification.state,'failed');assert.match(host.state.error,/Syntax allein/);assert.equal(host.state.lastDiagnostics.ok,false);}
        }else if(scenario.startsWith('knowledge')){
          const wire=JSON.stringify(payloads.get(scenario)),names=payloads.get(scenario)[0].tools.map(tool=>tool.function.name);
          assert.equal(host.state.status,'done',host.state.error);
          if(scenario==='knowledge'){
            assert.match(wire,/SYNTHETIC_MEMORY_MARKER/);assert.match(wire,/SYNTHETIC_SKILL_BODY/);
            assert.deepEqual(operations.map(op=>[op.kind,op.action]),[['knowledge','list'],['knowledge','skills'],['knowledge','read']]);
            for(const name of ['memory_list','memory_add','memory_forget','skill_list','skill_read','skill_run','skill_write','skill_patch','skill_outcome'])assert.ok(names.includes(name),name);
          }else{
            assert.equal(operations.length,0);assert.doesNotMatch(wire,/SYNTHETIC_MEMORY_MARKER|SYNTHETIC_SKILL_BODY/);
            assert.equal(names.includes('memory_list'),scenario!=='knowledge-disabled');
            for(const name of ['skill_read','skill_run','skill_debug'])assert.equal(names.includes(name),false,name);
            assert.equal(names.includes('skill_write'),scenario==='knowledge-no-bodies');
          }
        }else if(scenario==='fetch'){
          assert.equal(operations[0].kind,'fetch');assert.equal(operations[0].url,'https://example.test/docs');assert.match(JSON.stringify(payloads.get(scenario)),/SYNTHETIC_WEB_CONTENT/);
        }else{
          assert.equal(operations.filter(op=>op.kind==='run').length,1,scenario+' must execute exactly once');
          assert.equal(host.state.lastRun.ok,true);assert.equal(host.state.verification.state,'passed');
          if(scenario==='format')assert.equal(host.state.drafts['main.cjs'].after,'console.log("old");\n');
        }
      }finally{await host.close();}
    }
  }finally{api.closeAllConnections();await new Promise(r=>api.close(r));}
});
