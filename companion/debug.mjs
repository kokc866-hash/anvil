/** Native Python debug via sys.settrace. Token-gated by the server. */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { resolveCwd } from "./git.mjs";
import { resolveBin, toolEnv } from "./toolchain.mjs";

const sessions = new Map();

function which(bin) {
  const env = process.env.PATH || "";
  const ext = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of env.split(path.delimiter)) {
    for (const e of ext) {
      const p = path.join(dir, bin + e);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

export function pythonBin() {
  return which("python3") || which("python") || which("py") || resolveBin("python");
}

const TRACER = String.raw`
import json, os, sys, traceback

BPS = json.loads(os.environ.get("ANVIL_BPS") or "{}")
MODE = os.environ.get("ANVIL_DBG_MODE") or "step"
TARGET = os.environ.get("ANVIL_DBG_FILE") or ""
ROOT = os.path.abspath(os.environ.get("ANVIL_DBG_ROOT") or os.getcwd())
SELF = os.path.abspath(__file__)
_real_out = sys.stdout
_real_in = sys.stdin
_real_err = sys.stderr

def emit(obj):
    try:
        _real_out.write("\x1e" + json.dumps(obj, ensure_ascii=False) + "\n")
        _real_out.flush()
    except Exception:
        pass

class _Stream:
    def __init__(self, kind):
        self.kind = kind
    def write(self, s):
        if s:
            emit({"t": self.kind, "s": s})
    def flush(self):
        pass
    def isatty(self):
        return False

sys.stdout = _Stream("out")
sys.stderr = _Stream("err")

def rel_of(p):
    ap = os.path.abspath(p)
    try:
        r = os.path.relpath(ap, ROOT)
    except Exception:
        return ap.replace("\\", "/")
    return r.replace("\\", "/")

def ours(p):
    ap = os.path.abspath(p)
    if ap == SELF:
        return False
    if "site-packages" in ap.replace("\\", "/"):
        return False
    return ap == ROOT or ap.startswith(ROOT + os.sep)

def locals_of(frame):
    out = {}
    for k, v in list(frame.f_locals.items())[:32]:
        if str(k).startswith("_"):
            continue
        try:
            s = repr(v)
        except Exception:
            s = "?"
        out[str(k)] = s[:200]
        if len(out) >= 20:
            break
    return out

def stack_of(frame):
    rows = []
    cur = frame
    n = 0
    while cur is not None and n < 16:
        fn = cur.f_code.co_filename
        if ours(fn):
            rows.append({"path": rel_of(fn), "line": cur.f_lineno, "fn": cur.f_code.co_name})
        cur = cur.f_back
        n += 1
    return rows or [{"path": TARGET, "line": 1, "fn": "<module>"}]

def wait_cmd():
    line = _real_in.readline()
    if not line:
        return {"cmd": "stop"}
    try:
        return json.loads(line)
    except Exception:
        return {"cmd": "continue"}

step_next = MODE == "step"
stop = False

def tracer(frame, event, arg):
    global step_next, stop, BPS, MODE
    if stop:
        return None
    if event not in ("line", "exception"):
        return tracer
    fn = frame.f_code.co_filename
    if not ours(fn):
        return tracer
    path = rel_of(fn)
    line = frame.f_lineno
    hit = False
    if event == "exception":
        hit = True
        reason = "exception"
    elif step_next:
        hit = True
        reason = "step"
    elif path in BPS and line in BPS.get(path, []):
        hit = True
        reason = "break"
    elif TARGET and path == TARGET.replace("\\", "/") and MODE == "step" and line <= 2:
        hit = True
        reason = "entry"
    if not hit:
        return tracer
    step_next = False
    emit({"t": "pause", "path": path, "line": line, "reason": reason, "locals": locals_of(frame), "stack": stack_of(frame)})
    while True:
        msg = wait_cmd()
        raw_bps = msg.get("bps")
        if isinstance(raw_bps, dict):
            try:
                BPS = {str(k).replace("\\", "/"): [int(x) for x in (v or []) if int(x) > 0] for k, v in raw_bps.items()}
            except Exception:
                pass
        cmd = str(msg.get("cmd") or "continue")
        if cmd == "eval":
            expr = str(msg.get("expr") or "")
            try:
                emit({"t": "eval", "s": repr(eval(expr, frame.f_globals, frame.f_locals))[:800]})
            except Exception as e:
                emit({"t": "eval", "s": str(e)})
            continue
        if cmd == "stop":
            stop = True
            return None
        if cmd == "step":
            step_next = True
        return tracer
    return tracer

def main():
    target = TARGET.replace("\\", "/")
    full = os.path.join(ROOT, *target.split("/")) if target else ""
    if not target or not os.path.isfile(full):
        emit({"t": "done", "code": 1, "err": "Datei fehlt: " + target})
        return
    sys.settrace(tracer)
    sys.argv = [full]
    try:
        with open(full, "r", encoding="utf-8") as f:
            src = f.read()
        ns = {"__name__": "__main__", "__file__": full}
        exec(compile(src, full, "exec"), ns)
        emit({"t": "done", "code": 0})
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else 0
        emit({"t": "done", "code": code})
    except Exception:
        emit({"t": "err", "s": traceback.format_exc()})
        emit({"t": "done", "code": 1})
    finally:
        sys.settrace(None)

if __name__ == "__main__":
    main()
`;

function parseBps(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [p, lines] of Object.entries(raw)) {
    const key = String(p).replace(/\\/g, "/").replace(/^\/+/, "");
    const nums = (Array.isArray(lines) ? lines : []).map((n) => Number(n)).filter((n) => n > 0);
    if (nums.length) out[key] = nums;
  }
  return out;
}

function pushEvent(sess, ev) {
  if (ev.t === "out") sess.stdout = (sess.stdout + String(ev.s || "")).slice(-200_000);
  else if (ev.t === "err") sess.stderr = (sess.stderr + String(ev.s || "")).slice(-80_000);
  else if (ev.t === "eval") sess.eval = String(ev.s || "");
  else if (ev.t === "pause") {
    sess.pause = {
      path: String(ev.path || ""),
      line: Number(ev.line) || 1,
      reason: String(ev.reason || "break"),
      locals: ev.locals && typeof ev.locals === "object" ? ev.locals : {},
      stack: Array.isArray(ev.stack) ? ev.stack : [],
    };
  } else if (ev.t === "done") {
    sess.done = true;
    sess.code = Number(ev.code) || 0;
    if (ev.err) sess.stderr = (sess.stderr + String(ev.err)).slice(-80_000);
    sess.pause = null;
  }
}

function feed(sess, chunk) {
  sess.buf += chunk;
  const parts = sess.buf.split("\n");
  sess.buf = parts.pop() ?? "";
  for (const part of parts) {
    let line = part.trim();
    if (!line) continue;
    if (line.charCodeAt(0) === 0x1e) line = line.slice(1).trim();
    const brace = line.indexOf("{");
    if (brace < 0) {
      sess.stdout = (sess.stdout + line + "\n").slice(-200_000);
      continue;
    }
    try {
      pushEvent(sess, JSON.parse(line.slice(brace)));
    } catch {
      sess.stdout = (sess.stdout + line + "\n").slice(-200_000);
    }
  }
}

function killSess(sess) {
  if (sess.dead) return;
  sess.dead = true;
  sess.done = true;
  try {
    sess.child.kill("SIGTERM");
  } catch {
    /* */
  }
  setTimeout(() => {
    try {
      sess.child.kill("SIGKILL");
    } catch {
      /* */
    }
  }, 800);
  try {
    rmSync(sess.dir, { recursive: true, force: true });
  } catch {
    /* */
  }
}

export function debugStart(body) {
  const bin = pythonBin();
  if (!bin) return { ok: false, error: "python fehlt im PATH." };
  let root;
  try {
    root = resolveCwd(body.cwd);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const rel = String(body.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.includes("..")) return { ok: false, error: "Pfad ungültig." };
  const full = path.join(root, ...rel.split("/"));
  if (!existsSync(full)) return { ok: false, error: `Datei fehlt: ${rel}` };
  const id = randomBytes(8).toString("hex");
  const dir = mkdtempSync(path.join(os.tmpdir(), "anvil-dbg-"));
  const script = path.join(dir, "anvil_dbg.py");
  writeFileSync(script, TRACER, "utf8");
  const pauseOnEntry = body.pauseOnEntry !== false;
  const child = spawn(bin, ["-u", script], {
    cwd: root,
    windowsHide: true,
    shell: false,
    env: {
      ...toolEnv(),
      PYTHONUNBUFFERED: "1",
      ANVIL_DBG_ROOT: root,
      ANVIL_DBG_FILE: rel,
      ANVIL_DBG_MODE: pauseOnEntry ? "step" : "run",
      ANVIL_BPS: JSON.stringify(parseBps(body.breakpoints)),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const sess = {
    id,
    dir,
    child,
    buf: "",
    stdout: "",
    stderr: "",
    eval: "",
    pause: null,
    done: false,
    code: 0,
    dead: false,
  };
  child.stdout?.on("data", (d) => feed(sess, d.toString("utf8")));
  child.stderr?.on("data", (d) => {
    sess.stderr = (sess.stderr + d.toString("utf8")).slice(-80_000);
  });
  child.on("close", (code) => {
    sess.done = true;
    sess.code = code ?? 0;
    sess.pause = null;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });
  child.on("error", (err) => {
    sess.done = true;
    sess.stderr = (sess.stderr + String(err.message)).slice(-80_000);
  });
  const t = setTimeout(() => killSess(sess), 5 * 60 * 1000);
  child.on("close", () => clearTimeout(t));
  sessions.set(id, sess);
  return { ok: true, id, path: rel, cwd: root };
}

export function debugCmd(id, cmd, expr, bps) {
  const sess = sessions.get(id);
  if (!sess || sess.dead) return { ok: false, error: "Session tot" };
  const payload = { cmd: String(cmd || "continue") };
  if (cmd === "eval") payload.expr = String(expr || "");
  if (bps && typeof bps === "object") payload.bps = parseBps(bps);
  try {
    sess.child.stdin.write(JSON.stringify(payload) + "\n");
    if (cmd !== "eval") sess.pause = null;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function debugPoll(id) {
  const sess = sessions.get(id);
  if (!sess) return { ok: false, error: "Session fehlt", done: true };
  const evalOut = sess.eval;
  sess.eval = "";
  return {
    ok: true,
    done: sess.done,
    code: sess.code,
    stdout: sess.stdout,
    stderr: sess.stderr,
    eval: evalOut,
    pause: sess.pause,
  };
}

export function debugStop(id) {
  const sess = sessions.get(id);
  if (!sess) return { ok: true };
  try {
    sess.child.stdin.write(JSON.stringify({ cmd: "stop" }) + "\n");
  } catch {
    /* */
  }
  killSess(sess);
  sessions.delete(id);
  return { ok: true };
}
