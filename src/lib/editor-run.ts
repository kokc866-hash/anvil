import { useIde } from "@/store/ide";
import { runFile } from "./run-client";
import { selectRunTarget } from "./run-target";
import { emitPlugin } from "./plugins/events";
let active = false;
let completion: Promise<void> = Promise.resolve();
/** Buttons, hotkeys and Live Run share one owner of the execution state. */
export async function runFromEditor(path = useIde.getState().activePath, options: { live?: boolean; current?: () => boolean } = {}): Promise<void> {
  const st = useIde.getState();
  if (active && options.live) {
    await completion;
    if (st.workspaceEpoch === useIde.getState().workspaceEpoch && (!options.current || options.current())) return runFromEditor(path, options);
    return;
  }
  if (active || st.running || st.agentBusy || !path) return;
  const target = options.live ? path : selectRunTarget(Object.keys(st.files), path);
  if (!target) { st.setNotice("Keine ausführbare Startdatei im Projekt gefunden."); return; }
  let complete!: () => void;
  completion = new Promise<void>((resolve) => { complete = resolve; });
  active = true; st.setRunning(true); st.setRunPath(target);
  const current = () => st.workspaceEpoch === useIde.getState().workspaceEpoch && (!options.current || options.current());
  try {
    const result = await runFile(target, st.files);
    if (!current()) return;
    st.pushOutput(result); emitPlugin("run", target);
    if (!options.live && result.stage?.kind !== "html" && !result.html) { st.revealOutput(); st.setPreviewOpen(false); }
  } catch (error) {
    if (current()) st.pushOutput({ ok: false, stdout: "", stderr: error instanceof Error ? error.message : String(error), duration: 0, label: target });
  } finally { active = false; if (!useIde.getState().agentBusy) st.setRunning(false); complete(); }
}
