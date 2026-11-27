import { runFile } from "./run-client";
import { runAllTests, runTestFiles, runNodeTestFiles, testFilesOf } from "./run-tests";
import { parseTestCommand } from "./test-parse";
import type { AgentRun } from "./agent-run";

const RUN_CMD = /^(python3?|py|node|bun|deno|php|ruby|go\s+run)\s+(\S+)/i;

export { parseTestCommand } from "./test-parse";

export async function runAgentShell(
  command: string,
  files: Record<string, string>,
  scope?: AgentRun,
): Promise<{ ok: boolean; stdout: string; stderr: string; command?: string }> {
  const cmd = command.trim();
  scope?.assertCurrent();
  if (!cmd) return { ok: false, stdout: "", stderr: "Leerer Befehl" };

  const test = parseTestCommand(cmd);
  if (test) {
    if (test.node) {
      if (test.paths.some(path => !Object.hasOwn(files, path))) return { ok: false, stdout: "", stderr: "Node-Testdatei fehlt im aktuellen Dateistand.", command: cmd };
      const result = await runNodeTestFiles(test.paths, files, scope);
      scope?.assertCurrent();
      return { ok: result.ok, stdout: result.stdout, stderr: result.stderr, command: cmd };
    }
    const known = test.paths.filter(
      (p) => p in files || testFilesOf(files).some((f) => f === p || f.startsWith(`${p.replace(/\/$/, "")}/`)),
    );
    const r = test.paths.length
      ? await runTestFiles(known.length ? known : test.paths, test.filter, scope, { files })
      : await runAllTests(test.filter, scope, files);
    scope?.assertCurrent();
    return { ok: r.ok, stdout: r.stdout, stderr: r.stderr, command: cmd };
  }
  if (/^node\s+--test(?:\s|$)/.test(cmd)) return { ok: false, stdout: "", stderr: "Node-Tests benötigen ausdrückliche relative .js-, .mjs- oder .cjs-Dateien aus dem Projekt. Zusätzliche Node-Optionen sind hier nicht freigegeben.", command: cmd };

  const run = cmd.match(RUN_CMD);
  if (run) {
    const path = run[2].replace(/^\.\//, "");
    if (!files[path]) return { ok: false, stdout: "", stderr: `Datei nicht gefunden: ${path}`, command: cmd };
    const r = await runFile(path, files, { run: scope });
    scope?.assertCurrent();
    return { ok: r.ok, stdout: r.stdout, stderr: r.stderr, command: cmd };
  }

  return {
    ok: false,
    stdout: "",
    stderr:
      "Nur: python/node/php/ruby/go run <datei>, node --test <testdatei>, npm test, pytest, pytest -q, python -m pytest, go test, cargo test, dotnet test. Kein freies System-Terminal.",
    command: cmd,
  };
}
