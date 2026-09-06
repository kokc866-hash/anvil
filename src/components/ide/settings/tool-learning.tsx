import { useState } from "react";
import { useIde } from "@/store/ide";
import { providerOf } from "@/lib/providers";
import { toolCompatibility, toolTargetKey } from "@/lib/tool-compat";
import { changeToolRule, toolLearningMode, type ToolLearningMode, type ToolRule } from "@/lib/tool-learning";

const button = "rounded-md border border-border px-3 py-2 text-xs disabled:opacity-40";

export function ToolLearningRow({ provider, model, baseUrl }: { provider: string; model: string; baseUrl: string }) {
  const key = toolTargetKey(provider, model, baseUrl || providerOf(provider).baseUrl);
  const state = useIde((s) => s.llmToolLearning[key]);
  const compatibility = useIde((s) => s.llmToolModes[key]);
  const update = useIde((s) => s.updateToolLearning);
  const de = useIde((s) => s.locale !== "en");
  const mode = toolLearningMode(state?.mode, toolCompatibility(compatibility));
  const rules = state?.rules || [];
  const labels = de ? ["Aus", "Beobachten", "Lernen & anwenden"] : ["Off", "Observe", "Learn & apply"];
  const hints = de ? {
    off: "Erkennung und gelernte Übersetzungen sind ausgeschaltet.",
    observe: "Erkennt abweichende Aufrufe und sammelt Vorschläge. Führt keine Übersetzung aus.",
    auto: "Übersetzt eindeutige Aufrufe. Nach Erfolg in zwei getrennten Aufträgen gilt eine Zuordnung als bewährt. Mehrdeutige Vorschläge brauchen deine Bestätigung.",
  } : {
    off: "Recognition and learned translations are off.",
    observe: "Records alternative call formats as suggestions without translating them.",
    auto: "Translates unambiguous calls. Success in two separate tasks establishes a mapping. Ambiguous suggestions need your confirmation.",
  };
  return <div className="min-w-0 border-t border-border py-3" role="group" aria-label={de ? "Gelernte Tool-Aufrufe" : "Learned tool calls"}>
    <p className="mb-2 text-sm text-fg">{de ? "Gelernte Tool-Aufrufe" : "Learned tool calls"}</p>
    <div className="flex flex-wrap gap-1">
      {(["off", "observe", "auto"] as ToolLearningMode[]).map((value, i) => <button key={value} type="button" aria-pressed={mode === value} className={`${button} ${mode === value ? "bg-hover text-fg" : "bg-bg text-muted"}`} onClick={() => update(key, (s) => ({ ...s, mode: value, rules: s.rules.map((r) => ({ ...r, revision: r.revision + 1 })) }))}>{labels[i]}</button>)}
    </div>
    <p className="mt-2 text-xs text-muted">{hints[mode]}</p>
    <p className="mt-1 text-xs text-muted">{de ? "Für dieses Modell an dieser Serveradresse. Text wird nur im Text-Tool-Modus gelesen. Keine zusätzlichen Modellanfragen; gespeichert werden nur Formate und Feldzuordnungen. Aus und Sperren wirken vor dem nächsten Tool-Aufruf, laufende Tools beendet Stop." : "For this model at this server address. Text is read only in text-tool mode. No extra model requests; only formats and field mappings are saved. Off and Disable affect the next tool call; Stop ends running tools."}</p>
    {!rules.length ? <p className="mt-3 text-xs text-muted">{de ? "Noch keine abweichenden Aufrufe erkannt. Gültige native Aufrufe brauchen keine Lernregel." : "No alternative calls observed. Valid native calls need no learned rule."}</p> : <>
      <div className="mt-3 flex flex-col gap-2">
        {[...rules].reverse().map((rule) => <Rule key={rule.id} rule={rule} de={de} onAction={(action, target) => update(key, (s) => changeToolRule(s, rule.id, action, target))} />)}
      </div>
      <button type="button" className={`${button} mt-2 text-muted`} onClick={() => update(key, (s) => ({ ...s, rules: [] }))}>{de ? "Regeln für dieses Modell löschen" : "Delete rules for this model"}</button>
    </>}
  </div>;
}

function Rule({ rule, de, onAction }: { rule: ToolRule; de: boolean; onAction: (action: "confirm" | "toggle" | "delete", target?: string) => void }) {
  const [picked, setPicked] = useState("");
  const target = rule.candidates.some((c) => c.name === picked) ? picked : rule.target || (rule.candidates.length === 1 ? rule.candidates[0].name : "");
  const mapping = rule.candidates.find((c) => c.name === target);
  const label = !rule.enabled ? de ? "Gesperrt" : "Disabled" : rule.review ? de ? "Bestätigung nötig" : "Needs confirmation"
    : rule.status === "manual" ? de ? "Bestätigt" : "Confirmed" : rule.status === "learned" ? de ? "Bewährt" : "Established" : de ? "Beobachtet" : "Observed";
  return <div className="min-w-0 rounded-md border border-border p-3 text-xs" data-tool-rule={rule.id}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <code className="break-all text-fg">{rule.shape.name} → {target || "?"}</code>
      <span className="text-muted">{label}</span>
    </div>
    <p className="mt-1 break-all text-muted">{rule.shape.wire === "native" ? "Native" : `JSON (${rule.shape.envelope})`}{mapping ? ` · ${Object.entries(mapping.fields).map(([a, b]) => a === b ? a : `${a} → ${b}`).join(", ") || "{}"}` : ""}</p>
    <p className="mt-1 text-muted">{de ? `Erkannt: ${rule.seen} · Erfolgreiche Aufträge: ${rule.successes} · Fehler: ${rule.failures}` : `Observed: ${rule.seen} · Successful tasks: ${rule.successes} · Errors: ${rule.failures}`}</p>
    <div className="mt-2 flex flex-wrap gap-1">
      {rule.candidates.length > 1 ? <select aria-label={de ? `Ziel für ${rule.shape.name}` : `Target for ${rule.shape.name}`} value={target} onChange={(e) => setPicked(e.target.value)} className="min-w-0 max-w-full rounded-md border border-border bg-bg px-2 text-fg">
        <option value="">{de ? "Tool wählen" : "Choose tool"}</option>
        {rule.candidates.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
      </select> : null}
      {rule.status !== "manual" || rule.review || target !== rule.target ? <button type="button" disabled={!target} onClick={() => onAction("confirm", target)} className={`${button} text-fg`}>{de ? "Zuordnung bestätigen" : "Confirm mapping"}</button> : null}
      <button type="button" onClick={() => onAction("toggle")} className={`${button} text-muted`}>{rule.enabled ? de ? "Sperren" : "Disable" : de ? "Freigeben" : "Enable"}</button>
      <button type="button" onClick={() => onAction("delete")} className={`${button} text-muted`}>{de ? "Löschen" : "Delete"}</button>
    </div>
  </div>;
}
