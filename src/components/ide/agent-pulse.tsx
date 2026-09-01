import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { pulseKind, type PulseKind } from "@/lib/agent-pulse";
import { formatElapsed, useElapsed } from "@/lib/elapsed";
import { useT } from "@/lib/i18n";
import { useIde } from "@/store/ide";
import { Tip } from "@/components/ui/tooltip";

export function useAgentPulse(): PulseKind | null {
  const busy = useIde((s) => s.agentBusy);
  const chat = useIde((s) => s.chat);
  if (!busy) return null;
  const last = [...chat].reverse().find((m) => m.role === "assistant");
  return pulseKind({
    busy,
    thinking: last?.thinking,
    content: last?.content,
    steps: last?.steps,
  });
}

const LABEL: Record<PulseKind, "pulseWait" | "pulseThink" | "pulseWrite" | "pulseEdit" | "pulseRead" | "pulseRun" | "pulseSearch" | "pulseTool"> = {
  wait: "pulseWait",
  think: "pulseThink",
  write: "pulseWrite",
  edit: "pulseEdit",
  read: "pulseRead",
  run: "pulseRun",
  search: "pulseSearch",
  tool: "pulseTool",
};

function Svg({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg className={cn("pulse-svg", className)} viewBox="0 0 16 16" width={12} height={12} aria-hidden>
      {children}
    </svg>
  );
}

function Mark({ kind }: { kind: PulseKind }) {
  if (kind === "wait" || kind === "think") {
    return (
      <Svg className={kind === "wait" ? "pulse-spin-slow" : "pulse-spin"}>
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.4" />
        <circle cx="8" cy="2.6" r="1.5" fill="currentColor" />
      </Svg>
    );
  }
  if (kind === "write") {
    return (
      <span className="pulse-eq" aria-hidden>
        <i />
        <i />
        <i />
      </span>
    );
  }
  if (kind === "edit") {
    return (
      <Svg className="pulse-tilt">
        <path d="M3.5 12.5l1.2-4.2 6.4-6.4 3 3-6.4 6.4z" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M9.2 3.2l3.6 3.6" stroke="currentColor" strokeWidth="1.4" />
      </Svg>
    );
  }
  if (kind === "read") {
    return (
      <Svg>
        <rect x="2" y="3.5" width="12" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path className="pulse-scan" d="M3.5 8h9" stroke="currentColor" strokeWidth="1.4" />
      </Svg>
    );
  }
  if (kind === "run") {
    return (
      <Svg className="pulse-spin">
        <path d="M5 3.6v8.8L13 8z" fill="currentColor" />
      </Svg>
    );
  }
  if (kind === "search") {
    return (
      <Svg className="pulse-spin">
        <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7 7 L11.2 3.6" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10.2 10.2 L13.4 13.4" stroke="currentColor" strokeWidth="1.5" />
      </Svg>
    );
  }
  return (
    <Svg className="pulse-spin-slow">
      <path
        d="M8 2.2l.9 1.6 1.8.2.9 1.6-.7 1.6.7 1.6-.9 1.6-1.8.2L8 13.8l-.9-1.6-1.8-.2-.9-1.6.7-1.6-.7-1.6.9-1.6 1.8-.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
    </Svg>
  );
}

export function AgentPulse({
  kind,
  className,
  tip = true,
}: {
  kind?: PulseKind | null;
  className?: string;
  tip?: boolean;
}) {
  const t = useT();
  const live = useAgentPulse();
  const k = kind ?? live;
  const started = useIde((s) => s.agentStartedAt);
  const busy = useIde((s) => s.agentBusy);
  const ms = useElapsed(started || undefined, busy);
  if (!k) return null;
  const label = `${t(LABEL[k])}${ms ? ` · ${formatElapsed(ms)}` : ""}`;
  const mark = (
    <span className={cn("pulse", `pulse-${k}`, className)} role="status" aria-label={label} title={label}>
      <Mark kind={k} />
    </span>
  );
  if (!tip) return mark;
  return (
    <Tip label={label} side="bottom">
      {mark}
    </Tip>
  );
}
