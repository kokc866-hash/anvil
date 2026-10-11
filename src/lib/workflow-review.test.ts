import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentWorkflow } from './agent-workflow.ts';
import { validWorkflowSnapshot } from '../../electron/workflow-validation.mjs';

test('reviewed workflow effects allow a new deliberate call while unrelated effects remain blocked', async () => {
  const options = { runLoop: false, graphLoop: false, testLoop: false, loopTries: 1 };
  const original = new AgentWorkflow({}, options, ['mcp_call']);
  await original.begin('mcp_call', { server: 'fixture', name: 'execute_code', arguments: { code: 'old()' } });
  await original.begin('mcp_call', { server: 'fixture', name: 'export_step' });
  const snapshot = original.snapshot();
  snapshot.operations.forEach(op => { op.status = 'unclear'; });
  const selected = snapshot.operations[0];
  selected.status = 'confirmed';
  selected.resolution = { outcome: 'confirmed', note: 'Im künstlichen Dienstprotokoll geprüft: ausgeführt.', at: selected.at };
  assert.equal(validWorkflowSnapshot(snapshot), true);
  const recovered = new AgentWorkflow({}, options, ['mcp_call'], snapshot);
  assert.ok((await recovered.begin('mcp_call', { server: 'fixture', name: 'execute_code', arguments: { code: 'verify_current_state()' } })).id);
  assert.match((await recovered.begin('mcp_call', { server: 'fixture', name: 'export_step' })).error || '', /unklar/);
  assert.equal(recovered.snapshot().operations[0].resolution?.note, selected.resolution.note);
  assert.match(recovered.summary(), /not task acceptance/);
  for (const resolution of [{ ...selected.resolution, note: '' }, { ...selected.resolution, at: selected.at - 1 }, { ...selected.resolution, outcome: 'not-executed' }]) {
    assert.equal(validWorkflowSnapshot({ ...snapshot, operations: [{ ...selected, resolution }] }), false);
  }
});

test('resume can keep an unknown action blocked and requires a current observation before new writes', async () => {
  const options={runLoop:false,graphLoop:false,testLoop:false,loopTries:1};
  const original=new AgentWorkflow({},options,['read_file','write_file','mcp_call']);
  await original.begin('mcp_call',{server:'fixture',name:'execute_code',arguments:{code:'original()'}});
  const snapshot=original.snapshot(),op=snapshot.operations[0];
  op.status='unclear';op.recovery={mode:'skip',at:Date.now()};
  assert.equal(validWorkflowSnapshot(snapshot),true);
  const recovered=new AgentWorkflow({},options,['read_file','write_file','mcp_call'],snapshot);
  assert.equal(recovered.recoveryNeedsInspection(),true);
  assert.match((await recovered.begin('write_file',{path:'notes.txt',content:'new'})).error||'',/Lies zuerst/);
  const read=await recovered.begin('read_file',{path:'notes.txt'});
  recovered.finish(read.id,'read_file',{path:'notes.txt'},{content:'Current synthetic state.'});
  assert.equal(recovered.recoveryNeedsInspection(),false);
  assert.ok((await recovered.begin('write_file',{path:'notes.txt',content:'new'})).id);
  assert.match((await recovered.begin('mcp_call',{server:'fixture',name:'execute_code',arguments:{code:'different()'}})).error||'',/unklar/);
  assert.equal(recovered.snapshot().operations[0].status,'unclear');
  assert.equal(recovered.snapshot().operations[0].resolution,undefined);
  assert.match(recovered.summary(),/No user outcome declaration is required/);
  for(const invalid of [{...op,recovery:{mode:'skip',at:op.at-1}},{...op,status:'confirmed'},{...op,external:false},{...op,recovery:{mode:'confirmed',at:op.at}}])assert.equal(validWorkflowSnapshot({...snapshot,operations:[invalid]}),false);
});
