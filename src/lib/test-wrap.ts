export function hasRealPyRunner(src: string): boolean {
  return /\bunittest\.main\s*\(/.test(src) || /\bpytest\.main\s*\(/.test(src);
}

export function hasRealJsRunner(src: string): boolean {
  return /\bfrom\s+['"]node:test['"]/.test(src) || /\brequire\s*\(\s*['"]node:test['"]/.test(src);
}

export function wrapPy(path: string, src: string, only?: string): string {
  if (hasRealPyRunner(src)) return src;
  const p = JSON.stringify(path);
  const filter = JSON.stringify(only ?? "");
  return `${src}

_anvil_fails = 0
_anvil_ran = 0
_anvil_only = ${filter}
def _anvil_run(_n, _fn):
    global _anvil_fails, _anvil_ran
    if _anvil_only and _n != _anvil_only:
        return
    _anvil_ran += 1
    try:
        _fn()
        print("PASS", ${p}, "::", _n)
    except Exception as _e:
        _anvil_fails += 1
        print("FAIL", ${p}, "::", _n, _e)
for _n, _fn in list(globals().items()):
    if not _n.startswith("test_") or not callable(_fn):
        continue
    _anvil_run(_n, _fn)
for _n, _cls in list(globals().items()):
    if not isinstance(_cls, type) or not _n.startswith("Test"):
        continue
    try:
        _obj = _cls()
    except Exception:
        continue
    for _m in dir(_obj):
        if not _m.startswith("test_"):
            continue
        _mf = getattr(_obj, _m, None)
        if callable(_mf):
            _anvil_run(_m, _mf)
if _anvil_fails:
    raise SystemExit(1)
if not _anvil_ran and not _anvil_only:
    raise SystemExit("keine test_* Funktionen")
`;
}

export function wrapJs(path: string, src: string, only?: string): string {
  if (hasRealJsRunner(src)) return src;
  const p = JSON.stringify(path);
  const filter = JSON.stringify(only ?? "");
  return `let __anvil_fail = 0;
let __anvil_ran = 0;
const __anvil_only = ${filter};
const __anvil_pending = [];
function describe(_n, fn) { return fn(); }
async function __anvil_call(name, fn) {
  if (__anvil_only && name !== __anvil_only) return;
  __anvil_ran += 1;
  try {
    await fn();
    console.log("PASS " + ${p} + " · " + name);
  } catch (e) {
    __anvil_fail += 1;
    console.error("FAIL " + ${p} + " · " + name + " " + e);
  }
}
function test(name, fn) {
  const r = __anvil_call(name, fn);
  __anvil_pending.push(Promise.resolve(r));
  return r;
}
const it = test;
${src}
const __anvil_done = Promise.all(__anvil_pending).then(function () {
  if (__anvil_fail) throw new Error(__anvil_fail + " Tests fehlgeschlagen");
  if (!__anvil_ran && !__anvil_only) throw new Error("keine test()/it() Aufrufe");
});
if (typeof process !== "undefined") {
  __anvil_done.catch(function (e) { console.error(e); process.exit(1); });
}
__anvil_done
`;
}

export function wrapPhp(path: string, src: string, only?: string): string {
  if (/\bPHPUnit\\|\bphpunit\b/i.test(src)) return src;
  const body = src.replace(/^\s*<\?php\s*/i, "");
  const p = JSON.stringify(path);
  const filter = JSON.stringify(only ?? "");
  return `<?php
${body}
$_anvil_fails = 0; $_anvil_ran = 0; $_anvil_only = ${filter};
foreach (get_defined_functions()['user'] as $_n) {
  if (strpos($_n, 'test_') !== 0) continue;
  if ($_anvil_only && $_n !== $_anvil_only) continue;
  $_anvil_ran++;
  try { $_n(); echo "PASS " . ${p} . " :: $_n\\n"; }
  catch (Throwable $_e) { $_anvil_fails++; echo "FAIL " . ${p} . " :: $_n $_e\\n"; }
}
if ($_anvil_fails) exit(1);
`;
}

export function wrapRb(path: string, src: string, only?: string): string {
  if (/\b(?:minitest|rspec)\b/i.test(src)) return src;
  const p = JSON.stringify(path);
  const filter = JSON.stringify(only ?? "");
  return `${src}
_anvil_fails = 0
_anvil_only = ${filter}
private_methods.grep(/^test_/).each do |_n|
  next if !_anvil_only.empty? && _n.to_s != _anvil_only
  begin
    send(_n)
    puts("PASS " + ${p} + " :: #{_n}")
  rescue => _e
    _anvil_fails += 1
    puts("FAIL " + ${p} + " :: #{_n} #{_e}")
  end
end
raise "#{_anvil_fails} Tests fehlgeschlagen" if _anvil_fails > 0
`;
}

export function prepared(files: Record<string, string>, path: string, only?: string): Record<string, string> {
  const src = files[path] ?? "";
  if (path.endsWith(".py")) return { ...files, [path]: wrapPy(path, src, only) };
  if (/\.(js|ts|tsx|jsx|mjs|cjs)$/.test(path)) return { ...files, [path]: wrapJs(path, src, only) };
  if (path.endsWith(".php")) return { ...files, [path]: wrapPhp(path, src, only) };
  if (path.endsWith(".rb")) return { ...files, [path]: wrapRb(path, src, only) };
  return files;
}
