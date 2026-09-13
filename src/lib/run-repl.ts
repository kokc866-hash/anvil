import { evalSnippet } from "./run-client";
import { parseTestCommand, runAgentShell } from "./agent-shell";
import { useIde } from "@/store/ide";

/** Execute console input against the project captured at submission. */
export async function runReplCommand(code: string, showTab: (tab: "test" | "out") => void): Promise<void> {
  const initial = useIde.getState();
  const current = () => useIde.getState().workspaceEpoch === initial.workspaceEpoch;
  if (parseTestCommand(code)) {
    showTab("test");
    const r = await runAgentShell(code, initial.files);
    if (current() && !r.ok && r.stderr) {
      initial.pushOutput({ ok: false, stdout: r.stdout, stderr: r.stderr, duration: 0, label: "tests" });
    }
    return;
  }
  showTab("out");
  if (/^(python3?|py|node|bun|deno)\s+\S+/i.test(code)) {
    const r = await runAgentShell(code, initial.files);
    if (current()) initial.pushOutput({ ok: r.ok, stdout: r.stdout, stderr: r.stderr, duration: 0, label: code });
    return;
  }
  const result = await evalSnippet(code, initial.files, initial.activePath ?? "repl.js");
  if (current()) initial.pushOutput(result);
}
