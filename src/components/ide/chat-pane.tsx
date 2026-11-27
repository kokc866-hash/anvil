import { ChatHistory } from "./chat-history";
import { BackgroundTaskSelector, BackgroundStartError } from "./background-task-controls";
import { useBackgroundAgent, backgroundRunning, resumeBackgroundJob } from '@/lib/background-agent';
import { chatMenu, chatSel, type ChatMenu } from "./chat-menu";
import { ContextBar } from "./chat-context";
import { AgentTodo } from "./chat-trail";
import { LongRequestHint } from "./request-status";
export { ThinkBlock, Trail, AgentTodo, HelperLaneBits, LiveTools } from "./chat-trail";
import { sendChat } from "@/lib/chat-session";
import { queuedChatRequest, queuedReplyMatches } from "@/lib/chat-queue";
import {isAskAnswer} from '@/lib/agent-ask';
import type {QueuedChatMode} from '@/lib/chat-queue';
import {TaskPlanPane} from './task-plan-pane';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Plus, Send, Square, X, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { providerOf } from "@/lib/agent-client";

import { prepareAnvilIntent } from "@/lib/anvil";
import { isRefPath, REF_DIR } from "@/lib/ref";

import { agentGen, stopAgent } from "@/lib/abort";

import { brainMentionRank, brainModelOf, brainStopNote, useBrain } from "@/lib/brain";
import { heuristicMention } from "@/lib/brain/extra-heur";
import { reflectUtterance } from "@/lib/learn";

import { cn } from "@/lib/cn";

import { useIde, type AgentMode } from "@/store/ide";
import { SurfaceSwitch } from "./surface-switch";
import { HelperPrompts } from "./helper-prompts";
import { connectionCapabilities, imageAttachmentError } from "@/lib/connection-capabilities";
import { useT } from "@/lib/i18n";
import { getDrag, importDropped } from "@/lib/dnd";
import { CtxMenu } from "./ctx-menu";
import { Tip } from "@/components/ui/tooltip";

import { JobAskBar } from "./job-ask-bar";
import { prepareAttachmentHints } from "@/lib/attachment-hints";
import { selectFileKeys } from "@/lib/workspace-index";
import { useChatComposerDraft } from "./use-chat-composer-draft";

export function ChatPane() {
  const draft = useChatComposerDraft();
  return <ChatView {...draft} />;
}

export function ChatView({images, setImages, delivery, setDelivery}: ReturnType<typeof useChatComposerDraft>) {
  const t = useT();
  const chat = useIde((s) => s.chat);
  const agentBusy = useIde((s) => s.agentBusy);
  const trailInline = useIde((s) => s.trailInChat || !s.panels.trail);
  const trailOpen = useIde((s) => s.panels.trail);
  const setAgentBusy = useIde((s) => s.setAgentBusy);
  const togglePanel = useIde((s) => s.togglePanel);
  const clearChat = useIde((s) => s.clearChat);
  const setSettingsOpen = useIde((s) => s.setSettingsOpen);
  const [title, setTitle] = useState("");
  const [planning,setPlanning]=useState(false);
  const llmProvider = useIde((s) => s.llmProvider);
  const llmModel = useIde((s) => s.llmModel);
  const llmAuthMode = useIde(s => s.llmAuthMode);
  const llmBaseUrl = useIde(s => s.llmBaseUrl);
  const locale = useIde(s => s.locale);
  const connection = { provider: llmProvider, authMode: llmAuthMode, baseUrl: llmBaseUrl, model: llmModel };
  const capabilities = connectionCapabilities(connection);
  const helperId = useBrain((s) => s.customId.trim() || s.modelId);
  const helperLabel = brainModelOf(helperId)?.label ?? helperId;
  const agentMode = useIde((s) => s.agentMode);
  const setAgentMode = useIde((s) => s.setAgentMode);
  const attached = useIde((s) => s.attached);
  const setAttached = useIde((s) => s.setAttached);
  const fileKeys = useIde(selectFileKeys);
  const draft = useIde((s) => s.agentDraft);
  const setDraft = useIde((s) => s.setAgentDraft);
  const [mention, setMention] = useState<string | null>(null);
  const [mentionRank, setMentionRank] = useState<string[]>([]);
  const [dropOn, setDropOn] = useState(false);
  const [menu, setMenu] = useState<ChatMenu | null>(null);
  const pendingAsk = useIde((s) => s.pendingAsk);
  const agentJob = useIde((s) => s.agentJob);
  const agentQueue = useIde((s) => s.agentQueue);
  const scroller = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pin = useRef(true);
  const [away, setAway] = useState(false);

  useLayoutEffect(() => {
    const field = input.current, panel = pane.current;
    if (!field || !panel) return;
    let width = -1, height = -1;
    const resize = () => {
      const nextWidth = field.clientWidth, nextHeight = panel.clientHeight;
      if (width === nextWidth && height === nextHeight) return;
      width = nextWidth; height = nextHeight;
      field.style.height = "0px";
      const limit = Math.max(44, Math.min(200, Math.floor(height * 0.26)));
      field.style.height = `${Math.min(limit, field.scrollHeight + 2)}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(field);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [draft]);

  useEffect(() => {
    if (chat.length) return;
    setTitle("");
    setMention(null);
    setMenu(null);
    pin.current = true;
    setAway(false);
  }, [chat.length]);

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
  const backgroundJob = useBackgroundAgent(s=>s.job);
  const backgroundAvailable = useBackgroundAgent(s=>s.available);
  const backgroundEnabled = useIde(s => s.backgroundAgent);
  const project = useIde(s => s.workspaceCwd || s.memoryWorkspace);
  const backgroundQuestion = backgroundEnabled && backgroundJob?.project === project && !backgroundJob.dismissed && backgroundJob.status === 'waiting-user' ? backgroundJob.ask : null;
  const canResume = backgroundEnabled && backgroundAvailable && !agentBusy && agentJob?.status !== 'ask' && !planning && agentMode === 'agent' && backgroundJob?.project === project && !backgroundJob.dismissed && !backgroundRunning(backgroundJob) && backgroundJob.status !== 'done' && backgroundJob.status !== 'waiting-user' && !draft.trim() && !images.length && !pendingAsk;
  const steering = agentBusy && agentJob?.status !== "ask" && delivery === "steer";
  const sendLabel = canResume ? (locale === "en" ? "Resume" : "Fortsetzen") : steering ? (locale === "en" ? "Send correction" : "Korrektur senden") : t("send");
  const queueSending = useRef(false);
  const [queueWake,setQueueWake]=useState(0);

  useEffect(() => {
    // Read the current busy flag: another effect may already have started work
    // since this render. Inbox and queue must share one consumer.
    const st = useIde.getState();
    if (queueSending.current || st.agentBusy) return;
    const project=st.workspaceCwd||st.memoryWorkspace,asking=st.agentJob?.status==='ask';
    const fromInbox=Boolean(st.agentInbox&&(!asking||queuedReplyMatches(queuedChatRequest(st.agentInbox),st.agentJob,project)));
    const queueIndex=asking?st.agentQueue.findIndex(entry=>queuedReplyMatches(queuedChatRequest(entry),st.agentJob,project)):0;
    const entry = fromInbox?st.agentInbox:st.agentQueue[queueIndex];
    if (!entry) return;
    const request = queuedChatRequest(entry);
    if(asking&&!queuedReplyMatches(request,st.agentJob,project))return;
    const awaitingBackgroundAnswer=backgroundJob?.status==='waiting-user'&&!backgroundJob.dismissed;
    if(!request?.reply&&request?.mode==='agent'&&st.backgroundAgent&&(!backgroundAvailable||backgroundRunning(backgroundJob)&&backgroundJob?.project===(st.workspaceCwd||st.memoryWorkspace)||awaitingBackgroundAnswer&&backgroundJob?.project===(st.workspaceCwd||st.memoryWorkspace)))return;
    const queued = !fromInbox;
    let consumed=false;
    const accepted=()=>{consumed=true;useIde.setState(current=>{
      if(fromInbox)return current.agentInbox===entry?{agentInbox:null}:{};
      const index=current.agentQueue.indexOf(entry);
      return index<0?{}:{agentQueue:current.agentQueue.filter((_,i)=>i!==index)};
    });};
    if(!request||request.reply&&!queuedReplyMatches(request,st.agentJob,project)||request&&!request.reply&&isAskAnswer(request.text)){accepted();if(request)st.setNotice('Die frühere Rückfrage ist nicht mehr aktuell oder nicht eindeutig zugeordnet. Ihre Antwort wurde nicht ausgeführt.');return;}
    queueSending.current=true;
    void send(request.text,{queued,mode:request.mode,onAccepted:accepted}).finally(()=>{queueSending.current=false;if(consumed)setQueueWake(n=>n+1);});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentBusy, agentInbox, agentQueue, agentJob?.id, agentJob?.status, agentJob?.ask?.id, backgroundAvailable, backgroundJob?.id, backgroundJob?.status, backgroundJob?.dismissed,queueWake]);

  function stop() {
    stopAgent("Gestoppt");
    setAgentBusy(false);
    useIde.getState().failRunningSteps();
    const stopped = agentGen();
    const last = useIde.getState().chat.at(-1);
    if (last?.role === "assistant") {
      void brainStopNote(last.steps ?? []).then((note) => {
        const cur = useIde.getState().chat.at(-1);
        if (stopped !== agentGen() || cur?.id !== last.id || !note) return;
        const body = cur.content.trim();
        if (body.includes(note.slice(0, 24))) return;
        useIde.setState((state) => ({ chat: state.chat.map((message) => message.id === cur.id
          ? { ...message, content: body ? `${body}\n${note}` : note } : message) }));
      });
    }
    reflectUtterance(draft, "abort");
  }

  function addImages(urls: string[]) {
    const st = useIde.getState();
    const error = imageAttachmentError({ provider: st.llmProvider, authMode: st.llmAuthMode, baseUrl: st.llmBaseUrl, model: st.llmModel }, urls.length, st.locale);
    if (error) { st.setNotice(error); return; }
    setImages(prev => [...prev, ...urls].slice(0, 4));
  }

  async function send(preset?: string, opts?: { queued?: boolean; choiceId?: string; mode?: QueuedChatMode; onAccepted?:()=>void }) {
    const st = useIde.getState();
    const queued=Boolean(opts?.onAccepted),sendImages=queued?[]:images;
    const error = imageAttachmentError({ provider: st.llmProvider, authMode: st.llmAuthMode, baseUrl: st.llmBaseUrl, model: st.llmModel }, sendImages.length, st.locale);
    if (error) { st.setNotice(error); return; }
    const background = useBackgroundAgent.getState().job;
    if (!queued && st.agentJob?.status !== 'ask' && st.backgroundAgent && background?.project === (st.workspaceCwd || st.memoryWorkspace) && !background.dismissed && background.status === 'waiting-user' && background.ask) {
      const text = (preset ?? st.agentDraft).trim();
      if (!text || sendImages.length) { if (sendImages.length) st.setNotice('Beantworte die Rückfrage als Text oder mit einer angebotenen Antwort.'); return; }
      const choice = !background.ask.allowText ? background.ask.choices.find(choice => choice.id.toLowerCase() === text.toLowerCase() || choice.label.toLowerCase() === text.toLowerCase()) : undefined;
      const submitted = st.agentDraft;
      if (await resumeBackgroundJob({askId:background.ask.id,...(choice ? {choiceId:choice.id} : {text})}, background.id)) {
        if (!preset && useIde.getState().agentDraft === submitted) setDraft('');
      }
      return;
    }
    if (!queued && st.agentJob?.status !== 'ask' && st.backgroundAgent && !preset && !st.agentDraft.trim() && !sendImages.length && !st.pendingAsk && !planning && st.agentMode === 'agent' && background?.project === (st.workspaceCwd || st.memoryWorkspace) && !background.dismissed && !backgroundRunning(background) && !['done','waiting-user'].includes(background.status)) {
      return resumeBackgroundJob(undefined, background.id);
    }
    // Enter can follow a paste/store update before React renders a new handler.
    // Read the current draft so that a fast submit never sends stale/empty text.
    const route = !queued && st.agentBusy && st.agentJob?.status !== 'ask' ? delivery : 'queue';
    const updateImages = route === 'steer'
      ? (next: string[]) => setImages(current => current === sendImages ? next : current)
      : setImages;
    return sendChat({ preset, draft: queued?'':st.agentDraft, images:sendImages, title, setTitle, setDraft:queued?()=>{}:setDraft, setImages:queued?()=>{}:updateImages, setMention:queued?()=>{}:setMention }, {...opts,mode:opts?.mode??(planning?'plan':undefined),delivery:route});
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
      ref={pane}
      className={cn("chat-pane flex h-full min-h-0 min-w-0 flex-col bg-surface", dropOn ? "ring-1 ring-inset ring-accent/40" : "")}
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
                if (url) addImages([url]);
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
        className="chat-head"
        onContextMenu={(e) => {
          e.preventDefault();
          const cur = useIde.getState().agentDraft;
          chatSel.a = cur.length;
          chatSel.b = cur.length;
          setMenu({ kind: "pane", x: e.clientX, y: e.clientY });
        }}
      >
        <div data-help="modes" className="flex rounded-[10px] bg-bg p-0.5">
          {(["agent", "ask"] as AgentMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={cn(
                "h-7 rounded-[8px] px-2.5 text-xs font-medium",
                !planning&&agentMode === m ? "bg-hover text-fg" : "text-muted hover:text-fg",
              )}
              onClick={() => {setPlanning(false);setAgentMode(m);}}
              aria-pressed={!planning&&agentMode === m}
              title={m === "agent" ? t("agentModeHint") : t("askModeHint")}
            >
              {m === "agent" ? t("agent") : t("ask")}
            </button>
          ))}
          <button type="button" className={cn('h-7 rounded-[8px] px-2.5 text-xs font-medium',planning?'bg-hover text-fg':'text-muted hover:text-fg')} aria-pressed={planning} onClick={()=>setPlanning(true)} title={locale === "en" ? "Read the project and draft a plan" : "Projekt lesen und einen Plan entwerfen"}>{locale === "en" ? "Plan" : "Planen"}</button>
        </div>
        <div className="chat-head-context">
        <SurfaceSwitch compact />
        <BackgroundTaskSelector />
        <button
          type="button"
          data-chat-model
          className="min-w-0 flex-1 truncate rounded px-1 text-left text-xs text-muted hover:text-fg"
          onClick={() => setSettingsOpen(true)}
          title={t("pickModel")}
        >
          {title ? `${title} · ` : ""}
          {providerOf(llmProvider).label}
          {llmModel ? ` · ${llmModel}` : ""}
        </button>
        </div>
        <div className="chat-head-actions">
        <Button
          variant="quiet"
          className="h-8 w-8 p-0"
          title={t("newChat")}
          aria-label={t("newChat")}
          onClick={() => clearChat()}
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
      </div>
      <p className="chat-mode-hint shrink-0 border-b border-border px-3 py-1.5 text-[11px] leading-relaxed text-muted" data-testid="chat-mode-hint"
        data-mode-warning={(agentBusy || agentJob?.status === "ask") && agentJob?.mode && agentJob.mode !== agentMode ? true : undefined}>
        {(agentBusy || agentJob?.status === "ask") && agentJob?.mode
          ? <>{agentJob.mode === "agent" ? t("agentModeHint") : t("askModeHint")} {locale === "en" ? "This task keeps its mode. The selector applies to your next task." : "Diese Aufgabe behält ihren Modus. Die Auswahl gilt für deinen nächsten Auftrag."}</>
          : agentMode === "agent" ? t("agentModeHint") : t("askModeHint")}
      </p>

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
            <TaskPlanPane />
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
                  {agentQueue.map((q, i) => {
                    const request = queuedChatRequest(q);
                    if (!request) return null;
                    return <li key={`${i}-${request.text.slice(0, 24)}`} className="flex items-center gap-2 text-[11px]">
                      <span className="shrink-0 text-muted">{request.mode === "ask" ? t("ask") : t("agent")}</span>
                      <span className="min-w-0 flex-1 truncate text-fg">{request.text}</span>
                      <button
                        type="button"
                        className="shrink-0 text-subtle hover:text-fg"
                        aria-label="entfernen"
                        onClick={() => useIde.setState((s) => ({ agentQueue: s.agentQueue.filter((_, n) => n !== i) }))}
                      >
                        ×
                      </button>
                    </li>;
                  })}
                </ul>
              </div>
            ) : null}
            {agentBusy && !trailOpen && chat.at(-1)?.steps?.some((s) => s.status === "run") ? (
              <button
                type="button"
                className="px-1 text-left text-[11px] text-muted hover:text-fg"
                onClick={() => togglePanel("trail")}
              >
                Werkzeug wird ausgeführt · Spur öffnen
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
            addImages,
          })}
        />
      ) : null}

      {trailInline ? <AgentTodo /> : null}

      <div className="chat-composer relative z-10 shrink-0 border-t border-border p-2">
        <div className="composer-options">
        {agentBusy && agentJob?.status !== "ask" && <div className="composer-delivery mb-1.5 flex items-center gap-2 text-sm text-muted">
          <label htmlFor="chat-delivery">{locale === "en" ? "Message" : "Nachricht"}</label>
          <select id="chat-delivery" className="min-h-8 min-w-0 max-w-full flex-1 rounded-md border border-border bg-bg px-2 text-sm text-fg" value={delivery}
            onChange={e => setDelivery(e.target.value as "queue" | "steer")}>
            <option value="queue">{locale === "en" ? "Queue for later" : "Danach ausführen"}</option>
            <option value="steer">{locale === "en" ? "Correct current task" : "Auftrag korrigieren"}</option>
          </select>
        </div>}
        <JobAskBar />
        {pendingAsk && agentJob?.status !== "ask" ? (
          <div className="mb-1.5 flex items-start justify-between gap-2 rounded-md border border-border bg-bg px-2 py-1">
            <p className="min-w-0 font-mono text-[11px] text-muted">
              Frage · {pendingAsk.path} · {pendingAsk.text.slice(0, 80)}
            </p>
            <button type="button" className="text-subtle hover:text-fg" onClick={() => useIde.getState().setPendingAsk(null)}>
              ×
            </button>
          </div>
        ) : null}
        {images.length && capabilities.images === "unsupported" ? <p role="alert" className="px-3 py-1 text-xs text-danger">{imageAttachmentError(connection, images.length, locale)} <button type="button" className="underline" onClick={() => setSettingsOpen(true)}>{locale === "en" ? "Choose connection" : "Verbindung wählen"}</button></p> : null}
        {images.length ? (
          <div className="composer-images mb-1.5 flex gap-1 overflow-x-auto">
            {images.map((src, i) => (
              <button key={i} type="button" className="relative shrink-0 rounded-md" aria-label={locale === "en" ? `Remove image ${i + 1}` : `Bild ${i + 1} entfernen`} onClick={() => setImages(images.filter((_, n) => n !== i))}>
                <img src={src} alt="" className="size-10 rounded-md object-cover" />
                <X aria-hidden="true" className="pointer-events-none absolute right-0 top-0 size-4 rounded-bl bg-bg/90 p-0.5 text-fg" />
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
        <BackgroundStartError />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="relative">
            {mentionList.length > 0 ? (
              <ul className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-[min(12rem,30dvh)] overflow-auto rounded-md border border-border bg-surface">
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
            <div className="chat-input-row">
              <Tip label={capabilities.images === "unsupported" ? imageAttachmentError(connection, 1, locale) : t("attachImage")} side="top">
                <label className="chat-attach relative flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg focus-within:outline-2 focus-within:outline-ring">
                  <ImagePlus className="size-4" />
                  <input
                    id="anvil-chat-img"
                    onClick={(e) => { if (capabilities.images === "unsupported") { e.preventDefault(); useIde.getState().setNotice(imageAttachmentError(connection, 1, locale)); } }}
                    type="file"
                    accept="image/*"
                    aria-label={t("attachImage")}
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      const r = new FileReader();
                      r.onload = () => {
                        const url = String(r.result || "");
                        if (url) addImages([url]);
                      };
                      r.readAsDataURL(f);
                    }}
                  />
                </label>
              </Tip>
              <textarea
                ref={input}
                id="anvil-chat"
                value={draft}
                rows={2}
                placeholder={
                  agentJob?.status === "ask" || backgroundQuestion
                    ? t("chatJobAsk")
                    : pendingAsk
                      ? t("chatAskSel")
                      : steering ? (locale === "en" ? "What should the agent change?" : "Was soll der Agent korrigieren?")
                      : agentMode === "ask"
                        ? t("chatAsk")
                        : t("chatAgent")
                }
                className="chat-input min-h-11 min-w-0 resize-none overflow-y-auto rounded-md bg-bg px-2 py-2 text-sm text-fg outline-none placeholder:text-subtle"
                onPointerDown={(e) => e.currentTarget.focus()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const t = e.currentTarget;
                  chatSel.a = t.selectionStart;
                  chatSel.b = t.selectionEnd;
                  setMenu({ kind: "pane", x: e.clientX, y: e.clientY, selection: t.value.slice(t.selectionStart, t.selectionEnd) });
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
                      if (url) addImages([url]);
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
              <div className="chat-input-actions flex items-center gap-1">
              {agentBusy && (
                <Button
                  type="button"
                  variant="danger"
                  className="h-9 w-9 p-0"
                  onClick={e=>{e.preventDefault();stop();}}
                  aria-label={t("stop")}
                  title={t("stop")}
                  tipSide="left"
                >
                  <Square className="size-3.5" />
                </Button>
              )}
                <Button
                  variant="primary"
                  className="h-9 min-w-9 gap-1.5 px-2"
                  disabled={!canResume && !draft.trim() && !images.length && !pendingAsk}
                  aria-label={sendLabel}
                  title={sendLabel}
                  tipSide="left"
                  kbd="Enter"
                  type="submit"
                >
                  {canResume ? <Play className="size-4" /> : <Send className="size-4" />}
                  {steering && <span className="text-xs">{t("send")}</span>}
                </Button>
              </div>
            </div>
          </div>
        </form>
        <div className="composer-meta">
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 px-1">
            <FollowupChips />
            <HelperPrompts where="chat" />
          </div>
          <ContextBar />
        </div>
      </div>
    </div>
  );
}

function FollowupChips() {
  const items = useBrain((s) => s.followups);
  if (!items.length) return null;
  return (
    <>
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
    </>
  );
}
