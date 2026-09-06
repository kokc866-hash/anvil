import { useMemo, type ReactNode } from "react";

import { estimateTokens, formatContext, formatTokens } from "@/lib/tokens";

import { cn } from "@/lib/cn";

import { useIde } from "@/store/ide";

import { t, useT } from "@/lib/i18n";

function Chip({ children, title, tone }: { children: ReactNode; title?: string; tone?: "ok" | "warn" | "live" }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-sm bg-bg px-1.5 text-[10px] leading-none whitespace-nowrap tabular-nums text-subtle",
        tone === "live" && "border-fg/35 text-muted",
        tone === "warn" && "border-danger/40 text-danger",
        tone === "ok" && "border-ok/40 text-ok",
      )}
    >
      {children}
    </span>
  );
}

export function ContextBar() {
  const t = useT();
  const chat = useIde((s) => s.chat);
  const fileN = useIde((s) => Object.keys(s.files).length);
  const llmContext = useIde((s) => s.llmContext);
  const sessionTokens = useIde((s) => s.sessionTokens);
  const llmThinking = useIde((s) => s.llmThinking);
  const llmCompact = useIde((s) => s.llmCompact);
  const agentBusy = useIde((s) => s.agentBusy);
  const runLoop = useIde((s) => s.runLoop);
  const graphLoop = useIde((s) => s.graphLoop);
  const llmRetries = useIde((s) => s.llmRetries);
  const agentQueue = useIde((s) => s.agentQueue.length);
  const ctxUsed = useMemo(() => {
    let n = 0;
    for (const m of chat) n += estimateTokens(m.content) + estimateTokens(m.thinking ?? "");
    n += fileN * 4;
    return n;
  }, [chat, fileN]);
  const pct = Math.min(100, Math.round((ctxUsed / Math.max(1, llmContext)) * 100));
  const session = sessionTokens.prompt + sessionTokens.completion;
  const think = llmThinking === "auto" ? "auto" : llmThinking === "medium" ? "mid" : llmThinking;
  const items: { id: string; title?: string; tone?: "ok" | "warn" | "live"; node: ReactNode }[] = [
    {
      id: "ctx",
      title: t("context"),
      tone: pct > 85 ? "warn" : undefined,
      node: (
        <>
          <span>{t("context")}</span>
          <span>
            {formatTokens(ctxUsed)}/{formatContext(llmContext)}
          </span>
          <span className="inline-block h-1 w-10 overflow-hidden rounded-full bg-border">
            <span
              className={cn("block h-full", pct > 85 ? "bg-danger" : pct > 60 ? "bg-fg/50" : "bg-ok")}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span>{pct}%</span>
        </>
      ),
    },
  ];
  if (session > 0) {
    items.push({
      id: "session",
      title: t("session"),
      node: (
        <>
          {t("session")} {formatTokens(session)}
          {sessionTokens.completion ? ` · ${formatTokens(sessionTokens.completion)}` : ""}
        </>
      ),
    });
  }
  if (llmThinking !== "off" && llmThinking !== "auto") {
    items.push({
      id: "think",
      title: t("think"),
      node: (
        <>
          {t("think")} {think}
        </>
      ),
    });
  }
  if (llmCompact === "aggressive") {
    items.push({ id: "compact", title: t("compact"), node: <>{t("compact")} max</> });
  }
  if (runLoop) items.push({ id: "run", title: t("runLoop"), node: "Run" });
  if (graphLoop) items.push({ id: "graph", title: t("graph"), node: "Graph" });
  if (llmRetries > 1) items.push({ id: "retry", title: t("retries", { n: llmRetries }), node: `×${llmRetries}` });
  if (agentQueue) items.push({ id: "queue", title: t("queued", { n: agentQueue }), node: t("queued", { n: agentQueue }) });

  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
      {items.map((c) => (
        <Chip key={c.id} title={c.title} tone={c.tone}>
          {c.node}
        </Chip>
      ))}
    </div>
  );
}
