import { useIde } from "@/store/ide";
import { checkpointRestorePlan } from "./restore-plan";
import { confirmApp } from "./confirm";
import { previewProjectRestore, projectEditorRestorePlan } from "./project-checkpoints";

/** Every destructive entry point shows the same exact files before executing. */
export async function requestCheckpointRestore(id: string): Promise<boolean> {
  const state = useIde.getState(), ck = state.checkpoints.find((c) => c.id === id), en = state.locale === "en";
  if (!ck) { state.setNotice(en ? "No saved round found." : "Kein gesicherter Rundenstand vorhanden."); return false; }
  const plan = ck.disk ? projectEditorRestorePlan(ck, state.files, state.dirs) : checkpointRestorePlan(ck, state.files, state.dirs);
  if (plan.conflicts.length) { state.setNotice(plan.conflicts.join("; ")); return false; }
  let disk;
  try { disk = await previewProjectRestore(id); }
  catch (error) { state.setNotice(error instanceof Error ? error.message : String(error)); return false; }
  if (disk?.conflicts.length) { state.setNotice(disk.conflicts.join("; ")); return false; }
  const rows = [...new Set([...plan.files.map((f) => `${f.after === null ? (en ? "Delete" : "Löschen") : (en ? "Restore" : "Wiederherstellen")}: ${f.path}`), ...(disk?.files ?? []).map((f) => `${f.action === "delete" ? (en ? "Delete" : "Löschen") : (en ? "Restore" : "Wiederherstellen")}: ${f.path}`), ...[...plan.mkdir, ...disk?.mkdir ?? []].map((p) => `+ ${p}/`), ...[...plan.rmdir, ...disk?.rmdir ?? []].map((p) => `${en ? "Remove only if empty" : "Nur leer entfernen"}: ${p}/`)])];
  const scope = disk
    ? (en ? "Includes project files and binary assets on disk. " : "Erfasst Projektdateien und Binärdateien auf der Platte. ")
    : (en ? "Only loaded project files were captured for this round. " : "Für diese Runde sind nur geladene Projektdateien gesichert. ");
  const limits = en ? "External service actions and running databases are not reversed.\n\n" : "Externe Dienstaktionen und laufende Datenbanken werden nicht zurückgenommen.\n\n";
  const exclusions = disk?.excluded.length ? `\n\n${en ? "Excluded" : "Ausgenommen"}:\n${disk.excluded.join("\n")}` : "";
  const external = ck.externalCalls?.length ? `\n\n${en ? "Recorded external tool calls (not reversed)" : "Protokollierte externe Werkzeugaufrufe (werden nicht zurückgenommen)"}:\n${ck.externalCalls.map((c) => `${c.server}: ${c.name}${c.ok ? "" : (en ? " (failed/uncertain)" : " (fehlgeschlagen/unklar)")}`).join("\n")}` : "";
  const body = (en ? "These changes will be saved immediately. Later changes are protected.\n\n" : "Diese Änderungen werden sofort gespeichert. Spätere Bearbeitungen sind geschützt.\n\n") + scope + limits + (rows.join("\n") || (en ? "Already restored." : "Bereits zurückgenommen.")) + exclusions + external;
  if (!await confirmApp(body, { title: en ? "Restore round" : "Runde zurücknehmen", ok: en ? "Restore and save" : "Zurücknehmen und speichern", danger: true })) return false;
  return useIde.getState().restoreCheckpoint(id);
}
