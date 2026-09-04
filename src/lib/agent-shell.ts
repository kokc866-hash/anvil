import { runFile } from "./run-client";
import { runAllTests, runTestFiles, testFilesOf } from "./run-tests";
import { parseTestCommand } from "./test-parse";

const RUN_CMD = /^(python3?|py|node|bun|deno|php|ruby|go\s+run)\s+(\S+)/i;

export { parseTestCommand } from "./test-parse";

export async function runAgentShell(
  command: string,
  files: Record<string, string>,
): Promise<{ ok: boolean; stdout: string; stderr: string; command?: string }> {
  const cmd = command.trim();
  if (!cmd) return { ok: false, stdout: "", stderr: "Leerer Befehl" };

  const test = parseTestCommand(cmd);
  if (test) {
    const known = test.paths.filter(
      (p) => p in files || testFilesOf(files).some((f) => f === p || f.startsWith(`${p.replace(/\/$/, "")}/`)),
    );
    const r = test.paths.length
      ? await runTestFiles(known.length ? known : test.paths, test.filter)
      : await runAllTests(test.filter);
    return { ok: r.ok, stdout: r.stdout, stderr: r.stderr, command: cmd };
  }

  const run = cmd.match(RUN_CMD);
  if (run) {
    const path = run[2].replace(/^\.\//, "");
    if (!files[path]) return { ok: false, stdout: "", stderr: `Datei nicht gefunden: ${path}`, command: cmd };
    const r = await runFile(path, files);
    return { ok: r.ok, stdout: r.stdout, stderr: r.stderr, command: cmd };
  }

  return {
    ok: false,
    stdout: "",
    stderr:
      "Nur: python/node/php/ruby/go run <datei>, npm test, pytest, pytest -q, python -m pytest, go test, cargo test, dotnet test. Kein freies System-Terminal.",
    command: cmd,
  };
}
