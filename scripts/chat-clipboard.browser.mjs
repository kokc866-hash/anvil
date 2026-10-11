import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { _electron } from 'playwright';
import { verifyBuild } from './build-fingerprint.mjs';

const build = await verifyBuild(process.cwd(), true);
const output = path.resolve('artifacts/clipboard-fix-2026-10-06/browser');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'profile-'));
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const url = `http://127.0.0.1:${port}/`;
const env = { ...process.env, ANVIL_DESKTOP_MODE: 'production', ANVIL_PORT: String(port), ANVIL_QA_USER_DATA: profile, ANVIL_HOME: path.join(profile, 'packages') };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [], consoleErrors = [], blockedRequests = [], modelRequests = [];
let app, checking = false;
const deadline = setTimeout(() => { app?.process()?.kill(); process.exitCode = 1; }, 90000);
try {
  app = await _electron.launch({ args: [path.resolve('fixtures/electron-boot.mjs')], env });
  let page;
  for (let i = 0; i < 240; i++) {
    page = app.windows().find(window => window.url() === url);
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(page, 'The real production main window must appear');
  // The URL is visible before main.mjs has finished awaiting loadURL. Reloading
  // then aborts application startup and produces a native ERR_ABORTED dialog.
  await page.waitForFunction(() => document.readyState === 'complete' && window.__anvilIde?.persist.hasHydrated());
  await page.waitForLoadState('load');
  assert.equal(await app.evaluate(({ BrowserWindow }, target) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === target);
    return Boolean(window && !window.webContents.isLoadingMainFrame());
  }, url), true, 'Initial application navigation must finish before QA reload');
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (checking && message.type() === 'error') consoleErrors.push({ message: message.text(), resource: message.location().url }); });
  await page.addInitScript(() => {
    localStorage.setItem('anvil-brain', JSON.stringify({ state: { on: false, autoLoad: false, autoUpdate: false, autonomy: 'off' }, version: 0 }));
    localStorage.setItem('anvil-intern', JSON.stringify({ state: { prefs: { on: false, autoHeal: false, autoSoft: false } }, version: 0 }));
  });
  await page.route('**/*', route => {
    const target = new URL(route.request().url());
    if (/\/(?:chat\/completions|api\/(?:chat|generate)|responses)(?:\/|$)/.test(target.pathname)) { modelRequests.push(target.origin + target.pathname); return route.abort(); }
    if (target.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '/* Existing system-font fallback for offline QA. */' });
    if (['http:', 'https:'].includes(target.protocol) && target.origin !== new URL(url).origin) {
      blockedRequests.push(target.origin + target.pathname);
      return route.abort();
    }
    return route.continue();
  });
  checking = true;
  await page.reload();
  await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(window => !window.isDestroyed())?.setSize(1440, 900); });
  await page.evaluate(() => {
    window.__anvilIde.setState({ setupDone: true, autoUpdate: false, locale: 'de', workspaceCwd: '', files: { 'test.txt': 'Synthetic clipboard QA' }, dirty: {}, activePath: 'test.txt',
      autoSaveDisk: false, autoRunAgent: false, autoPreview: false, mcpServers: [], agentBusy: false, agentJob: null,
      panels: { editor: true, agent: true, trail: false, output: false }, sidebar: null, settingsOpen: false,
      chat: [{ id: 'clipboard-fixture', role: 'assistant', content: 'Künstlicher Einfügetest. Es wird kein Modell aufgerufen.' }], agentDraft: '' });
  });
  const field = page.locator('#anvil-chat');
  await field.waitFor();

  // Read only status from the actual native route. Never log clipboard contents
  // or write to the global OS clipboard during this isolated UI test.
  const nativeRead = await page.evaluate(async () => {
    const available = typeof window.anvilNative?.clipboardRead === 'function';
    if (!available) return { available, readable: false, error: 'Native clipboard binding missing' };
    try {
      const value = await window.anvilNative.clipboardRead();
      return { available: true, readable: typeof value?.text === 'string' && typeof value?.image === 'string' };
    } catch (error) { return { available, readable: false, error: String(error?.message || error) }; }
  });
  await writeFile(path.join(output, 'native-read.json'), JSON.stringify(nativeRead, null, 2));
  assert.equal(nativeRead.readable, true, 'The actual production native clipboard binding must be readable');
  await field.click();
  const browserRead = await page.evaluate(async () => {
    try { return { readable: typeof await navigator.clipboard.readText() === 'string' }; }
    catch { return { readable: false }; }
  });
  assert.equal(browserRead.readable, true, 'The actual browser fallback must be readable in the focused production window');

  // Substitute only this QA process's clipboard reader, keeping the real IPC
  // handler and preload. The operating system clipboard is never written.
  const nativeFormats = await app.evaluate(async ({ BrowserWindow, clipboard }, target) => {
    const original = clipboard.read;
    try {
      clipboard.read = async () => [{ types: ['text/plain', 'image/png'], getType: async type =>
        type === 'text/plain' ? new Blob(['Synthetic native CAD instructions']) : new Blob([new Uint8Array([0, 1, 2, 255])], { type }) }];
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === target);
      const value = await window.webContents.executeJavaScript('window.anvilNative.clipboardRead()');
      return { text: value.text === 'Synthetic native CAD instructions', image: value.image === 'data:image/png;base64,AAEC/w==' };
    } finally { clipboard.read = original; }
  }, url);
  assert.deepEqual(nativeFormats, { text: true, image: true });

  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('clipboard-read');
    ipcMain.handle('clipboard-read', () => { throw Error('Synthetic native clipboard unavailable'); });
  });
  const prompt = 'FreeCAD endurance fixture\n' + 'Build, recompute, inspect dimensions and verify STEP exports.\n'.repeat(200);
  await page.evaluate(prompt => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => prompt } }), prompt);
  async function paste(label = 'Einfügen', position) {
    await field.click({ button: 'right', position });
    await page.getByRole('menu').getByRole('menuitem', { name: label, exact: true }).click();
  }
  await field.fill('before SELECT after');
  await field.evaluate(input => input.setSelectionRange(7, 13));
  const selectedMiddle = await field.evaluate(input => {
    const style = getComputedStyle(input), measure = document.createElement('canvas').getContext('2d');
    measure.font = style.font;
    return { x: parseFloat(style.paddingLeft) + measure.measureText(input.value.slice(0, 10)).width,
      y: parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2 };
  });
  await paste('Einfügen', selectedMiddle);
  await page.waitForFunction(expected => document.getElementById('anvil-chat').value.length === expected, 'before  after'.length + prompt.length);
  assert.equal(await field.inputValue(), `before ${prompt} after`);
  assert.equal(await page.evaluate(() => window.__anvilIde.getState().agentDraft), `before ${prompt} after`);
  await page.waitForFunction(expected => {
    const field = document.getElementById('anvil-chat');
    return field.selectionStart === expected && field.selectionEnd === expected;
  }, 7 + prompt.length);
  const selection = await field.evaluate(input => ({ start: input.selectionStart, end: input.selectionEnd }));
  assert.deepEqual(selection, { start: 7 + prompt.length, end: 7 + prompt.length });
  await page.screenshot({ path: path.join(output, 'long-prompt.png') });

  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    read: async () => [{ types: ['image/png', 'text/plain'], getType: async type => {
      if (type === 'image/png') throw Error('Synthetic unreadable image');
      return new Blob(['Readable FreeCAD instructions']);
    } }], readText: async () => { throw Error('Synthetic direct read unavailable'); },
  } }));
  await field.fill('');
  await paste();
  await page.waitForFunction(() => document.getElementById('anvil-chat').value === 'Readable FreeCAD instructions');

  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    read: async () => { throw Error('Synthetic rich read denied'); }, readText: async () => { throw Error('Synthetic plain read denied'); },
  } }));
  await field.fill('Keep this unsent draft');
  await paste();
  await page.waitForFunction(() => window.__anvilIde.getState().notice.includes('Strg+V'));
  await page.locator('.ui-notice').filter({ hasText: 'Strg+V' }).waitFor();
  await page.waitForFunction(() => {
    const notice = document.querySelector('.ui-notice');
    return notice && Number(getComputedStyle(notice).opacity) >= 0.95;
  });
  assert.equal(await field.inputValue(), 'Keep this unsent draft');
  assert.notEqual(await page.evaluate(() => window.__anvilIde.getState().notice), 'Die Zwischenablage ist leer.');
  await page.screenshot({ path: path.join(output, 'blocked-access.png') });

  await page.evaluate(() => window.__anvilIde.setState({ locale: 'en' }));
  await paste('Paste');
  await page.waitForFunction(() => window.__anvilIde.getState().notice.includes('Ctrl+V'));
  await page.locator('.ui-notice').filter({ hasText: 'Ctrl+V' }).waitFor();
  assert.equal(await field.inputValue(), 'Keep this unsent draft');

  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('clipboard-read');
    ipcMain.handle('clipboard-read', () => ({ text: '', image: '' }));
  });
  await page.evaluate(() => window.__anvilIde.setState({ locale: 'de' }));
  await paste();
  await page.waitForFunction(() => window.__anvilIde.getState().notice === 'Die Zwischenablage ist leer.');
  assert.equal(await field.inputValue(), 'Keep this unsent draft');

  const expectedOfflineResourceErrors = consoleErrors.filter(error => error.message === 'Failed to load resource: net::ERR_FAILED'
    && error.resource === 'https://grok.com/grok-app-builder/extensions.js' && blockedRequests.includes(error.resource));
  const unexpectedConsoleErrors = consoleErrors.filter(error => !expectedOfflineResourceErrors.includes(error));
  assert.deepEqual(errors, []); assert.deepEqual(unexpectedConsoleErrors, []); assert.deepEqual(modelRequests, []);
  const result = { ok: true, production: true, version: build.version, sourceFingerprint: build.source, outputFingerprint: build.outputFingerprint,
    isolatedProfile: true, nativeRead, nativeFormats, browserRead, globalClipboardWritten: false, clipboardContentLogged: false,
    completeLongPrompt: true, promptCharacters: prompt.length, selectionPreserved: true, badImageDoesNotHideText: true,
    deniedAccessPreservesDraft: true, emptyAndDeniedDistinct: true, englishNotice: true, modelRequestsObserved: modelRequests.length,
    errors, unexpectedConsoleErrors, expectedOfflineResourceErrors, blockedRequests };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  clearTimeout(deadline);
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  const watchers = await readdir(path.join(profile, 'waechter')).catch(() => []);
  if (watchers[0]) await writeFile(path.join(profile, 'waechter', watchers[0], 'stop'), 'Clipboard QA completed');
}
