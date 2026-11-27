import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLoopFixture, tool } from '../fixtures/agent-loop-fixture.mjs';
import { AgentCommands } from '../electron/agent-commands.mjs';
import { ToolRejection } from '../electron/tool-rejection.mjs';

test('an early task-policy rejection is not an executed test and the agent can finish a safe read', async t => {
  const f = await agentLoopFixture(t);
  f.beginAgent();
  let calls = 0, executions = 0;
  const observed = [];
  const result = await f.runAgentLoop({ context: 32768, compact: 'off', maxRounds: 4, autoContinueRounds: false,
    runLoop: false, graphLoop: false, testLoop: false, afterWrite: 'none', autoRunAgent: false,
    files: [{ path: 'notes.txt', content: 'READ_MARKER' }],
    messages: [{ role: 'user', content: 'Read notes.txt and report its contents. Do not edit or change any files.' }] }, async () => {
      calls++;
      if (calls === 1) return tool('shell', { command: 'node -e "console.log(123)"' });
      if (calls === 2) return tool('read_file', { path: 'notes.txt' });
      return { content: 'READ_MARKER gelesen; keine Datei verändert.' };
    }, { shell: async () => { executions++; return { ok: true, code: 0, stdout: '', stderr: '' }; },
      onTool: event => observed.push(event) });
  assert.equal(executions, 0);
  const rejected = observed.find(event => event.name === 'shell').result;
  assert.equal(rejected.definitelyNotExecuted, true);
  assert.equal(rejected.rejected, true);
  assert.equal(rejected.ok, false);
  assert.equal(result.ok, true, result.reply);
  assert.notEqual(result.verification?.state, 'failed');
  assert.equal(calls, 3);
});

test('a shell play invocation is rejected with the exact native tool and its discovery path', async () => {
  const commands = new AgentCommands();
  let error;
  try { await commands.execute({ kind: 'shell', command: 'play index.html --actions anything' }, { signal: new AbortController().signal, files: {} }); }
  catch (value) { error = value; }
  assert.ok(error instanceof ToolRejection);
  const result = error.result();
  assert.equal(result.definitelyNotExecuted, true);
  assert.deepEqual(result.suggestedTools, ['play','select_tools']);
  assert.match(result.error, /select_tools\(\{"names":\["play"\]\}\)/);
});
