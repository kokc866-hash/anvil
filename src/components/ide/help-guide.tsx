import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Hand, X } from "lucide-react";
import { useIde } from "@/store/ide";
import { HELP_STEPS, useHelpTour } from "@/lib/help-guide";

/** Explanations are non-modal; the explicit tour traps focus and never operates a control. */
export function HelpGuide() {
  const prefs = useIde(s => s.helpPreferences);
  const settingsOpen = useIde(s => s.settingsOpen);
  const setupDone = useIde(s => s.setupDone);
  const en = useIde(s => s.locale) === "en";
  const step = useHelpTour(s => s.step);
  const [tip, setTip] = useState<{ index: number; target: HTMLElement } | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [position, setPosition] = useState({ left: 56, top: 12 });
  const card = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const active = step !== null;
  const index = step ?? tip?.index;
  const entry = index === undefined ? null : HELP_STEPS[index];
  const text = (de: string, english: string) => en ? english : de;

  useEffect(() => {
    if (!prefs.tips || active || settingsOpen || !setupDone) { setTip(null); return; }
    let showTimer = 0, hideTimer = 0;
    let target: HTMLElement | null = null;
    const clear = () => { window.clearTimeout(showTimer); window.clearTimeout(hideTimer); };
    const enter = (event: Event) => {
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest("[data-help-card]")) { window.clearTimeout(hideTimer); return; }
      const next = element?.closest<HTMLElement>("[data-help]") ?? null;
      // Removing the tour exposes whatever happens to be under the mouse.
      // That pointer event must not dismiss help requested with the keyboard.
      if (!next && event.type === "pointerover" && target?.contains(document.activeElement)) return;
      if (next === target) { window.clearTimeout(hideTimer); return; }
      clear(); target = next;
      const n = HELP_STEPS.findIndex(s => s.id === next?.dataset.help);
      if (next && n >= 0) showTimer = window.setTimeout(() => { if (next.isConnected) setTip({ index: n, target: next }); }, prefs.delay);
      else setTip(null);
    };
    const leave = (event: Event) => {
      const source = event.target instanceof Element ? event.target : null;
      if (!source?.closest("[data-help-card]") && source?.closest("[data-help]") !== target) return;
      if (event.type === "pointerout" && (target?.contains(document.activeElement) || card.current?.contains(document.activeElement))) return;
      const next = (event as MouseEvent).relatedTarget;
      if (next instanceof Element && (next.closest("[data-help-card]") || next.closest("[data-help]") === target)) return;
      window.clearTimeout(showTimer);
      hideTimer = window.setTimeout(() => { setTip(null); target = null; }, 350);
    };
    const dismiss = () => { clear(); target = null; setTip(null); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "F1" && card.current) { event.preventDefault(); event.stopPropagation(); card.current.focus(); }
      if (event.key === "Escape" && card.current) {
        event.stopPropagation();
        if (card.current.contains(document.activeElement)) target?.focus();
        dismiss();
      }
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("focusin", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusout", leave);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      clear(); document.removeEventListener("pointerover", enter); document.removeEventListener("focusin", enter);
      document.removeEventListener("pointerout", leave); document.removeEventListener("focusout", leave);
      document.removeEventListener("keydown", key); window.removeEventListener("scroll", dismiss, true); window.removeEventListener("resize", dismiss);
    };
  }, [prefs.tips, prefs.delay, active, settingsOpen, setupDone]);

  useEffect(() => {
    if (!active) return;
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const key = (event: KeyboardEvent) => {
      // Workspace shortcuts must not execute behind the guided tour.
      if (event.key === "Escape") { event.preventDefault(); useHelpTour.getState().stop(); }
      if (event.key === "Tab") {
        const buttons = Array.from(card.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        const first = buttons[0], last = buttons.at(-1);
        const atContainer = document.activeElement === card.current || !card.current?.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || atContainer)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || atContainer)) { event.preventDefault(); first?.focus(); }
      }
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      if (origin.current?.isConnected) origin.current.focus();
      else document.querySelector<HTMLElement>('[data-help="settings"]')?.focus();
    };
  }, [active]);

  useLayoutEffect(() => {
    if (!entry) return;
    const measure = () => {
      const visible = (element: HTMLElement | null) => element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 ? element : null;
      const target = active
        ? visible(document.querySelector<HTMLElement>(`[data-help="${entry.id}"]`)) ?? ("fallback" in entry ? visible(document.querySelector<HTMLElement>(`[data-help="${entry.fallback}"]`)) : null)
        : tip?.target;
      const bounds = target?.getBoundingClientRect() ?? null;
      setRect(bounds);
      const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
      const box = card.current?.getBoundingClientRect();
      const w = box?.width ?? 320, h = box?.height ?? 260;
      const left = bounds ? (bounds.right + w + 20 <= width ? bounds.right + 12 : bounds.left - w - 12) : (width - w) / 2;
      setPosition({ left: Math.max(12, Math.min(left, width - w - 12)), top: Math.max(12, Math.min(bounds?.top ?? 24, height - h - 12)) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    if (card.current) observer.observe(card.current);
    window.addEventListener("scroll", measure, true);
    if (active) card.current?.focus();
    return () => { observer.disconnect(); window.removeEventListener("scroll", measure, true); };
  }, [entry, active, tip, en]);

  if (!entry || (!active && (!prefs.tips || settingsOpen || !setupDone))) return null;
  const close = () => {
    if (!active && card.current?.contains(document.activeElement)) tip?.target.focus();
    setTip(null); useHelpTour.getState().stop();
  };
  const buttonClass = "rounded-md border border-border px-3 py-2 text-xs hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40";
  return createPortal(<>
    {active ? <div className="fixed inset-0 z-[100] bg-black/35" aria-hidden="true" /> : null}
    {active && rect ? <div data-testid="tour-highlight" className="pointer-events-none fixed z-[101] rounded-md border-2 border-accent" style={{ left: rect.left - 3, top: rect.top - 3, width: rect.width + 6, height: rect.height + 6, boxShadow: "0 0 0 3px var(--color-bg)" }}>
      {prefs.pointer ? <Hand data-testid="tour-hand" aria-hidden="true" className="absolute -right-2 -bottom-4 size-7 -rotate-45 fill-surface text-accent" /> : null}
    </div> : null}
    <div ref={card} data-help-card role="dialog" aria-modal={active || undefined} aria-labelledby="anvil-help-title" aria-describedby="anvil-help-body" tabIndex={-1}
      className="fixed z-[102] w-80 max-w-[calc(100vw-24px)] overflow-auto rounded-lg border border-border bg-surface p-4 text-fg shadow-xl outline-none"
      style={{ ...position, maxHeight: "calc(100dvh - 24px)" }}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted">{active ? text(`Tour · ${(step ?? 0) + 1} von ${HELP_STEPS.length}`, `Tour · ${(step ?? 0) + 1} of ${HELP_STEPS.length}`) : text("Erklärhilfe", "Explanation")}</p>
        <button type="button" aria-label={text("Hilfe schließen", "Close help")} className="rounded p-1 hover:bg-hover" onClick={close}><X className="size-4" /></button>
      </div>
      <h3 id="anvil-help-title" className="mt-2 text-sm font-medium">{en ? entry.en : entry.de}</h3>
      <p id="anvil-help-body" className="mt-2 text-xs leading-relaxed text-muted">{en ? entry.bodyEn : entry.bodyDe}</p>
      {!active ? <p className="mt-2 text-[10px] text-muted">{text("F1: Hilfe bedienen · Esc: schließen", "F1: focus help · Esc: close")}</p> : null}
      {active && !rect ? <p className="mt-2 text-xs text-muted">{text("Dieser Bereich ist im aktuellen Layout ausgeblendet.", "This area is hidden in the current layout.")}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {active ? <>
          <button type="button" className={buttonClass} disabled={step === 0} onClick={() => useHelpTour.getState().start((step ?? 0) - 1)}>{text("Zurück", "Back")}</button>
          <button type="button" className={buttonClass} onClick={() => (step ?? 0) === HELP_STEPS.length - 1 ? close() : useHelpTour.getState().start((step ?? 0) + 1)}>{(step ?? 0) === HELP_STEPS.length - 1 ? text("Tour beenden", "Finish tour") : text("Weiter", "Next")}</button>
          <button type="button" className="px-1 text-xs text-muted hover:text-fg" onClick={close}>{text("Überspringen", "Skip")}</button>
        </> : <>
          <button type="button" className={buttonClass} onClick={() => { setTip(null); useHelpTour.getState().start(index); }}>{text("In der Tour ansehen", "Show in tour")}</button>
          <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => { useIde.getState().setHelpPreferences({ ...prefs, tips: false }); setTip(null); }}>{text("Erklärhilfen ausschalten", "Turn explanations off")}</button>
        </>}
      </div>
    </div>
  </>, document.body);
}
