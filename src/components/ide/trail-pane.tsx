import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Footprints, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";
import { hasTrailMsg } from "@/lib/trail-filter";
import { AgentTodo, ThinkBlock, Trail } from "./chat-pane";

function BubbleSplit({ onDrag, title }: { onDrag: (dy: number) => void; title: string }) {
  const last = useRef(0);
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      title={title}
      className="flex h-3 shrink-0 cursor-ns-resize items-center justify-center hover:bg-hover"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        last.current = e.clientY;
      }}
      onPointerMove={(e) => {
        if (e.buttons !== 1) return;
        onDrag(e.clientY - last.current);
        last.current = e.clientY;
      }}
    >
      <span className="block h-0.5 w-10 rounded-full bg-subtle" />
    </div>
  );
}

export function TrailPane() {
  const t = useT();
  const chat = useIde((s) => s.chat);
  const busy = useIde((s) => s.agentBusy);
  const thinkH = useIde((s) => s.trailThinkH);
  const setThinkH = useIde((s) => s.setTrailThinkH);
  const rounds = useMemo(() => chat.filter((m) => m.role === "assistant" && hasTrailMsg(m)), [chat]);
  const latest = rounds.at(-1) ?? [...chat].reverse().find((m) => m.role === "assistant") ?? null;
  const [pick, setPick] = useState("");
  const current = (pick && rounds.find((m) => m.id === pick)) || latest;
  const idx = current ? rounds.findIndex((m) => m.id === current.id) : -1;
  const live = Boolean(busy && current && chat.at(-1) === current);
  const running = live ? (current?.steps?.filter((s) => s.status === "run") ?? []) : [];
  const [thinkOpen, setThinkOpen] = useState(Boolean(live));
  const hasThink = Boolean(current?.thinking);
  const hasTrail = Boolean(
    current &&
      (current.plan?.length ||
        current.steps?.length ||
        current.changes?.length ||
        current.checkpointId ||
        current.lastRun ||
        current.lastTests ||
        current.harness ||
        live),
  );

  useEffect(() => {
    if (busy && latest) setPick(latest.id);
  }, [busy, latest?.id]);

  useEffect(() => {
    setThinkOpen(live);
  }, [current?.id, live]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <Footprints className="size-3.5 text-muted" />
        <p className="text-xs font-medium tracking-wide text-muted uppercase">{t("trail")}</p>
        {rounds.length > 1 ? (
          <span className="flex items-center gap-0.5">
            <Button
              className="h-7 w-7 p-0"
              variant="quiet"
              disabled={idx <= 0}
              title={t("trailPrev")}
              onClick={() => {
                const m = rounds[idx - 1];
                if (m) setPick(m.id);
              }}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="w-8 text-center font-mono text-[10px] tabular-nums text-muted">
              {idx + 1}/{rounds.length}
            </span>
            <Button
              className="h-7 w-7 p-0"
              variant="quiet"
              disabled={idx < 0 || idx >= rounds.length - 1}
              title={t("trailNext")}
              onClick={() => {
                const m = rounds[idx + 1];
                if (m) setPick(m.id);
              }}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </span>
        ) : null}
        {running.length ? (
          <span className="min-w-0 truncate think-live text-[11px] text-fg">{running[0].detail || running[0].name}</span>
        ) : live ? (
          <span className="think-live text-[11px] text-fg">{t("working")}</span>
        ) : null}
        <div className="flex-1" />
        {hasThink && thinkOpen ? (
          <span className="flex items-center gap-0.5" title={t("trailThinkH")}>
            <Button className="h-7 w-7 p-0" variant="quiet" title={t("trailThinkH")} onClick={() => setThinkH(thinkH - 32)}>
              <Minus className="size-3.5" />
            </Button>
            <span className="w-8 text-center font-mono text-[10px] tabular-nums text-muted">{thinkH}</span>
            <Button className="h-7 w-7 p-0" variant="quiet" title={t("trailThinkH")} onClick={() => setThinkH(thinkH + 32)}>
              <Plus className="size-3.5" />
            </Button>
          </span>
        ) : null}
        <Button className="h-7 w-7 p-0" variant="quiet" title={t("trail")} onClick={() => useIde.getState().togglePanel("trail")}>
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2 py-2">
        {!current ? (
          <p className="px-1 py-6 text-center text-xs text-subtle">{t("trailEmpty")}</p>
        ) : (
          <>
            {hasThink ? (
              <div
                className={
                  thinkOpen
                    ? hasTrail
                      ? "min-h-0 shrink-0 overflow-hidden"
                      : "min-h-0 min-w-0 flex-1 overflow-hidden"
                    : "mb-2 shrink-0 overflow-hidden"
                }
                style={thinkOpen && hasTrail ? { height: thinkH, minHeight: 72 } : thinkOpen ? { minHeight: 72 } : undefined}
              >
                <ThinkBlock
                  text={current.thinking ?? ""}
                  live={live}
                  since={current.at}
                  fill
                  hideResize
                  opened={thinkOpen}
                  height={thinkH}
                  onResize={setThinkH}
                  onOpen={setThinkOpen}
                />
              </div>
            ) : live && !running.length ? (
              <p className="mb-2 shrink-0 px-1 text-[11px] text-muted think-live">{t("working")}</p>
            ) : null}
            {hasThink && thinkOpen && hasTrail ? (
              <BubbleSplit title={t("trailThinkHHint")} onDrag={(dy) => setThinkH(useIde.getState().trailThinkH + dy)} />
            ) : null}
            {hasTrail ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <Trail m={current} live={live} liveTools={live} fill />
              </div>
            ) : !current.thinking && !live ? (
              <p className="px-1 text-[11px] text-subtle">{t("trailIdle")}</p>
            ) : (
              <div className="min-h-0 flex-1" />
            )}
          </>
        )}
      </div>
      <AgentTodo plan={current?.plan} msgId={current?.id} />
    </div>
  );
}