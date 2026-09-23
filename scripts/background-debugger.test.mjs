import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentDebugger } from '../electron/agent-debugger.mjs';
import { resolveBin } from '../companion/toolchain.mjs';
import { buildDebugHelper } from './fixtures/background-debug-helper.mjs';
const helper = await buildDebugHelper(), loadTrace = async () => helper;

const run = (d, action, args = {}, files = {}, signal) => d.execute({ kind: 'debug', action, args }, { files, signal });
const gone = pid => { try { process.kill(pid, 0); return false; } catch { return true; } };
for (const extension of ['js', 'ts', 'py']) test(`real ${extension} breakpoint, step, eval/watch and isolated snapshot`, { timeout: 30000, skip: extension === 'py' && !resolveBin('python') }, async () => {
  const events = [], d = new AgentDebugger({ loadTrace, onState: s => events.push(s) });
  const entry = `main.${extension}`, files = { [entry]: extension === 'py' ? 'x = 1\nx += 2\nprint(x)\n' : `let x${extension === 'ts' ? ': number' : ''} = 1;\nx += 2;\nconsole.log(x);\n` };
  d.begin({ debug: { breakpoints: { [entry]: [2] }, watches: ['x'] } }, 'qa');
  try {
    let r = await run(d, 'start', { path: entry }, files); assert.equal(r.ok, true, r.error); assert.equal(r.paused, true); assert.equal(r.line, 1);
    const pid = r.pid; if(extension==='ts')assert.match(readFileSync(join(r.stage.out,'main.js'),'utf8'),/let x = 1/);else assert.equal(readFileSync(join(r.stage.out, entry), 'utf8'), files[entry]);
    r = await run(d, 'continue'); assert.equal(r.ok, true, r.error); assert.equal(r.line, 2); assert.equal(r.locals.x, '1');
    r = await run(d, 'eval', { expr: 'x + 10' }); assert.equal(r.eval, '11');
    r = await run(d, 'watch', { expr: 'x * 2' }); assert.equal(r.watchValues['x * 2'], '2');
    r = await run(d, 'step'); assert.equal(r.line, 3); assert.equal(r.locals.x, '3'); assert.equal(r.watchValues['x * 2'], '6');
    r = await run(d, 'watch', { expr: 'x * 2', remove: true }); assert.equal(r.watches.includes('x * 2'), false);
    r = await run(d, 'breakpoint', { path: entry, line: 2, on: false }); assert.deepEqual(r.breakpoints[entry], []);
    r = await run(d, 'continue'); assert.equal(r.ok, true, r.error); assert.equal(r.active, false); assert.match(r.stdout, /3/);
    await d.close(); assert.equal(gone(pid), true); assert.ok(events.some(s => s.paused && s.line === 2)); assert.ok(events.some(s => !s.active));
  } finally { await d.close(); }
});

test('abort, deadline and explicit close kill the owned process', { timeout: 30000 }, async () => {
  for (const mode of ['abort', 'timeout', 'close']) {
    const d = new AgentDebugger({ timeoutMs: mode === 'timeout' ? 800 : 30000, commandTimeoutMs: 3000 });
    const abort = new AbortController(); d.begin({});
    try {
      const started = await run(d, 'start', { path: 'loop.js' }, { 'loop.js': 'let x = 1;\nsetInterval(() => x++, 100);' }, abort.signal);
      assert.equal(started.ok, true, started.error); const pid = started.pid;
      if (mode === 'abort') abort.abort(); else if (mode === 'close') await d.close();
      for (let i = 0; i < 100 && !gone(pid); i++) await new Promise(r => setTimeout(r, 30));
      assert.equal(gone(pid), true, `${mode} process still alive`); assert.equal(d.snapshot().active, false);
    } finally { await d.close(); }
  }
});

test('invalid paths and unsupported formats never start a process', async () => {
  const d = new AgentDebugger(); d.begin({});
  for (const [entry, files] of [['../escape.js', { '../escape.js': '' }], ['app.txt', { 'app.txt': '' }], ['app.js', { 'app.js': '', '../secret': '' }]]) {
    const r = await run(d, 'start', { path: entry }, files); assert.equal(r.ok, false); assert.equal(r.active, false);
  }
  assert.equal(existsSync('runs/escape.js'), false);
});

test('multi-file JavaScript breakpoints and Python imports retain source locations', { timeout: 30000 }, async () => {
  for (const python of [false, true]) {
    if (python && !resolveBin('python')) continue;
    const entry = python ? 'app/main.py' : 'app/main.mjs';
    const other = python ? 'app/helper.py' : 'app/helper.mjs';
    const files = python ? { [entry]: 'from helper import work\nwork()\n', [other]: 'def work():\n    x = 7\n    print(x)\n' } : { [entry]: 'import {work} from "./helper.mjs";\nwork();\n', [other]: 'export function work() {\n  let x = 7;\n  console.log(x);\n}\n' };
    const d = new AgentDebugger(); d.begin({ debug: { breakpoints: { [other]: [3] } } });
    try {
      const r = await run(d, 'start', { path: entry, pause_on_entry: false }, files);
      assert.equal(r.ok, true, r.error); assert.equal(r.path, other); assert.equal(r.line, 3); assert.equal(r.locals.x, '7'); assert.equal(r.stack[0].path, other);
    } finally { await d.close(); }
  }
});

test('closing a debug target terminates its owned child process too', { timeout: 15000 }, async () => {
  const d = new AgentDebugger(); d.begin({});
  try {
    const r = await run(d, 'start', { path: 'child.cjs', pause_on_entry: false }, { 'child.cjs': 'const {spawn} = require("node:child_process");\nconst child = spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{windowsHide:true,stdio:"ignore"});\nconsole.log("CHILD=" + child.pid);\ndebugger;\nsetInterval(()=>{},1000);\n' });
    assert.equal(r.ok, true, r.error); assert.equal(r.paused, true); const childPid = Number(/CHILD=(\d+)/.exec(r.stdout)?.[1]); assert.ok(childPid);
    assert.throws(() => d.begin({}), /bisherigen Debugger/);
    await d.close(); assert.equal(gone(r.pid), true); assert.equal(gone(childPid), true);
    d.begin({}); const again = await run(d, 'start', { path: 'next.js' }, { 'next.js': 'let fresh = 2;\nconsole.log(fresh);' }); assert.equal(again.ok, true, again.error); assert.equal(again.path, 'next.js');
  } finally { await d.close(); }
});

test('new job does not expose previous debug output, values, errors or locations', { timeout: 15000 }, async () => {
  const d = new AgentDebugger(); d.begin({});
  try {
    const r = await run(d, 'start', { path: 'private.js', pause_on_entry: false }, { 'private.js': 'const secret = "PRIVATE_VALUE";\nconsole.log(secret);\ndebugger;\n' }); assert.equal(r.paused, true);
    await run(d, 'eval', { expr: 'secret' }); await d.close(); d.begin({ debug: { watches: ['next'], breakpoints: { 'next.js': [1] } } });
    const fresh = await run(d, 'state'); assert.equal(fresh.ok, true); assert.equal(fresh.stdout, ''); assert.equal(fresh.stderr, ''); assert.deepEqual(fresh.locals, {}); assert.equal(fresh.path, undefined); assert.equal(fresh.eval, undefined); assert.equal(fresh.code, undefined); assert.deepEqual(fresh.watches, ['next']); assert.ok(!JSON.stringify(fresh).includes('PRIVATE_VALUE'));
    const entry = await run(d, 'start', { path: 'next.js', pause_on_entry: false }, { 'next.js': 'let next = 2;\nconsole.log(next);' }); assert.equal(entry.ok, true, entry.error); assert.equal(entry.paused, true); assert.equal(entry.line, 1);
  } finally { await d.close(); }
});

test('blocked expression evaluation reaches deadline and terminates debugger', { timeout: 10000 }, async () => {
  const d = new AgentDebugger({ commandTimeoutMs: 500 }); d.begin({});
  try {
    const start = await run(d, 'start', { path: 'app.js' }, { 'app.js': 'let x = 1;\nconsole.log(x);' }); assert.equal(start.ok, true, start.error);
    const r = await run(d, 'eval', { expr: '(()=>{while(true){}})()' }); assert.equal(r.ok, false); assert.match(r.error, /Zeitlimit/); assert.equal(gone(start.pid), true);
  } finally { await d.close(); }
});

test('late breakpoint refreshes watches and publishes after initial command returned running', { timeout: 15000 }, async () => {
  for (const python of [false, true]) {
    if (python && !resolveBin('python')) continue;
    const events = [], d = new AgentDebugger({ onState: state => events.push(state) });
    const entry = python ? 'late.py' : 'late.cjs';
    const files = { [entry]: python ? 'import time\ntime.sleep(1.8)\nx = 7\nprint(x)\n' : 'setTimeout(() => {\n const x = 7;\n console.log(x);\n}, 1800);\n' };
    d.begin({ debug: { breakpoints: { [entry]: [python ? 4 : 3] }, watches: ['x * 2'] } });
    try {
      const started = await run(d, 'start', { path: entry, pause_on_entry: false }, files); assert.equal(started.ok, true, started.error); assert.equal(started.active, true); assert.equal(started.paused, false);
      for (let i = 0; i < 100 && !events.some(s => s.paused && s.watchValues['x * 2'] === '14'); i++) await new Promise(r => setTimeout(r, 30));
      assert.ok(events.some(s => s.paused && s.watchValues['x * 2'] === '14'));
    } finally { await d.close(); }
  }
});

test('hanging watch at a late pause reports its deadline and closes the process', { timeout: 10000 }, async () => {
  const events = [], d = new AgentDebugger({ commandTimeoutMs: 500, onState: state => events.push(state) }); d.begin({ debug: { watches: ['typeof x === "undefined" ? 0 : (()=>{while(true){}})()'] } });
  try {
    const start = await run(d, 'start', { path: 'late.cjs', pause_on_entry: false }, { 'late.cjs': 'setTimeout(() => { const x = 2; debugger; }, 1800);' }); assert.equal(start.ok, true, start.error); assert.equal(start.active, true); assert.equal(start.paused, false);
    for (let i = 0; i < 150 && !gone(start.pid); i++) await new Promise(r => setTimeout(r, 30));
    assert.equal(gone(start.pid), true); assert.ok(events.some(s => /Zeitlimit/.test(s.error || '')));
  } finally { await d.close(); }
});
