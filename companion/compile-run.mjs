import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveBin, toolEnv } from "./toolchain.mjs";
import { nativeCompileSteps, javaMainClass, isCargo, isCsproj, firstCsproj, looksGui, looksTerminal } from "./compile-plan.mjs";
import { createRunFolder, runEnvironment, saveRunRecord } from "./run-storage.mjs";
import { spawnRun, quoteCommand } from "./run-process.mjs";
import { terminalStep } from "./run-terminal.mjs";
import { beginRun, endRun } from "./run-jobs.mjs";

function safeRel(value) {
  const rel = String(value || "").replaceAll("\\", "/");
  if (!rel || path.isAbsolute(rel) || /[:]/.test(rel) || rel.split("/").some((p) => p === "..") || /[\x00-\x1f]/.test(rel)) throw new Error("Ungültiger Snapshot-Pfad: " + rel);
  return rel.replace(/^\.\//, "");
}

export async function compileLang(body, { resolveCwd = (cwd) => cwd, signal } = {}) {
  const started = Date.now();
  let folders;
  const phases = [];
  try {
    const lang = String(body.lang || "");
    const entry = safeRel(body.entry || "");
    if (/(^|\/)(\.anvil|\.git|ref|node_modules)\//i.test(entry) || !/\.(c|cpp|cc|cxx|py|js|mjs|cjs|ts|tsx|go|rs|java|cs|php|rb)$/i.test(entry) || /\.d\.ts$/i.test(entry)) throw new Error("Keine ausführbare Startdatei: " + entry);
    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length > 400) throw new Error("Run-Snapshot umfasst mehr als 400 Dateien.");
    if (!files.some((f) => safeRel(f.path) === entry)) throw new Error("Startdatei fehlt im Run-Snapshot: " + entry);
    const maxMs = (Number(process.env.ANVIL_COMPANION_TIMEOUT) || 600000);
    const timeoutMs = Math.min(maxMs, Math.max(1000, Number(body.timeoutMs) || 120000));
    const compileMs = Math.min(maxMs, Math.max(1000, Number(body.compileTimeoutMs) || 300000));
    const persistRoot = body.cwd ? resolveCwd(body.cwd) : "";
    folders = createRunFolder(entry, persistRoot);
    beginRun(folders.id);
    const workDir = folders.work, outDir = folders.out;
    const runCwd = persistRoot || workDir;
    const win = process.platform === "win32";
    const exe = () => path.join(outDir, folders.name + (win ? ".exe" : ""));
    const env = runEnvironment(folders, toolEnv());
    const entryFiles = files.filter((f) => safeRel(f.path) === entry);
    const gui = !body.asTest && looksGui(entryFiles);
    const interactive = !body.asTest && !gui && looksTerminal(entryFiles);
    const abs = (rel) => path.join(workDir, rel);
    for (const f of files) {
      const rel = safeRel(f.path);
      const full = abs(rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, String(f.content ?? ""), "utf8");
    }
    const need = (bin) => {
      const p = resolveBin(bin);
      if (!p) throw new Error(`${bin} nicht in Anvil. Compiler holen (Einstellungen → Companion).`);
      return p;
    };
    const steps = [];
    let projectBound = false;
    if (lang === "go") {
      const manifest = files.map((f) => f.path).filter((p) => /(^|\/)go\.mod$/.test(p) && entry.startsWith(path.posix.dirname(p) === "." ? "" : path.posix.dirname(p) + "/")).sort((a, b) => b.length - a.length)[0];
      if (!manifest) writeFileSync(path.join(workDir, "go.mod"), "module anvil\n\ngo 1.22\n");
      const project = manifest ? path.posix.dirname(manifest) : ".";
      const target = "./" + path.posix.relative(project, path.posix.dirname(entry));
      if (/_test\.go$/i.test(entry) || body.asTest) steps.push({ file: need("go"), args: ["test", "-v", target], cwd: abs(project) });
      else {
        steps.push({ file: need("go"), args: ["build", "-o", exe(), target], cwd: abs(project) });
        steps.push({ file: exe(), args: [] });
      }
    } else if (lang === "rust") {
      if (isCargo(files) || existsSync(path.join(workDir, "Cargo.toml"))) {
        projectBound = true;
        const testRs = /_test\.rs$/i.test(entry) || /(^|\/)tests\//i.test(entry);
        const manifest = files.map((f) => f.path).filter((p) => /(^|\/)Cargo\.toml$/.test(p) && entry.startsWith(path.posix.dirname(p) === "." ? "" : path.posix.dirname(p) + "/")).sort((a, b) => b.length - a.length)[0] || "Cargo.toml";
        steps.push({ file: need("cargo"), args: [...(testRs || body.asTest ? ["test"] : ["run", "--quiet"]), "--manifest-path", abs(manifest)] });
      } else {
        const out = exe("out");
        steps.push({ file: need("rustc"), args: [entry, "-o", out] });
        steps.push({ file: out, args: [] });
      }
    } else if (lang === "java") {
      const srcs = files.map((f) => safeRel(f.path)).filter((p) => p.endsWith(".java"));
      steps.push({ file: need("javac"), args: ["-d", outDir, ...(srcs.length ? srcs : [entry])] });
      const src = files.find((f) => safeRel(f.path) === entry);
      const cls = javaMainClass(entry, src?.content ?? "");
      steps.push({ file: need("java"), args: ["-cp", outDir, cls] });
    } else if (lang === "c" || lang === "cpp") {
      const bin = lang === "c" ? "cc" : "cxx";
      const compiler = resolveBin(bin);
      if (!compiler) throw new Error(`${lang === "c" ? "cc" : "c++"} nicht in Anvil. Zig/C holen.`);
      const out = exe("out");
      steps.push(...nativeCompileSteps(compiler, lang, entry, files, out));
      steps.push({ file: out, args: [] });
    } else if (lang === "php") {
      steps.push({ file: need("php"), args: [abs(entry)] });
    } else if (lang === "ruby") {
      steps.push({ file: need("ruby"), args: [abs(entry)] });
    } else if (lang === "python") {
      const py = resolveBin("python");
      if (!py) throw new Error("python nicht in Anvil. Python holen (Einstellungen → Companion).");
      if (/\b(?:import\s+curses|from\s+curses)\b/.test(files.find((f) => f.path === entry)?.content || "") && win) {
        steps.push({ file: py, args: ["-c", "try:\n import curses\nexcept ModuleNotFoundError as e:\n import sys\n print(str(e) + '\\nWindows-Python benötigt das Paket windows-curses. Mit diesem Python installieren: ' + sys.executable + ' -m pip install windows-curses', file=sys.stderr)\n sys.exit(1)"] });
      }
      steps.push({ file: py, args: ["-u", abs(entry)] });
    } else if (lang === "javascript" || lang === "typescript") {
      const node = resolveBin("node");
      if (!node) throw new Error("node nicht in Anvil. Node holen (Einstellungen → Companion).");
      if (lang === "typescript") {
        const tsc = resolveBin("tsc");
        if (tsc && path.resolve(tsc) !== path.resolve(node)) {
          const tscJs = path.join(path.dirname(tsc), "node_modules", "typescript", "bin", "tsc");
          if (/\.cmd$/i.test(tsc) && !existsSync(tscJs)) throw new Error("TypeScript-Compiler fehlt. TypeScript im Node-Compiler installieren.");
          steps.push({ file: /\.cmd$/i.test(tsc) ? node : tsc, args: [...(/\.cmd$/i.test(tsc) ? [tscJs] : []), "--outDir", outDir, "--rootDir", workDir, "--esModuleInterop", "--module", "commonjs", "--skipLibCheck", entry] });
          steps.push({ file: node, args: [path.join(outDir, entry.replace(/\.tsx?$/i, ".js"))] });
        } else {
          steps.push({ file: node, args: ["--experimental-strip-types", abs(entry)] });
        }
      } else {
        steps.push({ file: node, args: [abs(entry)] });
      }
    } else if (lang === "csharp") {
      projectBound = true;
      const testCs = /Tests?\.cs$/i.test(entry) || /(^|\/)tests?\//i.test(entry);
      if (!isCsproj(files)) {
        const csproj = testCs
          ? `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" /><PackageReference Include="xunit" Version="2.9.2" /><PackageReference Include="xunit.runner.visualstudio" Version="2.8.2" /></ItemGroup></Project>`
          : `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>`;
        writeFileSync(path.join(workDir, "app.csproj"), csproj);
      }
      const proj = firstCsproj(files);
      const args = testCs
        ? proj
          ? ["test", "--nologo", "-v", "n", "--project", proj]
          : ["test", "--nologo", "-v", "n"]
        : proj
          ? ["run", "--nologo", "-v", "q", "--project", proj]
          : ["run", "--nologo", "-v", "q"];
      steps.push({ file: need("dotnet"), args });
    } else {
      throw new Error("Sprache nicht lokal: " + lang);
    }
    let last = { ok: false, code: 1, stdout: "", stderr: "", duration: 0 };
    let cmd = "";
    let published;
    const pack = (last) => ({ ...last, duration: Date.now() - started,
      cmd: phases.map((p) => p.cmd).join(" && "),
      stdout: phases.map((p) => `— ${p.phase === "compile" ? "Compile" : "Run"} —\n${[p.cmd, p.stdout].filter(Boolean).join("\n")}`).join("\n\n"),
      stderr: phases.map((p) => p.stderr).filter(Boolean).join("\n\n"), steps: phases,
      stage: { kind: last.running ? "window" : "log", out: outDir, id: folders.id },
    });
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      cmd = quoteCommand(s.file, s.args);
      const isRun = i === steps.length - 1;
      const cwd = s.cwd || (isRun && !projectBound ? runCwd : workDir);
      const phase = i < steps.length - 1 ? "compile" : "run";
      const runStep = isRun && interactive ? terminalStep(s, cwd, env, folders) : s;
      last = await spawnRun(runStep.file, runStep.args, cwd, isRun ? timeoutMs : compileMs, runStep.env || env, {
        signal,
        stdoutFile: path.join(folders.dir, `${i}-stdout.log`),
        stderrFile: path.join(folders.dir, `${i}-stderr.log`),
        show: isRun && (gui || interactive),
        detach: isRun && (gui || interactive),
        onExit: (exit) => {
          if (!published) return;
          endRun(folders.id);
          phases[i] = { phase, cmd, ok: exit.ok, code: exit.code, signal: exit.signal, stdout: exit.stdout || "", stderr: exit.stderr || "" };
          try { saveRunRecord(folders, pack(exit)); } catch { /* The phase logs remain on disk. */ }
        },
      });
      last.cmd = cmd;
      phases.push({ phase, cmd, ok: last.ok, code: last.code, signal: last.signal, stdout: last.stdout || "", stderr: last.stderr || "" });
      if (!last.ok) break;
    }
    const result = pack(last);
    if (last.running) published = result;
    else endRun(folders.id);
    saveRunRecord(folders, result);
    return result;
  } catch (err) {
    if (folders) endRun(folders.id);
    const result = {
      ok: false,
      code: 1,
      stdout: phases.map((p) => [p.cmd, p.stdout].filter(Boolean).join("\n")).join("\n\n"),
      stderr: err instanceof Error ? err.message : String(err),
      duration: Date.now() - started,
      cmd: String(body.lang || ""),
      ...(folders ? { stage: { kind: "log", out: folders.out, id: folders.id } } : {}),
    };
    if (folders) { try { saveRunRecord(folders, result); } catch { /* Return original failure. */ } }
    return result;
  }
}
