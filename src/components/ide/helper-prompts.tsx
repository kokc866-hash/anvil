import { useEffect } from "react";
import { useBrain } from "@/lib/brain";
import { brainSuggestPrompts } from "@/lib/brain/apps";
import { useIde } from "@/store/ide";

function labelOf(p: string): string {
  if (/python312|_pyodide|File "|Traceback/i.test(p)) return "Fehler beheben";
  if (/fehler/i.test(p)) return "Fehler beheben";
  if (/unterschlang/i.test(p)) return "Unterschlangen";
  if (/diff/i.test(p)) return "Diffs prüfen";
  if (/verbesser|änder|weiter/i.test(p)) return "Weiterbauen";
  return p.length > 32 ? `${p.slice(0, 30)}…` : p;
}

export function HelperPrompts({ where }: { where: "chat" | "output" }) {
  const on = useBrain((s) => s.on);
  const job = useBrain((s) => s.jobs.prompts !== false);
  const prompts = useBrain((s) => s.prompts);
  const path = useIde((s) => s.activePath);
  const outN = useIde((s) => s.output.length);
  const lspN = useIde((s) => s.lspProblems.length);

  useEffect(() => {
    if (!on || !job) return;
    const t = window.setTimeout(() => void brainSuggestPrompts(), where === "chat" ? 500 : 900);
    return () => window.clearTimeout(t);
  }, [on, job, path, outN, lspN, where]);

  const shown = prompts.slice(0, 2);
  if (!on || !job || !shown.length) return null;

  function usePrompt(text: string) {
    const st = useIde.getState();
    st.setPanels({ ...st.panels, agent: true });
    if (where === "chat") st.setAgentDraft(text);
    else st.pushAgent(text);
  }

  return (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden">
      {shown.map((p) => (
        <button
          key={p}
          type="button"
          title={p}
          className="shrink-0 text-[11px] text-subtle hover:text-fg hover:underline"
          onClick={() => usePrompt(p)}
        >
          {labelOf(p)}
        </button>
      ))}
    </div>
  );
}
