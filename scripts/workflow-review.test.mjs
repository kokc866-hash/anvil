import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { TaskAcceptance } from '../electron/task-acceptance.mjs';

function fixture(t) {
  mkdirSync('artifacts/freecad-repair-2026-10-11/review-fixtures', { recursive: true });
  const root = mkdtempSync(resolve('artifacts/freecad-repair-2026-10-11/review-fixtures', 'job-'));
  let child, launches = 0; const sent=[];
  const host = new AgentJobHost({ snapshotPath: join(root, 'latest.json'), runtime: { begin() {}, close() {}, finish() {} }, launch() { launches++; child = new EventEmitter(); child.send = message => sent.push(message); child.kill = () => {}; return child; } });
  t.after(() => host.close());
  const request = { project: root, execution: true, files: {}, messages: [{ role: 'user', content: 'Synthetic review' }], model: { model: 'fixture' } };
  host.start(request); child.emit('message', { type: 'ready' });
  const snapshot = { schema: 1, id: 'review-workflow', inputStamp: '', definitionStamp: '', phase: 'act', nodes: [], changed: [], operations: [
    { id: 'review-workflow:1', name: 'mcp_call', fingerprint: 'a'.repeat(64), effectFingerprint: 'b'.repeat(64), inputStamp: '', status: 'unclear', target: 'execute_code', external: true, at: 10 },
    { id: 'review-workflow:2', name: 'mcp_call', fingerprint: 'c'.repeat(64), effectFingerprint: 'd'.repeat(64), inputStamp: '', status: 'unclear', target: 'other_mutation', external: true, at: 11 },
  ] };
  child.emit('message', { type: 'operation', id: 1, operation: { kind: 'workflow', snapshot } });
  return { host, request, root, sent, send:message=>child.emit('message',message), launches: () => launches };
}

test('unresolved workflow effects block resume before another model process is launched', t => {
  const f = fixture(t); f.host.stop();
  assert.throws(() => f.host.resume(f.host.state.id, f.request, true), /unbestätigt|ungeklärt/);
  assert.equal(f.launches(), 1);
});

test('native recovery rejects changed arguments without executing or ending the resumed task', async t => {
  const f = fixture(t); f.host.stop();
  let effects=0;
  f.host.runtime.execute=async()=>{effects++;return {ok:true};};
  f.host.resume(f.host.state.id,{...f.request,skipUnconfirmed:true});f.send({type:'ready'});
  for(const [i,code]of ['original()','different_arguments()'].entries()){
    f.send({type:'operation',id:i+1,operation:{kind:'mcp',action:'call',server:'fixture',name:'execute_code',args:{code}}});
    assert.equal(f.sent.at(-1).result.definitelyNotExecuted,true);
    assert.equal(f.host.state.status,'running');
  }
  assert.equal(effects,0);
  f.send({type:'operation',id:3,operation:{kind:'mcp',action:'read',server:'fixture',args:{uri:'fixture://current-state'}}});
  await f.host.operation;
  assert.equal(effects,1,'Reading the current state remains available');
  assert.equal(f.host.state.status,'running');
});

test('checking the current state resumes without guessing an external outcome or clearing its replay protection', async t => {
  const f = fixture(t); f.host.stop();
  const previous = f.host.state.id;
  const resumed = f.host.resume(previous, { ...f.request, skipUnconfirmed: true });
  assert.equal(f.launches(), 2);
  assert.equal(resumed.state.resumedFrom, previous);
  assert.ok(resumed.state.workflow.operations.every(op => op.status === 'unclear' && op.recovery?.mode === 'skip' && !op.resolution));
  assert.ok(resumed.state.recoveryBlockedActions.includes('mcp:execute_code'));
  const saved = JSON.parse(readFileSync(join(f.root, 'latest.json'), 'utf8'));
  assert.equal(saved.workflow.operations[0].status, 'unclear');
  assert.equal(saved.workflow.operations[0].resolution, undefined);
  const recovered = new AgentJobHost({ snapshotPath: join(f.root, 'latest.json'), launch() { assert.fail('Reopen must not resume automatically'); } });
  assert.equal(recovered.state.workflow.operations[0].recovery.mode, 'skip');
  assert.ok(recovered.state.recoveryBlockedActions.includes('mcp:execute_code'));
  await recovered.close();
});

test('resuming with an unknown effect cannot claim whole-task acceptance even when recorded measurements pass', t => {
  const f=fixture(t),acceptance=new TaskAcceptance();
  acceptance.define([{id:'fixture',label:'Synthetic measurement',operator:'eq',expected:true,required:true}]);
  acceptance.record('mcp_call',{anvil_acceptance:{observations:[{criterion:'fixture',actual:true,artifact:'fixture.json',sha256:'1234567890abcdef'.repeat(4)}]}},'e1',{failed:false,pending:false,changed:false});
  assert.equal(acceptance.result().state,'passed','The test starts from valid passing measurement data');
  const workflow=structuredClone(f.host.state.workflow);
  workflow.planProgress=JSON.stringify({version:1,revision:0,nextEvidenceId:2,plan:[],evidence:[],acceptance:acceptance.snapshot()});
  f.send({type:'operation',id:2,operation:{kind:'workflow',snapshot:workflow}});
  f.host.stop();
  const resumed=f.host.resume(f.host.state.id,{...f.request,skipUnconfirmed:true});
  assert.notEqual(resumed.state.acceptance.state,'passed');
  f.send({type:'ready'});
  f.send({type:'operation',id:1,operation:{kind:'workflow',snapshot:{...workflow,operations:[]}}});
  assert.notEqual(f.host.state.acceptance.state,'passed','A worker checkpoint cannot remove native replay protection or turn the unknown effect into acceptance');
  assert.ok(f.host.state.recoveryBlockedActions.includes('mcp:execute_code'));
});

test('explicit review resolves only the selected operation and persists its human explanation without executing it', async t => {
  const f = fixture(t), job = f.host.state.id;
  assert.throws(() => f.host.reviewOperation(job, f.request.project, 'review-workflow:1', 'confirmed', 'Im Dienst geprüft: gespeichert.'), /laufend|angehalten/);
  f.host.stop();
  assert.throws(() => f.host.reviewOperation('stale', f.request.project, 'review-workflow:1', 'confirmed', 'Im Dienst geprüft: gespeichert.'), /Auftrag/);
  assert.throws(() => f.host.reviewOperation(job, 'another-project', 'review-workflow:1', 'confirmed', 'Im Dienst geprüft: gespeichert.'), /Projekt/);
  assert.throws(() => f.host.reviewOperation(job, f.request.project, 'review-workflow:1', 'confirmed', ''), /Prüfergebnis/);
  const result = f.host.reviewOperation(job, f.request.project, 'review-workflow:1', 'confirmed', 'In FreeCAD geprüft: Dokument gespeichert; keine Aufgabe läuft.');
  assert.equal(result.state.workflow.operations[0].status, 'confirmed');
  assert.equal(result.state.workflow.operations[1].status, 'unclear');
  assert.equal(result.state.workflow.operations[0].resolution.outcome, 'confirmed');
  assert.equal(f.launches(), 1, 'Review must not launch or replay anything');
  assert.throws(() => f.host.resume(job, f.request, true), /unbestätigt|ungeklärt/);
  f.host.reviewOperation(job, f.request.project, 'review-workflow:2', 'not-executed', 'Im Dienstprotokoll geprüft: Auftrag wurde nicht gestartet.');
  const saved = JSON.parse(readFileSync(join(f.root, 'latest.json'), 'utf8'));
  assert.equal(saved.workflow.operations[1].status, 'failed');
  assert.equal(saved.workflow.operations[1].resolution.outcome, 'not-executed');
  const recovered = new AgentJobHost({ snapshotPath: join(f.root, 'latest.json'), launch() { assert.fail('Reopen must not launch'); } });
  assert.equal(recovered.state.workflow.operations[0].resolution.note, result.state.workflow.operations[0].resolution.note);
  await recovered.close();
  const resumed = f.host.resume(job, f.request, true);
  assert.equal(resumed.state.workflow.operations[1].resolution.outcome, 'not-executed');
  assert.equal(f.launches(), 2);
});
