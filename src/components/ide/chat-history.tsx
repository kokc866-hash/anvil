import { memo, useMemo, type RefObject } from "react";
import { useIde, type ChatMsg } from "@/store/ide";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { CodeBlock } from "@/lib/syntax";
import { parseBlocks } from "@/lib/chat-content";
import { formatElapsed, useElapsed } from "@/lib/elapsed";
import { hasTrailMsg } from "@/lib/trail-filter";
import { CopyMini } from "@/components/ui/copy-btn";
import { AgentPulse } from "./agent-pulse";
import { ThinkBlock, Trail } from "./chat-trail";
import type { ChatMenu } from "./chat-menu";
import { VirtualMessage } from "./virtual-message";

type RowProps = {
  m: ChatMsg;
  liveThink: boolean;
  lastUser: boolean;
  lastAsst: boolean;
  helperLabel: string;
  trailInline: boolean;
  setMenu: (menu: ChatMenu) => void;
};
const MessageRow = memo(function MessageRow({ m, liveThink, lastUser, lastAsst, helperLabel, trailInline, setMenu }: RowProps) {
  const t = useT();
  const setDraft = useIde((s) => s.setAgentDraft);
  const writeFile = useIde((s) => s.writeFile);
  const busyMs = useElapsed(m.at, liveThink);
  const blocks = useMemo(() => parseBlocks(m.content), [m.content]);
  const hollow =
    m.role === "assistant" &&
    !liveThink &&
    !(m.content || "").trim() &&
    !(m.thinking || "").trim() &&
    !m.steps?.length &&
    !m.plan?.length &&
    !m.lastRun &&
    !m.lastTests;
  if (hollow) return null;
  return (
    <div
      key={m.id}
      data-chat-msg
      className={cn("group relative min-w-0 max-w-[92%] break-words", m.role === "user" ? "self-end" : "self-start")}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ kind: "msg", x: e.clientX, y: e.clientY, id: m.id });
      }}
    >
      {m.role !== "user" ? (
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium justify-start text-muted">
          {m.voice === "helper" ? (
            <>
              <span className="flex size-5 items-center justify-center rounded-full border border-ok/40 bg-surface text-[10px] font-semibold text-ok">
                H
              </span>
              <span className="text-ok">{t("helper")}</span>
              {helperLabel ? <span className="truncate text-subtle">· {helperLabel}</span> : null}
              {m.ms ? <span className="font-mono tabular-nums text-subtle">· {formatElapsed(m.ms)}</span> : null}
            </>
          ) : (
            <>
              <span className="flex size-5 items-center justify-center rounded-full border border-border bg-surface text-[10px] font-semibold text-fg">
                A
              </span>
              <span className="text-fg">{t("agent")}</span>
              {liveThink ? <AgentPulse className="ml-0.5 shrink-0" /> : null}
              {liveThink || m.ms ? (
                <span className="shrink-0 font-mono tabular-nums text-subtle">
                  · {formatElapsed(liveThink ? busyMs : m.ms || 0)}
                </span>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      <div
        className={cn(
          "absolute -top-7 z-10 hidden items-center rounded-md border border-border bg-surface p-0.5 shadow-sm group-hover:flex",
          m.role === "user" ? "right-0" : "left-0",
        )}
      >
        <CopyMini text={m.content} />
        {lastUser || lastAsst ? (
          <button
            type="button"
            className="h-6 rounded-sm px-2 text-[11px] text-muted hover:bg-hover hover:text-fg"
            onClick={() => {
              if (m.role === "user") useIde.getState().pushAgent(m.content);
              else {
                const prev = [...useIde.getState().chat].reverse().find((x) => x.role === "user");
                if (prev) useIde.getState().pushAgent(prev.content);
              }
            }}
          >
            {t("again")}
          </button>
        ) : null}
        {lastUser ? (
          <button
            type="button"
            className="h-6 rounded-sm px-2 text-[11px] text-muted hover:bg-hover hover:text-fg"
            onClick={() => setDraft(m.content)}
          >
            {t("chatEdit")}
          </button>
        ) : null}
      </div>
      <div
        className={cn(
          "chat-in min-w-0 max-w-full overflow-hidden rounded-lg px-3.5 py-2.5 text-sm leading-relaxed break-words text-fg [overflow-wrap:anywhere]",
          m.role === "user" ? "rounded-br-sm bg-hover" : m.voice === "helper" ? "rounded-tl-sm bg-bg" : "rounded-tl-sm bg-bg",
        )}
      >
        {trailInline && m.role === "assistant" && m.thinking ? (
          <ThinkBlock text={m.thinking} live={liveThink} since={m.at} />
        ) : null}
        {trailInline && m.role === "assistant" && hasTrailMsg(m) ? <Trail m={m} live={false} liveTools={false} /> : null}
        {m.role === "user" && m.images?.length ? (
          <div className="mb-1 flex flex-wrap gap-1">
            {m.images.map((src, n) => (
              <img key={n} src={src} alt="" className="max-h-24 rounded-md" />
            ))}
          </div>
        ) : null}
        {blocks.map((part, i) =>
          part.code ? (
            <div
              key={i}
              className="my-2 overflow-hidden rounded-md bg-surface"
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({
                  kind: "code",
                  x: e.clientX,
                  y: e.clientY,
                  path: part.path,
                  lang: part.lang,
                  text: part.text,
                });
              }}
            >
              <div className="flex items-center justify-between px-2 py-1 text-xs text-muted">
                <span className="font-mono">{part.path || part.lang || "code"}</span>
                {part.path ? (
                  <button type="button" className="text-fg hover:underline" onClick={() => writeFile(part.path, part.text)}>
                    Übernehmen
                  </button>
                ) : null}
              </div>
              <CodeBlock code={part.text} lang={part.lang} path={part.path} />
            </div>
          ) : (
            <span key={i} className="whitespace-pre-wrap">
              {part.text}
            </span>
          ),
        )}
      </div>
    </div>
  );
});

export const ChatHistory = memo(function ChatHistory({
  chat,
  busy,
  helperLabel,
  trailInline,
  setMenu,
  scroller,
}: {
  chat: ChatMsg[];
  busy: boolean;
  helperLabel: string;
  trailInline: boolean;
  setMenu: (menu: ChatMenu) => void;
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const lastUser = [...chat].reverse().find((m) => m.role === "user")?.id;
  return (
    <>
      {chat.map((m, i) => {
        const live = busy && m.role === "assistant" && i === chat.length - 1;
        if (
          m.role === "assistant" &&
          !live &&
          !m.content.trim() &&
          !m.thinking?.trim() &&
          !m.steps?.length &&
          !m.plan?.length &&
          !m.lastRun &&
          !m.lastTests
        )
          return null;
        return (
          <VirtualMessage key={m.id} message={m} live={live} enabled={chat.length > 60} scroller={scroller}>
            <MessageRow
              m={m}
              liveThink={live}
              lastUser={m.id === lastUser}
              lastAsst={!busy && m.role === "assistant" && i === chat.length - 1}
              helperLabel={helperLabel}
              trailInline={trailInline}
              setMenu={setMenu}
            />
          </VirtualMessage>
        );
      })}
    </>
  );
});
