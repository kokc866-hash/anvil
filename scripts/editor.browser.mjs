import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const origin = 'http://127.0.0.1:8193';
const reports = [];
let server, browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 8193, strictPort: true }, cacheDir: 'node_modules/.vite-editor-tests', optimizeDeps: { include: ['react', 'react-dom/client', 'zustand', 'zustand/middleware', 'typescript', 'prettier/standalone', 'prettier/plugins/babel', 'prettier/plugins/estree', 'prettier/plugins/typescript', 'prettier/plugins/html', 'prettier/plugins/markdown', 'prettier/plugins/postcss', 'prettier/plugins/yaml'], noDiscovery: true } });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.ANVIL_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--disable-gpu', '--disable-features=LocalNetworkAccessChecks'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.stack); });
  page.on('crash', () => console.error('BROWSER_CRASH'));
  page.on('console', m => { if (m.type() === 'error') console.error('BROWSER', m.text().slice(0, 500)); });
  let releaseFormat;
  let formatStarted = false;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/__editor_audit') return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root" style="height:850px;display:flex;flex-direction:column"></div></body></html>' });
    if (url.pathname === '/v1/ping') return route.fulfill({ json: { ok: true } });
    if (url.pathname === '/v1/format') { formatStarted = true; await new Promise(r => releaseFormat = r); return route.fulfill({ json: { ok: true, via: 'fixture', content: 'FORMATTED_A' } }); }
    if (url.origin !== origin && url.protocol !== 'blob:') return route.abort();
    return route.continue();
  });
  await page.goto(origin + '/__editor_audit');
  await page.evaluate(async () => {
    const rr = (await import('/@react-refresh')).default;
    rr.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const { useIde } = await import('/src/store/ide.ts');
    window.__partialize = (await import('/src/store/ide-persist.ts')).partializeIde;
    await import('/src/lib/sse.ts');
    const { useBrain } = await import('/src/lib/brain/index.ts');
    useBrain.setState({ on: false, autoLoad: false });
    window.__anvilIde = useIde;
    window.auditReset = (files, active = Object.keys(files)[0]) => useIde.setState({ files, workspaceEpoch: useIde.getState().workspaceEpoch + 1, editBases: {}, activePath: active, openPaths: active ? [active] : [], dirs: [], dirty: {}, undo: {}, pendingDiffs: [], workspaceCwd: '', companionUrl: 'http://127.0.0.1:7845', suggestOn: false, autoSaveDisk: false, liveRun: false, previewOpen: false, agentBusy: false, liveEditor: true, agentMode: 'ask', pluginDisabled: [], pluginKnown: [] });
    window.auditReset({ 'a.txt': 'one\ntwo\nthree\nfour\nfive\n', 'b.txt': 'B' });
    const m = await (await import('/src/lib/monaco.ts')).loadMonaco();
    const originalCreate = m.editor.create;
    m.editor.create = function(...args) { window.__ed = originalCreate.apply(this, args); return window.__ed; };
    const ReactMod = await import('/@id/react'); const React = ReactMod.default || ReactMod;
    const Client = await import('/@id/react-dom/client'); const createRoot = Client.createRoot || Client.default?.createRoot;
    const { CodeEditor } = await import('/src/components/ide/code-editor.tsx');
    const { langFromPath } = await import('/src/lib/languages.ts');
    function Wrap() { const p = useIde(s => s.activePath); const value = useIde(s => s.files[p] || ''); return React.createElement(CodeEditor, { path: p, value, language: langFromPath(p), onChange: v => useIde.getState().setContent(p, v) }); }
    window.__auditReact = React; window.__auditWrap = Wrap; window.__auditCreateRoot = createRoot;
    window.__auditRoot = createRoot(document.getElementById('root'));
    window.__auditRoot.render(React.createElement(Wrap));
  });
  await page.waitForFunction(() => window.__ed);
  const report = async (name, fn) => { const result = await page.evaluate(fn); reports.push({ name, ...result }); console.log(JSON.stringify(reports.at(-1))); };
  await report('goto_same_file', async () => {
    const { gotoFile } = await import('/src/lib/goto.ts');
    window.__ed.setPosition({ lineNumber: 1, column: 1 }); gotoFile('a.txt', 4);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { expectedLine: 4, actual: window.__ed.getPosition(), unconsumed: window.__anvilGoto };
  });
  await report('command_event_cycle', () => {
    const orig = window.dispatchEvent.bind(window); const counts = {};
    window.dispatchEvent = e => { if (e.type === 'anvil-replace' || e.type === 'anvil-symbols') { counts[e.type] = (counts[e.type] || 0) + 1; if (counts[e.type] > 6) return true; } return orig(e); };
    window.__ed.getAction('anvil.replace').run(); window.__ed.getAction('anvil.symbols').run();
    window.dispatchEvent = orig; return { counts, stoppedByAuditAt: 7 };
  });
  await report('folder_move', async () => {
    window.auditReset({ 'src/a.txt': 'SOURCE', 'dest/a.txt': 'DESTINATION' }, 'src/a.txt');
    const st = window.__anvilIde; st.setState({ dirs: ['src', 'dest'] }); await st.getState().relocatePath('src', 'dest/src');
    const s = st.getState(); return { files: s.files, tabs: s.openPaths, active: s.activePath, activeExists: s.activePath in s.files };
  });
  await report('accept_diffs_dirty', () => {
    window.auditReset({ 'manual.txt': 'USER', 'agent.txt': 'BEFORE' });
    const st = window.__anvilIde; st.setState({ dirty: { 'manual.txt': true } }); st.getState().patchFiles({ 'agent.txt': 'AFTER' }); st.getState().acceptAllDiffs();
    return { dirtyAfterAccept: st.getState().dirty, manualContent: st.getState().files['manual.txt'] };
  });
  await report('reject_existing_empty_file', () => {
    window.auditReset({ 'empty.txt': '' }); const st = window.__anvilIde;
    st.getState().patchFiles({ 'empty.txt': 'ADDED' }); st.getState().rejectDiff('empty.txt');
    return { existsAfterReject: 'empty.txt' in st.getState().files };
  });
  await report('persisted_diff_truncation', async () => {
    const partializeIde = window.__partialize; const st = window.__anvilIde;
    window.auditReset({ 'large.txt': 'x'.repeat(450000) }); st.getState().patchFiles({ 'large.txt': 'NEW' });
    const persisted = partializeIde(st.getState()); st.setState({ pendingDiffs: persisted.pendingDiffs }); st.getState().rejectDiff('large.txt');
    return { originalLength: 450000, restoredLength: st.getState().files['large.txt']?.length };
  });
  await report('live_stream_prose_in_ask', async () => {
    window.auditReset({ 'a.txt': 'ORIGINAL' });
    const { readSseChat } = await import('/src/lib/sse.ts');
    const { resetLiveWrite } = await import('/src/lib/live-write.ts'); resetLiveWrite();
    const data = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Beispiel: write_file {"path":"a.txt","content":"EXAMPLE"}' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
    const choice = await readSseChat(new Response(data)); await new Promise(r => setTimeout(r, 80));
    return { mode: window.__anvilIde.getState().agentMode, nativeToolCalls: choice.tool_calls?.length || 0, contentAfterStream: window.__anvilIde.getState().files['a.txt'] };
  });
  await report('live_incomplete_arguments', async () => {
    window.auditReset({ 'a.txt': 'ORIGINAL' }); const { applyLiveDraft, resetLiveWrite } = await import('/src/lib/live-write.ts'); resetLiveWrite();
    applyLiveDraft('write_file', '{"path":"a.txt",'); await new Promise(r => setTimeout(r, 80));
    return { contentAfterPathOnly: window.__anvilIde.getState().files['a.txt'] };
  });
  await page.evaluate(() => window.auditReset({ 'a.go': 'ORIGINAL_A', 'b.go': 'ORIGINAL_B' }, 'a.go'));
  await page.waitForFunction(() => window.__ed.getModel()?.uri.path === '/a.go');
  await page.evaluate(() => window.__ed.getAction('anvil.format').run());
  for (let i = 0; !formatStarted && i < 100; i++) await new Promise(r => setTimeout(r, 20));
  if (!formatStarted) throw new Error('format fixture was not called');
  await page.evaluate(() => window.__anvilIde.getState().openFile('b.go'));
  await page.waitForFunction(() => window.__ed.getModel()?.uri.path === '/b.go');
  releaseFormat();
  await page.waitForFunction(() => window.__anvilIde.getState().notice === 'Formatiert');
  await report('format_after_tab_switch', () => ({ files: window.__anvilIde.getState().files }));
  await report('completion_workspace_cost', async () => {
    const { suggest } = await import('/src/lib/suggest.ts');
    const files = Object.fromEntries(Array.from({ length: 400 }, (_, i) => ['file' + i + '.js', ('const variable' + i + ' = computeValue;\n').repeat(1000)]));
    const start = performance.now();
    for (let i = 0; i < 3; i++) suggest({ source: 'const va', prefix: 'va', prev: 'const', lang: 'javascript', files, path: 'active.js' });
    return { syntheticFiles: 400, workspaceChars: Object.values(files).reduce((n, s) => n + s.length, 0), meanMsPerRefresh: +( (performance.now() - start) / 3 ).toFixed(1) };
  });
  await report('cached_model_remount', async () => {
    window.auditReset({ 'remount.txt': 'OLD' });
    await new Promise(r => setTimeout(r, 80));
    window.__auditRoot.unmount();
    window.__anvilIde.getState().setContent('remount.txt', 'NEW_WHILE_HIDDEN');
    window.__auditRoot = window.__auditCreateRoot(document.getElementById('root'));
    window.__auditRoot.render(window.__auditReact.createElement(window.__auditWrap));
    await new Promise(r => setTimeout(r, 80));
    return { value: window.__ed.getValue() };
  });
  await report('workspace_undo_isolation', async () => {
    window.auditReset({ 'same.txt': 'PROJECT_A' });
    await new Promise(r => setTimeout(r, 80));
    window.__ed.executeEdits('fixture', [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 }, text: 'EDIT_A' }]);
    window.auditReset({ 'same.txt': 'PROJECT_B' });
    await new Promise(r => setTimeout(r, 80));
    window.__ed.trigger('fixture', 'undo');
    return { value: window.__ed.getValue(), stored: window.__anvilIde.getState().files['same.txt'] };
  });
  await report('format_offline_and_css', async () => {
    const { formatCode } = await import('/src/lib/format.ts');
    window.__anvilIde.setState({ tabSize: 4, insertSpaces: true });
    const css = await formatCode('a.css', 'body{color:red;background:blue}');
    let unsupported = false;
    try { await formatCode('a.txt', 'line  \n\n\nvalue  '); } catch { unsupported = true; }
    return { css, unsupported };
  });
  await report('compiler_worker', async () => {
    const { compilerJob } = await import('/src/lib/compiler-client.ts');
    const a = { 'before.ts': 'export const x: number = 1;' };
    const first = await compilerJob('lint', a, []);
    const b = { 'after.ts': 'export const x: number = "a";' };
    const second = await compilerJob('lint', b, []);
    const renameFiles = { 'a.ts': 'export const count = 1; const s = "count"; function f(count: number) { return count; } console.log(count);', 'b.ts': 'export const count = 2;' };
    const rename = await compilerJob('rename', renameFiles, [], { path: 'a.ts', offset: 14, nextName: 'total' });
    return { first, second, rename: rename.value };
  });
  await report('replace_all_worker', async () => {
    const { searchJob } = await import('/src/lib/search-job.ts');
    const files = { 'a.txt': Array(250).fill('foo').join('\n') };
    const result = await searchJob({ files, needle: 'foo', opts: {}, replacement: 'bar' });
    const look = await searchJob({ files: { 'look.txt': 'ab ab' }, needle: '(?<=a)(b)', opts: { regex: true }, replacement: '$1$1' });
    return { total: result.total, left: result.patched['a.txt'].includes('foo'), look: look.patched['look.txt'] };
  });
  await report('archive_recovery_and_discard', async () => {
    const db = await import('/src/lib/persist-db.ts');
    const original = 'X'.repeat(450000);
    await db.saveArchive('editor-regression', { files: { 'a.txt': 'new' }, recovery: { pendingDiffs: [{ path: 'a.txt', before: original, after: 'new', existedBefore: true, backupVersion: 2 }], editBases: { 'a.txt': original } } }, {});
    const archive = await db.loadArchive('editor-regression');
    await db.removeArchive('editor-regression');
    window.auditReset({ 'a.txt': 'saved' });
    const st = window.__anvilIde;
    st.getState().setContent('a.txt', 'edited');
    await new Promise(r => setTimeout(r, 1000));
    const dirtyWithAutosaveOff = st.getState().dirty['a.txt'];
    await st.getState().discardFile('a.txt');
    return { backupLength: archive.recovery.pendingDiffs[0].before.length, baseLength: archive.recovery.editBases['a.txt'].length, dirtyWithAutosaveOff, afterDiscard: st.getState().files['a.txt'], dirtyAfterDiscard: !!st.getState().dirty['a.txt'] };
  });
  const result = name => reports.find(r => r.name === name);
  assert.equal(result('goto_same_file').actual.lineNumber, 4);
  assert.deepEqual(result('command_event_cycle').counts, { 'anvil-replace': 1, 'anvil-symbols': 1 });
  assert.deepEqual(result('folder_move').files, { 'dest/a.txt': 'DESTINATION', 'dest/src/a.txt': 'SOURCE' });
  assert.equal(result('folder_move').activeExists, true);
  assert.equal(result('accept_diffs_dirty').dirtyAfterAccept['manual.txt'], true);
  assert.equal(result('reject_existing_empty_file').existsAfterReject, true);
  assert.equal(result('persisted_diff_truncation').restoredLength, 450000);
  assert.equal(result('live_stream_prose_in_ask').contentAfterStream, 'ORIGINAL');
  assert.equal(result('live_incomplete_arguments').contentAfterPathOnly, 'ORIGINAL');
  assert.deepEqual(result('format_after_tab_switch').files, { 'a.go': 'FORMATTED_A', 'b.go': 'ORIGINAL_B' });
  assert.equal(result('cached_model_remount').value, 'NEW_WHILE_HIDDEN');
  assert.equal(result('workspace_undo_isolation').stored, 'PROJECT_B');
  assert.match(result('format_offline_and_css').css, /    color: red;/);
  assert.equal(result('format_offline_and_css').unsupported, true);
  assert.deepEqual(result('compiler_worker').first.hits, []);
  assert.ok(result('compiler_worker').second.hits.some(h => h.path === 'after.ts'));
  assert.equal(result('compiler_worker').rename['b.ts'], undefined);
  assert.match(result('compiler_worker').rename['a.ts'], /"count"; function f\(count: number\)/);
  assert.equal(result('replace_all_worker').total, 250);
  assert.equal(result('replace_all_worker').left, false);
  assert.equal(result('replace_all_worker').look, 'abb abb');
  assert.deepEqual(result('archive_recovery_and_discard'), { name: 'archive_recovery_and_discard', backupLength: 450000, baseLength: 450000, dirtyWithAutosaveOff: true, afterDiscard: 'saved', dirtyAfterDiscard: false });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ uncaughtErrors: errors, editorRegressionComplete: true }));
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await browser?.close(); await server?.close(); }
