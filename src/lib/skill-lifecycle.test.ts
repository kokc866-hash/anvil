import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { createServer } from 'vite';

test('skill registration, lifecycle and feedback preserve project authority', async t => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { '@': path.resolve('src') } }, ssr: { external: ['react', 'react-dom', 'zustand', 'js-yaml'] }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  t.after(() => server.close());
  const { useIde } = await server.ssrLoadModule('/src/store/ide.ts');
  const learn = await server.ssrLoadModule('/src/lib/learn.ts');
  const { useLearn } = learn;
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { if (!String(args[0]).startsWith('[zustand persist middleware]')) warn(...args); };
  t.after(() => { console.warn = warn; });
  const manifest = '.anvil/skills/export-check/SKILL.md';
  const source = '---\nname: export-check\ndescription: Verify the artificial export\nscope: user\nkind: plugin\n---\nRead the expected dimensions and verify the actual export.';
  const reset = (files: Record<string, string> = {}) => {
    useIde.setState({ workspaceCwd: 'I:/SkillLifecycle/A', workspaceEpoch: 1, files, dirs: [], dirty: {}, agentBusy: false, pathOperation: null, chat: [], autoSaveDisk: false });
    useLearn.setState({ on: true, prefs: { ...learn.LEARN_DEFAULTS }, skills: [], facts: [], negs: [], forgotten: [], forgottenFacts: [], disabledSkills: [], pinnedSkills: {}, skillSelection: [], activeSkills: [] });
    learn.markSkills([]);
  };
  await t.test('a project manifest cannot make itself global or executable', () => {
    reset({ [manifest]: source });
    learn.hydrateLearnFromFiles({ [manifest]: source });
    const skill = useLearn.getState().skills[0];
    assert.equal(skill.scope, 'project'); assert.equal(skill.kind, 'guide');
    assert.equal(learn.visibleSkills().length, 1);
    useIde.setState({ workspaceCwd: 'I:/SkillLifecycle/B', files: {} });
    assert.deepEqual(learn.visibleSkills(), []);
    assert.equal(useLearn.getState().skills[0].body, skill.body, 'another project must not delete its stored instructions');
  });
  await t.test('existing user skills survive project metadata and retain their body', () => {
    reset({ [manifest]: source });
    const user = { id: 'user-export', name: 'export-check', when: 'User export workflow', body: 'User instructions must survive.', scope: 'user', kind: 'guide', uses: 0, score: .1, wins: 0, fails: 9, at: 0 };
    useLearn.setState({ skills: [user] });
    learn.hydrateLearnFromFiles({ [manifest]: source });
    assert.equal(useLearn.getState().skills.find((s: { id: string }) => s.id === user.id)?.body, user.body);
    useIde.setState({ workspaceCwd: 'I:/SkillLifecycle/B', files: {} });
    assert.equal(learn.visibleSkills()[0]?.id, user.id);
  });
  await t.test('deletion and malformed content remove only this project’s file-backed skill', async () => {
    reset({ [manifest]: source }); learn.hydrateLearnFromFiles({ [manifest]: source });
    const first = useLearn.getState().skills[0];
    useLearn.setState({ skills: [...useLearn.getState().skills, { ...first, id: 'other-project', ws: 'v2:path:i:/skilllifecycle/b' }] });
    useIde.setState({ files: {} }); learn.hydrateLearnFromFiles({});
    assert.equal(useLearn.getState().skills.length, 1);
    assert.deepEqual(learn.visibleSkills(), []);
    assert.ok('error' in await learn.agentLearn('read', { name: first.id }));
    useIde.setState({ files: { [manifest]: source } }); learn.hydrateLearnFromFiles({ [manifest]: source });
    const broken = { [manifest]: '---\nname: [broken\n---\nInvalid manifest.' };
    useIde.setState({ files: broken }); learn.hydrateLearnFromFiles(broken);
    assert.equal(useLearn.getState().skills.length, 1);
  });
  await t.test('partial imports do not prune absent skills and unchanged scans notify nobody', () => {
    reset({ [manifest]: source }); learn.hydrateLearnFromFiles({ [manifest]: source });
    learn.hydrateLearnFromFiles({}, [], { complete: false });
    assert.equal(useLearn.getState().skills.length, 1);
    const before = useLearn.getState().skills;
    let notifications = 0; const off = useLearn.subscribe(() => notifications++);
    learn.hydrateLearnFromFiles({ [manifest]: source }); off();
    assert.equal(notifications, 0); assert.equal(useLearn.getState().skills, before);
  });
  await t.test('feedback stays descriptive, visible and tied to the used instruction version', async () => {
    reset({ [manifest]: source }); learn.hydrateLearnFromFiles({ [manifest]: source });
    const skill = useLearn.getState().skills[0];
    await learn.agentLearn('run', { name: skill.id }, { jobId: 'task-A' });
    for (let i = 0; i < 3; i++) await learn.agentLearn('outcome', { kind: 'fail' }, { jobId: 'task-A', eventId: `fail-${i}` });
    const rated = useLearn.getState().skills[0];
    assert.equal(rated.body, skill.body); assert.equal(learn.visibleSkills().length, 1);
    assert.equal(rated.feedback.length, 3);
    assert.ok(rated.feedback.every((entry: { jobId: string; version: string; source: string }) => entry.jobId === 'task-A' && entry.version && entry.source === 'agent'));
    const stale = await learn.agentLearn('outcome', { kind: 'ok' }, { jobId: 'task-B' });
    assert.ok(stale.error); assert.equal(useLearn.getState().skills[0].feedback.length, 3);
    useLearn.setState({ skills: [{ ...rated, body: 'A newer instruction that has not been used.' }] });
    assert.ok((await learn.agentLearn('outcome', { kind: 'ok' }, { jobId: 'task-A' })).error);
    assert.ok((await learn.agentLearn('outcome', { kind: 'unknown' }, { jobId: 'task-A' })).error);
  });
  await t.test('program failures, accept/reject and intentional aborts do not grade a skill', () => {
    reset({ [manifest]: source }); learn.hydrateLearnFromFiles({ [manifest]: source });
    const skill = useLearn.getState().skills[0]; learn.markSkills([skill.id]);
    useLearn.getState().track('accept'); useLearn.getState().track('reject');
    learn.reflectUtterance('Intentional stop', 'abort');
    assert.equal(useLearn.getState().skills[0].feedback?.length || 0, 0);
    assert.equal(useLearn.getState().skills[0].body, skill.body);
    assert.equal(useLearn.getState().facts.some((f: { text: string }) => /Bricht ab/.test(f.text)), false);
  });
  await t.test('flat legacy guides expose only declared resources, not neighboring skills', async () => {
    const file = '.anvil/skills/flat.md', own = '.anvil/skills/references/check.md', neighbor = '.anvil/skills/private/SKILL.md';
    const values = { [file]: 'Read [the check](references/check.md) and verify its dimensions.', [own]: 'Expected width: 20.', [neighbor]: 'Private neighboring instructions must not be disclosed here.' };
    reset(values); learn.hydrateLearnFromFiles(values);
    const guide = useLearn.getState().skills.find((skill: { file: string }) => skill.file === file);
    const read = await learn.agentLearn('read', { name: guide.id });
    assert.deepEqual(read.resources, [own]);
    assert.ok((await learn.agentLearn('read', { name: guide.id, resource: 'private/SKILL.md' })).error);
    assert.equal((await learn.agentLearn('read', { name: guide.id, resource: 'references/check.md' })).content, values[own]);
  });
});
