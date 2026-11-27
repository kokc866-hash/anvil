import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BookOpen, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIde } from "@/store/ide";
import { useLearn, workspaceId, skillEnvironment, visibleSkills, slugSkillId, type LearnSkill } from "@/lib/learn";
import { ANVIL_SKILLS, SKILL_PRESELECT_LIMIT, builtinSkill, selectTaskSkills, skillRequirements, projectSkillPackage, type SkillEnvironment, type SkillSelection } from "@/lib/skill-library";
import { skillSource, managedSkillPackage, saveManagedSkill, removeManagedSkill } from "@/lib/skill-management";
import { debugSkill } from "@/lib/skill-debug";
import { AGENT_TOOL_NAMES } from "@/lib/agent-tools";
import { skillInstructionVersion } from "../../../electron/skill-feedback.mjs";
import { skillPackageZip, planSkillPackage } from "@/lib/skill-package";
import { downloadBlob } from "@/lib/archive";
import { hydrateLearnFromFiles } from "@/lib/learn";
import { saveNow } from "@/lib/save";
import { mcpSubscribe, mcpRevision } from "@/lib/mcp";

const knownSkillTools = [...AGENT_TOOL_NAMES];

export function SkillLibrary({ query = "", onImport }: { query?: string; onImport?: () => void }) {
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
  const epoch = useIde(state => state.workspaceEpoch);
  const [copying, setCopying] = useState(false);
  const [sample, setSample] = useState("");
  useEffect(() => { setSample(""); }, [epoch]);
  const ws = workspaceId(), pins = (pinned[ws] || []).filter(id => skills.some(skill => skill.id === id));
  const catalogRevision = useSyncExternalStore(mcpSubscribe, mcpRevision, mcpRevision);
  // skillEnvironment reads both stores; these dependencies invalidate that snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const environment = useMemo(() => skillEnvironment(), [files, dirs, servers, mode, surface, surfaceMode, cwd, memoryId, catalogRevision]);
  const available = visibleSkills();
  const preview = prefs.skills && prefs.skillBodies ? selectTaskSkills(sample, available, environment, { automatic: prefs.skillAuto, pinned: pins, limit: SKILL_PRESELECT_LIMIT }) : [];
  const shown = skills.filter(skill => (skill.scope !== "project" || skill.ws === ws) && `${builtinSkill(skill.id)?.title || skill.name} ${builtinSkill(skill.id)?.titleEn || ""} ${skill.when}`.toLowerCase().includes(query.toLowerCase()));
  const categories = [...new Set(ANVIL_SKILLS.map(skill => skill.category)), "custom"];

  async function copyToProject(skill: LearnSkill): Promise<string> {
    const before = useIde.getState();
    setCopying(true);
    try {
      const builtin = builtinSkill(skill.id);
      const copyName = builtin ? `${skill.id}-projekt` : `${(slugSkillId(skill.name) || "skill").slice(0, 56).replace(/-$/, "")}-projekt`;
      const values = builtin ? projectSkillPackage(skill.id) : managedSkillPackage(skill);
      if (!builtin) {
        values['SKILL.md'] = values['SKILL.md'].replace(/^name:.*$/m, `name: ${copyName}`);
        for (const original of new Set([skill.id, skill.name])) for (const quote of ['"', "'"]) {
          values['SKILL.md'] = values['SKILL.md'].replaceAll(`name:${quote}${original}${quote}`, `name:${quote}${copyName}${quote}`).replaceAll(`name=${quote}${original}${quote}`, `name=${quote}${copyName}${quote}`);
        }
      }
      const pack = planSkillPackage(Object.fromEntries(Object.entries(values).map(([path, body]) => [`${copyName}/${path}`, body])), before.files, before.dirs);
      if (before.workspaceEpoch !== useIde.getState().workspaceEpoch || useIde.getState().agentBusy) throw Error(en ? "Project changed; try copying again." : "Projekt geändert. Bitte erneut kopieren.");
      for (const [path, content] of Object.entries(pack.files)) before.writeFile(path, content, { quiet: true });
      hydrateLearnFromFiles(useIde.getState().files, Object.keys(pack.files));
      before.openFile(pack.main);
      let saved = true;
      for (const path of Object.keys(pack.files)) {
        if (before.workspaceEpoch !== useIde.getState().workspaceEpoch || !await saveNow({ path, format: false })) { saved = false; break; }
      }
      return saved ? (en ? "Editable project copy saved. The original skill remains unchanged." : "Bearbeitbare Projektkopie gespeichert. Der ursprüngliche Skill bleibt erhalten.") : (en ? "Project copy created; some files have not been saved yet." : "Projektkopie erstellt; einige Dateien sind noch nicht gespeichert.");
    }
    finally { setCopying(false); }
  }

  return <section className="space-y-3 px-1 py-2" data-testid="skill-library">
    <div><h3 className="text-sm font-semibold">{en ? "Anvil skill library" : "Anvil-Skill-Bibliothek"}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">{en ? "Bundled instructions for specific work. Skills work independently of personal memory and use the tools you have enabled." : "Vorinstallierte Arbeitsanleitungen für konkrete Aufgaben. Skills funktionieren unabhängig vom persönlichen Gedächtnis und nutzen die Werkzeuge, die du freigegeben hast."}</p></div>
    <div className="space-y-2 rounded-md border border-border p-2 text-xs">
      <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.skills} disabled={agentBusy} onChange={event => setPref("skills", event.target.checked)} />{en ? "Use skills" : "Skills verwenden"}</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.skillAuto} disabled={agentBusy} onChange={event => setPref("skillAuto", event.target.checked)} />{en ? "Automatically select matching skills" : "Passende Skills automatisch auswählen"}</label>
      {!prefs.skillBodies ? <div className="text-[11px] leading-relaxed"><p>{en ? "Only the skill catalog is enabled. Instruction text cannot be loaded yet." : "Nur der Skill-Katalog ist freigegeben. Die Anleitungstexte können noch nicht geladen werden."}</p><Button variant="quiet" disabled={agentBusy} onClick={() => setPref("skillBodies", true)}>{en ? "Enable instruction text" : "Anleitungstexte freigeben"}</Button></div> : null}
      <p className="text-[11px] leading-relaxed text-muted">{en ? "Anvil automatically preselects up to two matching skills. Explicitly named and pinned skills are also included. Instructions and references load only when needed. Name a skill with $skill-name." : "Anvil wählt automatisch bis zu zwei passende Skills vor. Ausdrücklich genannte und angeheftete Skills werden ebenfalls berücksichtigt. Anleitungen und Referenzen lädt der Agent erst bei Bedarf. Mit $skill-name kannst du einen Skill direkt nennen."}</p>
    </div>
    {onImport ? <Button variant="quiet" disabled={agentBusy} onClick={onImport} className="h-auto whitespace-normal px-2 py-1 text-xs">{en ? "Import a skill" : "Skill importieren"}</Button> : null}
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
        <div className="space-y-2 p-2 pt-0">{rows.map(skill => <SkillCard key={`${epoch}:${skill.id}`} skill={skill} en={en} environment={environment} files={files} on={!disabled.includes(skill.id)} pinned={pins.includes(skill.id)} pinLimit={pins.length >= 3} busy={agentBusy || copying} onCopy={() => copyToProject(skill)} />)}</div>
      </details>;
    })}
    {!shown.length ? <p className="text-xs text-muted">{en ? "No matching skills." : "Keine passenden Skills gefunden."}</p> : null}
  </section>;
}

function SkillCard({ skill, en, environment, files, on, pinned, pinLimit, busy, onCopy }: { skill: LearnSkill; en: boolean; environment: SkillEnvironment; files: Record<string, string>; on: boolean; pinned: boolean; pinLimit: boolean; busy: boolean; onCopy: () => Promise<string> }) {
  const builtin = builtinSkill(skill.id), source = skillSource(skill);
  const heading = builtin ? en ? builtin.titleEn : builtin.title : skill.name;
  const [editing, setEditing] = useState<{ when: string; body: string; beforeWhen: string; beforeBody: string } | null>(null);
  const [working, setWorking] = useState(false), [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(false);
  const requirements = skillRequirements(skill.id, environment);
  const baseDirectory = source.file?.replace(/\/[^/]+$/, "");
  const check = useMemo(() => {
    if (!expanded) return null;
    const resources = builtin?.resources ?? (baseDirectory ? Object.keys(files).filter(path => path.startsWith(`${baseDirectory}/`) && path !== source.file) : undefined);
    return debugSkill(skill, { files, baseDirectory, resources, knownTools: knownSkillTools });
  }, [expanded, builtin, skill, files, baseDirectory, source.file]);
  const feedback = skill.feedback?.at(-1);
  const earlierFeedback = feedback && feedback.version !== skillInstructionVersion(skill);
  const origin = source.kind === "builtin" ? "Anvil" : source.kind === "package" ? `${en ? "Package" : "Paket"}: ${source.name}` : source.kind === "project" ? (en ? "This project" : "Dieses Projekt") : (en ? "Across projects" : "Projektübergreifend");
  const feedbackText = feedback?.kind === "ok" ? (en ? "reported as helpful" : "als hilfreich gemeldet") : feedback?.kind === "fail" ? (en ? "reported as unhelpful" : "als nicht hilfreich gemeldet") : feedback?.kind === "undo" ? (en ? "undone" : "zurückgenommen") : (en ? "rejected" : "verworfen");
  async function change(action: () => Promise<void | string>, saved: string) {
    setWorking(true); setMessage("");
    try { const result = await action(); setMessage(typeof result === "string" ? result : saved); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setWorking(false); }
  }
  return <article className="min-w-0 rounded border border-border bg-bg p-2" data-testid="skill-card" data-skill-id={skill.id}>
    <div className="flex items-start gap-2"><BookOpen className="mt-0.5 size-3.5 shrink-0 text-muted" /><div className="min-w-0 flex-1"><h4 className="break-words text-xs font-medium">{heading}</h4><p className="mt-0.5 break-words text-[10px] text-subtle">{origin}{source.version ? ` · ${source.version}` : ""}{builtin?.readOnly ? (en ? " · Read only" : " · Nur lesen") : ""}</p></div>
      <input type="checkbox" checked={on} disabled={busy || working} aria-label={`${heading} ${en ? "enabled" : "aktiv"}`} onChange={event => useLearn.getState().setSkillEnabled(skill.id, event.target.checked)} /></div>
    <p className="mt-2 break-words text-[11px] leading-relaxed text-muted">{skill.when}</p>
    {!on ? <p className="mt-1 text-[11px] text-muted">{en ? "Switched off" : "Ausgeschaltet"}</p> : null}
    <details className="mt-2" onToggle={event => setExpanded(event.currentTarget.open)}><summary className="cursor-pointer text-[11px] text-muted">{en ? "Instructions and prerequisites" : "Anleitung und Voraussetzungen"}</summary>
      <p className="my-2 break-all font-mono text-[10px] text-subtle">${skill.name}</p>
      {source.file ? <p className="mb-2 break-all text-[10px] text-muted">{en ? "Source" : "Quelle"}: {source.file}</p> : null}
      {source.compatibility ? <p className="mb-2 break-words text-[11px] text-muted">{en ? "Compatibility" : "Kompatibilität"}: {source.compatibility}</p> : null}
      {requirements.map(requirement => <div key={`${requirement.kind}:${requirement.label}`} className="mb-2 text-[11px]"><p className={requirement.status === "missing" ? "text-danger" : "text-fg"}>{en ? requirement.labelEn : requirement.label}: {requirement.status === "ready" ? (en ? "configured" : "vorhanden") : requirement.status === "missing" ? (en ? "missing" : "fehlt") : (en ? "check before use" : "vor Nutzung prüfen")}</p><p className="text-muted">{en ? requirement.detailEn : requirement.detail}</p></div>)}
      <div className="whitespace-pre-wrap break-words text-xs leading-relaxed">{skill.body}</div>
      {builtin && Object.entries(builtin.resources).map(([path, body]) => <details key={path} className="mt-2"><summary className="cursor-pointer break-words text-[11px] text-muted">{path}</summary><div className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed">{body}</div></details>)}
      {check ? <div className="mt-2 text-[11px] text-muted" data-testid="skill-checks">
        <p>{en ? "Format" : "Format"}: {check.checks.format === "pass" ? (en ? "valid" : "gültig") : (en ? "needs attention" : "prüfen")}. {en ? "References" : "Referenzen"}: {check.checks.references === "pass" ? (en ? "checked" : "geprüft") : check.checks.references === "fail" ? (en ? "missing" : "unvollständig") : (en ? "not checked" : "nicht geprüft")}.</p>
        <p>{en ? "Tool names" : "Werkzeugnamen"}: {check.checks.tools === "pass" ? (en ? "statically checked" : "statisch geprüft") : (en ? "check before use" : "vor Nutzung prüfen")}. {en ? "Actual workflow: not checked." : "Tatsächlicher Ablauf: nicht geprüft."}</p>
        {check.issues.map(issue => <p key={issue} className="mt-1 break-words text-danger">{issue}</p>)}
        {check.warnings.map(warning => <p key={warning} className="mt-1 break-words">{warning}</p>)}
      </div> : null}
      <p className="mt-1 text-[11px] text-muted">{feedback ? `${en ? "Model feedback" : "Modellrückmeldung"}: ${feedbackText}. ${en ? "This is not a functional test." : "Das ist keine Funktionsprüfung."}` : (en ? "No model feedback recorded. Workflow quality has not been established by this check." : "Noch keine Modellrückmeldung. Diese Prüfung belegt keine Ablaufqualität.")}</p>
      {earlierFeedback ? <p className="mt-1 text-[11px] text-muted">{en ? "This feedback belongs to an earlier version of the instructions." : "Diese Rückmeldung gehört zu einem früheren Stand der Anleitung."}</p> : null}
    </details>
    <div className="mt-2 flex flex-wrap gap-1">
      <Button variant="quiet" className="h-auto max-w-full gap-1 whitespace-normal px-2 py-1 text-[11px]" disabled={busy || working || !on || !pinned && pinLimit} aria-pressed={pinned} onClick={() => useLearn.getState().pinSkill(skill.id, !pinned)}><Pin className="size-3 shrink-0" />{pinned ? (en ? "Unpin" : "Lösen") : (en ? "Pin for project" : "Für Projekt anheften")}</Button>
      <Button variant="quiet" disabled={busy || working} className="h-auto whitespace-normal px-2 py-1 text-[11px]" onClick={() => { try { const bytes = skillPackageZip(managedSkillPackage(skill)); downloadBlob(new Blob([bytes as BlobPart], { type: "application/zip" }), `${skill.name}.zip`); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }}>{en ? "Export ZIP" : "Als ZIP exportieren"}</Button>
      {builtin || source.kind === "package" ? <Button variant="quiet" disabled={busy || working} className="h-auto whitespace-normal px-2 py-1 text-[11px]" onClick={() => void change(onCopy, en ? "Project copy created." : "Projektkopie erstellt.")}>{en ? "Edit project copy" : "Projektkopie bearbeiten"}</Button> : null}
      {!builtin ? <>
        {source.kind !== "package" ? <Button variant="quiet" disabled={busy || working} className="h-auto whitespace-normal px-2 py-1 text-[11px]" onClick={() => { setMessage(""); setEditing({ when: skill.when, body: skill.body, beforeWhen: skill.when, beforeBody: skill.body }); }}>{en ? "Edit" : "Bearbeiten"}</Button> : null}
        <Button variant="quiet" disabled={busy || working} className="h-auto whitespace-normal px-2 py-1 text-[11px] text-danger" onClick={() => void change(() => removeManagedSkill(skill.id), en ? "Removed." : "Entfernt.")}>{source.kind === "package" ? (en ? "Remove package" : "Paket entfernen") : (en ? "Remove" : "Entfernen")}</Button>
      </> : null}
    </div>
    {source.kind === "package" ? <p className="mt-1 text-[10px] leading-relaxed text-muted">{en ? "Removing this package also removes its other skills. Turn off this skill above to keep the package." : "„Paket entfernen“ entfernt auch die anderen Skills dieses Pakets. Über den Schalter oben kannst du nur diesen Skill ausschalten."}</p> : null}
    {editing ? <form className="mt-2 space-y-2 rounded border border-border p-2" onSubmit={event => {
      event.preventDefault();
      const draft = editing;
      void change(async () => {
        const current = useLearn.getState().skills.find(record => record.id === skill.id);
        if (!current || current.when !== draft.beforeWhen || current.body !== draft.beforeBody) throw Error(en ? "This skill changed while you were editing. Reopen it before saving." : "Der Skill wurde während der Bearbeitung geändert. Öffne ihn vor dem Speichern erneut.");
        await saveManagedSkill(skill.id, { when: draft.when, body: draft.body }); setEditing(null);
      }, en ? "Skill saved." : "Skill gespeichert.");
    }}>
      <label className="block text-[11px]">{en ? "When should this skill help?" : "Wann soll dieser Skill helfen?"}<textarea aria-label={`${en ? "Description for" : "Beschreibung für"} ${heading}`} value={editing.when} onChange={event => setEditing({ ...editing, when: event.target.value })} disabled={busy || working} className="mt-1 min-h-16 w-full rounded border border-border bg-bg p-2 text-xs" /></label>
      <label className="block text-[11px]">{en ? "Instructions" : "Anleitung"}<textarea aria-label={`${en ? "Instructions for" : "Anleitung für"} ${heading}`} value={editing.body} onChange={event => setEditing({ ...editing, body: event.target.value })} disabled={busy || working} className="mt-1 min-h-40 w-full rounded border border-border bg-bg p-2 font-mono text-xs" /></label>
      <div className="flex flex-wrap gap-1"><Button type="submit" disabled={busy || working || !editing.when.trim() || !editing.body.trim()} className="h-auto px-2 py-1 text-[11px]">{working ? (en ? "Saving…" : "Speichern…") : (en ? "Save skill" : "Skill speichern")}</Button><Button type="button" variant="quiet" disabled={working} onClick={() => setEditing(null)} className="h-auto px-2 py-1 text-[11px]">{en ? "Cancel" : "Abbrechen"}</Button></div>
    </form> : null}
    {message ? <p role="status" className="mt-2 break-words text-xs">{message}</p> : null}
  </article>;
}

export function SelectionList({ entries, en }: { entries: SkillSelection[]; en: boolean }) {
  return <ul className="mt-2 space-y-2 text-xs">{entries.map(entry => <li key={entry.id} className="min-w-0"><p className="font-medium">{builtinSkill(entry.id) ? en ? builtinSkill(entry.id)!.titleEn : builtinSkill(entry.id)!.title : entry.name}</p><p className="text-[11px] text-muted">{en ? entry.reasonEn : entry.reason}</p>{entry.loaded!==undefined?<p className="text-[11px] text-muted">{entry.loaded?(en?"Instructions loaded.":"Anleitung geladen."):(en?"Preselected; instructions not loaded yet.":"Vorausgewählt; Anleitung noch nicht geladen.")}</p>:null}{entry.requirements.filter(requirement => requirement.status !== "ready").map(requirement => <p key={requirement.label} className="text-[11px] text-muted">{en ? requirement.labelEn : requirement.label}: {en ? requirement.detailEn : requirement.detail}</p>)}</li>)}</ul>;
}
