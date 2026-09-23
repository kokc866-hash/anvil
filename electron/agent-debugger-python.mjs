/** Python standard-library debugger; separate child owns trace state and stdin protocol. */
export const PYTHON_TRACER = String.raw`
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
    if not p or p.startswith("<"):
        return False
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
        if cmd == "breakpoints":
            emit({"t": "ack", "id": msg.get("id")})
            continue
        if cmd == "eval":
            expr = str(msg.get("expr") or "")
            try:
                emit({"t": "eval", "id": msg.get("id"), "s": repr(eval(expr, frame.f_globals, frame.f_locals))[:800]})
            except Exception as e:
                emit({"t": "eval", "id": msg.get("id"), "s": str(e)})
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
    sys.path.insert(0, ROOT)
    sys.path.insert(0, os.path.dirname(full))
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
