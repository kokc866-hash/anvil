import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useIde } from "@/store/ide";
import { hydrateLearnFromFiles, openSkillLibrary } from "@/lib/learn";
import { diskWorkspaceHandle } from "@/lib/disk";
import { companionPing, type CompanionInfo } from "@/lib/companion";
import { projectReadiness } from "@/lib/project-readiness";
import { planSkillPackage, planWebTaskPackage, SKILL_PACKAGE_MAX_BYTES, SKILL_PACKAGE_MAX_FILES } from "@/lib/skill-package";
import { saveNow } from "@/lib/save";
import { bytesToDataUrl } from "@/lib/archive";

export function TaskPackages() {
  const files = useIde(s => s.files);
  const cwd = useIde(s => s.workspaceCwd);
  const model = useIde(s => s.llmModel);
  const agentBusy = useIde(s => s.agentBusy);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [runtime, setRuntime] = useState<{ base: string; info: CompanionInfo }>();
  const base = useIde(s => s.companionUrl);
  const readiness = projectReadiness({ files, saved: Boolean(cwd || diskWorkspaceHandle()), model, bins: runtime?.base === base ? runtime.info.bins : undefined, runtimeError: runtime?.base === base && !runtime.info.ok ? runtime.info.error || "Der Companion ist nicht erreichbar. Prüfe die Verbindung unter Einstellungen → Companion." : undefined });

  async function install(make: () => { files: Record<string, string>; main: string }, epoch: number) {
    if (useIde.getState().workspaceEpoch !== epoch) throw new Error("Das Projekt wurde inzwischen gewechselt. Starte den Import erneut.");
    const st = useIde.getState();
    if (st.agentBusy || st.pathOperation) throw new Error("Warte, bis die laufende Projektänderung abgeschlossen ist.");
    const pack = make();
    for (const [path, content] of Object.entries(pack.files)) st.writeFile(path, content, { quiet: true });
    hydrateLearnFromFiles(useIde.getState().files, Object.keys(pack.files));
    st.openFile(pack.main);
    let saved = true;
    for (const path of Object.keys(pack.files)) {
      if (useIde.getState().workspaceEpoch !== epoch) { saved = false; break; }
      if (!(await saveNow({ path, format: false }))) { saved = false; break; }
    }
    setMessage(saved ? "Paket ergänzt und gespeichert. Anleitungen und Dateien sind bereit; kein Skript oder Modell wurde ausgeführt." : "Das Paket wurde im Projekt ergänzt, aber noch nicht gespeichert. Beachte den Hinweis unten in Anvil.");
  }

  async function addWeb() {
    setBusy(true); setMessage("");
    try { await install(() => planWebTaskPackage(useIde.getState().files, useIde.getState().dirs), useIde.getState().workspaceEpoch); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function importFolder(selected: File[]) {
    const epoch = useIde.getState().workspaceEpoch;
    setBusy(true); setMessage("");
    try {
      if (selected.length > SKILL_PACKAGE_MAX_FILES || selected.reduce((n, file) => n + file.size, 0) > SKILL_PACKAGE_MAX_BYTES) throw new Error("Höchstens 100 Dateien und 8 MB pro Skill-Paket.");
      const values: Record<string, string> = {};
      for (const file of selected) {
        const path = file.webkitRelativePath || file.name;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const textLike = /\.(md|txt|json|ya?ml|[cm]?js|jsx|ts|tsx|py|sh|bat|ps1|css|html?|xml|svg|csv|toml|ini|cfg)$/i.test(path);
        values[path] = textLike ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : bytesToDataUrl(bytes, file.type || "application/octet-stream");
      }
      await install(() => planSkillPackage(values, useIde.getState().files, useIde.getState().dirs), epoch);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }

  return <section className="space-y-3 border-b border-border p-3" data-testid="task-packages">
    <h3 className="text-sm font-semibold">Aufgabenpakete & Skills</h3>
    <p className="text-xs text-muted">Vorlage für eine kleine Webanwendung mit Arbeitsanleitung und Prüfkriterien. Zum Hinzufügen sind keine Downloads und kein Modellzugang erforderlich.</p>
    <div className="flex flex-wrap gap-2"><Button className="h-auto max-w-full whitespace-normal" variant="primary" disabled={busy || agentBusy} onClick={() => void addWeb()}>Web-Aufgabenpaket ergänzen</Button><Button className="h-auto max-w-full whitespace-normal" variant="ghost" disabled={busy || agentBusy} onClick={() => input.current?.click()}>Skill-Ordner importieren</Button></div>
    <input ref={input} type="file" multiple className="hidden" aria-label="Skill-Ordner importieren" {...{ webkitdirectory: "" }} onChange={event => { const selected = Array.from(event.target.files || []); if (selected.length) void importFolder(selected); }} />
    <p className="text-[11px] text-muted">Ein Ordner mit SKILL.md und zugehörigen Dateien. Skripte werden beim Import gespeichert und nicht ausgeführt. Prüfe fremde Anleitungen vor der Nutzung. Bestehende Pakete werden nicht überschrieben.</p>
    <Button variant="quiet" onClick={openSkillLibrary}>Installierte Skills verwalten</Button>
    <details className="rounded border border-border p-2" open><summary className="cursor-pointer text-xs font-medium">Projekt startklar?</summary><ul className="mt-2 space-y-2 text-xs">{readiness.map(row => <li key={row.id}><span className={row.status === "missing" ? "text-red-400" : "font-medium"}>{row.label}: {row.status === "ready" ? "vorhanden" : row.status === "missing" ? "fehlt" : row.status === "optional" ? "optional" : "offen"}</span><p className="text-muted">{row.detail}</p></li>)}</ul><Button className="mt-2" variant="ghost" disabled={busy} onClick={async () => { setBusy(true); try { const info = await companionPing(base); setRuntime({ base, info }); } catch (error) { setRuntime({ base, info: { ok: false, error: String(error) } }); } finally { setBusy(false); } }}>Voraussetzungen prüfen</Button><p className="mt-1 text-[11px] text-muted">Prüft vorhandene Laufzeiten über den eingestellten Companion. Keine Installation, kein Modellaufruf.</p></details>
    {message && <p role="status" className="break-words text-xs">{message}</p>}
  </section>;
}
