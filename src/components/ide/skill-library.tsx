import { useMemo, useState, useSyncExternalStore } from "react";
import { BookOpen, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIde } from "@/store/ide";
import { useLearn, workspaceId, skillEnvironment, visibleSkills } from "@/lib/learn";
import { ANVIL_SKILLS, builtinSkill, selectTaskSkills, skillRequirements, skillPackage, projectSkillPackage, type SkillSelection } from "@/lib/skill-library";
import { skillPackageZip, planSkillPackage } from "@/lib/skill-package";
import { downloadBlob } from "@/lib/archive";
import { hydrateLearnFromFiles } from "@/lib/learn";
import { saveNow } from "@/lib/save";
import { mcpSubscribe, mcpRevision } from "@/lib/mcp";

export function SkillLibrary({ query = "" }: { query?: string }) {
  const skills = useLearn(state => state.skills);
  const prefs = useLearn(state => state.prefs);
  const disabled = useLearn(state => state.disabledSkills);
  const pinned = useLearn(state => state.pinnedSkills);
  const setPref = useLearn(state => state.setPref);
  const en = useIde(state => state.locale === "en");
  const files = useIde(state => state.files);
  const dirs = useIde(state => state.dirs);
  const servers = useIde(state => state.mcpServers);
  const mode = useIde(state => state.agentMode);
  const surface = useIde(state => state.activeSurfaceId);
  const surfaceMode = useIde(state => state.surfaceMode);
  const cwd = useIde(state => state.workspaceCwd);
  const memoryId = useIde(state => state.workspaceMemoryId);
  const agentBusy = useIde(state => state.agentBusy || Boolean(state.pathOperation));
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState("");
  const [sample, setSample] = useState("");
  const ws = workspaceId(), pins = (pinned[ws] || []).filter(id => skills.some(skill => skill.id === id));
  const catalogRevision = useSyncExternalStore(mcpSubscribe, mcpRevision, mcpRevision);
  // skillEnvironment reads both stores; these dependencies invalidate that snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const environment = useMemo(() => skillEnvironment(), [files, dirs, servers, mode, surface, surfaceMode, cwd, memoryId, catalogRevision]);
  const available = visibleSkills();
  const preview = prefs.skills && prefs.skillBodies ? selectTaskSkills(sample, available, environment, { automatic: prefs.skillAuto, pinned: pins, limit: Math.min(2, prefs.skillLimit) }) : [];
  const shown = skills.filter(skill => (skill.scope !== "project" || skill.ws === ws) && `${builtinSkill(skill.id)?.title || skill.name} ${builtinSkill(skill.id)?.titleEn || ""} ${skill.when}`.toLowerCase().includes(query.toLowerCase()));
  const categories = [...new Set(ANVIL_SKILLS.map(skill => skill.category)), "custom"];

  async function copyToProject(id: string) {
    const before = useIde.getState();
    setCopying(true); setNotice("");
    try {
      const values = projectSkillPackage(id);
      const pack = planSkillPackage(Object.fromEntries(Object.entries(values).map(([path, body]) => [`${id}-projekt/${path}`, body])), before.files, before.dirs);
      if (before.workspaceEpoch !== useIde.getState().workspaceEpoch || useIde.getState().agentBusy) throw Error(en ? "Project changed; try copying again." : "Projekt geändert. Bitte erneut kopieren.");
      for (const [path, content] of Object.entries(pack.files)) before.writeFile(path, content, { quiet: true });
      hydrateLearnFromFiles(useIde.getState().files, Object.keys(pack.files));
      before.openFile(pack.main);
      let saved = true;
      for (const path of Object.keys(pack.files)) {
        if (before.workspaceEpoch !== useIde.getState().workspaceEpoch || !await saveNow({ path, format: false })) { saved = false; break; }
      }
      setNotice(saved ? (en ? "Editable project copy saved. The bundled skill remains unchanged." : "Bearbeitbare Projektkopie gespeichert. Der vorinstallierte Skill bleibt erhalten.") : (en ? "Project copy created; some files have not been saved yet." : "Projektkopie erstellt; einige Dateien sind noch nicht gespeichert."));
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setCopying(false); }
  }

  return <section className="space-y-3 px-1 py-2" data-testid="skill-library">
    <div><h3 className="text-sm font-semibold">{en ? "Anvil skill library" : "Anvil-Skill-Bibliothek"}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">{en ? "Bundled instructions for specific work. Skills work independently of personal memory and use the tools you have enabled." : "Vorinstallierte Arbeitsanleitungen für konkrete Aufgaben. Skills funktionieren unabhängig vom persönlichen Gedächtnis und nutzen die Werkzeuge, die du freigegeben hast."}</p></div>
    <div className="space-y-2 rounded-md border border-border p-2 text-xs">
      <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.skills} disabled={agentBusy} onChange={event => setPref("skills", event.target.checked)} />{en ? "Use skills" : "Skills verwenden"}</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.skillAuto} disabled={agentBusy} onChange={event => setPref("skillAuto", event.target.checked)} />{en ? "Automatically select matching skills" : "Passende Skills automatisch auswählen"}</label>
      {!prefs.skillBodies ? <div className="text-[11px] leading-relaxed"><p>{en ? "Only the skill catalog is enabled. Instruction text cannot be loaded yet." : "Nur der Skill-Katalog ist freigegeben. Die Anleitungstexte können noch nicht geladen werden."}</p><Button variant="quiet" disabled={agentBusy} onClick={() => setPref("skillBodies", true)}>{en ? "Enable instruction text" : "Anleitungstexte freigeben"}</Button></div> : null}
      <p className="text-[11px] leading-relaxed text-muted">{en ? "At most two matching instructions are included per task. Pin a skill for this project or invoke it explicitly with $skill-name. References are read only when needed." : "Pro Auftrag werden höchstens zwei passende Anleitungen mitgesendet. Du kannst Skills für dieses Projekt anheften oder mit $skill-name ausdrücklich aufrufen. Referenzen werden erst bei Bedarf gelesen."}</p>
    </div>
    <details className="rounded-md border border-border p-2"><summary className="cursor-pointer text-xs font-medium">{en ? "Preview skill selection" : "Skill-Auswahl ausprobieren"}</summary>
      <p className="my-2 text-[11px] text-muted">{en ? "Enter a task to see its matches. No model call or project change." : "Gib einen Auftrag ein, um passende Skills zu sehen. Dabei wird kein Modell aufgerufen und keine Projektdatei geändert."}</p>
      <textarea aria-label={en ? "Task for skill preview" : "Auftrag für Skill-Vorschau"} value={sample} onChange={event => setSample(event.target.value)} className="min-h-16 w-full rounded border border-border bg-bg p-2 text-xs" />
      <SelectionList entries={preview} en={en} />
      {sample && !preview.length ? <p className="mt-2 text-[11px] text-muted">{!prefs.skills ? (en ? "Skills are switched off." : "Skills sind ausgeschaltet.") : !prefs.skillBodies ? (en ? "Instruction text is switched off." : "Anleitungstexte sind ausgeschaltet.") : (en ? "No skill matches this task." : "Für diesen Auftrag wurde kein passender Skill gefunden.")}</p> : null}
    </details>
    {categories.map(category => {
      const definition = ANVIL_SKILLS.find(skill => skill.category === category);
      const rows = shown.filter(skill => (builtinSkill(skill.id)?.category || "custom") === category);
      if (!rows.length) return null;
      return <details key={category} open={Boolean(query) || category === "development"} className="rounded-md border border-border" data-testid={`skill-group-${category}`}>
        <summary className="cursor-pointer px-2 py-2 text-xs font-medium">{definition ? en ? definition.categoryLabelEn : definition.categoryLabel : en ? "Project and imported skills" : "Projekt-Skills und importierte Anleitungen"} <span className="text-muted">· {rows.length}</span></summary>
        <div className="space-y-2 p-2 pt-0">{rows.map(skill => {
          const builtin = builtinSkill(skill.id), on = !disabled.includes(skill.id);
          const requirements = skillRequirements(skill.id, environment);
          const heading = builtin ? en ? builtin.titleEn : builtin.title : skill.name;
          return <article key={skill.id} className="min-w-0 rounded border border-border bg-bg p-2" data-testid="skill-card" data-skill-id={skill.id}>
            <div className="flex items-start gap-2"><BookOpen className="mt-0.5 size-3.5 shrink-0 text-muted" /><div className="min-w-0 flex-1"><h4 className="break-words text-xs font-medium">{heading}</h4><p className="mt-0.5 text-[10px] text-subtle">{builtin ? `Anvil · ${builtin.version}` : skill.scope === "project" ? (en ? "This project" : "Dieses Projekt") : (en ? "Saved skill" : "Gespeicherter Skill")}{builtin?.readOnly ? (en ? " · Read only" : " · Nur lesen") : ""}</p></div>
              <input type="checkbox" checked={on} disabled={agentBusy} aria-label={`${heading} ${en ? "enabled" : "aktiv"}`} onChange={event => useLearn.getState().setSkillEnabled(skill.id, event.target.checked)} /></div>
            <p className="mt-2 break-words text-[11px] leading-relaxed text-muted">{skill.when}</p>
            {!on ? <p className="mt-1 text-[11px] text-muted">{en ? "Switched off" : "Ausgeschaltet"}</p> : null}
            <details className="mt-2"><summary className="cursor-pointer text-[11px] text-muted">{en ? "Instructions and prerequisites" : "Anleitung und Voraussetzungen"}</summary>
              <p className="my-2 break-all font-mono text-[10px] text-subtle">${skill.name}</p>
              {requirements.map(requirement => <div key={`${requirement.kind}:${requirement.label}`} className="mb-2 text-[11px]"><p className={requirement.status === "missing" ? "text-danger" : "text-fg"}>{en ? requirement.labelEn : requirement.label}: {requirement.status === "ready" ? (en ? "configured" : "vorhanden") : requirement.status === "missing" ? (en ? "missing" : "fehlt") : (en ? "check before use" : "vor Nutzung prüfen")}</p><p className="text-muted">{en ? requirement.detailEn : requirement.detail}</p></div>)}
              <div className="whitespace-pre-wrap break-words text-xs leading-relaxed">{skill.body}</div>
              {builtin && Object.entries(builtin.resources).map(([path, body]) => <details key={path} className="mt-2"><summary className="cursor-pointer break-words text-[11px] text-muted">{path}</summary><div className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed">{body}</div></details>)}
            </details>
            <div className="mt-2 flex flex-wrap gap-1">
              <Button variant="quiet" className="h-auto max-w-full gap-1 whitespace-normal px-2 py-1 text-[11px]" disabled={agentBusy || !on || !pins.includes(skill.id) && pins.length >= 3} aria-pressed={pins.includes(skill.id)} onClick={() => useLearn.getState().pinSkill(skill.id, !pins.includes(skill.id))}><Pin className="size-3 shrink-0" />{pins.includes(skill.id) ? (en ? "Unpin" : "Lösen") : (en ? "Pin for project" : "Für Projekt anheften")}</Button>
              {builtin ? <><Button variant="quiet" className="h-auto whitespace-normal px-2 py-1 text-[11px]" onClick={() => { const bytes = skillPackageZip(skillPackage(skill.id)); downloadBlob(new Blob([bytes as BlobPart], { type: "application/zip" }), `${skill.id}.zip`); }}>{en ? "Export ZIP" : "Als ZIP exportieren"}</Button><Button variant="quiet" disabled={agentBusy || copying} className="h-auto whitespace-normal px-2 py-1 text-[11px]" onClick={() => void copyToProject(skill.id)}>{en ? "Edit project copy" : "Projektkopie bearbeiten"}</Button></> : null}
            </div>
          </article>;
        })}</div>
      </details>;
    })}
    {!shown.length ? <p className="text-xs text-muted">{en ? "No matching skills." : "Keine passenden Skills gefunden."}</p> : null}
    {notice ? <p role="status" className="break-words text-xs">{notice}</p> : null}
  </section>;
}

export function SelectionList({ entries, en }: { entries: SkillSelection[]; en: boolean }) {
  return <ul className="mt-2 space-y-2 text-xs">{entries.map(entry => <li key={entry.id} className="min-w-0"><p className="font-medium">{builtinSkill(entry.id) ? en ? builtinSkill(entry.id)!.titleEn : builtinSkill(entry.id)!.title : entry.name}</p><p className="text-[11px] text-muted">{en ? entry.reasonEn : entry.reason}</p>{entry.requirements.filter(requirement => requirement.status !== "ready").map(requirement => <p key={requirement.label} className="text-[11px] text-muted">{en ? requirement.labelEn : requirement.label}: {en ? requirement.detailEn : requirement.detail}</p>)}</li>)}</ul>;
}
