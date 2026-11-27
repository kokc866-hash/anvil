import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import path from 'node:path';
import { mkdir, mkdtemp, lstat, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { verifyWorkspaceFile } from '../electron/workspace-file-proof.mjs';

test('agent reconciles descriptive checklists against actual tool results', async t => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { '@': path.resolve('src') } }, server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [], entries: [] }, appType: 'custom' });
  try {
    const { runAgentLoop } = await server.ssrLoadModule('/src/lib/agent-core.ts');
    const { beginAgent, abortAgent } = await server.ssrLoadModule('/src/lib/abort.ts');
    const { PlanProgress } = await server.ssrLoadModule('/src/lib/plan-progress.ts');
    await server.ssrLoadModule('/src/lib/intern.ts');
    await server.ssrLoadModule('/src/lib/app-log.ts');
    const call = (name, args) => ({ content: '', tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    const data = { messages: [{ role: 'user', content: 'Erweitere Tags, Statistik, Hilfe und Sortierung. Teste das Projekt.' }], files: [{ path: 'index.html', content: '<p>Old</p>' }], runLoop: false, afterWrite: 'none', maxRounds: 24 };
    const steps = ['Bestandsaufnahme: CSS existiert bereits, JS fehlt', 'Tags-Funktion: Eingabe, Anzeige, Filter', 'Statistik-Karten: offen, überfällig, heute fällig, erledigt heute', 'Hilfe-Overlay: Tastenkürzel anzeigen', 'Sortierung nach Fälligkeitsdatum ergänzen', 'Testen und prüfen'];
    const kinds = ['read', 'edit', 'edit', 'edit', 'edit', 'check'];
    await t.test('late deletion reopens the file todo before nudging another pending step', async subtest => {
      beginAgent();
      const root = await mkdtemp(path.join(tmpdir(), 'anvil-plan-late-delete-'));
      subtest.after(() => rm(root, { recursive: true, force: true }));
      const target = 'Ergebnis/Stadtpark/Stadtpark.blend';
      const full = path.join(root, target);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, 'Synthetic file for the path and hash proof.');
      const stat = await lstat(root, { bigint: true });
      const identity = `${stat.dev}:${stat.ino}`;
      let visible = [
        { text: `Prüfe, ob ${target} auf Platte vorhanden ist.`, kind: 'check', status: 'todo' },
        { text: 'Prüfe die Vorschau in Blender.', kind: 'check', status: 'todo' },
      ];
      let round = 0;
      const selected = [];
      const result = await runAgentLoop({
        ...data, files: [], maxRounds: 10, messages: [{ role: 'user', content: 'Prüfe die gespeicherte Blender-Datei und die Vorschau.' }],
      }, async messages => {
        if (++round === 1) return call('verify_file', { path: target });
        if (round === 2) return call('set_plan', { updates: [{ step: 1, status: 'ok', reason: 'The file on disk was verified.', evidence: ['e1'] }] });
        if (round === 3) {
          assert.deepEqual(visible.map(step => step.status), ['ok', 'todo']);
          await unlink(full);
        }
        if (round === 4) {
          assert.deepEqual(visible.map(step => step.status), ['todo', 'todo']);
          assert.ok(selected.at(-1)?.includes('verify_file'));
          assert.ok(messages.some(message => message.role === 'user' && String(message.content).includes('Use verify_file with the actual saved asset paths')));
        }
        return { content: 'Die Vorschau ist noch ungeprüft.' };
      }, {
        verifyFile: query => verifyWorkspaceFile(root, identity, query),
        getPlan: () => visible,
        canReplacePlan: () => false,
        selectTools: names => selected.push(names),
        onTool: event => {
          if (event.name === 'set_plan' && event.result?.plan) visible = event.result.plan;
        },
      });
      assert.ok(round >= 4);
      assert.equal(result.ok, false);
      assert.deepEqual(result.plan.map(step => step.status), ['todo', 'todo']);
    });
    await t.test('locked preview checklist accepts the observed baseline without a kind and continues to distinct cases', async () => {
      beginAgent();
      let visible = [
        { text: 'Öffne index.html und verifiziere den Ausgangszustand Paused und Zähler 0.', status: 'todo' },
        { text: 'Prüfe separat den Fehlerfall. Versuche einmal einen Vorschauklick auf das absichtlich nicht vorhandene Ziel #unavailable-test-target. Erwartet wird eine Ablehnung ohne Zustandsänderung. Danach mit dem echten Ziel weiterarbeiten.', status: 'todo' },
        { text: 'Klicke Start/Pause. Prüfe Running. Klicke erneut und prüfe Paused.', status: 'todo' },
        { text: 'Aktiviere die Checkbox und prüfe checked.', status: 'todo' },
      ];
      const initialTexts = visible.map(step => step.text);
      const updates = (step, evidence) => call('set_plan', { updates: [{ step, status: 'ok', evidence: [evidence], reason: 'Observed result from the specified test.' }] });
      const baseline = [{ type: 'assert', selector: '#status', text: 'Paused' }, { type: 'assert', selector: '#count', text: '0' }];
      const missing = [{ type: 'click', selector: '#unavailable-test-target' }];
      const interaction = [
        { type: 'click', selector: '#start' }, { type: 'assert', selector: '#status', text: 'Running' },
        { type: 'click', selector: '#start' }, { type: 'assert', selector: '#status', text: 'Paused' },
      ];
      const replies = [
        call('run_file', { path: 'index.html' }),
        call('play', { actions: baseline }),
        updates(1, 'e2'),
        updates(4, 'e2'),
        call('play', { actions: missing }),
        updates(2, 'e3'),
        call('play', { actions: interaction }),
        updates(3, 'e4'),
      ];
      const exercised = [];
      const outcomes = [];
      let turn = 0;
      const result = await runAgentLoop({ ...data, humanRequest: 'Teste die Browseranwendung in der nativen Vorschau. Keine Änderungen.' },
        async () => replies[turn++] ?? {content:'Ausgangszustand, Ablehnung und Start/Pause geprüft. Die Checkbox blieb offen.'},
        {
          getPlan: () => visible,
          canReplacePlan: () => false,
          onTool: event => {
            outcomes.push(event);
            if (event.result?.plan) visible = event.result.plan;
          },
          runFile: async () => ({ ok: true, stage: {kind:'html'}, previewPath: 'index.html' }),
          play: async (_keys, _hold, actions) => {
            exercised.push(actions);
            if (actions[0].selector === '#unavailable-test-target')
              return { ok:false, error:'Selector absent', rejected:true, definitelyNotExecuted:true,
                previewPath:'index.html', previewMissingTarget:'#unavailable-test-target', input:{assertions:0,completed:0,total:1} };
            return { ok:true, functionalChecks:true, previewPath:'index.html', input:{assertions:2,completed:actions.length,total:actions.length} };
          },
        });
      assert.deepEqual(exercised, [baseline, missing, interaction]);
      assert.deepEqual(result.plan.map(step => step.text), initialTexts);
      assert.deepEqual(result.plan.map(step => step.status), ['ok', 'ok', 'ok', 'todo']);
      assert.ok(outcomes.some(event => event.name === 'set_plan' && event.args.updates?.[0]?.step === 4 && event.result?.error));
      assert.equal(result.ok, false, 'the open checkbox prevents task completion');
      assert.notEqual(result.stopReason, 'no-progress');
    });
    await t.test('evidence IDs are visible in native/text tool results and rejected updates include recovery context', async () => {
      const { prepareTextTools } = await server.ssrLoadModule('/src/lib/tool-fallback.ts');
      const { AGENT_TOOLS } = await server.ssrLoadModule('/src/lib/agent-tools.ts');
      for (const transport of ['native', 'text']) {
        beginAgent(); let n = 0;
        const result = await runAgentLoop(data, async messages => {
          const wire = { messages };
          if (transport === 'text') prepareTextTools(wire, AGENT_TOOLS);
          const last = String(wire.messages.at(-1)?.content || '');
          let choice;
          if (++n === 1) choice = call('set_plan', { steps: ['Datei prüfen', 'Ergebnis berichten'], kinds: ['read', 'report'] });
          else if (n === 2) choice = call('read_file', { path: 'index.html' });
          else if (n === 3) {
            assert.match(last, /Plan evidence ID: e1/);
            assert.match(last, /Old/);
            choice = call('set_plan', { updates: [{ step: 1, status: 'ok', evidence: [], reason: 'Read completed' }] });
          } else if (n === 4) {
            assert.match(last, /No evidence IDs supplied/);
            assert.match(last, /e1: read_file index.html/);
            assert.match(last, /Do not guess IDs/);
            choice = call('set_plan', { updates: [{ step: 1, status: 'ok', evidence: ['e1'], reason: 'Read completed' }] });
          } else choice = { content: 'Datei geprüft.' };
          if (transport === 'text' && choice.tool_calls) {
            const c = choice.tool_calls[0]; choice = { content: JSON.stringify({ name: c.function.name, arguments: JSON.parse(c.function.arguments) }) };
          }
          return { ...choice, toolContract: { transport, names: ['set_plan', 'read_file'] } };
        });
        assert.equal(result.plan[0].status, 'ok');
        assert.equal(n, 5);
      }
    });
    await t.test('three rejected checklist updates allow real work, correct reconciliation and completion', async () => {
      beginAgent(); let n = 0; let visible = []; const outcomes = [];
      const result = await runAgentLoop({ ...data, autoContinueRounds: true }, async messages => {
        if (++n === 1) return call('set_plan', { steps: ['Datei ändern', 'Ergebnis prüfen', 'Ergebnis berichten'], kinds: ['edit', 'check', 'report'] });
        if (n === 2) return call('edit_file', { path: 'index.html', old_string: 'Old', new_string: 'Changed' });
        if (n <= 5) return call('set_plan', { updates: [{ step: 1, status: 'ok', evidence: [n % 2 ? 'guessed' : 'missing'], reason: 'I think it is done' }] });
        if (n === 6) {
          assert.match(JSON.stringify(messages), /Drei To-do-Statusänderungen|Three checklist updates/);
          return call('edit_file', { path: 'index.html', old_string: 'Changed', new_string: 'Final' });
        }
        if (n === 7) return call('run_file', { path: 'index.html' });
        if (n === 8) return call('play', {actions:[{type:'assert',selector:'body',text:'Final'}]});
        if (n === 9) return call('set_plan', { updates: [
          { step: 1, status: 'ok', evidence: ['e2'], reason: 'The final requested edit was applied.' },
          { step: 2, status: 'ok', evidence: ['e4'], reason: 'The expected final preview text was asserted.' },
        ] });
        return { content: 'Die Änderung wurde umgesetzt und geprüft.' };
      }, { getPlan: () => visible, onTool: info => { outcomes.push(info); if (info.result?.plan) visible = info.result.plan; }, runFile: async () => ({ ok: true }), play: async (_keys,_hold,actions) => {assert.deepEqual(actions,[{type:'assert',selector:'body',text:'Final'}]);return {ok:true,functionalChecks:true,input:{assertions:1}};} });
      assert.equal(n, 10);
      assert.notEqual(result.stopReason, 'no-progress');
      assert.equal(result.ok, true);
      assert.equal(result.files.find(f => f.path === 'index.html').content, '<p>Final</p>');
      assert.deepEqual(result.plan.slice(0, 2).map(step => step.status), ['ok', 'ok']);
      assert.equal(outcomes.filter(info => info.name === 'set_plan' && info.result?.error).length, 3);
      assert.equal(result.tools.filter(name => name === 'edit_file').length, 2, 'each actual edit runs once; rejected checklist updates do not replay edits');
    });
    await t.test('repeated invalid status churn still reaches the ordinary bounded no-progress guard', async () => {
      beginAgent(); let n = 0; let visible = [];
      const result = await runAgentLoop({ ...data, maxRounds: 8, autoContinueRounds: true }, async () => {
        if (++n === 1) return call('set_plan', { steps: ['Datei ändern', 'Ergebnis berichten'], kinds: ['edit', 'report'] });
        if (n === 2) return call('edit_file', { path: 'index.html', old_string: 'Old', new_string: 'Changed' });
        return call('set_plan', { updates: [{ step: 1, status: 'ok', evidence: ['missing'], reason: 'Still no actual evidence supplied.' }] });
      }, { getPlan: () => visible, onTool: ({ result }) => { if (result?.plan) visible = result.plan; } });
      assert.ok(n > 5 && n <= 10, `the first three rejected updates warn; continued lack of real progress remains bounded (${n} model calls)`);
      assert.equal(result.stopReason, 'no-progress');
      assert.equal(result.ok, false);
      assert.equal(result.files.find(f => f.path === 'index.html').content, '<p>Changed</p>');
      assert.equal(result.plan[0].status, 'todo');
      assert.equal(result.tools.filter(name => name === 'edit_file').length, 1);
    });
    await t.test('accepted open checklist updates do not erase rejected completion attempts', async () => {
      beginAgent(); let n = 0; let visible = []; const pauses = [];
      const result = await runAgentLoop({ ...data, maxRounds: 14, autoContinueRounds: true }, async messages => {
        if (++n === 1) return call('set_plan', { steps: ['Datei ändern', 'Ergebnis berichten'], kinds: ['edit', 'report'] });
        if (n === 2) return call('edit_file', { path: 'index.html', old_string: 'Old', new_string: 'Changed' });
        if (n <= 7) return call('set_plan', { updates: [n % 2 ?
          { step: 1, status: 'ok', evidence: ['missing'], reason: 'Unproven completion.' } :
          { step: 1, status: 'todo', reason: `Still open after attempt ${n}.` }] });
        if (n === 8) {
          assert.ok(messages.some(message => typeof message.content === 'string' && /Drei To-do-Statusänderungen|Three checklist updates/.test(message.content)), 'three unsuccessful completions must pause checklist updates despite the accepted todo calls');
          assert.deepEqual(pauses, [true]);
          return call('edit_file', { path: 'index.html', old_string: 'Changed', new_string: 'Final' });
        }
        if (n === 9) return call('set_plan', { updates: [{ step: 1, status: 'ok', evidence: ['e2'], reason: 'The requested edit was applied.' }] });
        return { content: 'Die Änderung wurde umgesetzt.' };
      }, {
        getPlan: () => visible,
        onTool: ({ result }) => { if (result?.plan) visible = result.plan; },
        pausePlanUpdates: paused => { pauses.push(paused); },
      });
      assert.deepEqual(pauses, [true, false]);
      assert.equal(result.stopReason, undefined);
      assert.equal(result.plan[0].status, 'ok');
      assert.equal(result.files.find(f => f.path === 'index.html').content, '<p>Final</p>');
    });
    await t.test('a newly evidenced completion resets the checklist rejection count', async () => {
      beginAgent(); let n = 0; let visible = []; const pauses = [];
      const missing = () => call('set_plan', { updates: [{ step: 2, status: 'ok', evidence: ['missing'], reason: 'Unproven completion.' }] });
      const result = await runAgentLoop({ ...data, maxRounds: 14, autoContinueRounds: true }, async () => {
        if (++n === 1) return call('set_plan', { steps: ['Datei lesen', 'Ergebnis prüfen', 'Ergebnis berichten'], kinds: ['read', 'check', 'report'] });
        if (n === 2) return call('read_file', { path: 'index.html' });
        if (n < 5 || n === 6) return missing();
        if (n === 5) return call('set_plan', { updates: [{ step: 1, status: 'ok', evidence: ['e1'], reason: 'The file was read.' }] });
        if (n === 7) return call('run_file', { path: 'index.html' });
        if (n === 8) return call('play', { actions: [{ type: 'assert', selector: 'body', text: 'Old' }] });
        if (n === 9) return call('set_plan', { updates: [{ step: 2, status: 'ok', evidence: ['e3'], reason: 'The expected preview text was asserted.' }] });
        return { content: 'Die Datei wurde gelesen und die Vorschau geprüft.' };
      }, {
        getPlan: () => visible,
        onTool: ({ result }) => { if (result?.plan) visible = result.plan; },
        pausePlanUpdates: paused => { pauses.push(paused); },
        runFile: async () => ({ ok: true }),
        play: async () => ({ ok: true, functionalChecks: true, input: { assertions: 1 } }),
      });
      assert.deepEqual(pauses, []);
      assert.deepEqual(result.plan.slice(0, 2).map(step => step.status), ['ok', 'ok']);
    });
    await t.test('partial checklist updates count their rejected completions', async () => {
      beginAgent(); let n = 0; let visible = []; const pauses = []; const outcomes = [];
      const result = await runAgentLoop({ ...data, maxRounds: 14, autoContinueRounds: true }, async () => {
        if (++n === 1) return call('set_plan', { steps: ['Datei ändern', 'Ergebnis prüfen', 'Ergebnis berichten'], kinds: ['edit', 'check', 'report'] });
        if (n === 2) return call('edit_file', { path: 'index.html', old_string: 'Old', new_string: 'Changed' });
        if (n <= 5) return call('set_plan', { updates: [
          { step: 1, status: 'ok', evidence: ['missing'], reason: 'Unproven completion.' },
          { step: 2, status: n === 4 ? 'todo' : 'run', reason: 'The check remains unfinished.' },
        ] });
        assert.deepEqual(pauses, [true]);
        return { content: 'Die Datei wurde geändert. Die Checkliste enthält noch ungeprüfte Punkte.' };
      }, {
        getPlan: () => visible,
        onTool: ({ result }) => { outcomes.push(result); if (result?.plan) visible = result.plan; },
        pausePlanUpdates: paused => { pauses.push(paused); },
      });
      assert.equal(outcomes.filter(result => result?.ok === true && result.rejected_updates?.length).length, 3);
      assert.equal(result.plan[0].status, 'todo');
      assert.equal(result.ok, false);
    });
    await t.test('a final answer with 0/6 triggers one status reconciliation, including text-tool mode', async () => {
      for (const transport of ['native', 'text']) {
        beginAgent(); let n = 0; let visible;
        const result = await runAgentLoop(data, async messages => {
          n++;
          let choice;
          if (n === 1) choice = call('set_plan', { steps });
          else if (n === 2) choice = call('read_file', { path: 'index.html' });
          else if (n === 3) choice = call('edit_file', { path: 'index.html', old_string: 'Old', new_string: 'Tags, statistics, help, sorting' });
          else if (n === 4) choice = call('run_file', { path: 'index.html' });
          else if (n === 5) choice = call('play', {actions:[{type:'assert',selector:'body',text:'Tags, statistics, help, sorting'}]});
          else if (n === 6) choice = { content: 'Alle vier Funktionen umgesetzt und geprüft.' };
          else if (n === 7) {
            assert.match(JSON.stringify(messages), /Current visible checklist/);
            assert.match(JSON.stringify(messages), /e4: play/);
            choice = call('set_plan', { updates: steps.map((_, i) => ({ step: i + 1, kind: kinds[i], status: 'ok', evidence: [i === 0 ? 'e1' : i === 5 ? 'e4' : 'e2'], reason: `Result for step ${i + 1} confirmed in the actual tool output.` })) });
          } else choice = { content: 'Umsetzung und Prüfung abgeschlossen.' };
          if (transport === 'text' && choice.tool_calls) { const c = choice.tool_calls[0]; choice = { content: JSON.stringify({ name: c.function.name, arguments: JSON.parse(c.function.arguments) }) }; }
          return { ...choice, toolContract: { transport, names: ['set_plan', 'read_file', 'edit_file', 'run_file', 'play'] } };
        }, { runFile: async () => ({ ok: true }), play: async (_keys,_hold,actions) => {assert.deepEqual(actions,[{type:'assert',selector:'body',text:'Tags, statistics, help, sorting'}]);return {ok:true,functionalChecks:true,input:{assertions:1}};}, onTool: info => { if (info.result?.plan) visible = info.result.plan; } });
        assert.equal(result.ok, true);
        assert.equal(n, 8, 'final answer must wait for the checklist reconciliation');
        assert.deepEqual(visible.map(s => s.status), Array(6).fill('ok'));
      }
    });
    await t.test('updates preserve locked text and require matching successful current evidence', () => {
      const p = new PlanProgress();
      p.sync([{ text: 'Tests ausführen', kind: 'check', status: 'todo' }, { text: 'Dienst-Datensatz löschen', kind: 'service', status: 'todo' }]);
      const update = (step, evidence) => p.set({ updates: [{ step, status: 'ok', evidence, reason: 'Verified' }] }, false);
      p.record('shell', { command: 'npm test' }, { ok: false });
      assert.ok(update(1, ['e1']).error);
      p.record('shell', { command: 'echo ok' }, { ok: true });
      assert.ok(update(1, ['e2']).error);
      p.record('shell', { command: 'npm test' }, { ok: true });
      p.record('write_file', { path: 'main.js' }, { ok: true }, true);
      assert.ok(update(1, ['e3']).error, 'stale checks cannot close the task');
      p.record('mcp_call', { name: 'notion-search' }, { ok: true });
      assert.ok(update(2, ['e5']).error, 'search is not deletion');
      assert.ok(update(1, ['invented']).error);
      assert.ok(p.set({ steps: ['Replace', 'User checklist'] }, false).error);
      p.record('shell', { command: 'npm test' }, { ok: true });
      assert.equal(update(1, ['e6']).ok, true, 'locked plan still allows progress');
      assert.equal(p.plan[1].status, 'todo');
      assert.equal(p.plan[0].text, 'Tests ausführen');
    });
    await t.test('an unclassified action cannot be converted into a report to bypass evidence', () => {
      const progress = new PlanProgress();
      progress.sync([{ text: 'Ändere main.js und teste das Ergebnis.', status: 'todo' }]);
      const rejected = progress.set({ updates: [{ step: 1, status: 'run', kind: 'report', reason: 'Summarize at the end.' }] }, false);
      assert.match(rejected.error, /requests work/);
      assert.equal(progress.hasOpenWork(), true);
      assert.equal(progress.plan[0].kind, undefined);
    });
    await t.test('changing the kind cannot turn a requested preview assertion into a launch or read', () => {
      for (const existingKind of [undefined, 'run', 'read']) {
        const progress = new PlanProgress();
        progress.sync([{text:'Öffne index.html und verifiziere den Ausgangszustand Paused und Zähler 0.', status:'todo', kind:existingKind}]);
        progress.record('run_file', {path:'index.html'}, {ok:true, stage:{kind:'html'}});
        progress.record('read_file', {path:'index.html'}, {ok:true, content:'<output>Paused</output>'});
        const results = [
          {step:1, kind:'run', status:'ok', evidence:['e1'], reason:'HTML launched'},
          {step:1, kind:'read', status:'ok', evidence:['e2'], reason:'HTML read'},
        ];
        for (const update of results) assert.ok(progress.set({updates:[update]}, false).error);
        assert.equal(progress.plan[0].status, 'todo');
      }
    });
    await t.test('ignored reminders remain bounded and never check open work', async () => {
      beginAgent(); let n = 0;
      const result = await runAgentLoop(data, async () => ++n === 1 ? call('set_plan', { steps }) : { content: 'Alles erledigt.' });
      assert.ok(n <= 4);
      assert.match(result.reply, /To-do|checklist/i);
      assert.notEqual(result.plan?.[0]?.status, 'ok');
    });
    await t.test('new failures invalidate earlier success, while running editor launches count only as launches', () => {
      const p = new PlanProgress();
      p.sync([{ text: 'Tests ausführen', kind: 'check', status: 'err' }, {text:'Godot-Editor öffnen',kind:'run',status:'todo'}]);
      const update = (step, evidence) => p.set({updates:[{step,status:'ok',evidence,reason:'Result verified'}]});
      p.record('shell',{command:'npm test'},{ok:true});
      p.record('shell',{command:'npm test'},{ok:false});
      assert.ok(update(1,['e1']).error);
      assert.equal(p.plan[0].status,'err');
      p.record('shell',{command:'npm test'},{ok:true});
      assert.equal(update(1,['e3']).ok,true);
      p.record('engine_run',{action:'editor'},{ok:true,running:true});
      assert.equal(update(2,['e4']).ok,true);
      assert.ok(update(1,['e4']).error);
      p.record('engine_run',{action:'check'},{ok:true,running:true});
      assert.ok(update(1,['e5']).error);
      p.record('run_file',{path:'cart.test.mjs'},{ok:true});
      assert.equal(update(1,['e6']).ok,true);
      p.record('run_file',{path:'index.html'},{ok:true});
      assert.ok(update(1,['e7']).error, 'launch alone does not prove checks');
    });
    await t.test('early inspection evidence survives long jobs and compact mode always retains the update tool', async () => {
      const p = new PlanProgress();
      p.sync([{text:'Bestandsaufnahme',status:'todo'}]);
      p.record('read_file',{path:'original.mjs'},{content:'original'});
      for (let i=0;i<100;i++) p.record('edit_file',{path:`part${i}.mjs`},{ok:true},true);
      assert.match(p.context(),/e1: read_file original.mjs/);
      const { ToolSession } = await server.ssrLoadModule('/src/lib/tool-compat.ts');
      const { AGENT_TOOLS } = await server.ssrLoadModule('/src/lib/agent-tools.ts');
      const session = new ToolSession('compact','Lies die Datei');
      const available = AGENT_TOOLS.filter(t => ['set_plan','select_tools','ask_user','read_file','list_files','grep','edit_file','write_file','run_file'].includes(t.function.name));
      beginAgent(); let n=0;
      const visible = [{text:'Bestandsaufnahme',kind:'read',status:'todo'}];
      await runAgentLoop({...data,messages:[{role:'user',content:'Lies index.html und erkläre den Inhalt.'}]}, async () => {
        const names = session.tools(available).map(t=>t.function.name);
        n++;
        if (n===1) { assert.ok(names.includes('set_plan')); return {...call('read_file',{path:'index.html'}),toolContract:{transport:'native',names}}; }
        if (n===3) { assert.ok(names.includes('set_plan')); return {...call('set_plan',{updates:[{step:1,status:'ok',reason:'Source inspected',evidence:['e1']}]}),toolContract:{transport:'native',names}}; }
        return {content:'Dokument gelesen.',toolContract:{transport:'native',names}};
      },{getPlan:()=>visible,onTool:({result})=>{if(result.plan) visible.splice(0,visible.length,...result.plan);},selectTools:names=>session.select(names)});
      assert.equal(visible[0].status,'ok');
      assert.equal(n,4);
    });
    await t.test('resume publishes the revalidated visible checklist before requesting the model', async () => {
      const { AgentWorkflow } = await server.ssrLoadModule('/src/lib/agent-workflow.ts');
      const files = { 'model.js': 'export const model = {};', 'store.js': 'export const store = {};' };
      const progress = new PlanProgress();
      progress.record('write_file', { path: 'model.js' }, { ok: true }, true);
      progress.record('write_file', { path: 'store.js' }, { ok: true }, true);
      const old = [{ text: 'Implement model.js and store.js', kind: 'edit', status: 'ok' }, { text: 'Implement index.html and ui.js', kind: 'edit', status: 'ok' }];
      const saved = progress.snapshot(); saved.plan = structuredClone(old);
      const workflow = new AgentWorkflow(files, {}, [], undefined, 'resumed-todo-probe'); await workflow.update(files, {}, []);
      let visible = structuredClone(old), published = false, asked = false;
      beginAgent();
      await assert.rejects(runAgentLoop({ ...data, files: Object.entries(files).map(([path, content]) => ({ path, content })), workflow: workflow.checkpoint({ planProgress: saved }) }, async () => {
        asked = true;
        assert.equal(published, true, 'UI receives the correction before a new model turn');
        assert.deepEqual(visible.map(step => step.status), ['ok', 'todo']);
        abortAgent('Synthetic resume probe complete');
        throw Error('Synthetic resume probe complete');
      }, { getPlan: () => visible, onTool: info => { if (info.result?.plan) { visible = info.result.plan; published ||= info.result.revalidated === true; } } }), /Synthetic resume probe complete/);
      assert.equal(asked, true);
    });
    await t.test('Stop during reconciliation is still honored', async () => {
      beginAgent(); let n = 0;
      await assert.rejects(runAgentLoop(data, async () => {
        if (++n === 1) return call('set_plan', { steps });
        if (n === 3) abortAgent('Gestoppt');
        return { content: 'Alles erledigt.' };
      }), /Gestoppt|abort|stop/i);
    });
  } finally {
    await new Promise(resolve => setTimeout(resolve, 50));
    await server.close();
  }
});
