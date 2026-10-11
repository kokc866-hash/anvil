import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { AgentKnowledge } from '../electron/agent-knowledge.mjs';
import { AgentJobHost } from '../electron/agent-job-host.mjs';
import { AgentProjectRuntime } from '../electron/agent-project-runtime.mjs';

test('real renderer knowledge and background snapshot share independent skill permissions', async t => {
  const values = new Map(), timers = new Set(), previous = Object.fromEntries(['window','document','localStorage','fetch'].map(key => [key, globalThis[key]]));
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  globalThis.window = Object.assign(new EventTarget(), { localStorage,
    setTimeout: (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; },
    clearTimeout: id => { timers.delete(id); clearTimeout(id); } });
  globalThis.document = Object.assign(new EventTarget(), { documentElement: { lang: 'de' } });
  const network = [];
  globalThis.fetch = async (...args) => { network.push(String(args[0])); throw Error('Network disabled in skill fixture'); };
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { '@': path.resolve('src') } }, ssr: { external: ['react', 'react/jsx-runtime', 'react-dom', 'zustand', 'zustand/middleware'] }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  t.after(async () => {
    try {
    const { useIntern } = await server.ssrLoadModule('/src/lib/intern.ts');
    useIntern.getState().setPrefs({ on: false, autoHeal: false });
    const { flushPersistence } = await server.ssrLoadModule('/src/lib/persist-storage.ts');
    const { flushSecrets } = await server.ssrLoadModule('/src/lib/secrets.ts');
    await flushPersistence().catch(function unavailable(error) { if (error.errors) return error.errors.forEach(unavailable); assert.match(String(error), /indexedDB/i); }); await flushSecrets(); await new Promise(resolve => setTimeout(resolve, 100));
    } finally {
    for (const id of timers) clearTimeout(id);
    await server.close();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
    }
  });
  const learn = await server.ssrLoadModule('/src/lib/learn.ts'), { useIde } = await server.ssrLoadModule('/src/store/ide.ts');
  await learn.useLearn.persist.rehydrate();
  const store = learn.useLearn;
  useIde.setState({ files: { 'project.godot': '[application]\nconfig/name="Artificial skill test"', 'main.gd': 'extends Node\n' }, workspaceCwd: '', workspaceMemoryId: 'isolated-skill-fixture', agentMode: 'agent', activeSurfaceId: 'anvil', mcpServers: [], chat: [] });
  store.setState({ on: false, facts: [{ id: 'private', kind: 'user', text: 'PERSONAL MEMORY MUST NOT LEAK', scope: 'user', conf: .9, hits: 1, at: 0 }], prefs: { ...store.getState().prefs, skills: true, skillBodies: true, skillAuto: true } });
  const prompt = learn.learnPrompt('Ändere die Godot-Szene.');
  assert.match(prompt, /anvil-godot/);assert.doesNotMatch(prompt, /PERSONAL MEMORY/);
  assert.ok(store.getState().skillSelection.some(skill => skill.id === 'anvil-godot'));
  assert.ok((await learn.agentLearn('add', { text: 'Do not save this' })).error);
  const read = await learn.agentLearn('read', { name: 'anvil-godot' });
  assert.ok(read.body);assert.equal(read.resourceContents, undefined);assert.ok(read.resources.length);
  const resource = await learn.agentLearn('read', { name: 'anvil-godot', resource: read.resources[0] });
  assert.ok(resource.content);
  assert.ok((await learn.agentLearn('patch', { name: 'anvil-godot', body: 'Replace builtin' })).error);
  const { prepareBackgroundContext } = await server.ssrLoadModule('/src/lib/background-context.ts');
  const snapshot = await prepareBackgroundContext('Ändere die Godot-Szene.', []);
  assert.equal(snapshot.knowledge.enabled, true);assert.equal(snapshot.knowledge.memoryEnabled, false);
  assert.equal(snapshot.knowledge.personEnabled, false);assert.deepEqual(snapshot.knowledge.memories, []);
  const bundled = snapshot.knowledge.skills.find(skill => skill.id === 'anvil-godot');
  assert.ok(bundled.body);assert.ok(bundled.resourceContents[read.resources[0]]);
  assert.ok(snapshot.skillSelection.some(skill => skill.id === 'anvil-godot'));
  const { projectSkillPackage } = await server.ssrLoadModule('/src/lib/skill-library.ts');
  const { planSkillPackage } = await server.ssrLoadModule('/src/lib/skill-package.ts');
  const pack = planSkillPackage(Object.fromEntries(Object.entries(projectSkillPackage('anvil-godot')).map(([key, value]) => [`anvil-godot-projekt/${key}`, value])), useIde.getState().files, []);
  useIde.setState(state => ({ files: { ...state.files, ...pack.files } }));
  learn.hydrateLearnFromFiles(useIde.getState().files, Object.keys(pack.files));
  const referencePath = read.resources[0], fullReference = `${pack.main.replace(/\/[^/]+$/, '')}/${referencePath}`;
  useIde.setState(state => ({ files: { ...state.files, [fullReference]: 'Edited project reference must be used.' } }));
  assert.equal((await learn.agentLearn('read', { name: 'anvil-godot-projekt', resource: referencePath })).content, 'Edited project reference must be used.');
  assert.match(pack.files[pack.main], /name:"anvil-godot-projekt"/);
  assert.ok((await learn.agentLearn('read', { name: 'anvil-godot-projekt', resource: '../../main.gd' })).error);
  store.getState().setSkillEnabled('anvil-godot', false);
  assert.ok((await learn.agentLearn('read', { name: 'anvil-godot' })).error);
  assert.equal((await prepareBackgroundContext('Godot erweitern', [])).knowledge.skills.some(skill => skill.id === 'anvil-godot'), false);
  store.getState().setSkillEnabled('anvil-godot', true);
  store.getState().pinSkill('anvil-godot', true);
  store.getState().setPref('skillAuto', false);
  assert.match(learn.learnPrompt('Diesen Punkt bearbeiten'), /anvil-godot/);
  store.getState().clearMemories();assert.ok(store.getState().skills.some(skill => skill.id === 'anvil-godot'));
  const { exportSettingsPack, applySettingsPack } = await server.ssrLoadModule('/src/lib/settings-io.ts');
  const exported = exportSettingsPack();
  store.getState().setSkillEnabled('anvil-godot', false);store.getState().pinSkill('anvil-godot', false);
  applySettingsPack(exported);
  assert.equal(store.getState().disabledSkills.includes('anvil-godot'), false);
  assert.ok(store.getState().pinnedSkills[learn.workspaceId()].includes('anvil-godot'));
  store.getState().setPref('skills', false);
  assert.equal(learn.learnPrompt('Godot erweitern'), '');
  assert.ok((await learn.agentLearn('read', { name: 'anvil-godot' })).error);
  assert.equal(network.length, 0, 'discovery and preview must not start model or service requests');
  store.setState({ pinnedSkills: { [learn.workspaceId()]: ['removed-one', 'removed-two', 'removed-three'] } });
  store.getState().pinSkill('anvil-godot', true);
  assert.deepEqual(store.getState().pinnedSkills[learn.workspaceId()], ['anvil-godot'], 'removed skills cannot exhaust the pin quota');
  const permissions = [];
  window.anvilNative = { agentJob: async (action, payload) => { if (action === 'permissions') permissions.push(payload); return { available: true }; } };
  const { startBackgroundAgentMonitor } = await server.ssrLoadModule('/src/lib/background-agent.ts');
  const stopMonitor = startBackgroundAgentMonitor();
  try { store.getState().setSkillEnabled('anvil-godot', false); assert.ok(permissions.some(payload => payload.knowledge.disabledSkills.includes('anvil-godot')), 'individual permission revocation reaches the native host'); }
  finally { stopMonitor(); }
});

test('native host records later skill loads and retains their selection after restart', async t => {
  const folder = mkdtempSync(path.join(tmpdir(), 'anvil-skills-native-'));
  t.after(() => { assert.ok(path.resolve(folder).startsWith(path.resolve(tmpdir()) + path.sep)); assert.ok(path.basename(folder).startsWith('anvil-skills-native-')); rmSync(folder, { recursive: true, force: true }); });
  const knowledge = new AgentKnowledge({ storagePath: path.join(folder, 'journal.json') });
  const runtime = new AgentProjectRuntime({ knowledge });
  const child = Object.assign(new EventEmitter(), { send() {}, kill() {} });
  const snapshotPath = path.join(folder, 'job.json');
  const host = new AgentJobHost({ snapshotPath, runtime, launch: () => child });
  const skill = { id: 'anvil-fixture', name: 'anvil-fixture', builtin: true, body: 'Inspect the artificial file, then verify its result.', scope: 'user', resources: ['ref.md'], resourceContents: { 'ref.md': 'Explicit reference only.' } };
  const request = { project: 'artificial-fixture', execution: true, files: { 'notes.md': 'Fixture' }, messages: [{ role: 'user', content: 'Inspect fixture' }], model: { provider: 'custom', model: 'fixture', context: 16384 }, skillSelection: [], knowledge: { enabled: true, memoryEnabled: false, skillsEnabled: true, skillBodies: true, skills: [skill], memories: [], workspace: 'fixture' } };
  host.start(request); child.emit('message', { type: 'ready' });
  child.emit('message', { type: 'operation', id: 1, operation: { kind: 'knowledge', action: 'read', args: { name: skill.name } } });
  for (let n = 0; n < 50 && host.state.operation?.status !== 'done'; n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(host.state.operation.status, 'done', host.state.error);
  assert.equal(host.state.skillSelection[0].name, skill.name);
  assert.match(host.state.skillSelection[0].reason, /skill_read/);
  host.finish('done');
  const restarted = new AgentJobHost({ snapshotPath, launch: () => child });
  assert.deepEqual(restarted.state.skillSelection, host.state.skillSelection);
});

test('exclusive service surfaces can read instructions without gaining project write access', async t => {
  const folder = mkdtempSync(path.join(tmpdir(), 'anvil-skills-exclusive-'));
  t.after(() => { assert.ok(path.resolve(folder).startsWith(path.resolve(tmpdir()) + path.sep)); assert.ok(path.basename(folder).startsWith('anvil-skills-exclusive-')); rmSync(folder, { recursive: true, force: true }); });
  const runtime = new AgentProjectRuntime({ knowledge: new AgentKnowledge({ storagePath: path.join(folder, 'journal.json') }) });
  runtime.begin({ project: 'fixture', files: {}, surface: { id: 'external-service', mode: 'exclusive' }, knowledge: { enabled: true, skillsEnabled: true, skillBodies: true, memoryEnabled: false, skills: [{ id: 'service-guide', name: 'service-guide', body: 'Read granted tools and inspect their schema.', scope: 'user' }] } }, 'fixture-job');
  const context = { files: {}, signal: new AbortController().signal, operationId: 'fixture:read' };
  assert.ok((await runtime.execute({ kind: 'knowledge', action: 'read', args: { name: 'service-guide' } }, context)).body);
  await assert.rejects(runtime.execute({ kind: 'knowledge', action: 'write', args: { name: 'bad-write', body: 'No authority' } }, context), /nur im Modus Brücke/);
  await assert.rejects(runtime.execute({ kind: 'write', path: 'must-not-exist.txt', content: 'No authority' }, context), /nur im Modus Brücke/);
  await runtime.close();
});
