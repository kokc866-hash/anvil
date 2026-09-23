import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { toolEnv, resolveBin } from '../companion/toolchain.mjs';
import { createRunFolder, runEnvironment } from '../companion/run-storage.mjs';
import { nodeCommand, withNodeEnv } from './node-cmd.mjs';
import { safePath } from './agent-file-actions.mjs';
import { fileBytes } from '../scripts/file-content.mjs';
import { PYTHON_TRACER } from './agent-debugger-python.mjs';
import { compileLang } from '../companion/compile-run.mjs';
import { evaluateRecordedLocals } from './agent-debugger-values.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const valueText = v => String(v?.unserializableValue ?? (Object.hasOwn(v || {}, 'value') ? JSON.stringify(v.value) : v?.description ?? v?.type ?? '')).slice(0, 1000);
const cleanBps = raw => Object.fromEntries(Object.entries(raw || {}).filter(([p]) => safePath(p)).map(([p, lines]) => [p, [...new Set((Array.isArray(lines) ? lines : []).filter(n => Number.isInteger(n) && n > 0))].slice(0, 100)]));

/** One debugger per background job; all execution uses an acknowledged private snapshot.
 * This is process isolation, not an OS sandbox. Evaluating an expression can execute code.
 */
export class AgentDebugger {
  constructor({ timeoutMs = 300000, commandTimeoutMs = 10000, onState, loadTrace = () => import('../agent-build/debug-trace.mjs'), runTrace = compileLang } = {}) {
    this.timeoutMs = timeoutMs; this.commandTimeoutMs = commandTimeoutMs;
    this.state = { active: false, paused: false, stack: [], locals: {}, stdout: '', stderr: '', breakpoints: {}, watches: [] };
    this.pending = new Map(); this.seq = 0; this.watchExprs = []; this.bpsIds = []; this.onState = onState; this.scripts = new Map();
    this.loadTrace = loadTrace; this.runTrace = runTrace;
  }
  begin(request = {}, id) {
    if (this.state.active || this.closing) throw Error('Vor einem neuen Auftrag den bisherigen Debugger schließen.');
    this.generation = (this.generation || 0) + 1;
    this.jobId = id; this.project = request.project || '';
    this.state = { active: false, paused: false, stack: [], locals: {}, stdout: '', stderr: '', breakpoints: cleanBps(request.debug?.breakpoints ?? request.breakpoints), watches: [] };
    this.watchExprs = (request.debug?.watches ?? request.watches ?? []).map(x => typeof x === 'string' ? x : x?.expr).filter(x => typeof x === 'string' && x.trim()).slice(0, 32);
  }
  snapshot() { return structuredClone({ ...this.state, ok: !this.state.error && (this.state.active || this.state.code == null || this.state.code === 0), watches: [...this.watchExprs], watchValues: Object.fromEntries((this.state.watches || []).map(w => [w.expr, w.value])) }); }
  publish() { try { this.onState?.(this.snapshot()); } catch { /* Observer must not interrupt debugger ownership. */ } }
  async failPause(error, generation) {
    if (this.generation !== generation || !this.state.active) return;
    this.state.error = error.message; this.publish(); await this.close();
  }
  async waitFor(predicate, signal) {
    const until = Date.now() + this.commandTimeoutMs;
    while (!predicate()) {
      signal?.throwIfAborted();
      if (this.state.error) throw Error(this.state.error);
      if (Date.now() >= until) throw Error('Debugger antwortet nicht innerhalb des Zeitlimits.');
      await delay(20);
    }
  }
  async waitExecution(signal) {
    const until = Date.now() + Math.min(1200, this.commandTimeoutMs);
    while (this.state.active && !this.state.paused && Date.now() < until) {
      signal?.throwIfAborted(); if (this.state.error) throw Error(this.state.error); await delay(20);
    }
  }
  async execute(op, { files = {}, signal } = {}) {
    signal?.throwIfAborted();
    const action = String(op.action || '').replace(/^debug_/, ''), args = op.args || {};
    try {
      if (action === 'start') await this.start(args, files, signal);
      else if (action === 'stop') await this.close();
      else if (action === 'breakpoint') {
        if (!safePath(args.path) || !Number.isInteger(args.line) || args.line < 1) throw Error('Ungültiger Haltepunkt.');
        if (this.state.active && !this.state.paused && this.language === 'python') throw Error('Python zuerst anhalten; Haltepunkte werden nur am Halt geändert.');
        const lines = new Set(this.state.breakpoints[args.path] || []);
        const on = args.on ?? !lines.has(args.line); if (on) lines.add(args.line); else lines.delete(args.line);
        this.state.breakpoints[args.path] = [...lines];
        if (this.state.active) await this.setBreakpoints(signal);
      } else if (action === 'watch') {
        if (typeof args.expr !== 'string' || !args.expr.trim() || args.expr.length > 2000) throw Error('Ausdruck fehlt oder ist zu lang.');
        if (args.remove === true) this.watchExprs = this.watchExprs.filter(expr => expr !== args.expr);
        else if (!this.watchExprs.includes(args.expr)) this.watchExprs = [...this.watchExprs, args.expr].slice(-32);
        if (this.state.paused) await this.refreshWatches(signal);
      } else if (action === 'eval') {
        if (!this.state.paused) throw Error('Auswertung benötigt einen angehaltenen Debugger.');
        if (typeof args.expr !== 'string' || !args.expr.trim() || args.expr.length > 2000) throw Error('Ausdruck fehlt oder ist zu lang.');
        this.state.eval = await this.evaluate(args.expr, signal);
      } else if (action === 'continue' || action === 'step') {
        if (!this.state.active || !this.state.paused) throw Error('Debugger ist nicht angehalten.');
        if (this.language === 'trace') { await this.advanceTrace(action); this.publish(); return this.snapshot(); }
        this.state.paused = false; this.state.reason = 'running'; this.state.locals = {}; this.state.stack = [];
        if (this.language === 'python') this.child.stdin.write(JSON.stringify({ cmd: action, bps: this.state.breakpoints }) + '\n');
        else await this.command(action === 'step' ? 'Debugger.stepOver' : 'Debugger.resume');
        await this.waitExecution(signal);
        if (this.state.paused) await this.refreshWatches(signal);
      } else if (action !== 'state') throw Error('Unbekannte Debuggeraktion.');
      if (this.pauseWork) await this.pauseWork;
      this.publish(); return this.snapshot();
    } catch (error) {
      // A stuck debugger operation must not leave an invisible interpreter behind.
      if (action === 'start' || signal?.aborted || /Zeitlimit|closed|geschlossen/i.test(error.message)) await this.close();
      return { ...this.snapshot(), ok: false, error: error.message };
    }
  }
  async start(args, files, signal) {
    await this.close();
    let entry = args.path;
    if (!safePath(entry) || !Object.hasOwn(files, entry)) throw Error('Startdatei fehlt im Dateistand.');
    if (!/\.(py|[cm]?js|[cm]?tsx?|go|rs|java|c|cpp|cc|cxx|cs|php|rb)$/i.test(entry)) throw Error('Dateityp wird vom Debugger nicht unterstützt.');
    if (Object.keys(files).length > 4000) throw Error('Zu viele Dateien im Debugger-Dateistand.');
    let bytes = 0;
    for (const [p, content] of Object.entries(files)) { if (!safePath(p)) throw Error('Ungültiger Snapshot-Pfad.'); bytes += fileBytes(content).length; }
    if (bytes > 64 * 1024 * 1024) throw Error('Debugger-Dateistand ist größer als 64 MB.');
    if (/\.(go|rs|java|c|cpp|cc|cxx|cs|php|rb)$/i.test(entry)) return this.startTrace(args, files, signal);
    this.sourceMaps = {};
    if (/\.[cm]?tsx?$/i.test(entry)) {
      const helper = await this.loadTrace();
      const prepared = helper.prepareTypeScriptDebug(files, entry);
      files = prepared.files; entry = prepared.entry; this.sourceMaps = prepared.maps;
    }
    const folders = createRunFolder('background-debug', this.project);
    this.work = folders.work;
    for (const [p, content] of Object.entries(files)) { const full = join(this.work, p); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, fileBytes(content)); }
    this.state = { active: true, paused: false, path: args.path, reason: 'starting', stack: [], locals: {}, stdout: '', stderr: '', breakpoints: this.state.breakpoints, watches: [], stage: { kind: 'debug', id: folders.id, out: folders.work } };
    const env = runEnvironment(folders, toolEnv()); delete env.NODE_OPTIONS; delete env.NODE_PATH; delete env.PYTHONPATH; delete env.PYTHONSTARTUP;
    let bin, argv;
    this.language = /\.py$/i.test(entry) ? 'python' : 'javascript'; this.pauseWork = null; this.url = ''; this.buf = ''; this.frames = []; this.scripts.clear();
    if (this.language === 'python') {
      bin = resolveBin('python'); if (!bin) throw Error('Python ist nicht eingerichtet.');
      const tracer = join(folders.out, 'anvil_debug.py'); writeFileSync(tracer, PYTHON_TRACER);
      argv = ['-u', tracer]; Object.assign(env, { ANVIL_DBG_ROOT: this.work, ANVIL_DBG_FILE: entry, ANVIL_DBG_MODE: args.pause_on_entry === false ? 'run' : 'step', ANVIL_BPS: JSON.stringify(this.state.breakpoints) });
    } else {
      const node = nodeCommand({ isPackaged: Boolean(process.versions.electron), execPath: process.execPath }); bin = node.file; Object.assign(env, withNodeEnv(env, node.electronAsNode));
      argv = ['--inspect-brk=127.0.0.1:0', ...(/\.[cm]?ts$/i.test(entry) ? ['--experimental-strip-types'] : []), join(this.work, entry)];
    }
    const generation = this.generation = (this.generation || 0) + 1;
    const child = spawn(bin, argv, { cwd: this.work, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child; this.state.pid = child.pid;
    this.closed = new Promise(resolve => child.once('close', (code, sig) => { signal?.removeEventListener('abort', cancel); if (this.generation === generation) { clearTimeout(this.timer); this.state.active = false; this.state.paused = false; this.state.code = code; this.state.signal = sig; this.state.reason = this.state.error ? 'error' : 'ended'; this.socket?.close(); this.publish(); } resolve(); }));
    child.stdin.on('error', () => {});
    child.once('error', error => { if (this.generation === generation) { this.state.error = error.message; this.state.active = false; } });
    child.stdout.on('data', data => { if (this.generation !== generation) return; this.language === 'python' ? this.feedPython(data.toString()) : this.state.stdout = (this.state.stdout + data).slice(-120000); });
    child.stderr.on('data', data => { if (this.generation !== generation) return; const s = data.toString(); this.state.stderr = (this.state.stderr + s).slice(-80000); this.url ||= /ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/.exec(s)?.[0] || ''; if (/Waiting for the debugger to disconnect/.test(s)) this.socket?.close(); });
    const cancel = () => { if (this.generation !== generation) return; this.state.error = 'Debugger abgebrochen.'; void this.close(); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    this.timer = setTimeout(() => { this.state.error = 'Zeitlimit des Debuggers erreicht.'; void this.close(); }, this.timeoutMs); this.timer.unref?.();
    if (this.language === 'javascript') {
      await this.waitFor(() => !!this.url || !this.state.active, signal);
      if (!this.url) throw Error(this.state.stderr || 'Debugger konnte nicht starten.');
      const socket = this.socket = new WebSocket(this.url);
      socket.addEventListener('message', ev => { if (this.socket === socket) this.receive(JSON.parse(ev.data)); });
      socket.addEventListener('error', () => { if (this.socket === socket) this.state.error = 'Debugger-Verbindung fehlgeschlagen.'; });
      socket.addEventListener('close', () => { if (this.socket !== socket) return; for (const pending of this.pending.values()) pending.reject(Error('Debugger-Verbindung geschlossen.')); this.pending.clear(); });
      await this.waitFor(() => this.socket.readyState === WebSocket.OPEN, signal);
      await this.command('Runtime.enable'); await this.command('Debugger.enable'); await this.command('Debugger.setPauseOnExceptions', { state: 'uncaught' }); await this.setBreakpoints(signal);
      await this.command('Runtime.runIfWaitingForDebugger');
      await this.waitFor(() => this.state.paused || !this.state.active, signal);
      if (args.pause_on_entry === false && this.state.paused && !this.state.breakpoints[this.state.path]?.includes(this.state.line)) { this.state.paused = false; await this.command('Debugger.resume'); }
    }
    await this.waitExecution(signal);
    if (this.pauseWork) await this.pauseWork;
    if (this.state.paused) await this.refreshWatches(signal);
    if (!this.state.active && this.state.code !== 0) throw Error(this.state.stderr || 'Debugger-Programm fehlgeschlagen.');
  }
  command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq, timer = setTimeout(() => { this.pending.delete(id); reject(Error('Debugger-Befehl überschreitet das Zeitlimit.')); }, this.commandTimeoutMs);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: err => { clearTimeout(timer); reject(err); } });
      try { this.socket.send(JSON.stringify({ id, method, params })); } catch (e) { this.pending.get(id).reject(e); this.pending.delete(id); }
    });
  }
  receive(message) {
    if (message.id) { const pending = this.pending.get(message.id); if (pending) { this.pending.delete(message.id); message.error ? pending.reject(Error(message.error.message)) : pending.resolve(message.result); } return; }
    if (message.method === 'Debugger.scriptParsed') this.scripts.set(message.params.scriptId, message.params.url);
    if (message.method === 'Debugger.paused') {
      this.frames = message.params.callFrames || [];
      const generation = this.generation;
      this.pauseWork = this.capturePause(message.params, generation).catch(error => this.failPause(error, generation));
    }
  }
  localPath(url) {
    try { const p = url.startsWith('file:') ? fileURLToPath(url) : url; const rel = relative(this.work, p).replace(/\\/g, '/'); return safePath(rel) && !isAbsolute(rel) ? rel : ''; } catch { return ''; }
  }
  originalPosition(generated, line) {
    const map = this.sourceMaps?.[generated];
    if (!map) return {path:generated,line};
    let index=line-1; while(index>=0 && (map.lines[index]??-1)<0)index--;
    return {path:map.originalPath,line:index>=0?map.lines[index]+1:1};
  }
  async capturePause(params, generation) {
    const stack = this.frames.map(f => ({ ...this.originalPosition(this.localPath(f.url || this.scripts.get(f.location.scriptId) || ''), f.location.lineNumber + 1), fn: f.functionName || '<module>' })).filter(f => f.path);
    // V8 can omit call-frame URLs; scriptParsed metadata recovers the source path.
    const top = this.frames[0];
    if (!stack.length && top) stack.push({ path: this.state.path, line: top.location.lineNumber + 1, fn: top.functionName || '<module>' });
    const locals = {};
    for (const scope of (top?.scopeChain || []).filter(x => ['local', 'block', 'closure', 'script', 'module'].includes(x.type)).slice(0, 5)) {
      const properties = await this.command('Runtime.getProperties', { objectId: scope.object.objectId, ownProperties: true });
      for (const prop of properties.result || []) if (prop.value && !prop.name.startsWith('__') && Object.keys(locals).length < 32) locals[prop.name] = valueText(prop.value);
    }
    if (this.generation !== generation || !this.state.active) return;
    Object.assign(this.state, { paused: true, path: stack[0]?.path || this.state.path, line: stack[0]?.line || top?.location.lineNumber + 1, reason: params.hitBreakpoints?.length ? 'breakpoint' : params.reason, stack, locals });
    await this.refreshWatches();
    if (this.generation !== generation || !this.state.active) return;
    this.publish();
  }
  async setBreakpoints(signal) {
    if (this.language === 'trace') return;
    if (this.language === 'python') { await this.pythonCommand('breakpoints', {}, signal); return; }
    for (const breakpointId of this.bpsIds) await this.command('Debugger.removeBreakpoint', { breakpointId });
    this.bpsIds = [];
    for (const [p, lines] of Object.entries(this.state.breakpoints)) for (const line of lines) {
      const generated=Object.entries(this.sourceMaps||{}).find(([,map])=>map.originalPath===p);
      const mapped=generated?generated[1].lines.findIndex(n=>n===line-1):-1;
      const result = await this.command('Debugger.setBreakpointByUrl', { lineNumber: mapped>=0?mapped:line-1, url: pathToFileURL(join(this.work, generated?.[0]||p)).href }); this.bpsIds.push(result.breakpointId);
    }
  }
  feedPython(chunk) {
    this.buf = (this.buf + chunk).slice(-240000); const lines = this.buf.split('\n'); this.buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('\x1e')) { this.state.stdout = (this.state.stdout + line + '\n').slice(-120000); continue; }
      let ev; try { ev = JSON.parse(line.slice(1)); } catch { continue; }
      if (ev.t === 'pause') {
        Object.assign(this.state, { paused: true, path: ev.path, line: ev.line, reason: ev.reason, stack: ev.stack, locals: ev.locals });
        const generation = this.generation;
        this.pauseWork = this.refreshWatches().then(() => { if (this.generation === generation && this.state.active) this.publish(); }).catch(error => this.failPause(error, generation));
      }
      else if (ev.t === 'out' || ev.t === 'err') { const key = ev.t === 'out' ? 'stdout' : 'stderr'; this.state[key] = (this.state[key] + ev.s).slice(-120000); }
      else if (ev.t === 'done') Object.assign(this.state, { active: false, paused: false, code: ev.code, reason: 'ended' });
      else if (ev.id) { const pending = this.pending.get(ev.id); if (pending) { this.pending.delete(ev.id); pending.resolve(ev.s || ''); } }
    }
  }
  pythonCommand(cmd, args, signal) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = ++this.seq, timer = setTimeout(() => { this.pending.delete(id); reject(Error('Debugger-Befehl überschreitet das Zeitlimit.')); }, this.commandTimeoutMs);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.child.stdin.write(JSON.stringify({ id, cmd, ...args, bps: this.state.breakpoints }) + '\n');
    });
  }
  async evaluate(expr, signal) {
    if (this.language === 'trace') return evaluateRecordedLocals(expr, this.state.locals);
    if (this.language === 'python') return this.pythonCommand('eval', { expr }, signal);
    const out = await this.command('Debugger.evaluateOnCallFrame', { callFrameId: this.frames[0].callFrameId, expression: expr, returnByValue: true, silent: true });
    if (out.exceptionDetails) return out.exceptionDetails.exception?.description || out.exceptionDetails.text;
    return valueText(out.result);
  }
  async refreshWatches(signal) {
    const generation = this.generation, watches = [];
    for (const expr of this.watchExprs) watches.push({ expr, value: await this.evaluate(expr, signal) });
    if (this.generation === generation && this.state.paused) this.state.watches = watches;
  }
  async startTrace(args, files, signal) {
    const helper = await this.loadTrace();
    const generation = this.generation = (this.generation || 0) + 1;
    this.language = 'trace'; this.pauseWork = null;
    this.state = { active: true, paused: false, path: args.path, reason: 'recording', mode: 'replay', runCompleted: false, stack: [], locals: {}, stdout: '', stderr: '', breakpoints: this.state.breakpoints, watches: [], note: 'Trace-Aufzeichnung: Das Programm wird einmal vollständig ausgeführt. Danach zeigen Schritte und Haltepunkte nur aufgezeichnete Zustände; keine angehaltene Live-Ausführung.' };
    this.traceAbort = new AbortController();
    const traceDeadline = setTimeout(() => this.traceAbort?.abort(Error('Zeitlimit der Trace-Aufzeichnung erreicht.')), this.timeoutMs);
    traceDeadline.unref?.();
    const abort = () => this.traceAbort?.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    this.publish();
    try {
      const prepared = helper.prepareDebugTrace(args.path, files, true);
      this.traceRun = this.runTrace({ ...prepared, headless: true, timeoutMs: this.timeoutMs, compileTimeoutMs: this.timeoutMs }, { signal: this.traceAbort.signal });
      const result = await this.traceRun;
      signal?.throwIfAborted(); this.traceAbort.signal.throwIfAborted();
      if (this.generation !== generation) return;
      const parsed = helper.parseTrace(result.stdout || '', result.stderr || '');
      const events = parsed.events.filter(ev => safePath(ev.path) && Number.isInteger(ev.line) && ev.line > 0).slice(0, 10000).map(ev => ({ ...ev, fn: String(ev.fn || '<module>').slice(0, 300), locals: Object.fromEntries(Object.entries(ev.locals || {}).slice(0, 32).map(([key, value]) => [key.slice(0, 200), String(value).slice(0, 1000)])) }));
      Object.assign(this.state, { stdout: parsed.stdout.slice(-120000), stderr: parsed.stderr.slice(-80000), code: result.code, runCompleted: true, stage: result.stage, traceCount: events.length, traceTruncated: parsed.events.length > events.length });
      if (!result.ok) this.state.error = parsed.stderr || result.error || `Trace-Ausführung fehlgeschlagen (Exitcode ${result.code ?? '?'}).`;
      this.replay = { events, index: -1 };
      if (!events.length) {
        this.state.active = false; this.state.reason = 'ended';
        if (!this.state.error) this.state.error = 'Keine ausführbaren Zeilen aufgezeichnet. Mehrzeilige Funktionen für die Trace-Ansicht verwenden.';
        this.publish(); return;
      }
      await this.advanceTrace(args.pause_on_entry === false ? 'continue' : 'step'); this.publish();
    } finally { clearTimeout(traceDeadline); signal?.removeEventListener('abort', abort); this.traceRun = null; this.traceAbort = null; }
  }
  async advanceTrace(action) {
    if (!this.replay) throw Error('Keine Trace-Aufzeichnung vorhanden.');
    const replay = this.replay; replay.index++;
    if (action === 'continue') while (replay.index < replay.events.length) { const event = replay.events[replay.index]; if (this.state.breakpoints[event.path]?.includes(event.line)) break; replay.index++; }
    const event = replay.events[replay.index];
    if (!event) { this.state.active = false; this.state.paused = false; this.state.reason = 'trace-ended'; return; }
    Object.assign(this.state, { active: true, paused: true, path: event.path, line: event.line, reason: 'trace', locals: event.locals, stack: [{ path: event.path, line: event.line, fn: event.fn }] });
    await this.refreshWatches();
  }
  async close() {
    if (this.closing) return this.closing;
    const closing = this.closeOwned(); this.closing = closing;
    try { await closing; } finally { if (this.closing === closing) this.closing = null; }
  }
  async closeOwned() {
    clearTimeout(this.timer);
    this.state.active = false; this.state.paused = false;
    this.traceAbort?.abort();
    if (this.traceRun) await Promise.resolve(this.traceRun).catch(() => {});
    this.replay = null;
    const child = this.child; this.child = null;
    this.socket?.close(); this.socket = null;
    for (const pending of this.pending.values()) pending.reject(Error('Debugger geschlossen.')); this.pending.clear();
    if (child?.pid && child.exitCode === null) {
      if (process.platform === 'win32') await new Promise(resolve => { const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.once('close', resolve); killer.once('error', () => { child.kill(); resolve(); }); });
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      await Promise.race([this.closed, delay(2000)]);
    }
    this.state.active = false; this.state.paused = false;
    this.publish();
  }
}
