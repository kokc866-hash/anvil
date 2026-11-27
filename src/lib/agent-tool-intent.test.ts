import assert from 'node:assert/strict';
import test from 'node:test';
import { changesTaskState } from './agent-tool-intent.ts';

test('observation tasks can use purpose-built MCP readers but cannot send opaque code or mutations', () => {
  for (const name of ['get_document_info', 'getDocumentInfo', 'list_objects', 'inspect_shape', 'validate_shape', 'search_docs']) {
    assert.equal(changesTaskState('mcp_call', { name }), false, name);
  }
  for (const name of ['execute_code', 'execute_code_headless', 'executeCode', 'run_script', 'recompute_document', 'set_property', 'get_and_delete', 'cad_action']) {
    assert.equal(changesTaskState('mcp_call', { name }), true, name);
  }
});

test('observation task restrictions cover local writes and inline shell code while permitting requested test entry points', () => {
  for (const name of ['write_file', 'edit_file', 'delete_file', 'format_file', 'git_commit', 'memory_add', 'skill_outcome', 'debug_eval']) {
    assert.equal(changesTaskState(name, {}), true, name);
  }
  for (const command of ['node --test adder.test.cjs', 'python -m pytest test_adder.py', 'git status --short']) {
    assert.equal(changesTaskState('shell', { command }), false, command);
  }
  for (const command of ['node -e "repair()"', 'python -c "repair()"', 'pwsh -Command "Set-Content file text"', 'git reset --hard', 'npm install tool', 'Remove-Item file']) {
    assert.equal(changesTaskState('shell', { command }), true, command);
  }
});

test('a no-changes task cannot bypass file preservation through common shell file operations', () => {
  for (const command of ['cp fixed.js negative.js', 'Copy-Item fixed.js negative.js', 'Move-Item fixed.js negative.js', 'New-Item negative.js', 'echo repaired > negative.js', 'printf fixed >> negative.js', 'git apply fix.patch', 'sed -i s/7/0/ negative.js']) {
    assert.equal(changesTaskState('shell', { command }), true, command);
  }
  assert.equal(changesTaskState('shell', { command: 'node --test test.cjs 2>&1' }), false, 'redirecting stderr to stdout does not itself modify a file');
});
