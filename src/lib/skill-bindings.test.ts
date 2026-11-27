import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { createServer } from 'vite';

test('real request preparation shares skill bindings in foreground and background, honors switches and clears old choices', async t => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { '@': path.resolve('src') } }, ssr: { external: ['react', 'react-dom', 'zustand', 'js-yaml'] }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  t.after(() => server.close());
  const { useIde } = await server.ssrLoadModule('/src/store/ide.ts');
  const { useLearn, LEARN_DEFAULTS, learnPrompt, skillEnvironment } = await server.ssrLoadModule('/src/lib/learn.ts');
  const { librarySeeds, skillToolHints } = await server.ssrLoadModule('/src/lib/skill-library.ts');
  const { prepareBackgroundContext } = await server.ssrLoadModule('/src/lib/background-context.ts');
  const oldWarn = console.warn;
  console.warn = (...args: unknown[]) => { if (!String(args[0]).startsWith('[zustand persist middleware]')) oldWarn(...args); };
  t.after(() => { console.warn = oldWarn; });
  useIde.setState({ workspaceCwd: 'I:/artificial-skill-binding-fixture', workspaceEpoch: 101, files: { 'package.json': '{"dependencies":{"react":"19"}}', 'src/view.tsx': 'export const View = () => null;' }, dirs: [], dirty: {}, chat: [], attached: [], openPaths: [], recentPaths: [], pendingAsk: undefined, activePath: '', mcpServers: [], planWho: 'anvil', agentMode: 'agent', activeSurfaceId: 'anvil', surfaceMode: 'bridge', llmProvider: 'custom', llmModel: 'artificial-no-network', llmBaseUrl: 'http://127.0.0.1:1', llmAuthMode: 'api' });
  useLearn.setState({ on: false, prefs: { ...LEARN_DEFAULTS, skills: true, skillBodies: true, skillAuto: true }, skills: librarySeeds(), facts: [], forgotten: [], forgottenFacts: [], disabledSkills: [], pinnedSkills: {}, skillSelection: [], activeSkills: [] });
  assert.deepEqual(skillEnvironment().frameworks, ['react']);
  const prompt = 'Nutze FreeCAD und prüfe die Geometrie.';
  const foreground = learnPrompt(prompt);
  const expected = skillToolHints(useLearn.getState().skillSelection);
  assert.ok(expected.includes('mcp_list') && expected.includes('mcp_call'));
  const request = await prepareBackgroundContext(prompt, []);
  assert.ok(request.toolHints.includes('skill_read'));
  for (const name of expected) assert.ok(request.toolHints.includes(name), name);
  assert.equal(new Set(request.toolHints).size, request.toolHints.length);
  assert.ok(request.toolHints.length <= 11);
  assert.equal(request.knowledge.memoryEnabled, false);
  assert.equal(request.knowledge.skillsEnabled, true);
  assert.match(foreground, /Anleitungen noch nicht geladen/);
  assert.ok(request.memory.length < 6000, 'Initial skill guidance remains short and does not include package bodies/licenses');
  assert.doesNotMatch(request.memory, /GNU LESSER GENERAL PUBLIC LICENSE|Creative Commons Attribution-ShareAlike|Permission is hereby granted/);
  assert.equal(useLearn.getState().activeSkills.length, 0, 'Preparing a private snapshot does not mean the model loaded a guide');

  const following = await prepareBackgroundContext('Wie spät ist es?', []);
  assert.deepEqual(following.skillSelection, []);
  assert.deepEqual(following.toolHints, []);

  useLearn.setState({ prefs: { ...LEARN_DEFAULTS, skills: false, skillBodies: true, skillAuto: true } });
  const disabled = await prepareBackgroundContext(prompt, []);
  assert.equal(disabled.knowledge.skillsEnabled, false);
  assert.deepEqual(disabled.toolHints, []);

  useLearn.setState({ prefs: { ...LEARN_DEFAULTS, skills: true, skillBodies: false, skillAuto: true } });
  const metadataOnly = await prepareBackgroundContext(prompt, []);
  assert.equal(metadataOnly.knowledge.skillBodies, false);
  assert.deepEqual(metadataOnly.toolHints, []);

  useLearn.setState({ prefs: { ...LEARN_DEFAULTS, skills: true, skillBodies: true, skillAuto: false } });
  const manual = await prepareBackgroundContext(prompt, []);
  assert.deepEqual(manual.toolHints, []);
  const explicit = await prepareBackgroundContext('$anvil-freecad Prüfe die Geometrie.', []);
  assert.ok(explicit.toolHints.includes('mcp_call'));
});
