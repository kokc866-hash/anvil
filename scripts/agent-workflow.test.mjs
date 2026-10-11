import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLoopFixture, tool } from '../fixtures/agent-loop-fixture.mjs';
import { validWorkflowSnapshot } from '../electron/workflow-validation.mjs';
import { AgentJobHost } from '../electron/agent-job-host.mjs';

const base={messages:[{role:'user',content:'Ändere den künstlichen Code und prüfe ihn.'}],context:32768,compact:'off',maxRounds:8};
const files=[{path:'main.py',content:'print(1)'},{path:'test_main.py',content:'def test_ok():\n    assert True'}];
test('native and text model transports cannot pass CAD acceptance by green checkmarks or relaxed limits',async t=>{
  const f=await agentLoopFixture(t);
  const criterion={id:'bbox',label:'STEP-Abweichung',required:true,operator:'eq',expected:0,tolerance:0.1,unit:'mm'};
  for(const transport of ['native','text'])await t.test(transport,async()=>{
    f.beginAgent();let round=0;
    const call=(name,args)=>{
      const choice=tool(name,args);
      return transport==='text'?{content:JSON.stringify({name,arguments:args}),toolContract:{transport,names:['set_plan','mcp_call']}}:{...choice,toolContract:{transport,names:['set_plan','mcp_call']}};
    };
    const result=await f.runAgentLoop({...base,files:[{path:'notes.txt',content:'Synthetic saved CAD'}],messages:[{role:'user',content:'Prüfe die gespeicherte CAD-Datei und berichte das Ergebnis.'}]},async()=>{
      if(++round===1)return call('set_plan',{steps:['STEP prüfen','Ergebnis berichten'],kinds:['check','report'],criteria:[criterion]});
      if(round===2)return call('mcp_call',{server:'freecad',name:'execute_code',arguments:{code:'verify_saved_step()'}});
      if(round===3)return call('set_plan',{updates:[{step:1,status:'ok',evidence:['e1'],reason:'Checker executed successfully.'}]});
      if(round===4)return call('set_plan',{criteria:[{...criterion,tolerance:5}],criteria_change_reason:'Accept intermediate geometry.'});
      return {content:'Alle Prüfungen bestanden.'};
    },{mcp:async()=>({isError:false,structuredContent:{anvil_acceptance:{observations:[{criterion:'bbox',actual:4,artifact:'stage.step',sha256:'87300bbac8aba350f0b0683702cf0a759f9c5f47b8d217d3e64c7a39d9de3893'}]}}})});
    assert.equal(result.ok,true,'the execution ended normally');
    assert.equal(result.plan[0].status,'ok','checklist records the executed checker');
    assert.equal(result.acceptance.state,'failed','the measured 4 mm exceeds the original 0.1 mm');
    assert.equal(result.acceptance.criteria[0].tolerance,0.1);
    assert.equal(result.acceptance.changes.length,1);
    assert.match(result.reply,/Gesamtabnahme: Nicht bestanden/);
    const saved=JSON.parse(result.workflow.planProgress);
    assert.equal(saved.acceptance.criteria[0].tolerance,0.1);
    assert.equal(saved.acceptance.observations[0].actual,4);
    f.beginAgent();
    const resumed=await f.runAgentLoop({...base,files:[{path:'notes.txt',content:'Synthetic saved CAD'}],workflow:result.workflow,messages:[{role:'user',content:'Berichte die gesicherten Ergebnisse ohne neue Aktionen.'}]},async()=>({content:'Ergebnis unverändert.'}));
    assert.equal(resumed.acceptance.state,'failed');
    assert.equal(resumed.acceptance.changes.length,1);
  });
});
test('the production loop journals confirmed writes and executes safe checks as one shared workflow',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let rounds=0;const events=[],snapshots=[];
  const result=await f.runAgentLoop({...base,files,runLoop:true,testLoop:true,afterWrite:'run'},async()=>++rounds===1?tool('write_file',{path:'main.py',content:'print(2)',overwrite_reason:'Complete one-line synthetic fixture replacement.'}):{content:'Änderung und Prüfung abgeschlossen.'},{
    capabilities:['write_file','run_file','read_file'],
    onWorkflow:snapshot=>{assert.ok(validWorkflowSnapshot(snapshot));snapshots.push(structuredClone(snapshot));},
    onWorkspace:async ev=>{assert.equal(snapshots.at(-1).operations.at(-1).status,'started');events.push(`write:${ev.path}`);},
    runFile:async(path,snapshot,asTest)=>{assert.equal(snapshot['main.py'],'print(2)');assert.equal(snapshots.at(-1).operations.at(-1).status,'started');events.push(`run:${path}:${asTest}`);return {ok:true,code:0,stdout:'fixture checked'};}
  });
  assert.equal(result.ok,true,result.error);assert.equal(result.verification.state,'passed');assert.equal(result.verification.tests,true);
  assert.deepEqual(events,['write:main.py','run:main.py:false','run:test_main.py:true']);assert.ok(rounds<=4);
  assert.ok(result.workflow.operations.every(op=>op.status==='confirmed'));assert.ok(result.workflow.nodes.some(n=>n.id==='test:test_main.py'&&n.status==='passed'));
  f.beginAgent();let repeated=0;
  const resumed=await f.runAgentLoop({...base,files:result.files,workflow:result.workflow,runLoop:true,testLoop:true,afterWrite:'run'},async()=>({content:'Bestehende Nachweise geprüft; keine weitere Änderung.'}),{capabilities:['run_file'],runFile:async()=>{repeated++;return {ok:true,code:0};}});
  assert.equal(repeated,0);assert.equal(resumed.verification.state,'passed');
  assert.equal(JSON.parse(resumed.workflow.planProgress).sequence,JSON.parse(result.workflow.planProgress).sequence);
});
test('a failed durable checkpoint prevents any workspace side effect',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let writes=0;
  await assert.rejects(f.runAgentLoop({...base,files},async()=>tool('write_file',{path:'main.py',content:'print(2)',overwrite_reason:'Complete one-line synthetic fixture replacement.'}),{
    onWorkflow:snapshot=>{if(snapshot.operations.some(op=>op.status==='started'))throw Error('fixture journal unavailable');},onWorkspace:async()=>{writes++;}
  }),/journal unavailable/);assert.equal(writes,0);
});
test('a rejected file acknowledgement cannot invent a saved file or successful automatic test',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let round=0,runs=0;
  const result=await f.runAgentLoop({...base,files,runLoop:true,testLoop:true,afterWrite:'run'},async()=>++round===1?tool('write_file',{path:'main.py',content:'print(2)',overwrite_reason:'Complete one-line synthetic fixture replacement.'}):{content:'Die künstliche Speicherung ist blockiert.'},{
    onWorkspace:async()=>{throw Error('fixture write rejected');},runFile:async()=>{runs++;return {ok:true,code:0};}
  });
  assert.equal(result.ok,false);assert.equal(result.files.find(f=>f.path==='main.py').content,'print(1)');assert.equal(runs,0);
  assert.equal(result.workflow.operations.find(op=>op.name==='write_file').status,'failed');
});
test('the loop executes a final automatic run through the journal without enabling immediate loops',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let round=0;const runs=[];
  const result=await f.runAgentLoop({...base,files,runLoop:false,testLoop:false,afterWrite:'none',autoRunAgent:true},async()=>++round===1?tool('write_file',{path:'main.py',content:'print(2)',overwrite_reason:'Complete one-line synthetic fixture replacement.'}):{content:'Fertig.'},{
    capabilities:['write_file','run_file'],onWorkspace:async()=>{},runFile:async path=>{runs.push(path);return {ok:true,code:0};}
  });assert.equal(result.ok,true);assert.deepEqual(runs,['main.py']);assert.equal(result.workflow.operations.filter(op=>op.name==='run_file').length,1);
});
test('ask mode cannot acquire mutation rights from a saved workflow or project rule',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let writes=0,runs=0,round=0;
  const result=await f.runAgentLoop({...base,files,observeOnly:true,runLoop:true,testLoop:true,afterWrite:'run'},async()=>++round===1?tool('write_file',{path:'main.py',content:'print(2)'}):{content:'Ich kann den künstlichen Code nur lesen.'},{onWorkspace:async()=>{writes++;},runFile:async()=>{runs++;return {ok:true,code:0};}});
  assert.equal(writes,0);assert.equal(runs,0);assert.equal(result.files.find(f=>f.path==='main.py').content,'print(1)');
});

test('a stop after a durable action start cannot acquire post-hoc acceptance criteria on resume',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let round=0;const outcomes=[];
  const {PlanProgress}=await f.server.ssrLoadModule('/src/lib/plan-progress.ts');
  const workflow={schema:1,id:'interrupted-before-record',inputStamp:'',definitionStamp:'',phase:'act',nodes:[],changed:[],
    operations:[{id:'started-action',name:'mcp_call',fingerprint:'a'.repeat(64),inputStamp:'',status:'started',target:'freecad',external:true,at:1}],
    planProgress:JSON.stringify(new PlanProgress().snapshot())};
  const result=await f.runAgentLoop({...base,files:[{path:'notes.txt',content:'Saved synthetic checkpoint'}],workflow},async()=>++round===1
    ?tool('set_plan',{criteria:[{id:'late',label:'Post-hoc criterion',required:true,operator:'eq',expected:true}]})
    :{content:'Die frühere Aktion bleibt unbestätigt.'},{onTool:info=>outcomes.push(info)});
  assert.ok(outcomes.find(info=>info.name==='set_plan').result.error);
  assert.deepEqual(result.acceptance.criteria,[]);
  assert.notEqual(result.acceptance.state,'passed');
});

test('resume after read-only inspection can define acceptance before the first mutation or execution',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let round=0;const outcomes=[];
  const {PlanProgress}=await f.server.ssrLoadModule('/src/lib/plan-progress.ts');
  const workflow={schema:1,id:'inspection-only',inputStamp:'',definitionStamp:'',phase:'act',nodes:[],changed:[],
    operations:[{id:'read-action',name:'read_file',fingerprint:'a'.repeat(64),inputStamp:'',status:'confirmed',target:'notes.txt',external:false,at:1}],
    planProgress:JSON.stringify(new PlanProgress().snapshot())};
  const result=await f.runAgentLoop({...base,files:[{path:'notes.txt',content:'Saved inspection'}],workflow},async()=>++round===1
    ?tool('set_plan',{criteria:[{id:'before-work',label:'Before work',required:true,operator:'eq',expected:true}]})
    :{content:'Kriterien vor Arbeitsbeginn festgelegt.'},{onTool:info=>outcomes.push(info)});
  assert.equal(outcomes.find(info=>info.name==='set_plan').result.ok,true);
  assert.equal(result.acceptance.criteria[0].id,'before-work');
  assert.equal(result.acceptance.state,'unverified');
});

test('a still-running test cannot complete the real core or host as a successful job',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let round=0;
  const result=await f.runAgentLoop({...base,files,runLoop:false,testLoop:false},async()=>++round===1?tool('run_file',{path:'test_main.py'}):{content:'Der Test läuft noch; ein Endergebnis fehlt.'},{runFile:async()=>({ok:true,running:true})});
  assert.equal(result.ok,false);assert.equal(result.verification.state,'stale');assert.equal(result.workflow.phase,'patch');assert.match(result.reply,/Noch nicht bestätigt/);
  let terminal;
  await AgentJobHost.prototype.message.call({state:{status:'running',revision:1},finish:async status=>{terminal=status;}},{type:'result',result});
  assert.equal(terminal,'failed');
});

test('unavailable automatic checks are reported instead of a successful completion',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let round=0;
  const result=await f.runAgentLoop({...base,files,runLoop:true,testLoop:true,afterWrite:'run'},async()=>++round===1?tool('write_file',{path:'main.py',content:'print(2)',overwrite_reason:'Complete one-line synthetic fixture replacement.'}):{content:'Fertig.'},{capabilities:['write_file'],onWorkspace:async()=>{}});
  assert.equal(result.ok,false);assert.equal(result.verification.state,'stale');assert.match(result.error,/nicht freigegeben/);
});
