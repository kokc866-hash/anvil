import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { decodeWriteEscapes, extractFileBlocks, parseToolArgs } from './agent-parse.ts';

const escaper = String.raw`function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}`;
const samples = [
  ['ui.js', escaper],
  ['index.html', '<!doctype html><p>&lt;script&gt; &amp; &#39; &quot; &#x1f642;</p>\n'],
  ['style.css', '.example::before { content: "&lt; &amp; u003c u003e"; }\n'],
  ['literal.json', JSON.stringify({ text: '&lt; &#39; u003c u003e', path: String.raw`C:\new\test`, unicode: String.raw`\u003c` })],
  ['main.cpp', '#include <string>\nconst char* text = "u003ciostreamu003e &lt; &#39;";\n'],
  ['crlf.txt', '\uFEFFQuoted &#39; and &amp;\r\nsecond line\r\n'],
] as const;

test('valid source remains valid and identical after normal JSON tool argument parsing', () => {
  new Script(escaper);
  const parsed = parseToolArgs(JSON.stringify({ path: 'ui.js', content: escaper }));
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.args.content, escaper);
  new Script(String(parsed.args.content));
});

test('all source-like entity and unicode literals survive JSON tool argument parsing', () => {
  for (const [path, content] of samples) {
    const parsed = parseToolArgs(JSON.stringify({ path, content })).args;
    assert.equal(parsed.content, content, path);
    assert.equal(decodeWriteEscapes(content), content, path);
  }
});

test('editing and appending preserve literal patterns without a second decoding pass', () => {
  const old = "'&': '&amp;'", next = "'&': '&amp;amp;'";
  const edit = parseToolArgs(JSON.stringify({ path: 'ui.js', old_string: old, new_string: next })).args;
  assert.equal(edit.old_string, old);
  assert.equal(edit.new_string, next);
  const suffix = '\n// Literal &#39; and &amp; stay intact.\n';
  assert.equal(parseToolArgs(JSON.stringify({ path: 'ui.js', content: suffix })).args.content, suffix);
});

test('fenced source preserves entities after only removing the Markdown frame', () => {
  const blocks = extractFileBlocks('```javascript ui.js\n' + escaper + '\n```');
  assert.equal(blocks[0]?.content, escaper);
  new Script(blocks[0].content);
});
