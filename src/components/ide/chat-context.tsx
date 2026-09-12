import type { ReactNode } from "react";

import { formatContext, formatTokens } from "@/lib/tokens";

import { cn } from "@/lib/cn";

import { useIde } from "@/store/ide";

import { useT } from "@/lib/i18n";

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
  const request = useIde((s) => s.lastRequestTokens);
  const locale = useIde((s) => s.locale);
  const llmContext = useIde((s) => s.llmContext);
  const sessionTokens = useIde((s) => s.sessionTokens);
  const llmThinking = useIde((s) => s.llmThinking);
  const llmCompact = useIde((s) => s.llmCompact);
  const runLoop = useIde((s) => s.runLoop);
  const graphLoop = useIde((s) => s.graphLoop);
  const llmRetries = useIde((s) => s.llmRetries);
  const agentQueue = useIde((s) => s.agentQueue.length);
  const ctxUsed = request?.prompt ?? 0;
  const contextLimit = request?.limit ?? llmContext;
  const pct = Math.min(100, Math.round((ctxUsed / Math.max(1, contextLimit)) * 100));
  const session = sessionTokens.prompt + sessionTokens.completion;
  const think = llmThinking === "auto" ? "auto" : llmThinking === "medium" ? "mid" : llmThinking;
  const items: { id: string; title?: string; tone?: "ok" | "warn" | "live"; node: ReactNode }[] = [
    {
      id: "ctx",
      title: locale === "de" ? "Eingabe der letzten Modellanfrage einschließlich System und Werkzeugen. ≈ = geschätzt; keine aktuelle Tokenizer-Messung." : "Input of the last model request including system and tools. ≈ = estimated; not a live tokenizer measurement.",
      tone: pct > 85 ? "warn" : undefined,
      node: (
        <>
          <span>{t("context")}</span>
          <span>
            {request ? `${request.estimated ? "≈" : ""}${formatTokens(ctxUsed)}` : "—"}/{formatContext(contextLimit)}
          </span>
          <span className="inline-block h-1 w-10 overflow-hidden rounded-full bg-border">
            <span
              className={cn("block h-full", pct > 85 ? "bg-danger" : pct > 60 ? "bg-fg/50" : "bg-ok")}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span>{request ? `${request.estimated ? "≈" : ""}${pct}%` : ""}</span>
        </>
      ),
    },
  ];
  if (session > 0) {
    items.push({
      id: "session",
      title: locale === "de"
        ? `Chat-Anfragen dieser Sitzung: Eingabe ${formatTokens(sessionTokens.prompt)}, Ausgabe ${formatTokens(sessionTokens.completion)}. Wiederholte Eingaben werden pro Anfrage gezählt. ≈ enthält Schätzungen; abgebrochene Antworten ohne Nutzungsdaten können fehlen. Automatische Helferjobs sind nicht enthalten.`
        : `Chat requests this session: input ${formatTokens(sessionTokens.prompt)}, output ${formatTokens(sessionTokens.completion)}. Repeated input counts per request. ≈ includes estimates; interrupted responses without usage may be missing. Automatic helper jobs are excluded.`,
      node: (
        <>
          {t("session")} {sessionTokens.estimated !== false ? "≈" : ""}{formatTokens(session)}
          {sessionTokens.completion ? ` · ↓${formatTokens(sessionTokens.completion)}` : ""}
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
