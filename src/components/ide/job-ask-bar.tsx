import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";
import { stopAgent } from "@/lib/abort";
import { formatAskAnswer } from "@/lib/agent-ask";
import { cn } from "@/lib/cn";
import { useState } from 'react';
import { dismissBackgroundJob, resumeBackgroundJob, useBackgroundAgent } from '@/lib/background-agent';

export function JobAskBar() {
  const t = useT();
  const job = useIde((s) => s.agentJob);
  const background = useBackgroundAgent(s => s.job);
  const backgroundEnabled = useIde(s => s.backgroundAgent);
  const project = useIde((s) => s.workspaceCwd || s.memoryWorkspace);
  const en = useIde(s => s.locale === 'en');
  const [replying, setReplying] = useState(false);
  const backgroundAsk = backgroundEnabled && background?.project === project && !background.dismissed && background.status === 'waiting-user' ? background.ask : null;
  const foregroundAsk = job?.status === "ask" ? job.ask : null;
  const ask = foregroundAsk || backgroundAsk;
  if (!ask) return null;
  const q = ask;

  function answer(id?: string, text?: string) {
    if (replying) return;
    if (!foregroundAsk && backgroundAsk && background) {
      const current = useBackgroundAgent.getState().job, state = useIde.getState();
      if (current?.id !== background.id || current.ask?.id !== q.id || current.status !== 'waiting-user' || current.project !== (state.workspaceCwd || state.memoryWorkspace)) {
        state.setNotice('Diese Rückfrage gehört nicht mehr zum aktuellen Auftrag.');
        return;
      }
      const draft = text ?? state.agentDraft;
      setReplying(true);
      void resumeBackgroundJob({askId:q.id,...(id ? {choiceId:id} : {text:draft.trim()})}, current.id).then(accepted => {
        if (accepted && !id && useIde.getState().agentDraft === draft) useIde.getState().setAgentDraft('');
      }).finally(() => setReplying(false));
      return;
    }
    const state = useIde.getState(), current = state.agentJob;
    if (current?.id !== job!.id || current.status !== "ask" || current.ask?.id !== q.id ||
        (state.workspaceCwd || state.memoryWorkspace) !== project || current.human && current.human.project !== project) {
      state.setNotice("Diese Rückfrage gehört nicht mehr zum aktuellen Auftrag.");
      return;
    }
    state.pushAgent(formatAskAnswer(q, id, text ?? state.agentDraft), false, current.mode ?? state.agentMode, { jobId: current.id, askId: q.id, project });
    state.setAgentDraft("");
  }

  function pick(id: string) {
    answer(id);
  }

  function go() {
    const text = useIde.getState().agentDraft.trim();
    if (!text) return;
    answer(undefined, text);
  }

  return (
    <div role="group" aria-label={en ? 'Question' : 'Rückfrage'} className="mb-1.5 rounded-md border border-border bg-bg px-2 py-1.5">
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
                disabled={replying}
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
          <button type="button" disabled={replying} className="h-7 rounded-md px-2 text-[11px] text-muted hover:text-fg hover:bg-hover" onClick={go}>
            {t("jobAskGo")}
          </button>
        ) : null}
        <button
          type="button"
          className="h-7 rounded-md px-2 text-[11px] text-subtle hover:text-fg hover:bg-hover"
          disabled={replying}
          onClick={() => { if (!foregroundAsk && background) { if (useBackgroundAgent.getState().job?.id === background.id) void dismissBackgroundJob(); } else stopAgent("Job beendet"); }}
        >
          {t("jobAskDrop")}
        </button>
      </div>
    </div>
  );
}
