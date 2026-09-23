import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useBrain } from "@/lib/brain";
import { brainSuggestPrompts } from "@/lib/brain/apps";
import { useIde } from "@/store/ide";

function labelOf(p: string): string {
  if (/python312|_pyodide|File "|Traceback/i.test(p)) return "Fehler beheben";
  if (/fehler/i.test(p)) return "Fehler beheben";
  if (/unterschlang/i.test(p)) return "Codeprobleme";
  if (/diff/i.test(p)) return "Änderungen prüfen";
  if (/verbesser|änder|weiter/i.test(p)) return "Weiterbauen";
  return p.length > 32 ? `${p.slice(0, 30)}…` : p;
}

export function HelperPrompts({ where }: { where: "chat" | "output" }) {
  const hintId = useId();
  const popup = useRef<HTMLDivElement>(null);
  const on = useBrain((s) => s.on && s.autonomy !== "off");
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

  if (where === "chat")
    return (
      <>
        <button
          type="button"
          popoverTarget={hintId}
          className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted hover:border-fg/40 hover:text-fg"
          onClick={(event) => {
            if (!popup.current) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const width = Math.min(380, window.innerWidth - 24);
            const below = window.innerHeight - rect.bottom - 20;
            const above = rect.top - 20;
            const openBelow = above < 200 && below > above;
            Object.assign(popup.current.style, {
              width: `${width}px`,
              left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
              top: openBelow ? `${rect.bottom + 8}px` : "auto",
              bottom: openBelow ? "auto" : `${Math.max(12, window.innerHeight - rect.top + 8)}px`,
              maxHeight: `${Math.max(80, Math.min(360, openBelow ? below : above))}px`,
            });
          }}
        >
          Helfer{shown.length > 1 ? ` (${shown.length})` : ""}
        </button>
        {createPortal(
          <div
            ref={popup}
            id={hintId}
            popover="auto"
            role="dialog"
            aria-label="Helferhinweise"
            className="fixed inset-auto m-0 overflow-y-auto rounded-lg border border-border bg-surface p-3 text-xs text-fg shadow-xl"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="font-medium">Vorschlag des Helfers</span>
              <button
                type="button"
                popoverTarget={hintId}
                popoverTargetAction="hide"
                aria-label="Helferhinweis schließen"
                className="px-1 text-muted hover:text-fg"
              >
                ×
              </button>
            </div>
            <div className="space-y-3">
              {shown.map((p) => (
                <div key={p} className="min-w-0">
                  <p className="whitespace-pre-wrap text-fg [overflow-wrap:anywhere]">{p}</p>
                  <button
                    type="button"
                    className="mt-2 rounded-md border border-border px-2 py-1 text-muted hover:bg-hover hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg"
                    onClick={() => {
                      usePrompt(p);
                      popup.current?.hidePopover();
                    }}
                  >
                    In Eingabe übernehmen
                  </button>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
      </>
    );

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
