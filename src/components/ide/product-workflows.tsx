import { useSyncExternalStore } from 'react';
import { useIde } from "@/store/ide";
import { PRODUCT_WORKFLOWS, workflowDraft, workflowSkills, workflowRequirements, type ProductWorkflowId } from "@/lib/product-workflows";
import { useLearn, skillEnvironment } from '@/lib/learn';
import { builtinSkill } from '@/lib/skill-library';
import { mcpRevision, mcpSubscribe } from '@/lib/mcp';

export function ProductWorkflows() {
  const busy = useIde(s => s.agentBusy);
  const locale = useIde(s => s.locale);
  const files = useIde(s => s.files);
  useIde(s => s.dirs);
  useIde(s => s.mcpServers);
  useIde(s => s.workspaceCwd);
  const surface = useIde(s => s.activeSurfaceId);
  const surfaceMode = useIde(s => s.surfaceMode);
  const prefs = useLearn(s => s.prefs);
  const disabled = useLearn(s => s.disabledSkills);
  useSyncExternalStore(mcpSubscribe, mcpRevision, mcpRevision);
  const en = locale === "en";
  const environment = skillEnvironment();
  const executionAllowed = !surface || surface === 'anvil' || surfaceMode === 'bridge';
  function choose(id: ProductWorkflowId) {
    const state = useIde.getState();
    if (state.agentBusy) return;
    const skills = prefs.skills && prefs.skillBodies ? workflowSkills(id, skillEnvironment(), state.files).filter(id => !disabled.includes(id)) : [];
    const prepared = workflowDraft(id, state.agentDraft, state.locale, skills);
    state.setSidebar(null);
    state.setPanels({ ...state.panels, agent: true });
    state.setAgentMode(prepared.mode);
    state.setAgentDraft(prepared.text);
    state.setNotice(en ? "Draft prepared. Add your task, then send." : "Der Entwurf ist vorbereitet. Ergänze deinen Auftrag und sende ihn anschließend.");
    requestAnimationFrame(() => document.getElementById("anvil-chat")?.focus());
  }
  return <div className="text-xs">
    <p className="text-muted">{en ? "Choose a workflow. Your draft stays editable; nothing is sent yet." : "Wähle eine Aufgabe aus und passe den Entwurf an. Du entscheidest, wann du ihn sendest."}</p>
    <div className="mt-3 grid gap-2">
      {PRODUCT_WORKFLOWS.map(flow => {
        const skills = workflowSkills(flow.id, environment, files);
        const requirements = workflowRequirements(skills, { ...environment, execution: flow.mode === 'agent' && executionAllowed });
        const inactive = !prefs.skills || !prefs.skillBodies || skills.some(id => disabled.includes(id));
        return <article key={flow.id} className="min-w-0 rounded border border-border" data-testid={`workflow-${flow.id}`}>
          <button type="button" disabled={busy} onClick={() => choose(flow.id)} title={en ? flow.hintEn : flow.hint} className="w-full px-2 py-2 text-left text-fg hover:bg-hover disabled:opacity-50">
        <span className="block font-medium">{en ? flow.titleEn : flow.title}</span>
        <span className="mt-1 block text-[10px] text-muted">{en ? flow.hintEn : flow.hint}</span>
          </button>
          <details className="border-t border-border px-2 py-1.5 text-[11px]">
            <summary className="cursor-pointer text-muted">{en ? 'Skills and next steps' : 'Skills und nächste Schritte'}</summary>
            <p className="mt-2 break-words">{skills.length ? skills.map(id => {const skill = builtinSkill(id); return en ? skill?.titleEn : skill?.title;}).join(', ') : en ? 'Choose the target project or application first.' : 'Zuerst das Zielprojekt oder die Anwendung festlegen.'}</p>
            {inactive ? <p className="mt-1 text-muted">{en ? 'One or more skill instructions are switched off. Your task can still be drafted.' : 'Eine oder mehrere Skill-Anleitungen sind ausgeschaltet. Der Auftrag lässt sich trotzdem vorbereiten.'}</p> : null}
            {requirements.map(requirement => <div key={`${requirement.kind}:${requirement.label}`} className="mt-2">
              <p>{en ? requirement.labelEn : requirement.label}: {requirement.status === 'missing' ? en ? 'missing' : 'fehlt' : en ? 'check before use' : 'vor Nutzung prüfen'}</p>
              <p className="text-muted">{en ? requirement.detailEn : requirement.detail}</p>
              <button type="button" className="mt-1 underline hover:text-fg" disabled={busy} onClick={() => {
                const state = useIde.getState();
                state.setSidebar(requirement.kind === 'project' ? 'files' : requirement.kind === 'service' || requirement.kind === 'engine' ? 'mcp' : 'connection');
              }}>{requirement.kind === 'project' ? en ? 'Open project' : 'Projekt öffnen' : requirement.kind === 'service' || requirement.kind === 'engine' ? en ? 'Open connections' : 'Verbindungen öffnen' : en ? 'Review working mode' : 'Arbeitsmodus prüfen'}</button>
            </div>)}
            <button type="button" className="mt-2 underline text-muted hover:text-fg" onClick={() => {useLearn.setState({libraryRequested: true}); useIde.getState().setSidebar('ext');}}>{en ? 'Open skill library' : 'Skill-Bibliothek öffnen'}</button>
          </details>
        </article>;
      })}
    </div>
  </div>;
}
