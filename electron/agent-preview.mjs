import { BrowserWindow, session } from 'electron';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { safeAgentPath } from './agent-project-runtime.mjs';
import { ToolRejection } from './tool-rejection.mjs';

const MIME = { html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', txt: 'text/plain' };
const inspect = `(() => ({...window.__ANVIL_PREVIEW__.input.describe(),capture:window.__ANVIL_PREVIEW__.state(),canvas:typeof window.Anvil?.status==='function'?window.Anvil.status():null}))()`;
const prepareCapture = `(() => { if(typeof window.__ANVIL_PREVIEW__?.ready !== 'function') throw new Error('Die Vorschau-Laufzeit meldet keine Aufnahmebereitschaft.'); return window.__ANVIL_PREVIEW__.ready(); })()`;

/** Untrusted project content never receives the editor preload or session. */
export class AgentPreview {
  constructor({ runtimeUrl = new URL('../agent-build/preview-runtime.mjs', import.meta.url), show = true } = {}) {
    this.runtimeUrl = runtimeUrl;
    this.show = show; this.generation = 0;
    this.window = null; this.server = null; this.entry = null; this.messages = []; this.blocked = [];
    // Reuse one non-persistent partition. A long agent job may rebuild its
    // preview hundreds of times; one Chromium session per run would accumulate.
    this.session = session.fromPartition('anvil-background-preview-' + randomUUID());
    this.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    this.session.setPermissionCheckHandler(() => false);
    this.session.on('will-download', event => event.preventDefault());
  }
  close() {
    this.generation++;
    this.entry = null;
    if (this.window && !this.window.isDestroyed()) this.window.destroy(); this.window = null;
    this.server?.closeAllConnections(); this.server?.close(); this.server = null;
  }
  async run(entry, files, signal, vision = false, inputMap) {
    this.vision=vision;
    this.close(); this.messages = []; this.blocked = [];
    const generation = this.generation;
    this.signal = signal;
    const current = () => { signal.throwIfAborted(); if (this.generation !== generation) throw new Error('Vorschau wurde beim Vorbereiten ersetzt.'); };
    await this.session.clearStorageData(); current();
    const { withEngine, normalizeInputMap } = await import(this.runtimeUrl);
    const map = normalizeInputMap(inputMap);
    this.inputMap = map;
    current();
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
    if (signal.aborted || this.server !== server || this.generation !== generation) { server.close(); signal.throwIfAborted(); throw new Error('Vorschau beendet.'); }
    const origin = `http://127.0.0.1:${server.address().port}/${token}/`;
    const ses = this.session;
    ses.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith(origin) || /^(data:|blob:)/.test(details.url);
      if (!allowed) this.blocked = [...this.blocked, 'Externe Ressource blockiert'].slice(-20);
      callback({ cancel: !allowed });
    });
    const win = new BrowserWindow({ width: 1100, height: 760, title: 'Anvil · Hintergrund-Vorschau', show: this.show,
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    this.window = win;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(origin)) event.preventDefault(); });
    win.webContents.on('console-message', (details) => { if (details.level === 'error') this.messages = [...this.messages, String(details.message).slice(0,2000)].slice(-30); });
    win.webContents.on('render-process-gone', () => { this.messages.push('Vorschauprozess wurde beendet.'); });
    const abort = () => { if (this.window === win) this.close(); };
    signal.addEventListener('abort', abort, { once: true });
    win.once('closed', () => { signal.removeEventListener('abort', abort); if (this.window === win) { this.window = null; this.server?.closeAllConnections(); this.server?.close(); this.server = null; } });
    const url = origin + entry.split('/').map(encodeURIComponent).join('/');
    this.entry = { path: entry, url };
    let loadTimer;
    try { await Promise.race([win.loadURL(url), new Promise((_, reject) => {
      loadTimer = setTimeout(() => reject(new Error('HTML-Vorschau antwortet beim Laden nicht.')), 15000);
    })]); } finally { clearTimeout(loadTimer); }
    current();
    return await this.see(vision, signal);
  }
  async see(vision = this.vision, signal = this.signal) {
    if (!this.window || this.window.isDestroyed()) return { ok: false, error: 'Keine HTML-Vorschau geöffnet.' };
    const win = this.window, generation = this.generation;
    const current = () => { signal?.throwIfAborted(); if (this.window !== win || generation !== this.generation || win.isDestroyed()) throw new Error('Vorschau wurde während der Aufnahme ersetzt oder beendet.'); };
    const bounded = async (operation, ms, message) => {
      let timer, abort;
      try {
        current();
        const result = await Promise.race([operation(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), ms);
          abort = () => reject(signal.reason || new Error('Vorschauaufnahme abgebrochen.'));
          signal?.addEventListener('abort', abort, { once: true });
        })]);
        current(); return result;
      } finally { clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); }
    };
    let image, state, readiness;
    for (let attempt = 0; attempt < 3; attempt++) {
      const prepared = await bounded(() => win.webContents.executeJavaScript(prepareCapture), 8000, 'Vorschau wurde für die Aufnahme nicht bereit.');
      if (!prepared?.ok) {
        const error = prepared?.error || 'Vorschau nicht bereit.';
        return { ok: false, error, stderr: [...this.messages, ...this.blocked, error].join('\n') };
      }
      readiness = prepared.readiness;
      state = await bounded(() => win.webContents.executeJavaScript(inspect), 5000, 'Vorschau antwortet nicht.');
      if (vision) {
        win.webContents.invalidate();
        // The guest has painted; capturePage must consume a compositor frame too.
        let frame;
        try { frame = await bounded(() => win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }), 5000, 'Bildaufnahme der Vorschau antwortet nicht.'); }
        catch (error) { if (attempt < 2 && /UnknownVizError/.test(String(error))) continue; throw error; }
        if (frame.isEmpty()) { if (attempt < 2) continue; throw new Error('Die Vorschau hat noch kein aufnehmbares Bild geliefert.'); }
        const after = await bounded(() => win.webContents.executeJavaScript(inspect), 5000, 'Vorschau antwortet nicht.');
        if (readiness?.state !== 'live' && JSON.stringify(state.capture) !== JSON.stringify(after.capture)) {
          if (attempt < 2) continue;
          throw new Error('Vorschau wurde während der Aufnahme verändert. Aufnahme erneut anfordern.');
        }
        state = after;
        const size = frame.getSize(), resized = size.width > 1280 ? frame.resize({ width: 1280 }) : frame;
        image = 'data:image/jpeg;base64,' + resized.toJPEG(75).toString('base64');
      }
      break;
    }
    current();
    const errors = [...this.messages, ...this.blocked, ...(state.canvas?.error ? [String(state.canvas.error).slice(0,2000)] : [])];
    const previewPath = this.entry && win.webContents.getURL().split(/[?#]/, 1)[0] === this.entry.url ? this.entry.path : null;
    return { ok: errors.length === 0, stdout: state.text, stderr: errors.join('\n'), state, image, readiness, previewPath,
      stage: { kind: 'html' }, note: `HTML geladen; DOM und Konsolenfehler geprüft.${image?' Aufnahme der Vorschau beigefügt.':' Keine Bildaufnahme an das Modell gesendet.'}${readiness?.state === 'live' ? ' Laufende Darstellung: Die Aufnahme zeigt einen einzelnen Zeitpunkt.' : ''} Funktion nur durch gezielte Interaktion bestätigen. Externe Ressourcen sind gesperrt.` };
  }
  async play(keys, hold = 90, signal = this.signal, actions) {
    if (!this.window || this.window.isDestroyed()) throw new ToolRejection('Keine HTML-Vorschau geöffnet. Öffne zuerst die HTML-Datei mit run_file und verwende danach play.', { suggestedTools:['run_file','play'] });
    const win = this.window, wc = win.webContents, generation = this.generation;
    const current = () => { signal?.throwIfAborted(); if (this.window !== win || generation !== this.generation || win.isDestroyed()) throw new Error('Vorschau wurde während der Eingabe ersetzt oder beendet.'); };
    current();
    const {parsePlayInput,performPreviewInput,previewCheckNote} = await import(this.runtimeUrl);
    current(); let input;
    try { input = parsePlayInput({keys,hold_ms:hold,actions}); }
    catch(error) { throw new ToolRejection(String(error.message || error), { guidance:'Die Eingaben wurden nicht ausgeführt. Korrigiere die play-Argumente und fahre mit den übrigen Prüfschritten fort.', suggestedTools:['play'] }); }
    win.focus(); wc.focus();
    let mouseHeld = '';
    const guest = async (method, args) => {
      current();
      const result = await wc.executeJavaScript(`(() => {try{return {ok:true,value:window.__ANVIL_PREVIEW__.input.${method}(...${JSON.stringify(args)})};}catch(error){return {ok:false,error:String(error.message||error)};}})()`);
      current(); if(!result.ok)throw new Error(result.error); return result.value;
    };
    try {
    const progress = await performPreviewInput(input,this.inputMap,{
      current,
      assert: action => guest('assert',[action]),
      target: async (target,scroll = true) => {
        await guest('target',[target,scroll]);
        // scrollIntoView updates layout before Chromium's compositor hit-test
        // regions. Wait for paint, then resolve again; never wheel/click an old
        // region simply because executeJavaScript already returned new bounds.
        let timer;
        try {
          await Promise.race([wc.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'),
            new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Vorschauziel wurde für die Eingabe nicht bereit.')),2000);})]);
        } finally { clearTimeout(timer); }
        current(); return guest('target',[target,false]);
      },
      event: async (event, release) => {
        if (release) { if (wc.isDestroyed() || generation !== this.generation || this.window !== win) return; }
        else current();
        if (event.type === 'type') {
          await guest('text',[event.text,event.selector,true]);
          if (event.text) { await wc.insertText(event.text); current(); }
        } else if (event.type === 'keyDown' || event.type === 'keyUp') {
          const {key,keyCode,modifiers} = event.key;
          if (event.type === 'keyDown') await guest('keyboardTarget',[]);
          const nativeMods=modifiers.map(m=>m.toLowerCase());
          if (event.type === 'keyDown') for (const modifier of modifiers) wc.sendInputEvent({type:'keyDown',keyCode:modifier,modifiers:nativeMods});
          wc.sendInputEvent({type:event.type,keyCode,modifiers:nativeMods});
          if (event.type === 'keyDown' && !modifiers.some(m=>['Control','Alt','Meta'].includes(m)) && (key.length===1 || key==='Enter')) wc.sendInputEvent({type:'char',keyCode:key==='Enter'?'\r':key,modifiers:nativeMods});
          if (event.type === 'keyUp') for (const modifier of [...modifiers].reverse()) wc.sendInputEvent({type:'keyUp',keyCode:modifier});
        } else if (event.type === 'scroll') {
          wc.sendInputEvent({type:'mouseWheel',...event.point,deltaX:-event.delta_x,deltaY:-event.delta_y,hasPreciseScrollingDeltas:true,canScroll:true});
        } else {
          if(event.type==='mouseDown')mouseHeld=event.button;
          if(event.type==='mouseUp')mouseHeld='';
          wc.sendInputEvent({type:event.type,...event.point,button:event.button,clickCount:event.count,
            modifiers:mouseHeld?[mouseHeld+'ButtonDown']:[]});
        }
        if (!release) current();
      },
    },signal);
    current();
    const result = await this.see(this.vision,signal); current();
    return {...result,input:{mode:'native-preview',...progress},functionalChecks:result.ok===true && progress.assertions>0,note:result.note+' '+previewCheckNote(result.ok===true,progress.assertions)};
    } catch (error) {
      current();
      const result=await this.see(this.vision,signal); current();
      return {...result,ok:false,error:String(error.message||error),functionalChecks:false,
        ...(error.inputRejected ? { rejected:true, definitelyNotExecuted:true, suggestedTools:['play','see_run'] } : {}),
        ...(error.previewMissingTarget && result.ok ? { previewMissingTarget:error.previewMissingTarget } : {}),
        input:{mode:'native-preview',...(error.inputProgress||{completed:0,total:input.keys.length+input.actions.length,assertions:0})},
        note:'Eingabefolge beim ersten Fehler angehalten. Bereits ausgeführte Eingaben wurden nicht wiederholt.'};
    }
  }
}
