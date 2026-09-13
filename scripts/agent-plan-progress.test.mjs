import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import path from 'node:path';

test('agent reconciles descriptive checklists against actual tool results', async t => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { '@': path.resolve('src') } }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
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
          else if (n === 5) choice = call('see_run', {});
          else if (n === 6) choice = { content: 'Alle vier Funktionen umgesetzt und geprüft.' };
          else if (n === 7) {
            assert.match(JSON.stringify(messages), /Current visible checklist/);
            assert.match(JSON.stringify(messages), /e4: see_run/);
            choice = call('set_plan', { updates: steps.map((_, i) => ({ step: i + 1, kind: kinds[i], status: 'ok', evidence: [i === 0 ? 'e1' : i === 5 ? 'e4' : 'e2'], reason: `Result for step ${i + 1} confirmed in the actual tool output.` })) });
          } else choice = { content: 'Umsetzung und Prüfung abgeschlossen.' };
          if (transport === 'text' && choice.tool_calls) { const c = choice.tool_calls[0]; choice = { content: JSON.stringify({ name: c.function.name, arguments: JSON.parse(c.function.arguments) }) }; }
          return { ...choice, toolContract: { transport, names: ['set_plan', 'read_file', 'edit_file', 'run_file', 'see_run'] } };
        }, { runFile: async () => ({ ok: true }), see: async () => ({ ok: true, image: 'data:image/png;base64,AAAA' }), onTool: info => { if (info.result?.plan) visible = info.result.plan; } });
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
    await t.test('early inspection evidence survives long jobs and compact mode selects the update tool', async () => {
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
        if (n===1) { assert.ok(!names.includes('set_plan')); return {...call('read_file',{path:'index.html'}),toolContract:{transport:'native',names}}; }
        if (n===3) { assert.ok(names.includes('set_plan')); return {...call('set_plan',{updates:[{step:1,status:'ok',reason:'Source inspected',evidence:['e1']}]}),toolContract:{transport:'native',names}}; }
        return {content:'Dokument gelesen.',toolContract:{transport:'native',names}};
      },{getPlan:()=>visible,onTool:({result})=>{if(result.plan) visible.splice(0,visible.length,...result.plan);},selectTools:names=>session.select(names)});
      assert.equal(visible[0].status,'ok');
      assert.equal(n,4);
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
