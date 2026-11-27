import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { createServer } from 'vite';
import ts from 'typescript';

const valid = String.raw`function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }`;

test('literal source and early diagnostics through the actual agent loop', async t => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { '@': path.resolve('src') } }, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  try {
    const { applyTool, runAgentLoop } = await server.ssrLoadModule('/src/lib/agent-core.ts');
    const { parseToolArgs } = await server.ssrLoadModule('/src/lib/agent-parse.ts');
    const { beginAgent, abortAgent } = await server.ssrLoadModule('/src/lib/abort.ts');
    const call = (name, args) => ({ content: '', tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    const data = { messages: [{ role: 'user', content: 'Erstelle ui.js und prüfe den Start. Erhalte Entities unverändert.' }], files: [], runLoop: false, afterWrite: 'none', maxRounds: 8 };
    await t.test('write, exact edit, append and resulting workspace events preserve source bytes', () => {
      const files = new Map(), args = value => parseToolArgs(JSON.stringify(value)).args;
      const apply = (name, value) => applyTool(name, args(value), files, [], new Set(), []);
      const written = apply('write_file', { path: 'ui.js', content: valid });
      assert.equal(files.get('ui.js'), valid);
      assert.equal(written.event.content, valid);
      const edited = apply('edit_file', { path: 'ui.js', old_string: "'&amp;'", new_string: "'&amp;amp;'" });
      assert.equal(edited.event.content, valid.replace("'&amp;'", "'&amp;amp;'"));
      const suffix = '\n// &#39; &amp; u003c u003e\r\n';
      apply('append_file', { path: 'ui.js', content: suffix });
      assert.equal(files.get('ui.js'), valid.replace("'&amp;'", "'&amp;amp;'" ) + suffix);
    });
    for (const transport of ['native', 'text']) await t.test(`${transport}: a syntax fault is visible before the next model request, correction is checked once`, async () => {
      beginAgent(); let n = 0;
      const saved = new Map(), checks = [], notices = [];
      const result = await runAgentLoop(data, async messages => {
        n++;
        let choice;
        if (n === 1) choice = call('write_file', { path: 'ui.js', content: 'const broken = ;' });
        else if (n === 2) {
          assert.match(JSON.stringify(messages.at(-1)), /Frühe Dateiprüfung|Early file check/);
          assert.match(JSON.stringify(messages.at(-1)), /syntax/);
          choice = call('edit_file', { path: 'ui.js', old_string: 'const broken = ;', new_string: valid });
        } else if (n === 3) {
          assert.match(JSON.stringify(messages.at(-1)), /Keine Syntaxfehler/);
          choice = call('run_file', { path: 'ui.js' });
        } else choice = { content: 'Datei gespeichert. Syntax und Ausführung geprüft; die Oberfläche wurde nicht interaktiv getestet.' };
        if (transport === 'text' && choice.tool_calls) {
          const { function: fn } = choice.tool_calls[0]; choice = { content: JSON.stringify({ name: fn.name, arguments: JSON.parse(fn.arguments) }) };
        }
        return { ...choice, toolContract: { transport, names: ['write_file', 'edit_file', 'run_file'] } };
      }, {
        onWorkspace: async event => { if (event.op === 'write') saved.set(event.path, event.content); },
        verify: async paths => {
          checks.push([...paths]);
          const broken = paths.some(file => ts.createSourceFile(file, saved.get(file), ts.ScriptTarget.Latest, true).parseDiagnostics.length);
          return { ok: !broken, detail: broken ? 'ui.js: syntax error (independent parser)' : 'Keine Syntaxfehler.' };
        },
        onNotice: (_kind, text) => notices.push(text),
        runFile: async () => ({ ok: true }),
      });
      assert.equal(result.ok, true);
      assert.equal(saved.get('ui.js'), valid);
      assert.deepEqual(checks, [['ui.js'], ['ui.js']]);
      assert.ok(notices.some(text => /kein Funktionstest/.test(text)));
    });
    await t.test('a failed save does not trigger diagnostics of an unacknowledged file', async () => {
      beginAgent(); let n = 0, checks = 0;
      await runAgentLoop({ ...data, maxRounds: 3 }, async () => ++n === 1 ? call('write_file', { path: 'ui.js', content: valid }) : { content: 'Speichern fehlgeschlagen.' }, {
        onWorkspace: async () => { throw Error('save denied'); }, verify: async () => { checks++; return { ok: true, detail: '' }; },
      });
      assert.equal(checks, 0);
    });
    await t.test('unchanged invalid code is not rechecked or reported as successful after final prose', async () => {
      beginAgent(); let n = 0, checks = 0;
      const result = await runAgentLoop({ ...data, maxRounds: 4 }, async () => {
        if (++n <= 2) return call('write_file', { path: 'ui.js', content: 'const broken = ;' });
        return { content: 'Everything works.' };
      }, { onWorkspace: async () => {}, verify: async () => { checks++; return { ok: false, detail: 'ui.js: SyntaxError, not executed.' }; } });
      assert.equal(checks, 1);
      assert.equal(result.ok, false);
      assert.equal(result.verification.state, 'failed');
      assert.match(result.reply, /SyntaxError/);
      assert.equal(result.files.find(file => file.path === 'ui.js').content, 'const broken = ;');
    });
    await t.test('a read-only intentional failure grants no repair or unrequested file checks', async () => {
      beginAgent(); let n = 0, writes = 0, checks = 0;
      const broken = 'throw new Error("intentional");';
      await runAgentLoop({ ...data, messages: [{ role: 'user', content: 'Führe den absichtlichen Negativtest ui.js aus. Berichte den Fehler; nichts reparieren oder ändern.' }], files: [{ path: 'ui.js', content: broken }], maxRounds: 3 }, async () => ++n === 1 ? call('run_file', { path: 'ui.js' }) : { content: 'Absichtlicher Fehler wie erwartet beobachtet.' }, {
        onWorkspace: async () => { writes++; }, verify: async () => { checks++; return { ok: true, detail: '' }; }, runFile: async () => ({ ok: false, stderr: 'Error: intentional' }),
      });
      assert.equal(writes, 0); assert.equal(checks, 0);
    });
    await t.test('cancellation during an early check prevents another model call', async () => {
      beginAgent(); let requests = 0;
      await assert.rejects(() => runAgentLoop(data, async () => { requests++; return call('write_file', { path: 'ui.js', content: valid }); }, {
        onWorkspace: async () => {}, verify: async () => { abortAgent('test cancellation'); return { ok: true, detail: '' }; },
      }), /abgebrochen|cancel|stop|generation|aktuell|Auftrag/i);
      assert.equal(requests, 1);
    });
  } finally { await server.close(); }
});
