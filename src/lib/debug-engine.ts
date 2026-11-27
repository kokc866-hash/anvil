import { langFromPath } from "./languages";
import { getPyodide, stripTs } from "./run-client";
import { startJsDebugIframe, type JsDebugSession } from "./debug-sandbox";
import { canDebug, collectRemoteTrace, stackOf, type TraceEvent } from "./debug-remote";
import { companionDebug } from "./companion";
import { holdCompanion, releaseCompanion } from "./companion-life";
import { emitPlugin } from "./plugins/events";
import { backgroundDebugCommand } from './background-debug';
import { useIde, type DebugFrame } from "@/store/ide";
import { captureAgentRun, type AgentRun } from "./agent-run";
import { AgentAbortError, isAbortLike } from "./agent-abort";

export type DebugCmd = "continue" | "step" | "stop" | "eval";
export function toggleDebugBreakpoint(path:string,line:number,on?:boolean){
  if(!backgroundDebugCommand('breakpoint',{path,line,...(on===undefined?{}:{on})}))useIde.getState().toggleBreakpoint(path,line,on);
}

type Waiter = {
  resolve: (cmd: DebugCmd) => void;
};

let waiter: Waiter | null = null;
let evalExpr = "";
let evalResultWait: ((s: string) => void) | null = null;
let mode: "run" | "step" | "stop" = "run";
let entryPause = false;
let started = false;
let lastPath = "";
type DebugOwner = { generation: number; run?: AgentRun; controller: AbortController; signal: AbortSignal; first?: (s: unknown) => void; js?: JsDebugSession };
let debugGeneration = 0;
let debugOwner: DebugOwner | undefined;
let kind: "live" | "replay" = "live";
let replay: { events: TraceEvent[]; i: number; finish?: () => void } | null = null;
let jsSession: JsDebugSession | null = null;

function debugCurrent(owner: DebugOwner): boolean {
  return debugOwner === owner && owner.generation === debugGeneration && !owner.signal.aborted && (!owner.run || owner.run.current()) && !useIde.getState().debug.backgroundJobId;
}
function assertDebug(owner: DebugOwner) {
  owner.run?.assertCurrent();
  if (!debugCurrent(owner)) throw new AgentAbortError("Debugsitzung beendet oder ersetzt");
}
async function waitDebug<T>(owner: DebugOwner, pending: Promise<T>): Promise<T> {
  assertDebug(owner);
  let abort = () => {};
  try {
    const result = await Promise.race([pending, new Promise<never>((_, reject) => {
      abort = () => reject(new AgentAbortError("Debug gestoppt"));
      owner.signal.addEventListener("abort", abort, { once: true });
    })]);
    assertDebug(owner);
    return result;
  } finally { owner.signal.removeEventListener("abort", abort); }
}
function stopOwnedDebug(owner: DebugOwner) {
  if (debugOwner !== owner) return;
  debugOwner = undefined;
  mode = "stop";
  replay?.finish?.(); replay = null;
  waiter?.resolve("stop"); waiter = null;
  evalResultWait?.("Debug gestoppt"); evalResultWait = null;
  started = false;
  owner.js?.kill();
  if (jsSession === owner.js) jsSession = null;
  owner.first?.({ ok: false, error: "Debug gestoppt" }); owner.first = undefined;
  owner.controller.abort("Debug gestoppt");
  if (!useIde.getState().debug.backgroundJobId) {
    useIde.getState().setDebug({ active: false, paused: false, path: null, line: 0, reason: "", stack: [], locals: {} });
    useIde.getState().setPluginStatus("");
    useIde.getState().setRunning(false);
  }
}

function bps(): Record<string, number[]> {
  return useIde.getState().breakpoints;
}

function needPause(path: string, line: number): boolean {
  if (mode === "stop") return true;
  if (mode === "step") return true;
  if (entryPause) {
    entryPause = false;
    return true;
  }
  return (bps()[path] ?? []).includes(line);
}

function applyPause(info: {
  path: string;
  line: number;
  reason: string;
  stack: DebugFrame[];
  locals: Record<string, string>;
}, owner = debugOwner) {
  if (owner) assertDebug(owner);
  lastPath = info.path;
  useIde.getState().setDebug({
    active: true,
    paused: true,
    path: info.path,
    line: info.line,
    reason: info.reason,
    stack: info.stack,
    locals: info.locals,
  });
  useIde.getState().openFile(info.path);
  useIde.getState().setPluginStatus(`⏸ ${info.path}:${info.line}`);
  owner?.first?.(debugSnapshot());
  if (owner) owner.first = undefined;
  emitPlugin("debug", debugSnapshot());
}

export function debugContinue() {
  if(backgroundDebugCommand('continue'))return;
  mode = "run";
  useIde.getState().setDebug({ paused: false, reason: "" });
  if (kind === "replay") {
    replayAdvance("continue");
    return;
  }
  waiter?.resolve("continue");
  waiter = null;
}

export function debugStep() {
  if(backgroundDebugCommand('step'))return;
  mode = "step";
  useIde.getState().setDebug({ paused: false, reason: "" });
  if (kind === "replay") {
    replayAdvance("step");
    return;
  }
  waiter?.resolve("step");
  waiter = null;
}

export function debugStop() {
  if(backgroundDebugCommand('stop'))return;
  if (debugOwner) { stopOwnedDebug(debugOwner); return; }
  mode = "stop";
  if (kind === "replay") {
    replay?.finish?.();
    replay = null;
  }
  waiter?.resolve("stop");
  waiter = null;
  started = false;
  jsSession?.kill();
  jsSession = null;
  useIde.getState().setDebug({
    active: false,
    paused: false,
    path: null,
    line: 0,
    reason: "",
    stack: [],
    locals: {},
  });
  useIde.getState().setPluginStatus("");
}

function replayAdvance(cmd: "continue" | "step") {
  if (!replay) return;
  if (cmd === "step") replay.i += 1;
  else {
    replay.i += 1;
    while (replay.i < replay.events.length) {
      const e = replay.events[replay.i];
      if ((bps()[e.path] ?? []).includes(e.line)) break;
      replay.i += 1;
    }
  }
  if (replay.i >= replay.events.length) {
    replay.finish?.();
    replay = null;
    return;
  }
  const e = replay.events[replay.i];
  applyPause({
    path: e.path,
    line: e.line,
    reason: "trace",
    stack: stackOf(e),
    locals: e.locals,
  });
  void refreshWatches(e.locals).catch(() => undefined);
}

export function debugSnapshot() {
  const d = useIde.getState().debug;
  return {
    active: d.active,
    paused: d.paused,
    path: d.path,
    line: d.line,
    reason: d.reason,
    stack: d.stack,
    locals: d.locals,
    breakpoints: bps(),
    watches: d.watches,
  };
}

export async function debugEval(expr: string): Promise<string> {
  const remote=backgroundDebugCommand('eval',{expr});
  if(remote){const result=await remote;return result.error||result.value||result.eval||result.lastEval||'';}
  const trimmed = expr.trim();
  if (!trimmed) return "";
  if (jsSession) {
    if (waiter) {
      evalExpr = trimmed;
      const got = new Promise<string>((resolve) => {
        evalResultWait = resolve;
      });
      waiter.resolve("eval");
      waiter = null;
      return got;
    }
    return jsSession.eval(trimmed);
  }
  if (!waiter) {
    const locals = useIde.getState().debug.locals;
    try {
      const keys = Object.keys(locals);
      const vals = keys.map((k) => {
        try {
          return JSON.parse(locals[k]);
        } catch {
          return locals[k];
        }
      });
      return String(new Function(...keys, `"use strict"; return (${trimmed});`)(...vals));
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
  evalExpr = trimmed;
  const got = new Promise<string>((resolve) => {
    evalResultWait = resolve;
  });
  waiter.resolve("eval");
  waiter = null;
  return got;
}

function waitCmd(): Promise<DebugCmd> {
  return new Promise((resolve) => {
    waiter = { resolve };
  });
}

async function pauseJs(info: {
  path: string;
  line: number;
  reason: string;
  stack: DebugFrame[];
  locals: Record<string, unknown>;
}, owner: DebugOwner): Promise<DebugCmd> {
  if (!debugCurrent(owner)) return "stop";
  const locals: Record<string, string> = {};
  for (const [k, v] of Object.entries(info.locals)) {
    if (k.startsWith("__")) continue;
    try {
      locals[k] = typeof v === "string" ? JSON.stringify(v) : fmtVal(v);
    } catch {
      locals[k] = String(v);
    }
  }
  applyPause({ ...info, locals }, owner);
  await refreshWatches(locals, owner);
  if (!debugCurrent(owner)) return "stop";
  let cmd: DebugCmd = "continue";
  for (;;) {
    cmd = await waitCmd();
    if (!debugCurrent(owner)) return "stop";
    if (cmd !== "eval") break;
    const expr = evalExpr;
    evalExpr = "";
    let out = "";
    if (jsSession) {
      out = await jsSession.eval(expr);
    } else {
      try {
        const keys = Object.keys(info.locals);
        const fn = new Function(...keys, `"use strict"; return (${expr});`);
        out = fmtVal(fn(...keys.map((k) => info.locals[k])));
      } catch (err) {
        out = err instanceof Error ? err.message : String(err);
      }
    }
    if (!debugCurrent(owner)) return "stop";
    useIde.getState().setDebugEval(out);
    evalResultWait?.(out);
    evalResultWait = null;
  }
  return cmd;
}

function fmtVal(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  try {
    const s = JSON.stringify(v);
    if (s != null) return s.length > 240 ? `${s.slice(0, 240)}…` : s;
  } catch {
    /* cyclic */
  }
  return String(v).slice(0, 240);
}

async function refreshWatches(locals: Record<string, string>, owner = debugOwner) {
  if (owner) assertDebug(owner);
  const watches = useIde.getState().debug.watches;
  if (!watches.length) {
    useIde.getState().setDebugWatches({});
    return;
  }
  if (jsSession) {
    const values = await jsSession.watches(watches);
    if (owner) assertDebug(owner);
    useIde.getState().setDebugWatches(values);
    return;
  }
  const values: Record<string, string> = {};
  const keys = Object.keys(locals);
  const parsed = keys.map((k) => {
    try {
      return JSON.parse(locals[k]);
    } catch {
      return locals[k];
    }
  });
  for (const w of watches) {
    try {
      const fn = new Function(...keys, `"use strict"; return (${w});`);
      values[w] = fmtVal(fn(...parsed));
    } catch (err) {
      values[w] = err instanceof Error ? err.message : String(err);
    }
  }
  useIde.getState().setDebugWatches(values);
}

const SKIP_JS =
  /^(else\b|catch\b|finally\b|case\b|default\b|\*|\/\*|\}|\]|\)|,|\.)/;

function instrumentJs(code: string, path: string): string {
  const ids = [...new Set(code.match(/\b[A-Za-z_$][\w$]*\b/g) ?? [])]
    .filter((w) => !JS_KW.has(w) && w.length < 40)
    .slice(0, 80);
  const dump = `(()=>{const o={};${ids
    .map((id) => `try{o[${JSON.stringify(id)}]=${id}}catch(e){}`)
    .join(";")};return o;})()`;
  const lines = code.split("\n");
  let depth = 0;
  const body = lines
    .map((line, i) => {
      const t = line.trim();
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      const skip =
        !t ||
        t.startsWith("//") ||
        t.startsWith("*") ||
        t.startsWith("/*") ||
        t.startsWith("#") ||
        SKIP_JS.test(t) ||
        /^(async\s+)?function\b/.test(t) ||
        /^class\s/.test(t) ||
        /^(export|import)\s/.test(t) ||
        /=>\s*\{/.test(t);
      const n = i + 1;
      const out = !skip && depth === 0 ? `await __dbg(${n},${JSON.stringify(path)},${dump},"line");\n${line}` : line;
      depth = Math.max(0, depth + opens - closes);
      return out;
    })
    .join("\n");
  return `"use strict";\n${body}\n`;
}

export function instrumentJsForTest(code: string, path = "t.js"): string {
  return instrumentJs(code, path);
}

const JS_KW = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "export", "extends", "false", "finally", "for",
  "function", "if", "import", "in", "instanceof", "let", "new", "null", "return",
  "super", "switch", "this", "throw", "true", "try", "typeof", "undefined",
  "var", "void", "while", "with", "yield", "await", "async", "of", "from", "as",
]);

async function runJsDebug(code: string, path: string, owner: DebugOwner): Promise<{ stdout: string; stderr: string }> {
  assertDebug(owner);
  if (/^\s*(?:import|export)\b/m.test(code)) {
    return { stdout: "Diese Datei ist ein Modul und wurde nicht im Debugger gestartet. Mit „Ausführen“ öffnest du die HTML-Vorschau.", stderr: "" };
  }
  const logs: string[] = [];
  const src = instrumentJs(code, path);
  const session = startJsDebugIframe(src, {
    shouldPause: (file, line, reason) => !debugCurrent(owner) || mode === "stop" || reason === "exception" || needPause(file, line),
    onLog: (line) => logs.push(line),
    onPause: async (info) => {
      if (!debugCurrent(owner) || mode === "stop") return "stop";
      try { const cmd = await pauseJs({
        path: info.path,
        line: info.line,
        reason: info.reason,
        stack: [{ path: info.path, line: info.line, fn: "<module>" }],
        locals: info.locals,
      }, owner);
      if (cmd === "stop") return "stop";
      if (cmd === "step") return "step";
      return "continue";
      } catch (error) { if (!debugCurrent(owner)) return "stop"; throw error; }
    },
  });
  owner.js = session;
  jsSession = session;
  try {
    const r = await waitDebug(owner, session.done);
    assertDebug(owner);
    const stdout = [...logs, r.stdout].filter(Boolean).join("\n");
    if (r.stderr && !r.stderr.includes("Debug gestoppt")) {
      const line = Number(/:(\d+)/.exec(r.stderr)?.[1] ?? 0);
      if (line) {
        try {
          await pauseJs({
            path,
            line,
            reason: "exception",
            stack: [{ path, line, fn: "<module>" }],
            locals: {},
          }, owner);
        } catch {
          /* stop */
        }
      }
    }
    return { stdout, stderr: r.stderr.includes("Debug gestoppt") ? "" : r.stderr };
  } finally {
    if (jsSession === session) jsSession = null;
    session.kill();
  }
}

const PY_BOOT = `
import ast, inspect, json, sys, types, os, builtins

class _VFS:
    def __init__(self, files):
        self.files = files
    def find_spec(self, fullname, path, target=None):
        rel = fullname.replace(".", "/") + ".py"
        pkg = fullname.replace(".", "/") + "/__init__.py"
        source = self.files.get(rel) or self.files.get(pkg)
        if source is None:
            return None
        spec = types.ModuleSpec(fullname, self)
        spec.origin = rel if rel in self.files else pkg
        spec.submodule_search_locations = [] if spec.origin.endswith("__init__.py") else None
        return spec
    def create_module(self, spec):
        return None
    def exec_module(self, module):
        name = module.__name__
        rel = name.replace(".", "/") + ".py"
        pkg = name.replace(".", "/") + "/__init__.py"
        source = self.files.get(rel) or self.files.get(pkg)
        module.__file__ = rel if rel in self.files else pkg
        exec(compile(source, module.__file__, "exec"), module.__dict__)

async def __dbg_maybe(v):
    if inspect.isawaitable(v):
        return await v
    return v

async def __dbg_hit(n, loc):
    clean = {k: repr(v)[:200] for k, v in loc.items() if not str(k).startswith("_")}
    while True:
        cmd = await anvil_dbg.pause(__dbg_path, int(n), clean)
        if cmd == "eval":
            expr = anvil_dbg.take_eval()
            try:
                anvil_dbg.eval_result(repr(eval(expr, globals(), loc)))
            except Exception as e:
                anvil_dbg.eval_result(str(e))
            continue
        return cmd

class _Ins(ast.NodeTransformer):
    def __init__(self):
        self.in_class = 0
        self.sync = 0
    def _hit(self, lineno):
        return ast.Expr(value=ast.Await(value=ast.Call(
            func=ast.Name(id="__dbg_hit", ctx=ast.Load()),
            args=[ast.Constant(lineno), ast.Call(func=ast.Name(id="locals", ctx=ast.Load()), args=[], keywords=[])],
            keywords=[],
        )))
    def _inject(self, body):
        out = []
        for stmt in body:
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                out.append(self.visit(stmt))
                continue
            ln = getattr(stmt, "lineno", None)
            if ln:
                out.append(self._hit(ln))
            out.append(self.visit(stmt))
        return out or [ast.Pass()]
    def visit_FunctionDef(self, node):
        self.sync += 1
        self.generic_visit(node)
        self.sync -= 1
        return node
    def visit_AsyncFunctionDef(self, node):
        self.generic_visit(node)
        node.body = self._inject(node.body)
        return node
    def visit_ClassDef(self, node):
        self.in_class += 1
        self.generic_visit(node)
        self.in_class -= 1
        return node
    def visit_Call(self, node):
        node = self.generic_visit(node)
        if self.in_class or self.sync:
            return node
        return ast.Await(value=ast.Call(func=ast.Name(id="__dbg_maybe", ctx=ast.Load()), args=[node], keywords=[]))

def __dbg_transform(src):
    tree = ast.parse(src)
    tree = _Ins().visit(tree)
    tree = ast.fix_missing_locations(tree)
    main = ast.AsyncFunctionDef(
        name="__anvil_main",
        args=ast.arguments(posonlyargs=[], args=[], vararg=None, kwonlyargs=[], kw_defaults=[], kwarg=None, defaults=[]),
        body=tree.body or [ast.Pass()],
        decorator_list=[],
        returns=None,
        type_params=[],
        lineno=1, col_offset=0,
    )
    mod = ast.Module(body=[main], type_ignores=[])
    ast.fix_missing_locations(mod)
    return ast.unparse(mod)
`;

async function runPyDebug(files: Record<string, string>, path: string, owner: DebugOwner): Promise<{ stdout: string; stderr: string }> {
  assertDebug(owner);
  const py = await getPyodide();
  assertDebug(owner);
  let stdout = "";
  let stderr = "";
  py.setStdout({ batched: (s) => { stdout += s; } });
  py.setStderr({ batched: (s) => { stderr += s; } });
  const pause = async (file: string, line: number, locals: Record<string, string>) => {
    if (!debugCurrent(owner) || mode === "stop") return "stop";
    if (!needPause(file, line)) return "continue";
    applyPause({
      path: file,
      line,
      reason: "break",
      stack: [{ path: file, line, fn: "<module>" }],
      locals,
    }, owner);
    await refreshWatches(locals, owner);
    if (!debugCurrent(owner)) return "stop";
    let cmd: DebugCmd = "continue";
    for (;;) {
      cmd = await waitCmd();
      if (!debugCurrent(owner)) return "stop";
      if (cmd !== "eval") break;
      // python loop handles eval via take_eval; we should not reach here
      // if python called pause() once per loop. We return "eval" and python continues.
      break;
    }
    return cmd;
  };
  py.registerJsModule?.("anvil_dbg", {
    pause,
    take_eval: () => {
      if (!debugCurrent(owner)) return "";
      const e = evalExpr;
      evalExpr = "";
      return e;
    },
    eval_result: (s: string) => {
      if (!debugCurrent(owner)) return;
      useIde.getState().setDebugEval(String(s));
      evalResultWait?.(String(s));
      evalResultWait = null;
    },
  });
  try {
    assertDebug(owner);
    const payload = JSON.stringify(files);
    await py.runPythonAsync(`
${PY_BOOT}
from anvil_dbg import pause as __p
class _AD:
    async def pause(self, path, n, loc):
        return await __p(path, n, loc)
    def take_eval(self):
        from anvil_dbg import take_eval
        return take_eval()
    def eval_result(self, s):
        from anvil_dbg import eval_result
        eval_result(s)
anvil_dbg = _AD()
_files = json.loads(${JSON.stringify(payload)})
sys.meta_path.insert(0, _VFS(_files))
__dbg_path = ${JSON.stringify(path)}
_src = _files[__dbg_path]
_t = __dbg_transform(_src)
ns = {"__name__": "__main__", "__file__": __dbg_path, "__dbg_hit": __dbg_hit, "__dbg_maybe": __dbg_maybe, "anvil_dbg": anvil_dbg}
exec(compile(_t, __dbg_path, "exec"), ns)
await ns["__anvil_main"]()
`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("Debug gestoppt")) stderr += msg;
  }
  return { stdout, stderr };
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function runNativePyDebug(path: string, cwd: string, owner: DebugOwner): Promise<{ stdout: string; stderr: string } | null> {
  const base = useIde.getState().companionUrl || "http://127.0.0.1:7845";
  let held = false;
  let id: string | undefined;
  let stdout = "";
  let stderr = "";
  try {
    held = await holdCompanion(cwd, base, owner.run);
    assertDebug(owner);
    const start = await companionDebug("start", { cwd, path, pauseOnEntry: entryPause, breakpoints: bps() }, base, owner.signal);
    // Keep a returned ID for cleanup even when cancellation raced the response.
    if (typeof start.id === "string" && start.id.trim()) id = start.id;
    assertDebug(owner);
    if (!start.ok || !id) {
      if (id || (owner.run && (start.uncertain || start.ok))) throw new Error("Debugstart nicht eindeutig bestätigt; keine andere Sitzung übernommen und kein weiterer Start versucht.");
      return null;
    }
    for (;;) {
      assertDebug(owner);
      if (mode === "stop") {
        return { stdout, stderr };
      }
      const ev = await companionDebug("poll", { id }, base, owner.signal);
      assertDebug(owner);
      if (!ev.ok) return { stdout, stderr: ev.error || "Debug tot" };
      stdout = ev.stdout || stdout;
      stderr = ev.stderr || stderr;
      if (ev.done) return { stdout, stderr };
      if (ev.pause) {
        applyPause({
          path: ev.pause.path || path,
          line: ev.pause.line,
          reason: ev.pause.reason || "break",
          stack: ev.pause.stack?.length ? ev.pause.stack : [{ path: ev.pause.path || path, line: ev.pause.line, fn: "<module>" }],
          locals: ev.pause.locals || {},
        }, owner);
        await refreshWatches(ev.pause.locals || {}, owner);
        assertDebug(owner);
        let cmd: DebugCmd = "continue";
        for (;;) {
          cmd = await waitCmd();
          assertDebug(owner);
          if (cmd !== "eval") break;
          const expr = evalExpr;
          evalExpr = "";
          await companionDebug("cmd", { id, cmd: "eval", expr }, base, owner.signal);
          assertDebug(owner);
          let text = "";
          for (let i = 0; i < 25; i++) {
            await sleep(40);
            assertDebug(owner);
            const got = await companionDebug("poll", { id }, base, owner.signal);
            assertDebug(owner);
            stdout = got.stdout || stdout;
            stderr = got.stderr || stderr;
            if (got.eval) {
              text = got.eval;
              break;
            }
            if (got.done) break;
          }
          useIde.getState().setDebugEval(text);
          evalResultWait?.(text);
          evalResultWait = null;
        }
        if (cmd === "stop") {
          return { stdout, stderr };
        }
        await companionDebug("cmd", { id, cmd, breakpoints: bps() }, base, owner.signal);
        assertDebug(owner);
      } else {
        await sleep(50);
      }
    }
  } finally {
    // Cancellation may already have invalidated the run; stop only its known ID.
    if (id) await companionDebug("stop", { id }, base);
    if (held) await releaseCompanion().catch(() => undefined);
  }
}

export async function startDebug(path: string, files: Record<string, string>, opts?: { pauseOnEntry?: boolean; run?: AgentRun; onFirst?: (s: unknown) => void }) {
  opts?.run?.assertCurrent();
  if(useIde.getState().debug.backgroundJobId&&useIde.getState().debug.active){useIde.getState().setNotice('Zuerst die laufende Hintergrund-Debugsitzung stoppen.');return {ok:false,error:'Hintergrund-Debugsitzung aktiv.'};}
  useIde.getState().setDebug({backgroundJobId:undefined});
  if (started) debugStop();
  const controller = new AbortController();
  const owner: DebugOwner = { generation: ++debugGeneration, run: opts?.run, controller, signal: opts?.run ? AbortSignal.any([controller.signal, opts.run.signal]) : controller.signal, first: opts?.onFirst };
  debugOwner = owner;
  const onAbort = () => stopOwnedDebug(owner);
  owner.signal.addEventListener("abort", onAbort, { once: true });
  mode = opts?.pauseOnEntry === false ? "run" : "step";
  entryPause = opts?.pauseOnEntry !== false;
  started = true;
  useIde.getState().setDebug({
    active: true,
    paused: false,
    path,
    line: 1,
    reason: "start",
    stack: [],
    locals: {},
  });
  useIde.getState().revealOutput();
  window.dispatchEvent(new Event("anvil-debug-tab"));
  useIde.getState().setRunning(true);
  window.dispatchEvent(new CustomEvent("anvil-learn", { detail: { k: "debug", d: path } }));
  const lang = langFromPath(path);
  const startedAt = performance.now();
  kind = "live";
  replay = null;
  let failure: { ok: false; error: string } | undefined;
  try {
    let out = { stdout: "", stderr: "" };
    if (lang === "python") {
      const cwd = useIde.getState().workspaceCwd;
      if (cwd) {
        const native = await runNativePyDebug(path, cwd, owner);
        assertDebug(owner);
        out = native ?? (await runPyDebug(files, path, owner));
      } else {
        out = await runPyDebug(files, path, owner);
      }
    } else if (lang === "javascript" || lang === "typescript") {
      const src = lang === "typescript" ? await stripTs(files[path] ?? "", path) : (files[path] ?? "");
      assertDebug(owner);
      out = await runJsDebug(src, path, owner);
    } else if (canDebug(path)) {
      kind = "replay";
      const trace = await collectRemoteTrace(path, files, true, owner.signal);
      assertDebug(owner);
      out = { stdout: trace.stdout, stderr: trace.stderr };
      if (trace.events.length) {
        await new Promise<void>((resolve) => {
          replay = { events: trace.events, i: -1, finish: resolve };
          if (entryPause) replayAdvance("step");
          else replayAdvance("continue");
          if (!replay) resolve();
        });
      } else if (!out.stderr) {
        out.stderr = "Kein Debug-Trace. Breakpoints setzen oder Code mit ausführbaren Zeilen.";
      }
    } else {
      out = { stdout: "", stderr: `Debug für ${lang} nicht verfügbar.` };
    }
    assertDebug(owner);
    useIde.getState().pushOutput({
      ok: !out.stderr,
      stdout: out.stdout,
      stderr: out.stderr,
      duration: (performance.now() - startedAt) / 1000,
      label: `debug ${path}`,
    });
    return { ok: !out.stderr, ...out, ...debugSnapshot() };
  } catch (error) {
    failure = { ok: false, error: isAbortLike(error) || owner.signal.aborted ? "Debug gestoppt" : error instanceof Error ? error.message : String(error) };
    return failure;
  } finally {
    owner.signal.removeEventListener("abort", onAbort);
    if (debugOwner === owner) {
      started = false;
      waiter = null;
      if (!useIde.getState().debug.backgroundJobId) {
        useIde.getState().setRunning(false);
        useIde.getState().setDebug({ active: false, paused: false, reason: "" });
        useIde.getState().setPluginStatus("");
      }
      owner.first?.(failure ?? (debugCurrent(owner) ? debugSnapshot() : { ok: false, error: "Debug gestoppt" }));
      owner.first = undefined;
      debugOwner = undefined;
    }
  }
}

export async function agentDebug(action: string, args: Record<string, unknown>, run?: AgentRun): Promise<unknown> {
  run?.assertCurrent();
  if(action!=='start'){const remote=backgroundDebugCommand(action,args);if(remote)return remote;}
  const st = useIde.getState();
  if (action === "start") {
    const scope = run ?? captureAgentRun();
    const path = String(args.path ?? st.activePath ?? "");
    if (!path || !st.files[path]) return { error: "Datei fehlt" };
    const got = new Promise((resolve) => {
      void startDebug(path, st.files, { pauseOnEntry: args.pause_on_entry !== false, run: scope, onFirst: resolve }).then(resolve, error => resolve({ ok: false, error: String(error) }));
    });
    return scope.wait(got);
  }
  if (action === "continue") {
    debugContinue();
    return { ok: true, cmd: "continue" };
  }
  if (action === "step") {
    debugStep();
    return { ok: true, cmd: "step" };
  }
  if (action === "stop") {
    debugStop();
    return { ok: true, cmd: "stop" };
  }
  if (action === "breakpoint") {
    const path = String(args.path ?? st.activePath ?? "");
    const line = Number(args.line ?? 0);
    if (!path || !line) return { error: "path und line" };
    st.toggleBreakpoint(path, line, args.on == null ? undefined : Boolean(args.on));
    return { ok: true, breakpoints: useIde.getState().breakpoints[path] ?? [] };
  }
  if (action === "eval") {
    const expr = String(args.expr ?? "");
    const value = await debugEval(expr);
    return { expr, value };
  }
  if (action === "watch") {
    const expr = String(args.expr ?? "").trim();
    if (expr) st.addWatch(expr);
    return { watches: useIde.getState().debug.watches };
  }
  if (action === "state") return debugSnapshot();
  return { error: `unbekannt ${action}` };
}
