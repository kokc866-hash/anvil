import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLoopFixture, tool } from '../fixtures/agent-loop-fixture.mjs';
import { validWorkflowSnapshot } from '../electron/workflow-validation.mjs';
import { AgentJobHost } from '../electron/agent-job-host.mjs';

const base={messages:[{role:'user',content:'Ändere den künstlichen Code und prüfe ihn.'}],context:32768,compact:'off',maxRounds:8};
const files=[{path:'main.py',content:'print(1)'},{path:'test_main.py',content:'def test_ok():\n    assert True'}];
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

test('a still-running test cannot complete the real core or host as a successful job',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let round=0;
  const result=await f.runAgentLoop({...base,files,runLoop:false,testLoop:false},async()=>++round===1?tool('run_file',{path:'test_main.py'}):{content:'Der Test läuft noch; ein Endergebnis fehlt.'},{runFile:async()=>({ok:true,running:true})});
  assert.equal(result.ok,false);assert.equal(result.verification.state,'stale');assert.equal(result.workflow.phase,'patch');assert.match(result.reply,/Noch nicht bestätigt/);
  let terminal;
  await AgentJobHost.prototype.message.call({state:{status:'running',revision:1},finish:async status=>{terminal=status;}},{type:'result',result});
  assert.equal(terminal,'failed');
});

test('a verified Delete retry can finish the real core and host after a failed focus attempt', async t => {
  const f = await agentLoopFixture(t); f.beginAgent();
  const page = { path: 'index.html', content: '<button id="start">Start</button><div id="item"></div>' };
  const caseText = 'Richte den Tastaturfokus außerhalb von Textfeldern, drücke Delete und prüfe, ob das löschbare Element #item fehlt.';
  const prompt = `Teste die HTML-Vorschau mit play. Keine Dateien ändern. ${caseText}`;
  const actions = selector => [{ type: 'click', selector }, { type: 'key', key: 'Delete' }, { type: 'assert', selector: '#item', count: 0 }];
  let visible = [{ text: caseText, kind: 'check', status: 'todo' }];
  let round = 0;
  const result = await f.runAgentLoop({
    ...base, files: [page], messages: [{ role: 'user', content: prompt }], humanRequest: prompt,
    runLoop: false, graphLoop: false, testLoop: false, afterWrite: 'none',
  }, async () => {
    switch (++round) {
      case 1: return tool('run_file', { path: page.path });
      case 2: return tool('play', { actions: actions('body') });
      case 3: return tool('play', { actions: actions('#start') });
      case 4: return tool('set_plan', { updates: [{ step: 1, status: 'ok', evidence: ['e3'], reason: 'Delete repeat removed #item and assert found zero.' }] });
      default: return { content: 'Das Element wurde beim zweiten Versuch gelöscht. Erster Versuch fehlgeschlagen.' };
    }
  }, {
    getPlan: () => visible, canReplacePlan: () => false,
    onTool: ({ result: outcome }) => { if (outcome?.plan) visible = outcome.plan; },
    onWorkflow: snapshot => assert.ok(validWorkflowSnapshot(snapshot)),
    runFile: async () => ({ ok: true, stage: { kind: 'html' }, state: { text: 'Item present' }, previewPath: page.path }),
    play: async (_keys, _hold, input) => {
      const passed = input[0].selector === '#start';
      return {
        ok: passed, functionalChecks: passed, previewPath: page.path, state: { text: passed ? 'Item absent' : 'Item present' },
        input: { mode: 'native-preview', completed: passed ? 3 : 2, total: 3, assertions: passed ? 1 : 0 },
        ...(!passed ? { error: 'Prüfung fehlgeschlagen: #item — erwartet 0 Elemente, erhalten 1.' } : {}),
      };
    },
  });
  assert.equal(result.ok, true, result.reply);
  assert.equal(result.verification.state, 'passed');
  assert.equal(result.plan[0].status, 'ok');
  assert.deepEqual(result.workflow.operations.filter(op => op.name === 'play').map(op => op.status), ['failed', 'confirmed']);
  let terminal;
  await AgentJobHost.prototype.message.call({ state: { status: 'running', revision: 1 }, finish: async status => { terminal = status; } }, { type: 'result', result });
  assert.equal(terminal, 'done');
});

test('unavailable automatic checks are reported instead of a successful completion',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let round=0;
  const result=await f.runAgentLoop({...base,files,runLoop:true,testLoop:true,afterWrite:'run'},async()=>++round===1?tool('write_file',{path:'main.py',content:'print(2)',overwrite_reason:'Complete one-line synthetic fixture replacement.'}):{content:'Fertig.'},{capabilities:['write_file'],onWorkspace:async()=>{}});
  assert.equal(result.ok,false);assert.equal(result.verification.state,'stale');assert.match(result.error,/nicht freigegeben/);
});
