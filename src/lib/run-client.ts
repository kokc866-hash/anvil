import { runJsSandboxed } from "./run-sandbox";
import { runRemote } from "./run-server";
import { looksGraphical, wrapJsGame, withEngine } from "./game-host";
import { prepareHtmlProject, projectHtmlEntry, transpileScript } from "./canvas/project";
import { canvasScope } from "./canvas/scope";
import { canvasCommand, findCanvasFrame } from "./canvas/session";
import { langFromPath, langMeta, type LangId } from "./languages";
import { compileFiles } from "./compile-files";
import type { RunResult } from "@/store/ide";
import { useIde } from "@/store/ide";
import { throwIfAborted, withAgentTimeout } from "./abort";
import { scrubRunError } from "./run-error";
import { isTestFile } from "./test-parse";
import { isExecutablePath } from "./run-target";

type PyodideLike = {
  runPythonAsync: (code: string) => Promise<unknown>;
  setStdout: (opts: { batched: (s: string) => void }) => void;
  setStderr: (opts: { batched: (s: string) => void }) => void;
  registerJsModule?: (name: string, mod: Record<string, unknown>) => void;
  globals?: { set: (k: string, v: unknown) => void };
};

let pyodidePromise: Promise<PyodideLike> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Pyodide konnte nicht geladen werden."));
    document.head.appendChild(s);
  });
}

export async function getPyodide(): Promise<PyodideLike> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      await loadScript("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");
      const load = (
        window as unknown as {
          loadPyodide?: (o: { indexURL: string }) => Promise<PyodideLike>;
        }
      ).loadPyodide;
      if (typeof load !== "function") {
        throw new Error("Python-Laufzeit nicht geladen.");
      }
      return load({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" });
    })();
  }
  return pyodidePromise;
}

function wrapPython(files: Record<string, string>, entry: string): string {
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) map[k.replaceAll("\\", "/")] = v;
  const payload = JSON.stringify(map);
  const entryN = entry.replaceAll("\\", "/");
  return `
import json, sys, types, os, io, builtins, pathlib
_files = json.loads(${JSON.stringify(payload)})

def _norm(p):
    s = str(p).replace("\\\\", "/").lstrip("./")
    for pref in ("/home/pyodide/", "/workspace/", "/home/web_user/"):
        if s.startswith(pref):
            s = s[len(pref):]
    return s

def _lookup(p):
    n = _norm(p)
    if n in _files:
        return n
    base = n.split("/")[-1]
    hits = [k for k in _files if k == n or k.endswith("/" + n) or k.split("/")[-1] == base]
    if len(hits) == 1:
        return hits[0]
    if n in hits:
        return n
    return None

class _WsText(io.StringIO):
    def __init__(self, name, data, mode):
        super().__init__(data)
        self.name = name
        self._mode = mode
    def close(self):
        if any(c in self._mode for c in "wa+"):
            _files[self.name] = self.getvalue()
        super().close()
    def __enter__(self):
        return self
    def __exit__(self, *a):
        self.close()

class _WsBin(io.BytesIO):
    def __init__(self, name, data, mode):
        super().__init__(data)
        self.name = name
        self._mode = mode
    def close(self):
        if any(c in self._mode for c in "wa+"):
            _files[self.name] = self.getvalue().decode("utf-8", "replace")
        super().close()
    def __enter__(self):
        return self
    def __exit__(self, *a):
        self.close()

_real_open = builtins.open
def _open(file, mode="r", *a, **kw):
    m = str(mode or "r")
    key = _lookup(file)
    writing = any(c in m for c in "wax+")
    if key is None and writing:
        key = _norm(file)
        _files.setdefault(key, "")
    if key is not None:
        data = _files.get(key, "")
        if "b" in m:
            raw = data.encode("utf-8") if isinstance(data, str) else data
            buf = _WsBin(key, b"" if "w" in m and "+" not in m else raw, m)
            if "a" in m:
                buf.seek(0, 2)
            return buf
        buf = _WsText(key, "" if "w" in m and "+" not in m else data, m)
        if "a" in m:
            buf.seek(0, 2)
        return buf
    n = _norm(file)
    if n.startswith("/") and "python" in n:
        return _real_open(file, mode, *a, **kw)
    similar = [k for k in _files if k.endswith("/" + n.split("/")[-1]) or k.split("/")[-1] == n.split("/")[-1]]
    hint = (" ähnlich: " + ", ".join(similar[:8])) if similar else ""
    have = ", ".join(sorted(_files)[:20])
    raise FileNotFoundError("not in workspace: " + n + hint + ". files: " + have)
builtins.open = _open

_real_exists = os.path.exists
os.path.exists = lambda p: _lookup(p) is not None or _real_exists(p)
_real_isfile = os.path.isfile
os.path.isfile = lambda p: _lookup(p) is not None or _real_isfile(p)

_real_listdir = os.listdir
def _listdir(p="."):
    n = _norm(p)
    prefix = "" if n in (".", "") else n.rstrip("/") + "/"
    kids = set()
    for k in _files:
        if n in (".", ""):
            kids.add(k.split("/")[0])
        elif k == n:
            continue
        elif k.startswith(prefix):
            kids.add(k[len(prefix):].split("/")[0])
    if kids:
        return sorted(kids)
    return _real_listdir(p)
os.listdir = _listdir

_real_read = pathlib.Path.read_text
def _read_text(self, *a, **k):
    key = _lookup(str(self))
    if key is not None:
        return _files[key]
    n = _norm(str(self))
    raise FileNotFoundError("not in workspace: " + n)
pathlib.Path.read_text = _read_text

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
        spec.cached = None
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

sys.meta_path.insert(0, _VFS(_files))
_entry = ${JSON.stringify(entryN)}
_src = _files[_entry]
import ast
_g = {"__name__": "__main__", "__file__": _entry, "__workspace__": _files}
try:
    _tree = ast.parse(_src, filename=_entry)
except SyntaxError:
    exec(compile(_src, _entry, "exec"), _g)
else:
    if _tree.body and isinstance(_tree.body[-1], ast.Expr):
        _rest = ast.Module(body=_tree.body[:-1], type_ignores=[])
        ast.fix_missing_locations(_rest)
        if _rest.body:
            exec(compile(_rest, _entry, "exec"), _g)
        _val = eval(compile(ast.Expression(_tree.body[-1].value), _entry, "eval"), _g)
        if _val is not None:
            print("→", repr(_val))
    else:
        exec(compile(_src, _entry, "exec"), _g)
`;
}

async function runPython(
  files: Record<string, string>,
  path: string,
): Promise<{ stdout: string; stderr: string }> {
  const py = await getPyodide();
  let stdout = "";
  let stderr = "";
  py.setStdout({ batched: (s) => { stdout += s; } });
  py.setStderr({ batched: (s) => { stderr += s; } });
  try {
    await py.runPythonAsync(wrapPython(files, path));
  } catch (err) {
    stderr += err instanceof Error ? err.message : String(err);
  }
  return { stdout, stderr: scrubRunError(stderr) };
}

function isEsm(code: string): boolean {
  return /^\s*(?:import|export)\b/m.test(code);
}

export const stripTs = transpileScript;

function wrapRepl(lang: LangId, code: string): string {
  if (code.includes("func main") || code.includes("fn main") || code.includes("public static void main") || code.includes("static void Main")) {
    return code;
  }
  if (lang === "go") return `package main\nimport "fmt"\nfunc main() {\n${code}\n}\n`;
  if (lang === "rust") return `fn main() {\n${code}\n}\n`;
  if (lang === "java") return `public class Main { public static void main(String[] args) {\n${code}\n} }\n`;
  if (lang === "c") return `#include <stdio.h>\nint main(void) {\n${code}\nreturn 0;}\n`;
  if (lang === "cpp") return `#include <iostream>\nint main() {\n${code}\nreturn 0;}\n`;
  if (lang === "csharp") return `using System; class Program { static void Main() {\n${code}\n} }\n`;
  if (lang === "php") return code.includes("<?php") ? code : `<?php\n${code}\n`;
  return code;
}

async function companionJob(
  lang: string,
  path: string,
  files: Record<string, string>,
  opts?: { asTest?: boolean },
): Promise<RunResult | null> {
  const st = useIde.getState();
  const url = st.companionUrl || "http://127.0.0.1:7845";
  const signal = st.agentBusy ? withAgentTimeout(0) : undefined;
  const { withCompanion } = await import("./companion-life");
  const { nativeHelper } = await import("./helper-local");
  return withCompanion(async () => {
    try {
      const { companionCompile } = await import("./companion");
      const job = await companionCompile({ lang, entry: path, files: compileFiles(lang, path, files),
        cwd: st.workspaceCwd || undefined, asTest: opts?.asTest }, url, signal);
      if (job.running && job.stage?.id) watchNativeRun(job.stage.id, url);
      return { ok: job.ok, stdout: job.stdout, stderr: job.stderr, duration: job.duration / 1000,
        label: path, stage: job.stage ?? { kind: job.running ? "window" : "log" } };
    } catch (err) {
      if (signal?.aborted) throw err;
      // The web build can run Python in the browser when no local Companion is configured.
      if (!nativeHelper() && url === "http://127.0.0.1:7845" && err instanceof TypeError) return null;
      return { ok: false, stdout: "", stderr: `Companion ${url}: ${err instanceof Error ? err.message : String(err)}`,
        duration: 0, label: path, stage: { kind: "log" } };
    }
  }, url);
}

const nativeWatches = new Set<string>();
function watchNativeRun(id: string, base: string) {
  const key = `${base}/${id}`;
  if (nativeWatches.has(key)) return;
  nativeWatches.add(key);
  let failures = 0;
  const poll = async () => {
    try {
      const { companionRunStatus } = await import("./companion");
      const r = await companionRunStatus(id, base);
      failures = 0;
      useIde.setState((st) => ({
        output: st.output.map((o) => o.stage?.id === id ? { ...o, ok: r.ok, stdout: r.stdout, stderr: r.stderr, duration: r.duration / 1000, stage: r.stage } : o),
        chat: st.chat.map((c) => c.lastRun?.id === id ? { ...c, lastRun: { ...c.lastRun, ok: r.ok, stdout: r.stdout, stderr: r.stderr, running: r.running } } : c),
      }));
      if (!r.running) { nativeWatches.delete(key); return; }
    } catch {
      if (++failures >= 3) {
        useIde.setState((st) => ({ output: st.output.map((o) => o.stage?.id === id ? { ...o, ok: false,
          stderr: [o.stderr, "Run-Status nicht mehr erreichbar. Companion-Verbindung unterbrochen."].filter(Boolean).join("\n"),
          stage: { ...o.stage, kind: "log" } } : o) }));
        nativeWatches.delete(key); return;
      }
    }
    setTimeout(() => void poll(), 2000);
  };
  setTimeout(() => void poll(), 1000);
}

export async function runFile(
  path: string,
  files: Record<string, string>,
  opts?: { asTest?: boolean },
): Promise<RunResult> {
  if (useIde.getState().agentBusy) throwIfAborted();
  const lang = langFromPath(path);
  const code = files[path];
  const started = performance.now();
  const done = (r: Omit<RunResult, "duration" | "label">): RunResult => ({
    ...r,
    duration: (performance.now() - started) / 1000,
    label: path,
  });
  const graphical = async (page: string, entry = path): Promise<RunResult> => {
    const st = useIde.getState();
    let html: string | undefined;
    const signal = st.agentBusy ? withAgentTimeout(0) : undefined;
    try {
      html = withEngine(await prepareHtmlProject(page, files, entry), st.inputMap);
      st.setRunPath(path);
      const { ensureCanvasOutput } = await import("./run-window");
      await ensureCanvasOutput();
      const frame = await findCanvasFrame(canvasScope(useIde.getState()), 7000, signal);
      const result = await canvasCommand(frame, "load", { html, restart: true }, signal);
      return done({ ok: result.ok, stdout: result.ok ? "Ausgabe bereit." : "", stderr: result.error || "", html,
        stage: { kind: "html", id: result.session, state: result.state } });
    } catch (error) {
      return done({ ok: false, stdout: "", stderr: error instanceof Error ? error.message : String(error), html, stage: { kind: "html", state: "failed" } });
    }
  };
  if (code == null) {
    return done({ ok: false, stdout: "", stderr: `Datei nicht gefunden: ${path}` });
  }
  if (!isExecutablePath(path)) return done({ ok: false, stdout: "", stderr: `${path} ist keine ausführbare Startdatei. Dokumente über die Vorschau öffnen.` });
  if (lang === "html") {
    if (!useIde.getState().runHtml) {
      return done({ ok: false, stdout: "", stderr: "HTML-Run aus (Einstellungen → Ausgabe)." });
    }
    return graphical(code);
  }
  if (lang === "python") {
    const live = await companionJob("python", path, files, opts);
    if (live) return done({ ok: live.ok, stdout: live.stdout, stderr: live.stderr, stage: live.stage });
    const { stdout, stderr } = await runPython(files, path);
    return done({ ok: !stderr, stdout, stderr, stage: { kind: "log" } });
  }
  if (lang === "javascript" || lang === "typescript") {
    let src: string;
    try { src = lang === "typescript" ? await stripTs(code, path) : code; }
    catch (error) { return done({ ok: false, stdout: "", stderr: error instanceof Error ? error.message : String(error) }); }
    const testing = Boolean(opts?.asTest) || isTestFile(path);
    if (!testing && useIde.getState().runHtml) {
      const host = projectHtmlEntry(path, files, isEsm(src));
      if (host && host !== path) return graphical(files[host], host);
      if (looksGraphical(src) || isEsm(src)) return graphical(wrapJsGame(src, useIde.getState().inputMap, { module: isEsm(src) }));
    }

    const live = await companionJob(lang, path, files, opts);
    if (live) return done({ ok: live.ok, stdout: live.stdout, stderr: live.stderr, stage: live.stage });
    const { stdout, stderr } = await runJsSandboxed(src);
    return done({ ok: !stderr, stdout, stderr, stage: { kind: "log" } });
  }
  if (langMeta(lang)?.run === "remote") {
    const live = await companionJob(lang, path, files, opts);
    if (live) return done({ ok: live.ok, stdout: live.stdout, stderr: live.stderr, stage: live.stage });
    const remoteFiles = compileFiles(lang, path, files);
    const { withCompanion } = await import("./companion-life");
    return withCompanion(async () => {
      if (!useIde.getState().netCompiler) {
        return done({ ok: false, stdout: "", stderr: "Compiler fehlt. In Einstellungen → Companion in Anvil laden." });
      }
      const remote = await runRemote({
        data: {
          lang,
          entry: path,
          files: remoteFiles,
        },
      });
      return done({
        ok: remote.ok,
        stdout: remote.stdout,
        stderr: remote.stderr,
        stage: { kind: "log" },
      });
    });
  }
  return done({
    ok: false,
    stdout: "",
    stderr: `${langMeta(lang)?.label ?? lang} kann hier nicht ausgeführt werden.`,
  });
}

export async function evalSnippet(
  code: string,
  files: Record<string, string>,
  hintPath: string,
): Promise<RunResult> {
  const lang = langFromPath(hintPath);
  const started = performance.now();
  const done = (r: Omit<RunResult, "duration" | "label">): RunResult => ({
    ...r,
    duration: (performance.now() - started) / 1000,
    label: "repl",
  });
  if (lang === "python") {
    const { stdout, stderr } = await runPython({ ...files, "__repl__.py": code }, "__repl__.py");
    return done({ ok: !stderr, stdout, stderr });
  }
  if (lang === "javascript" || lang === "typescript") {
    const { stdout, stderr } = await runJsSandboxed(lang === "typescript" ? await stripTs(code, hintPath) : code);
    return done({ ok: !stderr, stdout, stderr });
  }
  if (langMeta(lang)?.run === "remote") {
    const ext = hintPath.split(".").pop() ?? "txt";
    const entry = `__repl__.${ext}`;
    const prepared = { ...files, [entry]: wrapRepl(lang, code) };
    const local = await companionJob(lang, entry, prepared, { asTest: true });
    if (local) return done({ ok: local.ok, stdout: local.stdout, stderr: local.stderr, stage: local.stage });
    if (!useIde.getState().netCompiler) return done({ ok: false, stdout: "", stderr: "Compiler fehlt. In Einstellungen → Companion in Anvil laden." });
    const remote = await runRemote({ data: { lang, entry, files: compileFiles(lang, entry, prepared) } });
    return done({ ok: remote.ok, stdout: remote.stdout, stderr: remote.stderr });
  }
  const { stdout, stderr } = await runJsSandboxed(code);
  return done({ ok: !stderr, stdout, stderr });
}
