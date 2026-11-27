import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { createServer } from 'vite';

test('skill management saves and removes owned instructions without neighboring data loss', async t => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { '@': path.resolve('src') } }, ssr: { external: ['react', 'react-dom', 'zustand', 'js-yaml'] }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  t.after(() => server.close());
  const { useIde } = await server.ssrLoadModule('/src/store/ide.ts');
  const learn = await server.ssrLoadModule('/src/lib/learn.ts');
  const management = await server.ssrLoadModule('/src/lib/skill-management.ts');
  const { useLearn } = learn;
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { if (!String(args[0]).startsWith('[zustand persist middleware]')) warn(...args); };
  t.after(() => { console.warn = warn; });
  const manifest = '.anvil/skills/export-check/SKILL.md', ref = '.anvil/skills/export-check/references/check.md';
  const source = '---\nname: export-check\ndescription: Verify an artificial export\nlicense: MIT\ncompatibility: Requires the artificial project\nmetadata:\n  version: "2.1"\n---\nRead [the dimensions](references/check.md) and compare the actual export.';
  const files = { [manifest]: source, [ref]: 'Expected width: 20 mm.', 'keep.txt': 'INDEPENDENT USER DATA' };
  const reset = () => {
    useIde.setState({ workspaceCwd: '', workspaceMemoryId: 'managed-skills-fixture', workspaceEpoch: 10, files: { ...files }, dirs: ['.anvil/skills/export-check', '.anvil/skills/export-check/references'], openPaths: [manifest, 'keep.txt'], activePath: manifest, dirty: {}, editBases: {}, agentBusy: false, pathOperation: null, chat: [], autoSaveDisk: false, checkpoints: [] });
    useLearn.setState({ prefs: { ...learn.LEARN_DEFAULTS }, skills: [], facts: [], negs: [], forgotten: [], forgottenFacts: [], disabledSkills: [], pinnedSkills: {}, skillSelection: [], activeSkills: [] });
    learn.hydrateLearnFromFiles(useIde.getState().files);
    return useLearn.getState().skills[0];
  };
  await t.test('inline edit preserves source metadata and references, export contains only the owned package', async () => {
    const skill = reset();
    await management.saveManagedSkill(skill.id, { when: 'Verify current export dimensions', body: 'Read [the dimensions](references/check.md) and compare all expected dimensions.' });
    const stored = useLearn.getState().skills.find((value: { id: string }) => value.id === skill.id);
    assert.match(stored.body, /all expected dimensions/);
    assert.match(useIde.getState().files[manifest], /license: MIT/);
    assert.equal(useIde.getState().files[ref], files[ref]); assert.equal(useIde.getState().files['keep.txt'], files['keep.txt']);
    assert.equal(management.skillSource(stored).version, '2.1');
    const pack = management.managedSkillPackage(stored);
    assert.deepEqual(Object.keys(pack).sort(), ['SKILL.md', 'references/check.md']);
    assert.match(pack['SKILL.md'], /current export dimensions/);
  });
  await t.test('remove commits the whole owned folder and prunes registration, pins and tabs', async () => {
    const skill = reset(); useLearn.getState().pinSkill(skill.id, true);
    await management.removeManagedSkill(skill.id);
    assert.equal(useIde.getState().files[manifest], undefined); assert.equal(useIde.getState().files[ref], undefined);
    assert.equal(useIde.getState().files['keep.txt'], files['keep.txt']);
    assert.equal(learn.visibleSkills().length, 0); assert.ok(!useIde.getState().openPaths.includes(manifest));
    assert.deepEqual(useLearn.getState().pinnedSkills[learn.workspaceId()], []);
    learn.hydrateLearnFromFiles(files); assert.equal(useLearn.getState().skills.length, 0, 'a regular reload must not undo explicit removal');
  });
  await t.test('a project switch while saving does not remove anything from either store', async () => {
    const skill = reset(), oldFiles = useIde.getState().files;
    const pending = management.removeManagedSkill(skill.id);
    useIde.setState({ workspaceEpoch: 11 });
    await assert.rejects(pending, /geändert|gewechselt/);
    assert.equal(useIde.getState().files, oldFiles); assert.equal(useLearn.getState().skills[0].id, skill.id);
  });
  await t.test('busy projects and escaped file bindings reject before mutation', async () => {
    const skill = reset(); useIde.setState({ agentBusy: true });
    await assert.rejects(management.removeManagedSkill(skill.id), /gerade bearbeitet/);
    useIde.setState({ agentBusy: false });
    useLearn.setState({ skills: [{ ...skill, file: 'src/SKILL.md' }] });
    await assert.rejects(management.removeManagedSkill(skill.id), /Skill-Dateipfad/);
    assert.equal(useIde.getState().files['keep.txt'], files['keep.txt']);
  });
  await t.test('user-level edit and removal never touch a same-named project file', async () => {
    reset();
    const skill = { id: 'user-only', name: 'user-only', when: 'Verify a user workflow', body: 'Preserve the current user workflow.', scope: 'user', kind: 'guide', uses: 0, score: .1, wins: 0, fails: 9, at: 0, file: manifest };
    useLearn.setState({ skills: [skill] });
    const before = useIde.getState().files;
    await management.saveManagedSkill(skill.id, { when: 'Verify a general workflow', body: 'Use the explicitly selected input and report its actual result.' });
    assert.equal(useIde.getState().files, before);
    await management.removeManagedSkill(skill.id);
    assert.equal(useIde.getState().files, before); assert.deepEqual(useLearn.getState().skills, []);
  });
});
