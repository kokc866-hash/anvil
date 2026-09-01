import { langFromPath } from "./languages";
import { getPyodide, stripTs } from "./run-client";
import { startJsDebugIframe, type JsDebugSession } from "./debug-sandbox";
import { canDebug, collectRemoteTrace, stackOf, type TraceEvent } from "./debug-remote";
import { emitPlugin } from "./plugins/events";
import { useIde, type DebugFrame } from "@/store/ide";

export type DebugCmd = "continue" | "step" | "stop" | "eval";

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
let firstLock: ((s: unknown) => void) | null = null;
let kind: "live" | "replay" = "live";
let replay: { events: TraceEvent[]; i: number; finish?: () => void } | null = null;
let jsSession: JsDebugSession | null = null;

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
}) {
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
  firstLock?.(debugSnapshot());
  firstLock = null;
  emitPlugin("debug", debugSnapshot());
}

export function debugContinue() {
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
  void refreshWatches(e.locals);
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
}): Promise<DebugCmd> {
  const locals: Record<string, string> = {};
  for (const [k, v] of Object.entries(info.locals)) {
    if (k.startsWith("__")) continue;
    try {
      locals[k] = typeof v === "string" ? JSON.stringify(v) : fmtVal(v);
    } catch {
      locals[k] = String(v);
    }
  }
  applyPause({ ...info, locals });
  await refreshWatches(locals);
  let cmd: DebugCmd = "continue";
  for (;;) {
    cmd = await waitCmd();
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

async function refreshWatches(locals: Record<string, string>) {
  const watches = useIde.getState().debug.watches;
  if (!watches.length) {
    useIde.getState().setDebugWatches({});
    return;
  }
  if (jsSession) {
    useIde.getState().setDebugWatches(await jsSession.watches(watches));
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

async function runJsDebug(code: string, path: string): Promise<{ stdout: string; stderr: string }> {
  if (/^\s*(?:import|export)\b/m.test(code)) {
    return { stdout: "Moduldatei — Debugger übersprungen. Run öffnet die HTML-Vorschau.", stderr: "" };
  }
  const logs: string[] = [];
  const src = instrumentJs(code, path);
  const session = startJsDebugIframe(src, {
    shouldPause: (file, line, reason) => mode === "stop" || reason === "exception" || needPause(file, line),
    onLog: (line) => logs.push(line),
    onPause: async (info) => {
      if (mode === "stop") return "stop";
      const cmd = await pauseJs({
        path: info.path,
        line: info.line,
        reason: info.reason,
        stack: [{ path: info.path, line: info.line, fn: "<module>" }],
        locals: info.locals,
      });
      if (cmd === "stop") return "stop";
      if (cmd === "step") return "step";
      return "continue";
    },
  });
  jsSession = session;
  try {
    const r = await session.done;
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
          });
        } catch {
          /* stop */
        }
      }
    }
    return { stdout, stderr: r.stderr.includes("Debug gestoppt") ? "" : r.stderr };
  } finally {
    jsSession = null;
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

async function runPyDebug(files: Record<string, string>, path: string): Promise<{ stdout: string; stderr: string }> {
  const py = await getPyodide();
  let stdout = "";
  let stderr = "";
  py.setStdout({ batched: (s) => { stdout += s; } });
  py.setStderr({ batched: (s) => { stderr += s; } });
  const pause = async (file: string, line: number, locals: Record<string, string>) => {
    if (mode === "stop") return "stop";
    if (!needPause(file, line)) return "continue";
    applyPause({
      path: file,
      line,
      reason: "break",
      stack: [{ path: file, line, fn: "<module>" }],
      locals,
    });
    await refreshWatches(locals);
    let cmd: DebugCmd = "continue";
    for (;;) {
      cmd = await waitCmd();
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
      const e = evalExpr;
      evalExpr = "";
      return e;
    },
    eval_result: (s: string) => {
      useIde.getState().setDebugEval(String(s));
      evalResultWait?.(String(s));
      evalResultWait = null;
    },
  });
  try {
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

export async function startDebug(path: string, files: Record<string, string>, opts?: { pauseOnEntry?: boolean }) {
  if (started) debugStop();
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
  useIde.getState().setRunning(true);
  window.dispatchEvent(new CustomEvent("anvil-learn", { detail: { k: "debug", d: path } }));
  const lang = langFromPath(path);
  const startedAt = performance.now();
  kind = "live";
  replay = null;
  try {
    let out = { stdout: "", stderr: "" };
    if (lang === "python") out = await runPyDebug(files, path);
    else if (lang === "javascript" || lang === "typescript") {
      const src = lang === "typescript" ? stripTs(files[path] ?? "") : (files[path] ?? "");
      out = await runJsDebug(src, path);
    } else if (canDebug(path)) {
      kind = "replay";
      const trace = await collectRemoteTrace(path, files, true);
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
    useIde.getState().pushOutput({
      ok: !out.stderr,
      stdout: out.stdout,
      stderr: out.stderr,
      duration: (performance.now() - startedAt) / 1000,
      label: `debug ${path}`,
    });
    return { ok: !out.stderr, ...out, ...debugSnapshot() };
  } finally {
    started = false;
    waiter = null;
    useIde.getState().setRunning(false);
    useIde.getState().setDebug({ active: false, paused: false, reason: "" });
    useIde.getState().setPluginStatus("");
    firstLock?.(debugSnapshot());
    firstLock = null;
  }
}

export async function agentDebug(action: string, args: Record<string, unknown>): Promise<unknown> {
  const st = useIde.getState();
  if (action === "start") {
    const path = String(args.path ?? st.activePath ?? "");
    if (!path || !st.files[path]) return { error: "Datei fehlt" };
    const got = new Promise((resolve) => {
      firstLock = resolve;
    });
    void startDebug(path, st.files, { pauseOnEntry: args.pause_on_entry !== false });
    return got;
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
