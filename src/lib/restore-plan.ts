import type { Checkpoint } from "@/store/ide-types";

export type RestoreFile = { path: string; before: string | null; after: string | null };
export type RestorePlan = { files: RestoreFile[]; mkdir: string[]; rmdir: string[]; conflicts: string[] };
export type RestoreDiskPlan = { files: (RestoreFile & { expected: string | null })[]; mkdir: string[]; rmdir: string[] };

/** Only undo changes owned by this completed round, never a later workspace snapshot. */
export function checkpointRestorePlan(checkpoint: Checkpoint, files: Record<string, string>, dirs: string[]): RestorePlan {
  const plan: RestorePlan = { files: [], mkdir: [], rmdir: [], conflicts: [] };
  if (!checkpoint.endFiles || !checkpoint.endDirs) {
    plan.conflicts.push("Für diese alte Runde fehlt ein verlässlicher Endstand. Einzelne Änderungen im Diff prüfen.");
    return plan;
  }
  for (const path of new Set([...Object.keys(checkpoint.files), ...Object.keys(checkpoint.endFiles)])) {
    const original = checkpoint.files[path] ?? null, end = checkpoint.endFiles[path] ?? null, current = files[path] ?? null;
    if (original === end || current === original) continue;
    if (current !== end) { plan.conflicts.push(`${path}: nach der Runde bearbeitet`); continue; }
    plan.files.push({ path, before: current, after: original });
  }
  plan.mkdir = checkpoint.dirs.filter((p) => !checkpoint.endDirs!.includes(p) && !dirs.includes(p));
  // Removing directories is always non-recursive at the disk boundary.
  plan.rmdir = checkpoint.endDirs.filter((p) => !checkpoint.dirs.includes(p) && dirs.includes(p))
    .filter((p) => !Object.keys(files).some((f) => f.startsWith(`${p}/`) && !plan.files.some((x) => x.path === f && x.after === null)))
    .sort((a, b) => b.length - a.length);
  return plan;
}
