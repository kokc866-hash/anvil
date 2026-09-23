import { BrowserWindow, session } from 'electron';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { safeAgentPath } from './agent-project-runtime.mjs';

const MIME = { html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', txt: 'text/plain' };
const inspect = `(() => ({title:document.title,text:document.body?.innerText.slice(0,16000)||'',canvas:typeof window.Anvil?.status==='function'?window.Anvil.status():null,elements:[...document.querySelectorAll('button,input,a,select')].slice(0,80).map(e=>({tag:e.tagName,text:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'').slice(0,160)}))}))()`;

/** Untrusted project content never receives the editor preload or session. */
export class AgentPreview {
  constructor({ runtimeUrl = new URL('../agent-build/preview-runtime.mjs', import.meta.url) } = {}) {
    this.runtimeUrl = runtimeUrl;
    this.window = null; this.server = null; this.messages = []; this.blocked = [];
    // Reuse one non-persistent partition. A long agent job may rebuild its
    // preview hundreds of times; one Chromium session per run would accumulate.
    this.session = session.fromPartition('anvil-background-preview-' + randomUUID());
    this.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    this.session.setPermissionCheckHandler(() => false);
    this.session.on('will-download', event => event.preventDefault());
  }
  close() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy(); this.window = null;
    this.server?.closeAllConnections(); this.server?.close(); this.server = null;
  }
  async run(entry, files, signal, vision = false, inputMap) {
    this.vision=vision;
    this.close(); this.messages = []; this.blocked = [];
    await this.session.clearStorageData(); signal.throwIfAborted();
    const { withEngine, normalizeInputMap } = await import(this.runtimeUrl);
    const map = normalizeInputMap(inputMap);
    this.inputMap = map;
    signal.throwIfAborted();
    const token = randomUUID();
    const server = createServer((req, res) => {
      let rel;
      try { rel = decodeURIComponent(new URL(req.url, 'http://preview.invalid').pathname).slice(token.length + 2); } catch { res.writeHead(400).end(); return; }
      if (req.method !== 'GET' || !req.url.startsWith('/' + token + '/') || !safeAgentPath(rel) || !Object.hasOwn(files, rel)) { res.writeHead(404).end(); return; }
      const raw = files[rel];
      const data = /^data:([^;,]+);base64,([\s\S]+)$/.exec(raw);
      res.writeHead(200, { 'Content-Type': data?.[1] || `${MIME[rel.split('.').pop()] || 'text/plain'};charset=utf-8`, 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'" });
      // Keep project URLs and ES-module resolution intact. The shared Canvas
      // bootstrap runs in the page world before any project script executes.
      const body = data ? Buffer.from(data[2], 'base64') : raw;
      res.end(/\.html?$/i.test(rel) ? withEngine(String(body), map) : body);
    });
    this.server = server;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    if (signal.aborted || this.server !== server) { server.close(); signal.throwIfAborted(); throw new Error('Vorschau beendet.'); }
    const origin = `http://127.0.0.1:${server.address().port}/${token}/`;
    const ses = this.session;
    ses.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith(origin) || /^(data:|blob:)/.test(details.url);
      if (!allowed) this.blocked = [...this.blocked, 'Externe Ressource blockiert'].slice(-20);
      callback({ cancel: !allowed });
    });
    const win = new BrowserWindow({ width: 1100, height: 760, title: 'Anvil · Hintergrund-Vorschau', show: true,
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    this.window = win;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(origin)) event.preventDefault(); });
    win.webContents.on('console-message', (details) => { if (details.level === 'error') this.messages = [...this.messages, String(details.message).slice(0,2000)].slice(-30); });
    win.webContents.on('render-process-gone', () => { this.messages.push('Vorschauprozess wurde beendet.'); });
    const abort = () => { if (this.window === win) this.close(); };
    signal.addEventListener('abort', abort, { once: true });
    win.once('closed', () => { signal.removeEventListener('abort', abort); if (this.window === win) { this.window = null; this.server?.closeAllConnections(); this.server?.close(); this.server = null; } });
    let loadTimer;
    try { await Promise.race([win.loadURL(origin + entry.split('/').map(encodeURIComponent).join('/')), new Promise((_, reject) => {
      loadTimer = setTimeout(() => reject(new Error('HTML-Vorschau antwortet beim Laden nicht.')), 15000);
    })]); } finally { clearTimeout(loadTimer); }
    signal.throwIfAborted();
    return await this.see(vision);
  }
  async see(vision = this.vision) {
    if (!this.window || this.window.isDestroyed()) return { ok: false, error: 'Keine HTML-Vorschau geöffnet.' };
    let timer, state;
    try { state = await Promise.race([this.window.webContents.executeJavaScript(inspect), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Vorschau antwortet nicht.')), 5000); timer.unref(); })]); }
    finally { clearTimeout(timer); }
    let image;
    if(vision){
      let captureTimer;
      try{
        const frame=await Promise.race([this.window.webContents.capturePage(),new Promise((_,reject)=>{captureTimer=setTimeout(()=>reject(new Error('Bildaufnahme der Vorschau antwortet nicht.')),5000);})]);
        if(!frame.isEmpty()){const size=frame.getSize();const resized=size.width>1280?frame.resize({width:1280}):frame;image='data:image/jpeg;base64,'+resized.toJPEG(75).toString('base64');}
      }finally{clearTimeout(captureTimer);}
    }
    const errors = [...this.messages, ...this.blocked, ...(state.canvas?.error ? [String(state.canvas.error).slice(0,2000)] : [])];
    return { ok: errors.length === 0, stdout: state.text, stderr: errors.join('\n'), state, image,
      stage: { kind: 'html' }, note: `HTML geladen; DOM und Konsolenfehler geprüft.${image?' Aufnahme der Vorschau beigefügt.':' Keine Bildaufnahme an das Modell gesendet.'} Funktion nur durch gezielte Interaktion bestätigen. Externe Ressourcen sind gesperrt.` };
  }
  async play(keys, hold = 100, signal) {
    if (!this.window || this.window.isDestroyed()) throw new Error('Keine HTML-Vorschau geöffnet.');
    const wc = this.window.webContents;
    this.window.focus(); wc.focus();
    const aliases = { up:'Up', down:'Down', left:'Left', right:'Right', arrowup:'Up', arrowdown:'Down', arrowleft:'Left', arrowright:'Right', ok:'Enter', enter:'Enter', space:'Space', ' ':'Space', tab:'Tab', esc:'Escape' };
    for (const key of (Array.isArray(keys) ? keys : []).slice(0,32)) {
      signal.throwIfAborted();
      const action = String(key).toLowerCase();
      const bound = this.inputMap?.[action]?.keys?.[0] ?? String(key);
      const keyCode = aliases[bound.toLowerCase()] || bound;
      if (!/^(?:[a-zA-Z0-9]|Up|Down|Left|Right|Enter|Space|Tab|Escape)$/.test(keyCode)) throw new Error('Diese Taste wird in der Hintergrund-Vorschau nicht unterstützt.');
      wc.sendInputEvent({ type:'keyDown', keyCode });
      if (keyCode === 'Enter' || keyCode === 'Space' || /^[a-zA-Z0-9]$/.test(keyCode)) wc.sendInputEvent({ type:'char', keyCode: keyCode === 'Enter' ? '\r' : keyCode === 'Space' ? ' ' : keyCode });
      try { await new Promise(resolve => setTimeout(resolve, Math.min(500, Math.max(0, Number(hold)||100)))); }
      finally { if (!wc.isDestroyed()) wc.sendInputEvent({ type:'keyUp', keyCode }); }
    }
    signal.throwIfAborted(); return await this.see();
  }
}
