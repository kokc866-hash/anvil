import { useState } from "react";
import { Brain, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { profile, useLearn, workspaceId } from "@/lib/learn";
import { formatJournal, isJournalEmpty, EMPTY_JOURNAL } from "@/lib/session";
import { debugSkill } from "@/lib/skill-debug";
import { cn } from "@/lib/cn";
import { useIde } from "@/store/ide";

export function MemoryPane() {
  const on = useLearn((s) => s.on);
  const facts = useLearn((s) => s.facts);
  const skills = useLearn((s) => s.skills);
  const events = useLearn((s) => s.events);
  const negs = useLearn((s) => s.negs) ?? [];
  const setOn = useLearn((s) => s.setOn);
  const forgetFact = useLearn((s) => s.forgetFact);
  const forgetSkill = useLearn((s) => s.forgetSkill);
  const forgetNeg = useLearn((s) => s.forgetNeg);
  const writeSkill = useLearn((s) => s.writeSkill);
  const addFact = useLearn((s) => s.addFact);
  const clear = useLearn((s) => s.clear);
  const setSidebar = useIde((s) => s.setSidebar);
  const p = profile();
  const ws = workspaceId();
  const [tab, setTab] = useState<"person" | "project" | "session" | "skills" | "neg" | "log">("person");
  const [draft, setDraft] = useState("");
  const person = facts.filter((f) => f.scope !== "project" && f.kind !== "project");
  const proj = facts.filter((f) => (f.scope === "project" || f.kind === "project") && (!f.ws || f.ws === ws));
  const shownSkills = skills.filter((s) => s.scope !== "project" || !s.ws || s.ws === ws);
  const journal = useIde((s) => s.sessionJournal);
  const setSessionJournal = useIde((s) => s.setSessionJournal);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-10 items-center gap-1 border-b border-border px-2">
        <Brain className="size-3.5 text-muted" />
        <span className="min-w-0 flex-1 px-1 text-xs font-medium tracking-wide text-muted uppercase">Gedächtnis</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className={cn("relative h-6 w-10 rounded-full border", on ? "border-accent bg-accent" : "border-border")}
          onClick={() => setOn(!on)}
        >
          <span className={cn("absolute top-0.5 size-4 rounded-full bg-fg", on ? "left-5 bg-accent-fg" : "left-0.5")} />
        </button>
        <Button variant="quiet" className="h-8 w-8 p-0" aria-label="Schließen" onClick={() => setSidebar(null)}>
          <X className="size-3.5" />
        </Button>
      </div>
      <p className="border-b border-border px-3 py-2 text-[11px] text-muted">
        {ws} · {p.topLang || "—"} · Run {p.run} · Debug {p.debug} · +{p.accept}/−{p.reject} · Undo {p.undo}
      </p>
      <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1">
        {(
          [
            ["person", "Person"],
            ["project", "Projekt"],
            ["session", "Sitzung"],
            ["skills", "Skills"],
            ["neg", "Nicht"],
            ["log", "Log"],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            className={cn("h-7 rounded-md px-2 text-[11px]", tab === t ? "bg-hover text-fg" : "text-muted")}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2 text-xs">
        {tab === "person" || tab === "project"
          ? (tab === "person" ? person : proj).map((f) => (
              <div key={f.id} className="mb-1.5 rounded-md border border-border px-2 py-1.5">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-fg">{f.text}</p>
                  <button type="button" className="text-subtle hover:text-fg" onClick={() => forgetFact(f.id)}>
                    ×
                  </button>
                </div>
                <p className="text-[10px] text-subtle">
                  {f.kind} · {Math.round(f.conf * 100)}% · {f.hits}×
                </p>
              </div>
            ))
          : tab === "session"
            ? isJournalEmpty(journal)
              ? <p className="text-muted">Die Sitzung füllt sich, sobald der Agent arbeitet. Überlebt Compacting und Neustart — auch bei mittleren Projekten.</p>
              : (
                <div className="rounded-md border border-border px-2 py-1.5">
                  <p className="mb-1 text-[10px] text-subtle">{journal.turns} Runden · {journal.files.length} Dateien</p>
                  <pre className="whitespace-pre-wrap font-mono text-[11px] text-fg">{formatJournal(journal)}</pre>
                  <button type="button" className="mt-2 text-[10px] text-subtle hover:text-fg" onClick={() => setSessionJournal({ ...EMPTY_JOURNAL })}>
                    Sitzung leeren
                  </button>
                </div>
              )
          : tab === "skills"
            ? shownSkills.map((s) => {
                const dbg = debugSkill(s);
                return (
                <div key={s.id} className="mb-1.5 rounded-md border border-border px-2 py-1.5">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 font-medium text-fg">{s.name}</p>
                    <button type="button" className="text-subtle hover:text-fg" onClick={() => forgetSkill(s.id)}>
                      ×
                    </button>
                  </div>
                  <p className="text-muted">{s.when}</p>
                  <p className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-subtle">{s.body.slice(0, 280)}</p>
                  <p className="text-[10px] text-subtle">
                    {s.scope} · {Math.round((s.score ?? 0.5) * 100)}% · {s.wins ?? 0} ok / {s.fails ?? 0} fail
                    {dbg.ok ? " · ok" : ""}
                  </p>
                  {!dbg.ok
                    ? dbg.issues.map((i) => (
                        <p key={i} className="text-[10px] text-danger">
                          {i}
                        </p>
                      ))
                    : null}
                </div>
                );
              })
            : tab === "neg"
              ? negs.map((n) => (
                  <div key={n.id} className="mb-1.5 flex gap-2 rounded-md border border-border px-2 py-1.5">
                    <p className="min-w-0 flex-1 font-mono text-muted">
                      {n.path}: {n.text}
                    </p>
                    <button type="button" className="text-subtle hover:text-fg" onClick={() => forgetNeg(n.id)}>
                      ×
                    </button>
                  </div>
                ))
              : events.slice(0, 50).map((e, i) => (
                  <p key={`${e.t}-${i}`} className="truncate font-mono text-[11px] text-muted">
                    {e.k}
                    {e.d ? ` · ${e.d}` : ""}
                  </p>
                ))}
        {tab === "person" && person.length === 0 ? <p className="text-muted">Noch keine Personen-Fakten.</p> : null}
        {tab === "project" && proj.length === 0 ? <p className="text-muted">Noch keine Projekt-Fakten für {ws}.</p> : null}
        {tab === "skills" && shownSkills.length === 0 ? <p className="text-muted">Keine Skills für {ws}.</p> : null}
        {tab === "neg" && negs.length === 0 ? <p className="text-muted">Keine abgelehnten Muster.</p> : null}
      </div>
      {tab !== "session" && tab !== "log" && tab !== "neg" ? (
      <form
        className="flex gap-1 border-t border-border p-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft.trim();
          if (!t) return;
          if (tab === "skills") writeSkill({ name: t.split(":")[0] ?? "skill", when: t, body: t, kind: "guide" });
          else if (tab === "project") addFact("project", t, 0.9);
          else addFact("user", t, 0.9);
          setDraft("");
        }}
      >
        <input
          value={draft}
          placeholder={tab === "skills" ? "Neuer Skill" : tab === "project" ? "Projekt-Fakt" : "Person-Fakt"}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-xs text-fg outline-none"
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button className="h-8 text-[11px]" type="submit">
          +
        </Button>
      </form>
      ) : null}
      <button
        type="button"
        className="px-3 pb-2 text-[10px] text-subtle hover:text-fg"
        onClick={() => {
          clear();
          setSessionJournal({ ...EMPTY_JOURNAL });
        }}
      >
        Alles vergessen
      </button>
    </div>
  );
}
