import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('update IPC rejects preview callers and downloads without starting installer', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'anvil-update-ipc-'));
  const handlers = new Map(); let network = 0; const revealed = [];
  globalThis.__anvilUpdateQa = {
    app: { getVersion: () => '1.0.0', getPath: () => folder },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [folder] }) },
    shell: { showItemInFolder: file => revealed.push(file), openExternal: async () => { throw new Error('Unexpected external open'); }, openPath: async () => { throw new Error('Must not execute installer'); } },
    ipcMain: { removeHandler() {}, handle(name, handler) { handlers.set(name, handler); } },
  };
  const hook = registerHooks({ resolve(specifier, context, next) { return specifier === 'electron' ? { url: 'data:text/javascript,export const {app,dialog,shell,ipcMain}=globalThis.__anvilUpdateQa;', shortCircuit: true } : next(specifier, context); } });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    network++;
    if (String(url).includes('api.github.com')) return Response.json({ tag_name: 'v1.1.0', assets: ['Anvil.Setup.exe', 'Anvil.zip'].map(name => ({ name, browser_download_url: `https://github.com/kokc866-hash/anvil/releases/download/v1.1.0/${name}`, digest: 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' })) });
    return new Response('abc');
  };
  try {
    const { bindUpdateIpc } = await import('../electron/update.mjs');
    bindUpdateIpc(url => url === 'http://127.0.0.1:8080/');
    const mainFrame = { url: 'http://127.0.0.1:8080/' };
    const event = { senderFrame: mainFrame, sender: { mainFrame } };
    const preview = { senderFrame: { url: 'data:text/html,preview' }, sender: { mainFrame } };
    assert.equal((await handlers.get('update-setup')(preview)).ok, false);
    assert.equal((await handlers.get('update-zip')(preview)).ok, false);
    assert.equal(network, 0, 'Untrusted caller cannot trigger even a network download');
    // Public publisher configuration is tested by the separate signature gate.
    const config = JSON.parse(await readFile(new URL('../product-release.json', import.meta.url), 'utf8'));
    if (!config.signing?.subjectName) {
      const result = await handlers.get('update-setup')(event);
      assert.equal(result.ok, true);
      assert.match(result.message, /speichern.*schliessen/);
      assert.match(result.message, /Signatur nicht bestaetigt/);
      assert.equal(await readFile(result.path, 'utf8'), 'abc');
      assert.deepEqual(revealed, [result.path], 'Installer is revealed, never launched');
    }
    await writeFile(join(folder, 'existing-project.txt'), 'Keep me');
    const count = network;
    const zip = await handlers.get('update-zip')(event);
    assert.equal(zip.ok, false);
    assert.match(zip.error, /leeren Ordner/);
    assert.equal(network, count + 1, 'Reject occupied destination before downloading/extracting archive');
    assert.equal(await readFile(join(folder, 'existing-project.txt'), 'utf8'), 'Keep me');
  } finally {
    globalThis.fetch = oldFetch; hook.deregister(); delete globalThis.__anvilUpdateQa;
    await rm(folder, { recursive: true, force: true });
  }
});
