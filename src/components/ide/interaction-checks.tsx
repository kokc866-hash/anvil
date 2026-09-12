import { useEffect, useMemo, useRef, useState } from "react";
import { useIde } from "@/store/ide";
import { saveNow } from "@/lib/save";
import { INTERACTION_CHECKS_PATH, INTERACTION_RESULTS_PATH, interactionNative, interactionResultCurrent, interactionRevision, interactionSnapshot, parseInteractionScenarios, validateInteractionScenario, type InteractionAction, type InteractionResult, type InteractionScenario, type InteractionStep } from "@/lib/interaction-checks";

const labels: Record<InteractionAction, string> = { click: "Anklicken", fill: "Ausfüllen", reload: "Neu laden", visible: "Sichtbar prüfen", text: "Text prüfen", value: "Feldwert prüfen", count: "Anzahl prüfen" };
const field = "min-w-0 rounded border border-border bg-bg px-2 py-1.5 text-xs text-fg";
const button = "rounded border border-border px-2 py-1.5 text-xs hover:bg-hover disabled:opacity-40";

export function InteractionChecks() {
  const files = useIde(s => s.files), epoch = useIde(s => s.workspaceEpoch);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<InteractionScenario | null>(null);
  const [notice, setNotice] = useState("");
  const [running, setRunning] = useState("");
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);
  const [liveResult, setLiveResult] = useState<InteractionResult | null>(null);
  const [revision, setRevision] = useState("");
  const [scenarioRevision, setScenarioRevision] = useState("");
  const runningRef = useRef("");
  const native = interactionNative();
  const busy = Boolean(running || preparing);
  const parsed = useMemo(() => {
    try { return { scenarios: parseInteractionScenarios(files[INTERACTION_CHECKS_PATH]), error: "" }; }
    catch (error) { return { scenarios: [] as InteractionScenario[], error: String((error as Error).message) }; }
  }, [files[INTERACTION_CHECKS_PATH]]);
  const entries = useMemo(() => Object.keys(files).filter(path => /\.html?$/i.test(path) && !path.startsWith(".anvil/")), [files]);
  const saved = parsed.scenarios.find(scenario => scenario.id === selected);
  useEffect(() => { if (saved) setDraft(structuredClone(saved)); }, [saved]);
  useEffect(() => {
    setSelected(""); setDraft(null); setLiveResult(null); setNotice("");
    return () => { if (runningRef.current) void interactionNative()?.interactionCheckCancel?.(runningRef.current); };
  }, [epoch]);
  useEffect(() => {
    let current = true;
    setRevision("");
    void interactionRevision(interactionSnapshot(files)).then(value => { if (current) setRevision(value); });
    return () => { current = false; };
  }, [files]);
  useEffect(() => {
    let current = true; setScenarioRevision("");
    if (draft) void interactionRevision(draft).then(value => { if (current) setScenarioRevision(value); });
    return () => { current = false; };
  }, [draft]);
  let storedResult: InteractionResult | undefined;
  try {
    const doc = JSON.parse(files[INTERACTION_RESULTS_PATH] || "{}");
    if (doc.version === 1 && Array.isArray(doc.results)) storedResult = doc.results.find((r: InteractionResult) => r?.scenarioId === selected && typeof r.revision === "string" && typeof r.scenarioRevision === "string" && typeof r.startedAt === "string" && typeof r.durationMs === "number" && typeof r.message === "string" && ["passed", "failed", "open"].includes(r.status) && Array.isArray(r.steps) && r.steps.every(step => step && typeof step.index === "number" && typeof step.message === "string"));
  } catch { /* An invalid result never creates a success. */ }
  const result = liveResult?.scenarioId === selected ? liveResult : storedResult;
  const current = Boolean(revision && scenarioRevision && interactionResultCurrent(result, revision, scenarioRevision));
  const edited = draft && JSON.stringify(draft) !== JSON.stringify(saved);
  function changeStep(index: number, patch: Partial<InteractionStep>) {
    if (draft) setDraft({ ...draft, steps: draft.steps.map((step, i) => i === index ? { ...step, ...patch } : step) });
  }
  function create() {
    const id = crypto.randomUUID(); setSelected(id);
    setDraft({ id, name: "Neue Bedienprüfung", entry: entries[0] || "index.html", steps: [{ action: "visible", selector: "h1" }] });
    setLiveResult(null); setNotice("");
  }
  async function persist(scenarios: InteractionScenario[]) {
    useIde.getState().writeFile(INTERACTION_CHECKS_PATH, JSON.stringify({ version: 1, scenarios }, null, 2) + "\n", { quiet: true });
    return await saveNow({ path: INTERACTION_CHECKS_PATH, format: false });
  }
  async function save() {
    if (!draft || running) return false;
    try {
      validateInteractionScenario(draft);
      if (parsed.error) throw new Error("Die vorhandene Prüfdatei zuerst im Editor berichtigen; sie wird nicht überschrieben.");
      const next = [...parsed.scenarios.filter(s => s.id !== draft.id), draft];
      if (next.length > 40) throw new Error("Höchstens 40 Prüfungen pro Projekt.");
      const savedOk = await persist(next);
      setNotice(savedOk ? "Prüfung im Projekt gespeichert." : "Speichern noch offen. Hinweis in Anvil beachten.");
      return savedOk;
    } catch (error) { setNotice(String((error as Error).message)); return false; }
  }
  async function remove() {
    if (!draft || running || parsed.error) return;
    const targetEpoch = useIde.getState().workspaceEpoch;
    if (!saved || await persist(parsed.scenarios.filter(s => s.id !== draft.id))) {
      if (useIde.getState().workspaceEpoch !== targetEpoch) return;
      setSelected(""); setDraft(null); setLiveResult(null); setNotice("Prüfung entfernt.");
    }
  }
  async function run() {
    if (!draft || running || preparingRef.current) return;
    const startEpoch = useIde.getState().workspaceEpoch;
    if (!native?.interactionCheckRun) { setNotice("Bedienprüfungen benötigen die aktuelle Anvil-Desktop-Version."); return; }
    preparingRef.current = true; setPreparing(true);
    let savedOk = false;
    try { savedOk = await save(); }
    finally { preparingRef.current = false; setPreparing(false); }
    if (!savedOk || useIde.getState().workspaceEpoch !== startEpoch) return;
    const snapshot = interactionSnapshot(useIde.getState().files), scenario = structuredClone(draft);
    const id = crypto.randomUUID(); runningRef.current = id; setRunning(id); setNotice("Prüfung läuft in getrenntem, leerem Prüfspeicher …");
    try {
      const [sourceHash, scenarioHash] = await Promise.all([interactionRevision(snapshot), interactionRevision(scenario)]);
      if (useIde.getState().workspaceEpoch !== startEpoch) return;
      setLiveResult({ id, scenarioId: scenario.id, revision: sourceHash, scenarioRevision: scenarioHash, startedAt: new Date().toISOString(), durationMs: 0, steps: [], status: "open", message: "Prüfung läuft — Ergebnis offen." });
      const completed = await native.interactionCheckRun({ id, files: snapshot, scenario, revision: sourceHash, scenarioRevision: scenarioHash });
      if (useIde.getState().workspaceEpoch !== startEpoch) return;
      setLiveResult(completed);
      let previous: InteractionResult[] = [];
      const raw = useIde.getState().files[INTERACTION_RESULTS_PATH];
      if (raw) {
        try { const doc = JSON.parse(raw); if (doc.version !== 1 || !Array.isArray(doc.results)) throw new Error(); previous = doc.results; }
        catch { setNotice("Ergebnis angezeigt, aber nicht gespeichert: vorhandene Ergebnisdatei ist ungültig."); return; }
      }
      useIde.getState().writeFile(INTERACTION_RESULTS_PATH, JSON.stringify({ version: 1, results: [...previous.filter(r => r.scenarioId !== scenario.id), completed].slice(-40) }, null, 2) + "\n", { quiet: true });
      const savedOk = await saveNow({ path: INTERACTION_RESULTS_PATH, format: false });
      if (useIde.getState().workspaceEpoch === startEpoch) setNotice(savedOk ? completed.message : `${completed.message} Ergebnis noch nicht gespeichert.`);
    } catch (error) { if (useIde.getState().workspaceEpoch === startEpoch) { const message = `Prüfung offen: ${String((error as Error).message)}`; setLiveResult(previous => previous ? { ...previous, status: "open", message } : null); setNotice(message); } }
    finally { if (runningRef.current === id) { runningRef.current = ""; setRunning(""); } }
  }
  return <section className="space-y-3 border-t border-border p-3 text-fg" aria-label="Bedienprüfungen">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Bedienprüfungen</h3><button className={button} disabled={busy || !!parsed.error} onClick={create}>Neue Prüfung</button></div>
    <p className="text-xs text-muted">Gespeicherte Schritte für HTML-Projekte. Jeder Lauf beginnt mit leerem Prüfspeicher. Neuladen innerhalb einer Prüfung behält ihn; dein normales Run bleibt getrennt. Externe Dienste und Binärdateien sind nicht enthalten.</p>
    {parsed.error && <p role="alert" className="text-xs text-red-400">{parsed.error} <button className="underline" onClick={() => useIde.getState().openFile(INTERACTION_CHECKS_PATH)}>Prüfdatei öffnen</button></p>}
    {!!parsed.scenarios.length && <select aria-label="Gespeicherte Bedienprüfung" className={`${field} w-full`} value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setDraft(parsed.scenarios.find(s => s.id === event.target.value) ?? null); setLiveResult(null); setNotice(""); }}><option value="">Prüfung wählen</option>{parsed.scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
    {!draft && !parsed.error && <p className="text-xs text-muted">Zum Beispiel: Feld ausfüllen → Hinzufügen anklicken → neu laden → Text prüfen.</p>}
    {draft && <>
      <label className="grid gap-1 text-xs">Name<input className={field} value={draft.name} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="grid gap-1 text-xs">HTML-Startdatei<select className={field} value={draft.entry} disabled={busy} onChange={event => setDraft({ ...draft, entry: event.target.value })}>{!entries.includes(draft.entry) && <option value={draft.entry}>{draft.entry} (fehlt)</option>}{entries.map(entry => <option key={entry}>{entry}</option>)}</select></label>
      <p className="text-xs text-muted">CSS-Selektoren wie #aufgabe oder button[type="submit"]. Texte und Feldwerte werden exakt verglichen. Jede Erwartung wartet bis zu drei Sekunden.</p>
      <ol className="space-y-2">{draft.steps.map((step, index) => <li key={index} className="space-y-2 rounded border border-border p-2">
        <div className="flex items-center gap-2"><span className="text-xs text-muted">{index + 1}.</span><select aria-label={`Schritt ${index + 1}: Aktion`} className={`${field} flex-1`} disabled={busy} value={step.action} onChange={event => changeStep(index, { action: event.target.value as InteractionAction, value: step.value ?? "", selector: step.selector ?? "" })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className={button} aria-label={`Schritt ${index + 1} entfernen`} disabled={busy} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })}>×</button></div>
        {step.action !== "reload" && <input aria-label={`Schritt ${index + 1}: Selektor`} className={`${field} w-full`} placeholder="#element" disabled={busy} value={step.selector ?? ""} onChange={event => changeStep(index, { selector: event.target.value })} />}
        {["fill", "text", "value", "count"].includes(step.action) && <input aria-label={`Schritt ${index + 1}: Wert`} className={`${field} w-full`} placeholder={step.action === "count" ? "Erwartete Anzahl" : "Wert / exakte Erwartung"} disabled={busy} value={step.value ?? ""} onChange={event => changeStep(index, { value: event.target.value })} />}
      </li>)}</ol>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || draft.steps.length >= 40} onClick={() => setDraft({ ...draft, steps: [...draft.steps, { action: "text", selector: "", value: "" }] })}>Schritt hinzufügen</button><button className={button} disabled={busy} onClick={() => void save()}>Speichern{edited ? " *" : ""}</button><button className={button} disabled={busy || !entries.includes(draft.entry)} onClick={() => void run()}>Prüfung starten</button>{running && <button className={button} onClick={() => { setNotice("Abbruch angefordert …"); void native?.interactionCheckCancel?.(running); }}>Abbrechen</button>}<button className={button} disabled={busy} onClick={() => void remove()}>Prüfung entfernen</button></div>
    </>}
    {notice && <p role="status" className="text-xs text-muted">{notice}</p>}
    {result && <div className="space-y-2 rounded border border-border p-2 text-xs"><strong>{running ? "Prüfung läuft — Ergebnis offen" : !current ? "Veraltet — Projekt oder Prüfung verändert" : result.status === "passed" ? "Bestanden" : result.status === "failed" ? "Fehlgeschlagen" : "Offen"}</strong><p className="text-muted">{new Date(result.startedAt).toLocaleString()} · Stand {result.revision.slice(0, 10)} · {(result.durationMs / 1000).toFixed(1)} s</p><p>{result.message}</p><ol className="space-y-1">{result.steps.map(step => <li key={step.index}>{step.index + 1}. {step.status === "passed" ? "✓" : step.status === "failed" ? "×" : "…"} {step.message}</li>)}</ol></div>}
  </section>;
}
