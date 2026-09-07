import { useElapsed } from "@/lib/elapsed";
import { Tip } from "@/components/ui/tooltip";
import { useIde } from "@/store/ide";
import { requestPhaseLabel, useRequestState } from "@/lib/request-state";

export function RequestStatus() {
  const busy = useIde((s) => s.agentBusy);
  const locale = useIde((s) => s.locale);
  const phase = useRequestState((s) => s.phase);
  const detail = useRequestState((s) => s.detail);
  if (!busy) return null;
  const label = `${requestPhaseLabel(phase, locale)}${detail ? ` · ${detail}` : ""}`;
  return (
    <Tip label={label}>
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        tabIndex={0}
        className="min-w-0 truncate font-normal text-subtle"
      >
        · {label}
      </span>
    </Tip>
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
