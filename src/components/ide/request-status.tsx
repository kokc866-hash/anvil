import { useElapsed } from "@/lib/elapsed";
import { useIde } from "@/store/ide";
import { requestPhaseLabel, useRequestState } from "@/lib/request-state";

export function RequestStatus() {
  const busy = useIde((s) => s.agentBusy);
  const locale = useIde((s) => s.locale);
  const phase = useRequestState((s) => s.phase);
  const detail = useRequestState((s) => s.detail);
  if (!busy) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-10 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted"
    >
      {requestPhaseLabel(phase, locale)}
      {detail ? ` · ${detail}` : ""}
    </div>
  );
}

export function LongRequestHint({ onStop }: { onStop: () => void }) {
  const busy = useIde((s) => s.agentBusy);
  const started = useIde((s) => s.agentStartedAt);
  const locale = useIde((s) => s.locale);
  const elapsed = useElapsed(started, busy);
  if (!busy || elapsed < 180_000) return null;
  return (
    <button type="button" className="px-1 text-left text-[11px] text-subtle hover:text-fg" onClick={onStop}>
      {locale === "de" ? "Anfrage läuft weiter · bei Bedarf stoppen" : "Request is still running · stop if needed"}
    </button>
  );
}
