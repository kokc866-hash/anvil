export type Verification = { state: "none" | "passed" | "failed" | "stale"; detail: string };

function executesProject(command: string): boolean {
  const first = /^\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))\s*([\s\S]*)$/.exec(command);
  if (!first) return false;
  const program = (first[1] || first[2] || first[3]).split(/[/\\]/).pop()!.replace(/\.exe$/i, "");
  const args = first[4].trim();
  if (!/^(pytest|tsc|javac|gcc|clang|cargo|go|dotnet|zig|python\d*(?:\.\d+)?|node|npm|npx|pnpm|yarn)$/i.test(program)) return false;
  if (!args) return /^(pytest|tsc)$/i.test(program);
  if (/(?:^|\s)(?:--version|-version|--help|--showConfig|-V{1,2}|-h)(?:\s|$)/.test(args)) return false;
  if (/^(node|python\d*(?:\.\d+)?|npm|npx|pnpm|yarn)$/i.test(program) && /(?:^|\s)-v(?:\s|$)/.test(args)) return false;
  if (/^(npm|pnpm|yarn)$/i.test(program)) return /^(?:run(?:-script)?|test|exec|build)\b/.test(args);
  if (/^(cargo|go|dotnet|zig)$/i.test(program)) return /^(?:test|build|run|check|clippy|cc|c\+\+)(?:\s|$)/.test(args);
  return true;
}

export function automaticRunVerification(previous: Verification | undefined, ok: boolean, current: boolean): Verification {
  const run: Verification = !ok
    ? { state: "failed", detail: "Automatischer Run nach der letzten Änderung fehlgeschlagen." }
    : !current
      ? { state: "stale", detail: "Dateien während des automatischen Runs geändert. Aktueller Stand noch nicht bestätigt." }
      : { state: "passed", detail: "Automatischer Run nach der letzten Änderung erfolgreich." };
  if (previous?.state === "failed") return { state: "failed", detail: `${previous.detail}\n${run.detail}` };
  return run;
}

/** Only a successful execution of the same target can replace its failure. Edits invalidate prior runs. */
export class AgentEvidence {
  revision = 0;
  private writes = new Map<string, string>();
  private runs = new Map<string, { revision: number; ok: boolean; detail: string }>();
  changed() { this.revision++; }
  record(name: string, args: Record<string, unknown>, result: Record<string, unknown>) {
    if (/^(write_file|edit_file|append_file|delete_file|rename_file|mkdir)$/.test(name)) {
      const path = String(args.path ?? args.from ?? name);
      if (result.error || result.ok === false || result.isError) this.writes.set(path, `${path}: ${String(result.error || "Dateiänderung fehlgeschlagen").slice(0, 1000)}`);
      else this.writes.delete(path);
    }
    if (!/^(run_file|engine_run|shell)$/.test(name)) return;
    if (name === "shell" && !executesProject(String(args.command ?? ""))) return;
    const target = String(args.path ?? args.command ?? args.project ?? name);
    this.runs.set(`${name}:${target}`, { revision: this.revision, ok: result.ok === true && !result.error && !result.isError, detail: `${target}: ${String(result.error || result.stderr || (result.ok === true ? "Run erfolgreich" : "Run nicht erfolgreich bestätigt")).slice(0, 1000)}` });
  }
  status(): Verification {
    if (this.writes.size) return { state: "failed", detail: [...this.writes.values()].join("\n") };
    const runs = [...this.runs.values()];
    const failed = runs.filter((r) => !r.ok);
    if (failed.length) return { state: "failed", detail: failed.map((r) => r.detail).join("\n") };
    if (!runs.length) return { state: "none", detail: "Kein bestätigter Run." };
    if (runs.some((r) => r.revision !== this.revision)) return { state: "stale", detail: "Dateien nach dem letzten Run geändert. Aktueller Stand noch nicht durch Run bestätigt." };
    return { state: "passed", detail: "Run für den aktuellen Dateistand erfolgreich." };
  }
}
