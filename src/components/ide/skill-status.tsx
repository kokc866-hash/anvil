import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen } from "lucide-react";
import { useIde } from "@/store/ide";
import { useLearn, openSkillLibrary } from "@/lib/learn";
import { SelectionList } from "./skill-library";

export function SkillStatus() {
  const prefs = useLearn(state => state.prefs);
  const en = useIde(state => state.locale === "en");
  const selection = useIde(state => {
    for (let index = state.chat.length - 1; index >= 0; index--) {
      if (state.chat[index].role === "assistant") return state.chat[index].skillSelection;
    }
    return undefined;
  });
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null);
  const entries = selection || [];
  useEffect(() => {
    if (!position) return;
    const close = (event: Event) => { if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setPosition(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setPosition(null); trigger.current?.focus(); } };
    const resize = () => setPosition(null);
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape); window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); window.removeEventListener("resize", resize); };
  }, [position]);
  return <div className="min-w-0" data-testid="skill-status">
    <button ref={trigger} type="button" aria-expanded={Boolean(position)} aria-haspopup="dialog" className="flex h-5 cursor-pointer items-center gap-1 rounded-sm bg-bg px-1.5 text-[10px] text-subtle" onClick={() => {
      if (position) return setPosition(null);
      const rect = trigger.current!.getBoundingClientRect();
      setPosition({ left: Math.max(8, Math.min(innerWidth - Math.min(288, innerWidth - 16) - 8, rect.right - 288)), bottom: innerHeight - rect.top + 8, maxHeight: Math.min(288, rect.top - 16) });
    }}><BookOpen className="size-3" />{prefs.skills ? `Skills ${entries.length || (prefs.skillAuto ? en ? "auto" : "Auto" : en ? "manual" : "Manuell")}` : (en ? "Skills off" : "Skills aus")}</button>
    {position ? createPortal(<div ref={popup} role="dialog" aria-label={en ? "Skills for the latest task" : "Skills des letzten Auftrags"} style={position} className="fixed z-[100] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-border bg-surface p-3 shadow-lg">
      <p className="text-xs font-medium">{en ? "Skills for the latest task" : "Skills des letzten Auftrags"}</p>
      <SelectionList entries={entries} en={en} />
      {!entries.length ? <p className="mt-2 text-[11px] text-muted">{en ? "No skill was preselected or loaded. The agent can search for other enabled skills when needed." : "Es wurde kein Skill vorausgewählt oder geladen. Der Agent kann bei Bedarf nach weiteren freigegebenen Skills suchen."}</p> : null}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">{en ? "Loaded instructions do not confirm that a task succeeded. See tool results and tests for evidence." : "Eine geladene Anleitung bestätigt noch keinen Erfolg. Entscheidend sind die Werkzeugergebnisse und Prüfungen."}</p>
      <button type="button" className="mt-2 text-xs text-fg underline" onClick={() => { setPosition(null); openSkillLibrary(); }}>{en ? "Open skill library" : "Skill-Bibliothek öffnen"}</button>
    </div>, document.body) : null}
  </div>;
}
