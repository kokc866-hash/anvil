import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { workflowJournalPath, writeWorkflowJournal, readWorkflowJournal } from './workflow-journal.mjs';
const snapshot={schema:1,id:'fixture-1',inputStamp:'a'.repeat(64),definitionStamp:'b'.repeat(64),phase:'act',nodes:[],operations:[],changed:[]};
test('durable workflow journals use isolated project scopes and reject traversal',()=>{
  const root=mkdtempSync(join(tmpdir(),'anvil-workflow-'));
  try {
    const path=workflowJournalPath(root,'I:/synthetic-project',snapshot.id);
    assert.ok(resolve(path).startsWith(resolve(root)+sep));
    writeWorkflowJournal(path,snapshot);assert.deepEqual(readWorkflowJournal(path),snapshot);
    assert.notEqual(workflowJournalPath(root,'I:/other-project',snapshot.id),path);
    assert.throws(()=>workflowJournalPath(root,'fixture','../../elsewhere'));
    assert.throws(()=>writeWorkflowJournal(path,{...snapshot,schema:2}));
    writeFileSync(path,JSON.stringify({...snapshot,operations:[{status:'invented'}]}));assert.equal(readWorkflowJournal(path),null);
  } finally {rmSync(root,{recursive:true,force:true});}
});
