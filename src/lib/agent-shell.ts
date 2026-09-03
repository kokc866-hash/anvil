import { runFile } from "./run-client";
import { runAllTests } from "./run-tests";

const TEST_CMD = /^(npm test|npx vitest|pytest|go test|cargo test|dotnet test)$/i;
const RUN_CMD = /^(python3?|py|node|bun|deno|php|ruby|go\s+run)\s+(\S+)/i;

export async function runAgentShell(
  command: string,
  files: Record<string, string>,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const cmd = command.trim();
  if (!cmd) return { ok: false, stdout: "", stderr: "Leerer Befehl" };

  if (TEST_CMD.test(cmd)) {
    const r = await runAllTests();
    return { ok: r.ok, stdout: r.stdout, stderr: r.stderr };
  }

  const run = cmd.match(RUN_CMD);
  if (run) {
    const path = run[2].replace(/^\.\//, "");
    if (!files[path]) return { ok: false, stdout: "", stderr: `Datei nicht gefunden: ${path}` };
    const r = await runFile(path, files);
    return { ok: r.ok, stdout: r.stdout, stderr: r.stderr };
  }

  return {
    ok: false,
    stdout: "",
    stderr:
      "Nur: python/node/php/ruby/go run <datei>, npm test, pytest, go test, cargo test, dotnet test. Kein freies System-Terminal.",
  };
}
