import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";
import { stopAgent } from "@/lib/abort";
import { formatAskAnswer } from "@/lib/agent-ask";
import { cn } from "@/lib/cn";

export function JobAskBar() {
  const t = useT();
  const job = useIde((s) => s.agentJob);
  const draft = useIde((s) => s.agentDraft);
  const ask = job?.status === "ask" ? job.ask : null;
  if (!ask) return null;
  const q = ask;

  function pick(id: string) {
    useIde.getState().pushAgent(formatAskAnswer(q, id, draft));
    useIde.getState().setAgentDraft("");
  }

  function go() {
    const text = draft.trim();
    if (!text) return;
    useIde.getState().pushAgent(formatAskAnswer(q, undefined, text));
    useIde.getState().setAgentDraft("");
  }

  return (
    <div className="mb-1.5 rounded-md border border-border bg-bg px-2 py-1.5">
      <p className="text-[12px] text-fg">{ask.prompt}</p>
      {ask.why ? <p className="mt-0.5 text-[11px] text-muted">{ask.why}</p> : null}
      {ask.choices.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {ask.choices.map((c) => {
            const rec = ask.recommended === c.id;
            return (
              <button
                key={c.id}
                type="button"
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]",
                  rec ? "border-accent text-fg" : "border-border text-muted hover:text-fg hover:bg-hover",
                )}
                onClick={() => pick(c.id)}
              >
                <span className="font-mono text-subtle">{c.id}</span>
                {c.label}
                {rec ? <span className="text-[10px] text-subtle">{t("jobAskRec")}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="mt-1.5 flex items-center gap-2">
        {ask.allowText ? (
          <button type="button" className="h-7 rounded-md px-2 text-[11px] text-muted hover:text-fg hover:bg-hover" onClick={go}>
            {t("jobAskGo")}
          </button>
        ) : null}
        <button
          type="button"
          className="h-7 rounded-md px-2 text-[11px] text-subtle hover:text-fg hover:bg-hover"
          onClick={() => stopAgent("Job beendet")}
        >
          {t("jobAskDrop")}
        </button>
      </div>
    </div>
  );
}
