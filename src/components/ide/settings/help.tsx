import { useIde } from "@/store/ide";
import { useHelpTour } from "@/lib/help-guide";

export function HelpSettings() {
  const en = useIde(s => s.locale) === "en";
  const prefs = useIde(s => s.helpPreferences);
  const text = (de: string, english: string) => en ? english : de;
  return <section aria-label={text("Erklärhilfen und Tour", "Explanations and tour")} className="my-4 rounded-md border border-border p-3 text-sm">
    <h3 className="font-medium">{text("Erklärhilfen und Tour", "Explanations and tour")}</h3>
    <p className="mt-1 text-xs leading-relaxed text-muted">{text("Lass dir die wichtigsten Bedienelemente erklären, wenn du mit der Maus darüber bleibst oder sie mit Tab auswählst. Die Tour zeigt dir Schritt für Schritt den Arbeitsablauf.", "Get explanations of key controls when you hover or focus them with Tab. The tour walks you through the workflow.")}</p>
    <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={prefs.tips} onChange={e => useIde.getState().setHelpPreferences({ ...prefs, tips: e.target.checked })} />{text("Erklärhilfen anzeigen", "Show explanations")}</label>
    <label className="mt-3 flex flex-wrap items-center gap-2 text-xs">{text("Erklärung erscheint nach", "Show explanation after")}
      <select className="rounded border border-border bg-bg p-1" value={prefs.delay} onChange={e => useIde.getState().setHelpPreferences({ ...prefs, delay: Number(e.target.value) as 400 | 900 | 1800 })}>
        <option value={400}>{text("Kurz · 0,4 Sekunden", "Short · 0.4 seconds")}</option><option value={900}>{text("Normal · 0,9 Sekunden", "Normal · 0.9 seconds")}</option><option value={1800}>{text("Lang · 1,8 Sekunden", "Long · 1.8 seconds")}</option>
      </select>
    </label>
    <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={prefs.pointer} onChange={e => useIde.getState().setHelpPreferences({ ...prefs, pointer: e.target.checked })} />{text("Zeigende Hand in der Tour", "Pointing hand in the tour")}</label>
    <button type="button" className="mt-3 rounded-md border border-border px-3 py-2 hover:bg-hover" onClick={() => { useIde.getState().setSettingsOpen(false); useHelpTour.getState().start(); }}>{text("Tour starten", "Start tour")}</button>
    <p className="mt-2 text-xs text-muted">{text("Jederzeit überspringbar. Die Tour sendet nichts und verändert keine Dateien.", "Skip at any time. The tour sends nothing and changes no files.")}</p>
  </section>;
}
