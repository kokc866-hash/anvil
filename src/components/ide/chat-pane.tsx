import { ChatHistory } from "./chat-history";
import { chatMenu, chatSel, type ChatMenu } from "./chat-menu";
import { ContextBar } from "./chat-context";
import { AgentTodo } from "./chat-trail";
import { LongRequestHint } from "./request-status";
export { ThinkBlock, Trail, AgentTodo, HelperLaneBits, LiveTools } from "./chat-trail";
import { sendChat } from "@/lib/chat-session";
import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Plus, Send, Square, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { providerOf } from "@/lib/agent-client";

import { prepareAnvilIntent } from "@/lib/anvil";
import { isRefPath, REF_DIR } from "@/lib/ref";

import { stopAgent } from "@/lib/abort";

import { brainMentionRank, brainModelOf, brainStopNote, useBrain } from "@/lib/brain";
import { heuristicMention } from "@/lib/brain/extra-heur";
import { reflectUtterance } from "@/lib/learn";

import { cn } from "@/lib/cn";

import { useIde, type AgentMode } from "@/store/ide";
import { SurfaceSwitch } from "./surface-switch";
import { HelperPrompts } from "./helper-prompts";
import { t, useT } from "@/lib/i18n";
import { getDrag, importDropped } from "@/lib/dnd";
import { CtxMenu } from "./ctx-menu";
import { Tip } from "@/components/ui/tooltip";

import { JobAskBar } from "./job-ask-bar";
import { prepareAttachmentHints } from "@/lib/attachment-hints";
import { selectFileKeys } from "@/lib/workspace-index";

import { RequestStatus } from "./request-status";

export function ChatPane() {
  const t = useT();
  const chat = useIde((s) => s.chat);
  const agentBusy = useIde((s) => s.agentBusy);
  const trailInline = useIde((s) => s.trailInChat || !s.panels.trail);
  const trailOpen = useIde((s) => s.panels.trail);
  const finalizeAssistant = useIde((s) => s.finalizeAssistant);
  const setAgentBusy = useIde((s) => s.setAgentBusy);
  const togglePanel = useIde((s) => s.togglePanel);
  const clearChat = useIde((s) => s.clearChat);
  const setSettingsOpen = useIde((s) => s.setSettingsOpen);
  const [title, setTitle] = useState("");
  const llmProvider = useIde((s) => s.llmProvider);
  const llmModel = useIde((s) => s.llmModel);
  const helperId = useBrain((s) => s.customId.trim() || s.modelId);
  const helperLabel = brainModelOf(helperId)?.label ?? helperId;
  const agentMode = useIde((s) => s.agentMode);
  const setAgentMode = useIde((s) => s.setAgentMode);
  const attached = useIde((s) => s.attached);
  const setAttached = useIde((s) => s.setAttached);
  const fileKeys = useIde(selectFileKeys);
  const activePath = useIde((s) => s.activePath);
  const draft = useIde((s) => s.agentDraft);
  const setDraft = useIde((s) => s.setAgentDraft);
  const [mention, setMention] = useState<string | null>(null);
  const [mentionRank, setMentionRank] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [dropOn, setDropOn] = useState(false);
  const [menu, setMenu] = useState<ChatMenu | null>(null);
  const pendingAsk = useIde((s) => s.pendingAsk);
  const agentJob = useIde((s) => s.agentJob);
  const agentQueue = useIde((s) => s.agentQueue);
  const scroller = useRef<HTMLDivElement>(null);
  const pin = useRef(true);
  const [away, setAway] = useState(false);

  useEffect(() => {
    if (!pin.current) return;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, agentBusy]);

  useEffect(() => {
    if (agentBusy || draft.trim().length < 8) return;
    const timer = window.setTimeout(() => {
      void prepareAttachmentHints(draft.trim(), fileKeys);
      void prepareAnvilIntent(draft.trim()).catch(() => undefined);
    }, 750);
    return () => window.clearTimeout(timer);
  }, [draft, fileKeys, agentBusy]);

  const mentionList = useMemo(() => {
    if (mention == null) return [];
    const q = mention.toLowerCase();
    const names = fileKeys.split("\n").filter(Boolean);
    const st = useIde.getState();
    const ranked = mentionRank.length
      ? mentionRank.filter(
          (p) => names.includes(p) || p === "run" || p === "debug" || p === "problems" || p === "tests" || p === "git",
        )
      : heuristicMention(q, names, { dirty: Object.keys(st.dirty), recent: st.recentPaths, active: st.activePath });
    const pins = [
      st.output.some((r) => !r.ok) || q.startsWith("r") ? "run" : "",
      st.debug.paused || q.startsWith("d") ? "debug" : "",
      st.lspProblems.length || q.startsWith("p") ? "problems" : "",
      Object.values(st.testResults).length || q.startsWith("t") ? "tests" : "",
      Object.keys(st.dirty).length || q.startsWith("g") ? "git" : "",
    ].filter((id) => id && (!q || id.startsWith(q) || q === "@"));
    const refs = names.filter((p) => p === "ref" || p.startsWith("ref/"));
    const wantRef = q === "ref" || q.startsWith("ref/") || q === "";
    const pool = wantRef && q.startsWith("ref") ? refs : ranked.length ? ranked : names;
    const needle = q.replace(/^ref\/?/, "");
    const hits = pool.filter((p) => {
      const n = p.toLowerCase();
      return (
        !needle ||
        n.includes(q) ||
        n.includes(needle) ||
        p
          .slice(p.lastIndexOf("/") + 1)
          .toLowerCase()
          .includes(needle)
      );
    });
    const out = [...pins, ...hits].slice(0, 10);
    if (q === "ref" || q === "") out.unshift(`${REF_DIR}/`);
    return [...new Set(out)].slice(0, 10);
  }, [fileKeys, mention, mentionRank]);

  useEffect(() => {
    if (mention == null) {
      setMentionRank([]);
      return;
    }
    const names = fileKeys.split("\n").filter(Boolean);
    let live = true;
    void brainMentionRank(mention, names).then((r) => {
      if (live) setMentionRank(r);
    });
    return () => {
      live = false;
    };
  }, [mention, fileKeys]);

  const agentInbox = useIde((s) => s.agentInbox);
  const clearAgentInbox = useIde((s) => s.clearAgentInbox);

  useEffect(() => {
    if (!agentInbox || agentBusy) return;
    const text = agentInbox;
    clearAgentInbox();
    void send(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentInbox]);

  useEffect(() => {
    if (agentBusy) return;
    if (useIde.getState().agentInbox) return;
    const q = useIde.getState().agentQueue;
    if (!q.length) return;
    useIde.setState({ agentQueue: q.slice(1) });
    void send(q[0], { queued: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentBusy, agentQueue.length]);

  function stop() {
    stopAgent("Gestoppt");
    setAgentBusy(false);
    useIde.getState().failRunningSteps();
    const last = useIde.getState().chat.at(-1);
    if (last?.role === "assistant") {
      void brainStopNote(last.steps ?? []).then((note) => {
        const cur = useIde.getState().chat.at(-1);
        if (cur?.id !== last.id) return;
        const body = (cur.content || "").trim();
        finalizeAssistant(body ? `${body}\n${note}` : `Gestoppt.\n${note}`);
      });
    }
    reflectUtterance(draft, "abort");
  }

  async function send(preset?: string, opts?: { queued?: boolean; choiceId?: string }) {
    return sendChat({ preset, draft, images, title, setTitle, setDraft, setImages, setMention }, opts);
  }

  function onDraft(v: string) {
    setDraft(v);
    const at = v.match(/@([^\s@]*)$/);
    setMention(at ? at[1] : null);
  }

  function pickMention(path: string) {
    const next = draft.replace(/@([^\s@]*)$/, `@${path} `);
    setDraft(next);
    setMention(null);
    if (path === `${REF_DIR}/` || path === REF_DIR) {
      setAttached([...new Set([...attached.filter((p) => !isRefPath(p) || p === REF_DIR), REF_DIR])]);
      return;
    }
    if (/^(run|debug|problems|tests|git)$/.test(path)) return;
    if (!attached.includes(path)) setAttached([...attached, path]);
  }

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col bg-surface", dropOn ? "ring-1 ring-inset ring-accent/40" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropOn(true);
      }}
      onDragLeave={() => setDropOn(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropOn(false);
        const files = [...e.dataTransfer.files];
        if (files.length) {
          for (const f of files) {
            if (f.type.startsWith("image/")) {
              const r = new FileReader();
              r.onload = () => {
                const url = String(r.result || "");
                if (url) setImages((prev) => [...prev, url].slice(0, 4));
              };
              r.readAsDataURL(f);
            }
          }
          const rest = files.filter((f) => !f.type.startsWith("image/"));
          if (rest.length) {
            void importDropped(rest, "").then((n) => {
              if (n) useIde.getState().setNotice(t("droppedN", { n }));
            });
          }
          return;
        }
        const drag = getDrag(e.dataTransfer);
        if (drag?.path) {
          if (!attached.includes(drag.path)) setAttached([...attached, drag.path]);
          const d = useIde.getState().agentDraft;
          setDraft(d.includes(`@${drag.path}`) ? d : `${d}${d && !d.endsWith(" ") ? " " : ""}@${drag.path} `);
        }
      }}
    >
      <div
        className="flex h-10 items-center gap-1 border-b border-border px-2"
        onContextMenu={(e) => {
          e.preventDefault();
          const cur = useIde.getState().agentDraft;
          chatSel.a = cur.length;
          chatSel.b = cur.length;
          setMenu({ kind: "pane", x: e.clientX, y: e.clientY });
        }}
      >
        <div className="flex rounded-[10px] bg-bg p-0.5">
          {(["agent", "ask"] as AgentMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={cn(
                "h-7 rounded-[8px] px-2.5 text-xs font-medium",
                agentMode === m ? "bg-hover text-fg" : "text-muted hover:text-fg",
              )}
              onClick={() => setAgentMode(m)}
            >
              {m === "agent" ? t("agent") : t("ask")}
            </button>
          ))}
        </div>
        <SurfaceSwitch compact />
        <button
          type="button"
          className="min-w-0 flex-1 truncate px-2 text-left text-xs text-subtle hover:text-fg"
          onClick={() => setSettingsOpen(true)}
          title={t("pickModel")}
        >
          {title ? `${title} · ` : ""}
          {providerOf(llmProvider).label}
          {llmModel ? ` · ${llmModel}` : ""}
        </button>
        <Button
          variant="quiet"
          className="h-8 w-8 p-0"
          title={t("newChat")}
          aria-label={t("newChat")}
          onClick={() => {
            if (useIde.getState().agentBusy || useIde.getState().agentJob) stopAgent("Neuer Chat");
            clearChat();
            setTitle("");
            setDraft("");
          }}
        >
          <Plus className="size-3.5" />
        </Button>
        <Button
          variant="quiet"
          className="h-8 w-8 p-0"
          title={t("closeAgent")}
          aria-label={t("closeAgent")}
          onClick={() => togglePanel("agent")}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <div
        ref={scroller}
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3"
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest("[data-chat-msg]")) return;
          e.preventDefault();
          const cur = useIde.getState().agentDraft;
          chatSel.a = cur.length;
          chatSel.b = cur.length;
          setMenu({ kind: "pane", x: e.clientX, y: e.clientY });
        }}
        onScroll={() => {
          const el = scroller.current;
          if (!el) return;
          const at = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          pin.current = at;
          setAway(!at);
        }}
      >
        {chat.length === 0 ? (
          <div className="rounded-lg border border-border bg-bg p-3">
            <p className="text-sm text-fg">{agentMode === "ask" ? t("emptyAsk") : t("emptyAgent")}</p>
            <div className="mt-2 flex flex-col gap-1">
              {[t("hintNew"), t("hintWrite"), t("hintTests")].map((hint) => (
                <button
                  key={hint}
                  type="button"
                  className="rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-hover hover:text-fg"
                  onClick={() => {
                    if (hint === t("hintNew")) {
                      window.dispatchEvent(new Event("anvil-starter"));
                      return;
                    }
                    setDraft(hint);
                  }}
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-8 pt-8">
            <RequestStatus />
            <ChatHistory
              chat={chat}
              busy={agentBusy}
              helperLabel={helperLabel}
              trailInline={trailInline}
              setMenu={setMenu}
              scroller={scroller}
            />
            {agentBusy && !chat.at(-1)?.steps?.length && !chat.at(-1)?.plan?.length ? (
              <p className="px-1 text-xs text-muted">{agentQueue.length ? t("queued", { n: agentQueue.length }) : null}</p>
            ) : null}
            {agentQueue.length ? (
              <div className="mt-1 rounded-md border border-border bg-surface px-2 py-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted">{t("queued", { n: agentQueue.length })}</p>
                  <button
                    type="button"
                    className="text-[11px] text-danger hover:underline"
                    onClick={() => useIde.setState({ agentQueue: [] })}
                  >
                    Leeren
                  </button>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {agentQueue.map((q, i) => (
                    <li key={`${i}-${q.slice(0, 24)}`} className="flex items-center gap-2 text-[11px]">
                      <span className="min-w-0 flex-1 truncate text-fg">{q}</span>
                      <button
                        type="button"
                        className="shrink-0 text-subtle hover:text-fg"
                        aria-label="entfernen"
                        onClick={() => useIde.setState((s) => ({ agentQueue: s.agentQueue.filter((_, n) => n !== i) }))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {agentBusy && !trailOpen && chat.at(-1)?.steps?.some((s) => s.status === "run") ? (
              <button
                type="button"
                className="px-1 text-left text-[11px] text-muted hover:text-fg"
                onClick={() => togglePanel("trail")}
              >
                Tool läuft · Spur öffnen
              </button>
            ) : null}
            <LongRequestHint onStop={stop} />
            {away ? (
              <button
                type="button"
                className="sticky bottom-0 mx-auto block rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted"
                onClick={() => {
                  pin.current = true;
                  setAway(false);
                  const el = scroller.current;
                  if (el) el.scrollTop = el.scrollHeight;
                }}
              >
                Nach unten
              </button>
            ) : null}
          </div>
        )}
      </div>
      {menu ? (
        <CtxMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={chatMenu(menu, {
            addImages: (urls) => setImages((prev) => [...prev, ...urls].slice(0, 4)),
          })}
        />
      ) : null}

      {trailInline ? <AgentTodo /> : null}

      <div className="relative z-10 shrink-0 border-t border-border p-2">
        <JobAskBar />
        {pendingAsk && agentJob?.status !== "ask" ? (
          <div className="mb-1.5 flex items-start justify-between gap-2 rounded-md border border-border bg-bg px-2 py-1">
            <p className="min-w-0 font-mono text-[11px] text-muted">
              Ask · {pendingAsk.path} · {pendingAsk.text.slice(0, 80)}
            </p>
            <button type="button" className="text-subtle hover:text-fg" onClick={() => useIde.getState().setPendingAsk(null)}>
              ×
            </button>
          </div>
        ) : null}
        {images.length ? (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {images.map((src, i) => (
              <button key={i} type="button" className="relative" onClick={() => setImages(images.filter((_, n) => n !== i))}>
                <img src={src} alt="" className="h-12 w-12 rounded-md object-cover" />
              </button>
            ))}
          </div>
        ) : null}
        {attached.length ? (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {attached.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 rounded-md bg-bg px-1.5 py-0.5 font-mono text-[11px] text-muted"
              >
                @{p.split("/").pop()}
                <button
                  type="button"
                  className="text-subtle hover:text-fg"
                  onClick={() => setAttached(attached.filter((x) => x !== p))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="relative">
            {mentionList.length > 0 ? (
              <ul className="absolute inset-x-0 bottom-full mb-1 overflow-hidden rounded-md border border-border bg-surface">
                {mentionList.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      className="flex h-8 w-full items-center px-2 font-mono text-xs text-fg hover:bg-hover"
                      onClick={() => pickMention(p)}
                    >
                      {p === "run"
                        ? `@run · ${t("pinRun")}`
                        : p === "debug"
                          ? `@debug · ${t("pinDebug")}`
                          : p === "problems"
                            ? `@problems · ${t("pinProblems")}`
                            : p === "tests"
                              ? `@tests · ${t("pinTests")}`
                              : p === "git"
                                ? `@git · ${t("pinGit")}`
                                : p}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-end gap-2">
              <Tip label={t("attachImage")} side="top">
                <label className="flex h-11 w-9 cursor-pointer items-center justify-center rounded-md text-muted hover:text-fg">
                  <ImagePlus className="size-4" />
                  <input
                    id="anvil-chat-img"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      const r = new FileReader();
                      r.onload = () => {
                        const url = String(r.result || "");
                        if (url) setImages((prev) => [...prev, url].slice(0, 4));
                      };
                      r.readAsDataURL(f);
                    }}
                  />
                </label>
              </Tip>
              <textarea
                id="anvil-chat"
                value={draft}
                rows={2}
                placeholder={
                  agentJob?.status === "ask"
                    ? t("chatJobAsk")
                    : pendingAsk
                      ? t("chatAskSel")
                      : agentMode === "ask"
                        ? t("chatAsk")
                        : t("chatAgent")
                }
                className="min-h-11 flex-1 resize-none rounded-[10px] border border-border bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-subtle focus:border-fg/30 focus:ring-0"
                onPointerDown={(e) => e.currentTarget.focus()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const t = e.currentTarget;
                  chatSel.a = t.selectionStart;
                  chatSel.b = t.selectionEnd;
                  setMenu({ kind: "pane", x: e.clientX, y: e.clientY });
                }}
                onChange={(e) => onDraft(e.target.value)}
                onPaste={(e) => {
                  const files = [...e.clipboardData.items]
                    .filter((x) => x.type.startsWith("image/"))
                    .map((x) => x.getAsFile())
                    .filter((f): f is File => Boolean(f));
                  if (!files.length) return;
                  e.preventDefault();
                  for (const f of files) {
                    const r = new FileReader();
                    r.onload = () => {
                      const url = String(r.result || "");
                      if (url) setImages((prev) => [...prev, url].slice(0, 4));
                    };
                    r.readAsDataURL(f);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              {agentBusy ? (
                <Button
                  type="button"
                  variant="danger"
                  className="h-11 w-11 p-0"
                  onClick={stop}
                  aria-label={t("stop")}
                  title={t("stop")}
                >
                  <Square className="size-3.5" />
                </Button>
              ) : (
                <Button
                  variant="primary"
                  className="h-11 w-11 p-0"
                  disabled={!draft.trim() && !images.length && !pendingAsk}
                  aria-label={t("send")}
                  title={t("send")}
                  kbd="Enter"
                  type="submit"
                >
                  <Send className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </form>
        <div className="mt-1 flex items-center justify-between gap-2 px-1">
          <HelperPrompts where="chat" />
        </div>
        <FollowupChips />
        <ContextBar />
      </div>
    </div>
  );
}

function FollowupChips() {
  const items = useBrain((s) => s.followups);
  if (!items.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1 px-1">
      {items.map((p) => (
        <button
          key={p}
          type="button"
          title={p}
          className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted hover:border-fg/40 hover:text-fg"
          onClick={() => useIde.getState().pushAgent(p)}
        >
          {p.length > 42 ? `${p.slice(0, 40)}…` : p}
        </button>
      ))}
    </div>
  );
}
