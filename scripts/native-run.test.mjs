import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnRun, exitDescription } from "../companion/run-process.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "anvil-native-fixture-"));
process.env.ANVIL_INSTALL_DIR = path.join(root, "Anvil installation");
process.env.ANVIL_HOME = path.join(root, "compiler");
const { compileLang } = await import("../companion/compile-run.mjs");
const { resolveBin } = await import("../companion/toolchain.mjs");
const { runStatus, activeRunCount } = await import("../companion/run-jobs.mjs");
if (process.env.ANVIL_NATIVE_ZIG) {
  const python = resolveBin("python");
  assert.ok(python, "Python 3.12 fixture required");
  process.env.PATH = [path.dirname(process.env.ANVIL_NATIVE_ZIG), path.dirname(process.execPath), path.dirname(python), path.join(process.env.SystemRoot, "System32")].join(path.delimiter);
  assert.equal(resolveBin("cxx"), process.env.ANVIL_NATIVE_ZIG, "test must use Zig, not another system compiler");
}
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

function inside(actual, expected) {
  const relative = path.relative(expected, actual);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `${actual} must be inside ${expected}`);
}

test("silent failure, both output streams and timeout remain observable", async () => {
  const empty = await spawnRun(process.execPath, ["-e", "process.exit(7)"], root, 2000, process.env);
  assert.equal(empty.ok, false);
  assert.match(empty.stderr, /Exitcode 7/);
  const both = await spawnRun(process.execPath, ["-e", "console.log('before');console.error('failure');process.exit(3)"], root, 2000, process.env);
  assert.match(both.stdout, /before/);
  assert.match(both.stderr, /failure[\s\S]*Exitcode 3/);
  const timeout = await spawnRun(process.execPath, ["-e", "setInterval(()=>{},1000)"], root, 80, process.env);
  assert.equal(timeout.timedOut, true);
  assert.match(timeout.stderr, /Zeitlimit/);
  assert.match(exitDescription(-1073741515), /0xC0000135.*DLL/);
});

test("process cancellation terminates the run", async () => {
  const controller = new AbortController();
  const run = spawnRun(process.execPath, ["-e", "setInterval(()=>{},1000)"], root, 10000, process.env, { signal: controller.signal, onStart: () => controller.abort() });
  const result = await run;
  assert.equal(result.ok, false);
  assert.equal(result.aborted, true);
  assert.match(result.stderr, /abgebrochen/);
});

test("Python snapshot, temp files and logs live under the installation even with workspace cwd", { skip: !resolveBin("python") }, async () => {
  const cwd = path.join(root, "project"); mkdirSync(cwd);
  const body = { lang: "python", entry: "snake/snake.py", cwd, asTest: true, files: [{ path: "snake/snake.py", content: "import os, tempfile\nprint(__file__)\nprint(os.getcwd())\nprint(tempfile.gettempdir())\n" }] };
  const first = await compileLang(body);
  assert.equal(first.ok, true, first.stderr);
  inside(first.stage.out, process.env.ANVIL_INSTALL_DIR);
  assert.match(first.stdout, /Anvil installation/);
  assert.ok(first.stdout.includes(cwd));
  const record = runStatus(first.stage.id);
  assert.equal(record.ok, true);
  assert.ok(existsSync(path.join(path.dirname(first.stage.out), "run.log")));
  const second = await compileLang(body);
  assert.notEqual(second.stage.id, first.stage.id);
  assert.ok(existsSync(path.dirname(first.stage.out)), "previous build remains available");
});

test("selected C++ entry links C helper as C and excludes the other Snake main", { skip: !resolveBin("cxx"), timeout: 240000 }, async () => {
  const result = await compileLang({ lang: "cpp", entry: "snake/snake.cpp", timeoutMs: 120000, asTest: true, files: [
    { path: "snake/snake.cpp", content: '#include <cstdio>\nextern "C" int twice(int);\nint main(){ std::printf("answer=%d\\n", twice(21)); return 0; }\n' },
    { path: "snake/snake.c", content: "int main(void){ return 99; }\n" },
    { path: "snake/helper.c", content: "int twice(int value){ int new = value * 2; return new; }\n" },
  ] });
  assert.equal(result.ok, true, result.stderr + "\n" + result.stdout);
  assert.match(result.stdout, /answer=42/);
  assert.ok(!result.steps.some((s) => /snake\/snake\.c(?:\s|$)/.test(s.cmd)));
  inside(result.stage.out, process.env.ANVIL_INSTALL_DIR);
  assert.ok(existsSync(path.join(result.stage.out, "snake" + (process.platform === "win32" ? ".exe" : ""))));
});

test("late native window failure replaces the running status and keeps stderr", async () => {
  const result = await compileLang({ lang: "javascript", entry: "window.js", files: [{ path: "window.js", content: "// pygame: exercise native-window lifecycle\nsetTimeout(() => { console.error('late failure'); process.exit(9); }, 3200);" }] });
  assert.equal(result.running, true, result.stderr);
  assert.ok(activeRunCount() > 0);
  let final = result;
  for (let i = 0; i < 30 && final.running; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    final = runStatus(result.stage.id);
  }
  assert.equal(final.running, false);
  assert.equal(final.ok, false);
  assert.match(final.stderr, /late failure[\s\S]*Exitcode 9/);
  assert.equal(activeRunCount(), 0);
});

test("Windows terminal gives Python real input/output console handles", { skip: process.platform !== "win32" || !resolveBin("python"), timeout: 15000 }, async () => {
  const result = await compileLang({ lang: "python", entry: "terminal.py", files: [{ path: "terminal.py", content: "# input(): require interactive console\nimport sys, pathlib\npathlib.Path(__file__).with_suffix('.tty').write_text(str(sys.stdin.isatty()) + ',' + str(sys.stdout.isatty()))\n" }] });
  let final = result;
  for (let i = 0; i < 50 && final.running; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    final = runStatus(result.stage.id);
  }
  assert.equal(final.ok, true, final.stderr);
  const file = path.join(path.dirname(final.stage.out), "src", "terminal.tty");
  assert.equal(readFileSync(file, "utf8"), "True,True");
});

test("invalid cwd and oversized snapshots fail explicitly without a Temp fallback", async () => {
  const body = { lang: "python", entry: "x.py", cwd: "/not-authorized", files: [{ path: "x.py", content: "print(1)" }] };
  const result = await compileLang(body, { resolveCwd() { throw new Error("cwd rejected"); } });
  assert.equal(result.ok, false);
  assert.match(result.stderr, /cwd rejected/);
  assert.equal(result.stage, undefined);
  const large = await compileLang({ ...body, cwd: "", files: [...body.files, ...Array.from({ length: 400 }, (_, i) => ({ path: `f${i}.py`, content: "" }))] });
  assert.match(large.stderr, /mehr als 400/);
});
