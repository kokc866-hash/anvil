export type Verification = { state: "none" | "passed" | "failed" | "stale"; detail: string };

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
    if (name === "shell" && !/(?:^|[\s/\\])(?:pytest|tsc|javac|gcc|clang|cargo|go|dotnet|zig|python\d*|node|npm|npx|pnpm|yarn)(?:\s|$)/i.test(String(args.command ?? ""))) return;
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
