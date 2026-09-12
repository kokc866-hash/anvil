import { useIde } from "@/store/ide";
import { checkpointRestorePlan } from "./restore-plan";
import { confirmApp } from "./confirm";

/** Every destructive entry point shows the same exact files before executing. */
export async function requestCheckpointRestore(id: string): Promise<boolean> {
  const state = useIde.getState(), ck = state.checkpoints.find((c) => c.id === id), en = state.locale === "en";
  if (!ck) { state.setNotice(en ? "No saved round found." : "Kein gesicherter Rundenstand vorhanden."); return false; }
  const plan = checkpointRestorePlan(ck, state.files, state.dirs);
  if (plan.conflicts.length) { state.setNotice(plan.conflicts.join("; ")); return false; }
  const rows = [...plan.files.map((f) => `${f.after === null ? (en ? "Delete" : "Löschen") : (en ? "Restore" : "Wiederherstellen")}: ${f.path}`), ...plan.mkdir.map((p) => `+ ${p}/`), ...plan.rmdir.map((p) => `${en ? "Remove only if empty" : "Nur leer entfernen"}: ${p}/`)];
  const body = (en ? "These changes will be saved immediately. Later changes are protected.\n\n" : "Diese Änderungen werden sofort gespeichert. Spätere Bearbeitungen sind geschützt.\n\n") + (rows.join("\n") || (en ? "Already restored." : "Bereits zurückgenommen."));
  if (!await confirmApp(body, { title: en ? "Restore round" : "Runde zurücknehmen", ok: en ? "Restore and save" : "Zurücknehmen und speichern", danger: true })) return false;
  return useIde.getState().restoreCheckpoint(id);
}
