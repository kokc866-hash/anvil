import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'vite';

test('reviewed skill boundaries preserve resource ownership and native/frontend version identity', async t => {
  const root = path.resolve('artifacts/skills-improvement-2026-10-28/review-routing');
  mkdirSync(root, { recursive: true });
  const temp = mkdtempSync(path.join(root, 'boundary-'));
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { '@': path.resolve('src') } }, ssr: { external: ['react', 'react-dom', 'zustand', 'js-yaml'] }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  t.after(() => server.close());
  const { useIde } = await server.ssrLoadModule('/src/store/ide.ts');
  const { AgentKnowledge } = await server.ssrLoadModule('/electron/agent-knowledge.mjs');
  const { knowledgeVersion } = await server.ssrLoadModule('/electron/agent-knowledge-state.mjs');
  const { skillInstructionVersion } = await server.ssrLoadModule('/electron/skill-feedback.mjs');
  const { redactPatterns } = await server.ssrLoadModule('/src/lib/vault-redact.ts');
  const learn = await server.ssrLoadModule('/src/lib/learn.ts');
  const { applyBackgroundKnowledge } = await server.ssrLoadModule('/src/lib/background-knowledge.ts');
  const management = await server.ssrLoadModule('/src/lib/skill-management.ts');
  const { readBackgroundKnowledge } = await server.ssrLoadModule('/src/agent-runtime/knowledge.ts');
  const { prepareBackgroundContext } = await server.ssrLoadModule('/src/lib/background-context.ts');
  const { useBrain } = await server.ssrLoadModule('/src/lib/brain/store.ts');
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { if (!String(args[0]).startsWith('[zustand persist middleware]')) warn(...args); };
  t.after(() => { console.warn = warn; });
  const reset = (files: Record<string, string> = {}) => {
    useIde.setState({ workspaceCwd: path.join(temp, 'project'), workspaceEpoch: 1, files, dirs: [], dirty: {}, agentBusy: false, pathOperation: null, autoSaveDisk: false, chat: [], planWho: 'agent' });
    useBrain.setState({ on: false });
    learn.useLearn.setState({ on: false, facts: [], negs: [], skills: [], prefs: { ...learn.LEARN_DEFAULTS }, forgotten: [], forgottenFacts: [], disabledSkills: [], pinnedSkills: {}, activeSkills: [], skillSelection: [], backgroundKnowledgeEvents: [] });
    learn.markSkills([]);
  };
  const file = '.anvil/skills/shared/SKILL.md', ref = '.anvil/skills/shared/references/check.md';
  const user = { id: 'legacy-user', name: 'legacy-user', when: 'A user workflow', body: 'Read references/check.md.', file, scope: 'user', kind: 'guide', uses: 0, score: .6, wins: 0, fails: 0, at: 0 };

  await t.test('legacy user skills cannot bind another project’s same-named resource in any lane', async () => {
    const files = { [ref]: 'ARTIFICIAL_DATA_FROM_OTHER_PROJECT' };
    reset(files); learn.useLearn.setState({ skills: [user] });
    const body = await learn.agentLearn('read', { name: user.id });
    assert.equal(body.file, undefined);
    assert.equal(body.baseDirectory, undefined);
    assert.deepEqual(body.resources, []);
    assert.ok((await learn.agentLearn('read', { name: user.id, resource: 'references/check.md' })).error);

    const snapshot = { enabled: true, memoryEnabled: false, skillsEnabled: true, skillBodies: true, workspace: learn.workspaceId(), memories: [], skills: [{ ...user, description: user.when, baseDirectory: '.anvil/skills/shared', resources: [ref] }] };
    const host = new AgentKnowledge({ storagePath: path.join(temp, 'legacy-resource.json') });
    host.begin({ project: temp, knowledge: snapshot }, 'legacy-resource');
    assert.ok((await host.execute({ action: 'read', args: { name: user.id, resource: 'references/check.md' } }, { operationId: 'legacy-read', files })).error);
    assert.ok(readBackgroundKnowledge(snapshot, 'read', { name: user.id, resource: 'references/check.md' }, files).error);
  });

  await t.test('the resource restriction still permits the current project’s own skill', async () => {
    const files = { [file]: '---\nname: project-guide\ndescription: Verify an artificial export\n---\nRead references/check.md.', [ref]: 'EXPECTED_CURRENT_PROJECT_DIMENSIONS' };
    reset(files); learn.hydrateLearnFromFiles(files);
    const current = learn.useLearn.getState().skills[0];
    assert.equal((await learn.agentLearn('read', { name: current.id, resource: 'references/check.md' })).content, files[ref]);
  });

  await t.test('removing a user skill cannot freeze or hide a same-named project skill', async () => {
    const manifest = '.anvil/skills/same-name/SKILL.md';
    const source = '---\nname: same-name\ndescription: A project workflow\n---\nOLD_PROJECT_INSTRUCTIONS';
    reset({ [manifest]: source });
    learn.useLearn.setState({ skills: [{ ...user, id: 'same-name', name: 'same-name', file: undefined, body: 'USER_PROFILE_INSTRUCTIONS' }] });
    learn.hydrateLearnFromFiles(useIde.getState().files);
    const project = learn.visibleSkills().find((skill: { scope: string }) => skill.scope === 'project');
    assert.ok(project);
    await management.removeManagedSkill('same-name');
    const edited = source.replace('OLD_PROJECT_INSTRUCTIONS', 'NEW_PROJECT_INSTRUCTIONS');
    useIde.setState({ files: { [manifest]: edited } });
    learn.hydrateLearnFromFiles(useIde.getState().files);
    assert.equal((await learn.agentLearn('read', { name: project.id })).body, 'NEW_PROJECT_INSTRUCTIONS');
    useIde.setState({ workspaceCwd: path.join(temp, 'another-project'), workspaceEpoch: 2 });
    learn.hydrateLearnFromFiles(useIde.getState().files);
    assert.equal(learn.visibleSkills().find((skill: { scope: string }) => skill.scope === 'project')?.body, 'NEW_PROJECT_INSTRUCTIONS');
    assert.equal(learn.visibleSkills().some((skill: { scope: string }) => skill.scope === 'user'), false);
  });

  await t.test('a redacted runtime snapshot cannot rewrite stored instructions through usage or feedback', async () => {
    reset();
    // This artificial pattern is also used by the vault tests; it is not a credential.
    const raw = { ...user, id: 'redaction-fixture', name: 'redaction-fixture', file: undefined, body: 'Read the artificial example sk-abcdefghijklmnopqrstuv before reporting.' };
    learn.useLearn.setState({ skills: [raw] });
    const prepared = await prepareBackgroundContext('Nutze den künstlichen Skill redaction-fixture.', []);
    const sanitized = prepared.knowledge.skills.find((skill: { id: string }) => skill.id === raw.id);
    assert.notEqual(sanitized.body, raw.body);
    assert.equal(sanitized.sourceInstructionVersion, skillInstructionVersion(raw));
    const host = new AgentKnowledge({ storagePath: path.join(temp, 'redacted-snapshot.json') });
    host.begin({ project: temp, knowledge: prepared.knowledge }, 'redacted-job');
    const run = await host.execute({ action: 'run', args: { name: raw.id } }, { operationId: 'redacted-run', files: {} });
    assert.equal(run.body, sanitized.body, 'the public instruction stays redacted');
    assert.equal(run.sourceInstructionVersion, undefined);
    assert.deepEqual(applyBackgroundKnowledge(run.knowledgeEvents).conflicts, []);
    assert.equal(learn.useLearn.getState().skills[0].body, raw.body);
    assert.equal(learn.useLearn.getState().skills[0].uses, 1);
    const feedback = await host.execute({ action: 'outcome', args: { kind: 'fail' } }, { operationId: 'redacted-feedback', files: {} });
    assert.deepEqual(applyBackgroundKnowledge(feedback.knowledgeEvents).conflicts, []);
    assert.equal(learn.useLearn.getState().skills[0].body, raw.body);
    assert.equal(learn.useLearn.getState().skills[0].feedback.length, 1);
    const current = learn.useLearn.getState().skills[0];
    assert.equal(current.feedback[0].version, skillInstructionVersion(raw));
    const restartedPrepared = await prepareBackgroundContext('Nutze den künstlichen Skill redaction-fixture weiter.', []);
    assert.equal(restartedPrepared.knowledge.skills[0].sourceInstructionVersion, skillInstructionVersion(raw));
    const restarted = new AgentKnowledge({ storagePath: path.join(temp, 'redacted-snapshot.json') });
    restarted.begin({ project: temp, knowledge: restartedPrepared.knowledge }, 'redacted-job');
    const read = await restarted.execute({ action: 'read', args: { name: raw.id } }, { operationId: 'redacted-read', files: {} });
    assert.equal(read.body, sanitized.body, 'a restarted model still receives only the redacted text');
    assert.equal(read.sourceInstructionVersion, undefined);
    assert.equal(read.version, undefined);
    assert.equal(read.frontmatter, undefined);
    const second = await restarted.execute({ action: 'outcome', args: { kind: 'fail' } }, { operationId: 'redacted-feedback-after-restart', files: {} });
    assert.equal(second.verified, false);
    assert.deepEqual(applyBackgroundKnowledge(second.knowledgeEvents).conflicts, []);
    assert.equal(learn.useLearn.getState().skills[0].body, raw.body);
    assert.equal(learn.useLearn.getState().skills[0].feedback.length, 2);
    assert.ok(learn.useLearn.getState().skills[0].feedback.every((entry: { version: string }) => entry.version === skillInstructionVersion(raw)));
    assert.deepEqual(await restarted.execute({ action: 'outcome', args: { kind: 'fail' } }, { operationId: 'redacted-feedback', files: {} }), feedback);
    assert.equal(applyBackgroundKnowledge(feedback.knowledgeEvents).applied, 0);
    assert.equal(learn.useLearn.getState().skills[0].feedback.length, 2);
  });

  await t.test('equal redacted representations cannot attach old usage to a changed original', async () => {
    reset();
    const raw = { ...user, id: 'version-fixture', name: 'version-fixture', file: undefined, body: 'Read the artificial example sk-abcdefghijklmnopqrstuv before reporting.' };
    learn.useLearn.setState({ skills: [raw] });
    const prepared = await prepareBackgroundContext('Nutze den künstlichen Skill version-fixture.', []);
    const host = new AgentKnowledge({ storagePath: path.join(temp, 'same-redaction.json') });
    host.begin({ project: temp, knowledge: prepared.knowledge }, 'same-redaction-job');
    const run = await host.execute({ action: 'run', args: { name: raw.id } }, { operationId: 'same-redaction-run', files: {} });
    const changed = { ...raw, body: raw.body.replace('abcdefghijklmnopqrstuv', 'zyxwvutsrqponmlkjihgfe') };
    assert.equal(redactPatterns(changed.body).text, redactPatterns(raw.body).text);
    assert.notEqual(skillInstructionVersion(changed), skillInstructionVersion(raw));
    learn.useLearn.setState({ skills: [changed], backgroundKnowledgeEvents: [] });
    assert.deepEqual(applyBackgroundKnowledge(run.knowledgeEvents).conflicts, [raw.id]);
    assert.equal(learn.useLearn.getState().skills[0].body, changed.body);
    assert.equal(learn.useLearn.getState().skills[0].uses, 0);

    // Older saved jobs have no private instruction hash. Only the exact original
    // beforeVersion can authorize metadata projection, never scrubbed equality.
    const legacy = structuredClone(run.knowledgeEvents[0]);
    delete legacy.sourceInstructionVersion;
    delete legacy.before.sourceInstructionVersion;
    delete legacy.after.sourceInstructionVersion;
    learn.useLearn.setState({ skills: [changed], backgroundKnowledgeEvents: [] });
    assert.deepEqual(applyBackgroundKnowledge([legacy]).conflicts, [raw.id]);
    assert.equal(learn.useLearn.getState().skills[0].uses, 0);
    learn.useLearn.setState({ skills: [raw], backgroundKnowledgeEvents: [] });
    assert.equal(legacy.beforeVersion, knowledgeVersion(raw));
    assert.deepEqual(applyBackgroundKnowledge([legacy]).conflicts, []);
    assert.equal(learn.useLearn.getState().skills[0].body, raw.body);
    assert.equal(learn.useLearn.getState().skills[0].uses, 1);
  });

  await t.test('native writes, hydration, usage, feedback, replay and restart share one instruction identity', async () => {
    reset();
    const storagePath = path.join(temp, 'native-hydration.json');
    const snapshot = () => ({ enabled: true, skillsEnabled: true, skillBodies: true, memoryEnabled: false, workspace: learn.workspaceId(), memories: [], skills: learn.useLearn.getState().skills, appliedEvents: learn.useLearn.getState().backgroundKnowledgeEvents, fileVersions: {} });
    const host = new AgentKnowledge({ storagePath });
    host.begin({ project: temp, knowledge: snapshot() }, 'native-job');
    const write = await host.execute({ action: 'write', args: { name: 'native-created', when: 'Artificial native workflow', body: 'Read the expected export dimensions.', scope: 'project' } }, { operationId: 'native-write', files: {} });
    assert.deepEqual(applyBackgroundKnowledge(write.knowledgeEvents).conflicts, []);
    let files = Object.fromEntries(write.workspaceWrites.map((item: { path: string; content: string }) => [item.path, item.content]));
    useIde.setState({ files }); learn.hydrateLearnFromFiles(files);

    const run = await host.execute({ action: 'run', args: { name: 'native-created' } }, { operationId: 'native-run', files });
    assert.deepEqual(applyBackgroundKnowledge(run.knowledgeEvents).conflicts, []);
    assert.equal(learn.useLearn.getState().skills[0].uses, 1);
    const fail = await host.execute({ action: 'outcome', args: { kind: 'fail' } }, { operationId: 'native-fail', files });
    assert.deepEqual(applyBackgroundKnowledge(fail.knowledgeEvents).conflicts, []);
    assert.equal(learn.useLearn.getState().skills[0].feedback.length, 1);
    assert.deepEqual(await host.execute({ action: 'outcome', args: { kind: 'fail' } }, { operationId: 'native-fail', files }), fail);
    assert.equal(applyBackgroundKnowledge(fail.knowledgeEvents).applied, 0);

    const restarted = new AgentKnowledge({ storagePath });
    restarted.begin({ project: temp, knowledge: snapshot() }, 'native-job');
    const ok = await restarted.execute({ action: 'outcome', args: { kind: 'ok' } }, { operationId: 'native-ok', files });
    assert.equal(ok.verified, false);
    assert.deepEqual(applyBackgroundKnowledge(ok.knowledgeEvents).conflicts, []);
    assert.equal(learn.useLearn.getState().skills[0].feedback.length, 2);

    const patch = await restarted.execute({ action: 'patch', args: { name: 'native-created', body: 'Read the export and check the current dimensions.' } }, { operationId: 'native-patch', files });
    assert.deepEqual(applyBackgroundKnowledge(patch.knowledgeEvents).conflicts, []);
    files = { ...files, ...Object.fromEntries(patch.workspaceWrites.map((item: { path: string; content: string }) => [item.path, item.content])) };
    useIde.setState({ files }); learn.hydrateLearnFromFiles(files);
    const rerun = await restarted.execute({ action: 'run', args: { name: 'native-created' } }, { operationId: 'native-rerun', files });
    assert.deepEqual(applyBackgroundKnowledge(rerun.knowledgeEvents).conflicts, []);
    assert.equal(learn.useLearn.getState().skills[0].uses, 2);
    assert.equal(learn.useLearn.getState().skills[0].feedback.length, 2);
  });
});
