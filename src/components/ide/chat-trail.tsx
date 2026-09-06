import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { estimateTokens, formatTokens } from "@/lib/tokens";

import { diffPreview } from "@/lib/diff";
import { testsPrompt } from "@/lib/test-parse";

import { filterTrailSteps, stepLabel, stepPath } from "@/lib/trail-filter";

import { useBrain } from "@/lib/brain";

import { cn } from "@/lib/cn";
import { CodeBlock } from "@/lib/syntax";

import { useIde, type AgentStep, type ChatMsg, type PlanStep } from "@/store/ide";

import { t, useT } from "@/lib/i18n";

import { formatElapsed, useElapsed } from "@/lib/elapsed";
import { AgentPulse } from "./agent-pulse";

export function ThinkBlock({
  text,
  live,
  fill,
  height,
  onResize,
  onOpen,
  hideResize,
  opened,
  since,
}: {
  text: string;
  live?: boolean;
  fill?: boolean;
  height?: number;
  onResize?: (h: number) => void;
  onOpen?: (open: boolean) => void;
  hideResize?: boolean;
  opened?: boolean;
  since?: number;
}) {
  const t = useT();
  const thinkMs = useElapsed(since, Boolean(live));
  const [open, setOpen] = useState(Boolean(live));
  const [pinned, setPinned] = useState(false);
  const [h, setH] = useState(180);
  const preRef = useRef<HTMLPreElement>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const wasLive = useRef(Boolean(live));
  const cap = () => Math.round(window.innerHeight * 0.8);
  const size = fill ? (height ?? 180) : h;
  const shown = opened ?? open;

  function setOpenBoth(v: boolean) {
    setOpen(v);
    onOpen?.(v);
  }

  useEffect(() => {
    if (live && !pinned) setOpenBoth(true);
    if (wasLive.current && !live && !pinned) {
      const t = window.setTimeout(() => setOpenBoth(false), 380);
      wasLive.current = false;
      return () => window.clearTimeout(t);
    }
    wasLive.current = Boolean(live);
  }, [live, pinned]);

  useEffect(() => {
    if (shown && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [text, open, shown]);

  useEffect(() => {
    function move(e: PointerEvent) {
      const d = drag.current;
      if (!d) return;
      const next = Math.max(72, Math.min(cap(), d.h + (e.clientY - d.y)));
      if (onResize) onResize(next);
      else setH(next);
    }
    function up() {
      drag.current = null;
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [onResize]);

  if (!live && !text.trim()) return null;
  const view = live && text.length > 16_000 ? text.slice(-16_000) : text;
  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-hidden rounded-lg bg-bg",
        fill && shown ? "flex h-full min-h-0 flex-col" : fill ? "shrink-0" : "mb-2",
      )}
    >
      <div className="flex shrink-0 items-center gap-1 px-2 py-1 text-[11px] text-muted">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left hover:text-fg"
          onClick={() => {
            setPinned(true);
            setOpenBoth(!shown);
          }}
        >
          <ChevronRight className={cn("size-3 shrink-0 transition-transform duration-300", shown ? "rotate-90" : "")} />
          <span className={cn("shrink-0", live ? "think-live text-fg" : "")}>
            {live ? t("thinkingLive") : t("trailThinkLabel")}
          </span>
        </button>
        {live ? <AgentPulse className="shrink-0" tip={false} /> : null}
        {live && thinkMs ? <span className="font-mono text-[10px] text-subtle">{formatElapsed(thinkMs)}</span> : null}
        {text.trim() ? (
          <span className="shrink-0 font-mono text-[10px] text-subtle">{formatTokens(estimateTokens(text))}</span>
        ) : null}
      </div>
      {fill ? (
        shown ? (
          <>
            <pre
              ref={preRef}
              className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-1 font-mono text-[11px] leading-4 break-words text-muted whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {view}
              {live ? <span className="think-caret" /> : null}
            </pre>
            {hideResize ? null : (
              <div
                role="separator"
                title={t("dragHeight")}
                className="flex h-2 shrink-0 cursor-ns-resize items-center justify-center hover:bg-hover"
                onPointerDown={(e) => {
                  e.preventDefault();
                  drag.current = { y: e.clientY, h: size };
                }}
              >
                <span className="block h-0.5 w-8 rounded-full bg-border" />
              </div>
            )}
          </>
        ) : null
      ) : (
        <div className={cn("think-body", shown && "open")}>
          <div className="think-clip">
            <pre
              ref={preRef}
              className="max-w-full min-w-0 overflow-auto px-2 pb-1 font-mono text-[11px] leading-4 break-words text-muted whitespace-pre-wrap [overflow-wrap:anywhere]"
              style={{ height: h }}
            >
              {view}
              {live ? <span className="think-caret" /> : null}
            </pre>
            <div
              role="separator"
              title={t("dragHeight")}
              className="flex h-2 cursor-ns-resize items-center justify-center hover:bg-hover"
              onPointerDown={(e) => {
                e.preventDefault();
                drag.current = { y: e.clientY, h };
              }}
            >
              <span className="block h-0.5 w-8 rounded-full bg-border" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function HelperLaneBits() {
  const notes = useBrain((s) => s.lane);
  const t = useT();
  if (!notes.length) return null;
  return (
    <ul className="mb-1 space-y-0.5">
      {notes.slice(-4).map((n) => (
        <li key={`${n.t}-${n.kind}`} className="min-w-0 truncate font-mono text-[11px] text-muted" title={n.text}>
          <span className="text-ok">{t("helper")}</span> · {n.text}
        </li>
      ))}
    </ul>
  );
}

export function Trail({ m, live, liveTools = true, fill }: { m: ChatMsg; live: boolean; liveTools?: boolean; fill?: boolean }) {
  const t = useT();
  const locale = useIde((s) => s.locale);
  const loopTries = useIde((s) => s.loopTries);
  const run = m.lastRun;
  const attempt = run?.attempt ?? 0;
  const max = run?.max ?? loopTries;
  const raw = liveTools ? (m.steps ?? []) : (m.steps ?? []).filter((s) => s.status !== "run");
  const steps = filterTrailSteps(raw);
  const frames = (m.steps ?? []).filter((s) => s.image).slice(-8);
  const work = [...steps].reverse().find((s) => s.status === "run");
  const clip = (s: string) => s.trim().split("\n").slice(-24).join("\n").slice(0, 1600);
  const hasRound = Boolean(m.changes?.length);
  const hasRun = Boolean(run?.path || run?.running || run?.stdout || run?.stderr);
  const labelOf = (name: string) => stepLabel(name, locale);
  if (!steps.length && !hasRun && !frames.length && !m.lastTests && !hasRound && !m.harness && !live) {
    if (fill) return <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-bg px-2.5 py-2" />;
    return <HelperLaneBits />;
  }

  const body = (
    <>
      {fill ? null : <HelperLaneBits />}
      <div className="mb-1 flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium tracking-wide text-subtle uppercase">{t("trail")}</p>
          <p
            className={cn(
              "mt-0.5 truncate text-[11px] tabular-nums",
              run?.running || work || live ? "text-fg" : run && !run.ok ? "text-danger" : run?.ok ? "text-ok" : "text-muted",
            )}
          >
            {m.harness ? `${m.harness} · ` : ""}
            {run?.running
              ? `${t("trailRun")} ${Math.min(attempt, max)}/${max}${run.path ? ` · ${run.path}` : ""}`
              : hasRun
                ? `${t("trailTry")} ${Math.min(attempt, max)}/${max}${run?.ok ? "" : ` · ${t("fail")}`}${run?.path ? ` · ${run.path}` : ""}${run?.graphical ? ` · ${t("trailPic")}` : ""}`
                : work
                  ? `${labelOf(work.name)}${work.detail ? ` · ${work.detail}` : ""}`
                  : live
                    ? t("working")
                    : ""}
          </p>
        </div>
        {run?.path && !live && !run.running ? (
          <button
            type="button"
            className="h-6 shrink-0 rounded-sm px-1.5 text-[10px] text-fg hover:bg-hover"
            onClick={() => {
              const p = run.path;
              if (!p) return;
              useIde.getState().pushAgent(t("trailAgainAsk", { p }), true);
            }}
          >
            {t("trailAgain")}
          </button>
        ) : null}
      </div>
      {frames.length ? (
        <div className="mb-1 flex gap-1 overflow-x-auto py-0.5">
          {frames.map((s) => (
            <button
              key={s.id}
              type="button"
              className="shrink-0"
              title={s.detail || s.name}
              onClick={() => {
                const p = s.path || stepPath(s);
                if (p) useIde.getState().openFile(p);
              }}
            >
              <img src={s.image} alt="" className="h-16 w-auto rounded-sm border border-border" />
            </button>
          ))}
        </div>
      ) : null}
      {steps.length ? (
        <StepList steps={steps} />
      ) : live ? (
        <p className="mt-1 text-[11px] text-muted think-live">
          {work ? `${labelOf(work.name)}${work.detail ? ` · ${work.detail}` : ""}` : t("thinkingLive")}
        </p>
      ) : null}
      {run && (run.stdout || run.stderr) ? (
        <pre className={cn("mt-1 max-h-32 overflow-auto font-mono text-[10px] leading-4", run.ok ? "text-muted" : "text-danger")}>
          {clip([run.stdout, run.stderr].filter(Boolean).join("\n\n")) || run.path}
        </pre>
      ) : run?.running ? (
        <p className="mt-1 text-[10px] text-muted think-live">{t("trailOut")}</p>
      ) : null}
      {m.lastTests ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
          {m.lastTests.running ? (
            <span className="think-live text-fg">{t("running")}</span>
          ) : (
            <button
              type="button"
              className={m.lastTests.fail ? "text-danger hover:underline" : "text-ok hover:underline"}
              onClick={() => useIde.getState().setSidebar("tests")}
            >
              {t("tests")} {m.lastTests.pass}/{m.lastTests.pass + m.lastTests.fail}
              {m.lastTests.fail ? ` · ${m.lastTests.fail} ${t("fail")}` : ""}
            </button>
          )}
          {!live && (m.lastTests.fail ?? 0) > 0 ? (
            <button
              type="button"
              className="text-fg hover:underline"
              onClick={() => useIde.getState().pushAgent(testsPrompt(Object.values(useIde.getState().testResults)))}
            >
              {t("fixFails")}
            </button>
          ) : null}
        </div>
      ) : null}
      {hasRound ? <RoundFiles m={m} live={live} /> : null}
    </>
  );

  if (!fill) {
    return <div className="mb-2 overflow-hidden rounded-lg bg-bg px-2.5 py-2">{body}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-bg">
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2.5 py-2">{body}</div>
    </div>
  );
}

function RoundFiles({ m, live }: { m: ChatMsg; live: boolean }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const ck = useIde((s) => s.checkpoints.find((c) => c.id === m.checkpointId) ?? null);
  const now = useIde((s) => s.files);
  const changes = m.changes ?? [];
  const plus = changes.reduce((n, c) => n + (c.add || 0), 0);
  const minus = changes.reduce((n, c) => n + (c.del || 0), 0);
  const hasSnap = Boolean(ck && Object.keys(ck.files).length);

  function restore() {
    if (!m.checkpointId) return;
    const ok = useIde.getState().restoreCheckpoint(m.checkpointId);
    useIde.getState().setNotice(ok ? t("restored") : t("noSnapshot"));
    setAsk(false);
  }

  return (
    <div className="mt-1.5 border-t border-border pt-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted">
        <span className="text-fg">{t("roundDiff")}</span>
        {changes.length ? (
          <span>
            {t("roundFiles", { n: changes.length })}
            {plus || minus ? ` · +${plus} −${minus}` : ""}
          </span>
        ) : live ? null : (
          <span>{t("roundNone")}</span>
        )}
        {!live && hasSnap ? (
          ask ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-fg">{t("restoreAsk")}</span>
              <button type="button" className="text-danger hover:underline" onClick={restore}>
                {t("restoreRound")}
              </button>
              <button type="button" className="hover:underline" onClick={() => setAsk(false)}>
                {t("roundKeep")}
              </button>
            </span>
          ) : (
            <button type="button" className="ml-auto text-fg hover:underline" onClick={() => setAsk(true)}>
              {t("restoreRound")}
            </button>
          )
        ) : null}
      </div>
      {changes.slice(0, 32).map((c) => {
        const shown = open === c.path;
        const before = ck?.files[c.path] ?? "";
        const after = c.kind === "del" ? "" : (now[c.path] ?? "");
        return (
          <div key={c.path} className="mt-0.5">
            <button
              type="button"
              className="flex w-full items-baseline gap-2 text-left font-mono text-[11px] text-fg hover:underline"
              onClick={() => setOpen(shown ? null : c.path)}
            >
              <span className={c.kind === "add" ? "text-ok" : c.kind === "del" ? "text-danger" : "text-muted"}>
                {c.kind === "add" ? "+" : c.kind === "del" ? "−" : "~"}
              </span>
              <span className="min-w-0 truncate">{c.path}</span>
              {c.add || c.del ? (
                <span className="ml-auto shrink-0 text-[10px] text-subtle">
                  {c.add ? `+${c.add}` : ""}
                  {c.add && c.del ? " " : ""}
                  {c.del ? `−${c.del}` : ""}
                </span>
              ) : null}
            </button>
            {shown ? (
              <div className="mt-0.5 pl-4">
                {c.kind === "del" ? (
                  <p className="text-[10px] text-danger">{t("trailDeleted")}</p>
                ) : (
                  <MiniDiff before={before} after={after} />
                )}
                <button
                  type="button"
                  className="mt-0.5 text-[10px] text-muted hover:text-fg"
                  onClick={() => useIde.getState().openRoundDiff(c.path, m.checkpointId)}
                >
                  {t("inEditor")}
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MiniDiff({ before, after }: { before: string; after: string }) {
  const rows = diffPreview(before, after, 2, 80);
  if (!rows.length) return <p className="text-[10px] text-subtle">—</p>;
  return (
    <pre className="max-h-40 overflow-auto font-mono text-[10px] leading-4">
      {rows.map((r, i) => (
        <div key={i} className={r.type === "add" ? "text-ok" : r.type === "del" ? "text-danger" : "text-subtle"}>
          {r.type === "add" ? "+" : r.type === "del" ? "−" : " "} {r.text || " "}
        </div>
      ))}
    </pre>
  );
}

export function AgentTodo({ plan: forced, msgId }: { plan?: PlanStep[]; msgId?: string } = {}) {
  const plan = useIde((s) => {
    if (msgId) return s.chat.find((m) => m.id === msgId)?.plan ?? forced;
    if (forced) return forced;
    for (let i = s.chat.length - 1; i >= 0; i--) {
      const m = s.chat[i];
      if (m.role === "assistant" && m.plan?.length) return m.plan;
    }
    return undefined;
  });
  const busy = useIde((s) => s.agentBusy);
  const [open, setOpen] = useState(true);
  const seen = useRef("");

  useEffect(() => {
    const key = plan?.map((s) => s.text).join("|") ?? "";
    if (key && key !== seen.current) {
      seen.current = key;
      setOpen(true);
    }
  }, [plan]);

  if (!plan?.length) return null;
  const done = plan.filter((s) => s.status === "ok").length;
  const run = plan.find((s) => s.status === "run");

  return (
    <div className="shrink-0 border-t border-border bg-surface">
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 px-3 text-left text-xs text-muted hover:text-fg"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
        <span className="font-medium text-fg">To-do</span>
        <span className="tabular-nums">
          {done}/{plan.length}
        </span>
        {!open && run ? <span className="min-w-0 truncate think-live text-fg">{run.text}</span> : null}
        {!open && !run && busy ? <span className="think-live">…</span> : null}
      </button>
      {open ? (
        <div className="max-h-56 overflow-auto px-3 pb-2">
          <PlanList steps={plan} msgId={msgId} />
        </div>
      ) : null}
    </div>
  );
}

function PlanList({ steps, msgId }: { steps: { text: string; status: "todo" | "run" | "ok" | "err" }[]; msgId?: string }) {
  return (
    <ol className="space-y-0.5">
      {steps.map((s, i) => (
        <li key={i}>
          <button
            type="button"
            className="flex w-full items-baseline gap-2 text-left text-[11px] leading-4 hover:bg-hover"
            onClick={() => {
              const next = s.status === "ok" || s.status === "err" ? "todo" : s.status === "run" ? "ok" : "ok";
              useIde.getState().updatePlanStep(i, next, msgId);
            }}
          >
            <span
              className={
                s.status === "ok"
                  ? "text-ok"
                  : s.status === "err"
                    ? "text-danger"
                    : s.status === "run"
                      ? "think-live text-fg"
                      : "text-muted"
              }
            >
              {s.status === "ok" ? "☑" : s.status === "err" ? "✕" : s.status === "run" ? "…" : "☐"}
            </span>
            <span className={s.status === "ok" ? "text-muted line-through" : "text-fg"}>{s.text}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function StepList({ steps }: { steps: AgentStep[] }) {
  const locale = useIde((s) => s.locale);
  const live = steps.some((s) => s.status === "run");
  const now = useElapsed(live ? steps.find((s) => s.status === "run")?.at : undefined, live);
  return (
    <ol className="mt-1 space-y-1">
      {steps.map((s) => {
        const ms = s.status === "run" && s.at ? now : s.ms;
        const path = s.path || stepPath(s);
        return (
          <li key={s.id} className="flex min-w-0 items-start gap-2 font-mono text-[11px] leading-4">
            <span
              className={cn(
                "mt-0.5 shrink-0",
                s.status === "err" ? "text-danger" : s.status === "run" ? "think-live text-fg" : "text-ok",
              )}
            >
              {s.status === "err" ? "✕" : s.status === "run" ? "…" : "✓"}
            </span>
            <div className="min-w-0 flex-1 overflow-hidden">
              <button
                type="button"
                className="flex min-w-0 items-baseline gap-1.5 text-left"
                onClick={() => {
                  if (path) useIde.getState().openFile(path);
                }}
              >
                <span className="shrink-0 text-fg">{stepLabel(s.name, locale)}</span>
                {s.detail ? (
                  <span className="min-w-0 truncate text-muted" title={s.detail}>
                    {s.detail}
                  </span>
                ) : null}
                {ms ? (
                  <span className={cn("ml-auto shrink-0 tabular-nums text-subtle", s.status === "run" && "think-live")}>
                    {formatElapsed(ms)}
                  </span>
                ) : null}
              </button>
              {s.code ? <WriteBlock path={s.path} code={s.code} before={s.before} live={s.status === "run"} /> : null}
              {s.image ? <img src={s.image} alt="" className="mt-1 max-h-28 rounded-md border border-border" /> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function LiveTools({ steps }: { steps: AgentStep[] }) {
  const t = useT();
  if (!steps.length) return null;
  return (
    <div className="mb-2 overflow-hidden rounded-md border border-border bg-hover px-2 py-1.5">
      <p className="mb-0.5 flex items-center gap-2 text-[10px] font-medium tracking-wide text-muted uppercase">
        <span className="think-live text-fg">{t("trailLive")}</span>
      </p>
      <StepList steps={steps} />
    </div>
  );
}

function WriteBlock({ path, code, before, live }: { path?: string; code: string; before?: string; live?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(Boolean(live));
  const wasLive = useRef(Boolean(live));
  useEffect(() => {
    if (live) setOpen(true);
    if (wasLive.current && !live) {
      const t = window.setTimeout(() => setOpen(false), 600);
      wasLive.current = false;
      return () => window.clearTimeout(t);
    }
    wasLive.current = Boolean(live);
  }, [live]);
  const lines = code.split("\n").length;
  return (
    <div className="mt-1 overflow-hidden rounded-md border border-border bg-bg">
      <button
        type="button"
        className="flex h-7 w-full items-center gap-2 px-2 text-left text-[11px] text-muted hover:text-fg"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
        <span className={cn("font-mono", live ? "think-live text-fg" : "text-fg")}>
          {live ? t("trailWrites") : before ? t("trailPatch") : t("trailFile")}
        </span>
        <span className="min-w-0 truncate font-mono">{path || "code"}</span>
        <span className="ml-auto tabular-nums text-subtle">{t("trailLines", { n: lines })}</span>
      </button>
      {open ? (
        <div className="border-t border-border">
          {before ? (
            <MiniDiff before={before} after={code} />
          ) : (
            <div className="max-h-56 overflow-auto">
              <CodeBlock code={code} lang="" path={path} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
