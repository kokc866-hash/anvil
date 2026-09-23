import { useIde } from "@/store/ide";
import { PRODUCT_WORKFLOWS, workflowDraft, type ProductWorkflowId } from "@/lib/product-workflows";

export function ProductWorkflows() {
  const busy = useIde(s => s.agentBusy);
  const locale = useIde(s => s.locale);
  const en = locale === "en";
  function choose(id: ProductWorkflowId) {
    const state = useIde.getState();
    if (state.agentBusy) return;
    const prepared = workflowDraft(id, state.agentDraft, state.locale);
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
      {PRODUCT_WORKFLOWS.map(flow => <button key={flow.id} type="button" disabled={busy} onClick={() => choose(flow.id)} title={en ? flow.hintEn : flow.hint} className="rounded border border-border px-2 py-2 text-left text-fg hover:bg-hover disabled:opacity-50">
        <span className="block font-medium">{en ? flow.titleEn : flow.title}</span>
        <span className="mt-1 block text-[10px] text-muted">{en ? flow.hintEn : flow.hint}</span>
      </button>)}
    </div>
  </div>;
}
