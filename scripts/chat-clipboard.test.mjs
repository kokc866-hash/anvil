import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLoopFixture } from '../fixtures/agent-loop-fixture.mjs';

test('chat context-menu paste preserves content across clipboard access failures', async t => {
  const f = await agentLoopFixture(t);
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const savedFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  t.after(() => {
    if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator); else delete globalThis.navigator;
    if (savedFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', savedFrame); else delete globalThis.requestAnimationFrame;
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: callback => { callback(); return 0; } });
  const { chatMenu, chatSel } = await f.server.ssrLoadModule('/src/components/ide/chat-menu.tsx');
  const { t: label } = await f.server.ssrLoadModule('/src/lib/i18n.ts');
  const denied = async () => { throw new Error('Synthetic clipboard access denied'); };
  function reset(native, clipboard) {
    window.anvilNative = native;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard } });
    f.useIde.setState({ agentDraft: 'before SELECT after', notice: '', locale: 'de' });
    chatSel.a = 7; chatSel.b = 13;
  }
  async function paste() {
    const images = [];
    const entry = chatMenu({ kind: 'pane', x: 0, y: 0 }, { addImages: urls => images.push(...urls) }).find(item => item.label === label('chatPaste'));
    assert.ok(entry, 'The real chat menu must offer paste');
    entry.onClick();
    await new Promise(resolve => setImmediate(resolve));
    return { images, draft: f.useIde.getState().agentDraft, notice: f.useIde.getState().notice };
  }
  await t.test('native IPC failure falls back to browser text and inserts a complete long prompt', async () => {
    const prompt = 'FreeCAD endurance task\n' + 'Parameters, checks and exports.\n'.repeat(350);
    reset({ clipboardRead: denied }, { readText: async () => prompt });
    const result = await paste();
    assert.equal(result.notice, '', 'A failed native route must not reject a readable clipboard');
    assert.equal(result.draft.length, 'before  after'.length + prompt.length);
    assert.ok(result.draft.startsWith('before FreeCAD endurance task\n'));
    assert.ok(result.draft.endsWith('\n after'));
  });
  await t.test('native text and image paste keeps both and replaces only the selected draft text', async () => {
    reset({ clipboardRead: async () => ({ text: 'CAD', image: 'data:image/png;base64,fixture' }) }, { readText: denied });
    assert.deepEqual(await paste(), { images: ['data:image/png;base64,fixture'], draft: 'before CAD after', notice: '' });
  });
  await t.test('browser permission failure for rich content still accepts readable plain text', async () => {
    reset(null, { read: denied, readText: async () => 'plain text' });
    assert.equal((await paste()).draft, 'before plain text after');
  });
  await t.test('an unreadable image representation cannot hide readable text in the same clipboard item', async () => {
    reset(null, { read: async () => [{ types: ['image/png', 'text/plain'], getType: async type => {
      if (type === 'image/png') throw Error('Synthetic image format unavailable');
      return new Blob(['readable text']);
    } }], readText: denied });
    assert.equal((await paste()).draft, 'before readable text after');
  });
  await t.test('an incompatible native response falls back instead of losing readable text', async () => {
    reset({ clipboardRead: async () => null }, { readText: async () => 'CAD' });
    assert.equal((await paste()).draft, 'before CAD after');
  });
  await t.test('all read routes denied preserve the draft and must not claim the clipboard is empty', async () => {
    reset(null, { read: denied, readText: denied });
    const result = await paste();
    assert.equal(result.draft, 'before SELECT after');
    assert.notEqual(result.notice, 'Die Zwischenablage ist leer.', 'Access denial is not empty content');
    assert.ok(result.notice, 'Paste needs an actionable failure notice');
  });
  await t.test('denied access explains direct keyboard paste in English when selected', async () => {
    reset({ clipboardRead: denied }, { read: denied, readText: denied });
    f.useIde.setState({ locale: 'en' });
    const result = await paste();
    assert.match(result.notice, /Ctrl\+V/);
    assert.doesNotMatch(result.notice, /Zwischenablage/);
  });
  await t.test('a delayed clipboard result cannot paste into a newly selected project', async () => {
    let complete;
    reset({ clipboardRead: () => new Promise(resolve => { complete = resolve; }) }, {});
    const pending = paste();
    f.useIde.setState({ workspaceEpoch: f.useIde.getState().workspaceEpoch + 1, agentDraft: 'new project draft' });
    complete({ text: 'old project paste', image: 'data:image/png;base64,fixture' });
    assert.deepEqual(await pending, { images: [], draft: 'new project draft', notice: '' });
  });
  await t.test('a confirmed empty native clipboard remains distinct from a read failure', async () => {
    reset({ clipboardRead: async () => ({ text: '', image: '' }) }, { readText: denied });
    const result = await paste();
    assert.equal(result.draft, 'before SELECT after');
    assert.equal(result.notice, 'Die Zwischenablage ist leer.');
  });
});
