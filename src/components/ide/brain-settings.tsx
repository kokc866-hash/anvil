import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  BRAIN_MODELS,
  WEBLLM_SUGGESTIONS,
  checkBrainUpdate,
  clearBrainCache,
  gpuInfo,
  loadBrain,
  modelCached,
  unloadBrain,
  useBrain,
  brainGenerate,
  brainSystem,
} from "@/lib/brain";
import { useModelLib } from "@/lib/model-lib";
import { nativeHelper } from "@/lib/helper-local";
import { ModelPick } from "./model-pick";

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`relative h-6 w-10 rounded-full border ${on ? "border-accent bg-accent" : "border-border"}`}
      onClick={() => onChange(!on)}
    >
      <span className={`ui-switch-knob absolute top-0.5 left-0.5 size-4 rounded-full bg-fg ${on ? "translate-x-4 bg-accent-fg" : ""}`} />
    </button>
  );
}

export function BrainSection() {
  const on = useBrain((s) => s.on);
  const autoLoad = useBrain((s) => s.autoLoad);
  const autoUpdate = useBrain((s) => s.autoUpdate);
  const modelId = useBrain((s) => s.modelId);
  const customId = useBrain((s) => s.customId);
  const status = useBrain((s) => s.status);
  const progress = useBrain((s) => s.progress);
  const progressText = useBrain((s) => s.progressText);
  const error = useBrain((s) => s.error);
  const loadedId = useBrain((s) => s.loadedId);
  const gpu = useBrain((s) => s.gpu);
  const fp16 = useBrain((s) => s.fp16);
  const context = useBrain((s) => s.context);
  const temperature = useBrain((s) => s.temperature);
  const maxTokens = useBrain((s) => s.maxTokens);
  const systemExtra = useBrain((s) => s.systemExtra);
  const jobs = useBrain((s) => s.jobs);
  const gpuPower = useBrain((s) => s.gpuPower);
  const useWorker = useBrain((s) => s.useWorker);
  const gpuKeepAlive = useBrain((s) => s.gpuKeepAlive);
  const gpuFitBuffer = useBrain((s) => s.gpuFitBuffer);
  const gpuWarmShaders = useBrain((s) => s.gpuWarmShaders);
  const sliding = useBrain((s) => s.sliding);
  const repeatPenalty = useBrain((s) => s.repeatPenalty);
  const autonomy = useBrain((s) => s.autonomy);
  const stats = useBrain((s) => s.stats);
  const blog = useBrain((s) => s.log);
  const updateHint = useBrain((s) => s.updateHint);
  const libVersion = useBrain((s) => s.libVersion);
  const setOn = useBrain((s) => s.setOn);
  const setJob = useBrain((s) => s.setJob);
  const autoProfile = useBrain((s) => s.autoProfile);
  const helperProfiles = useBrain((s) => s.helperProfiles);
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [gpuNow, setGpuNow] = useState("");
  const [profileName, setProfileName] = useState("");
  const [ping, setPing] = useState("");
  const [helperPath, setHelperPath] = useState("");

  useEffect(() => {
    void gpuInfo().then((g) => setGpuNow(g.ok ? g.info : g.info));
    void Promise.all(BRAIN_MODELS.map(async (m) => [m.id, await modelCached(m.id)] as const)).then((rows) => {
      setCached(Object.fromEntries(rows));
    });
    void nativeHelper()?.helperDir?.().then((p) => setHelperPath(p)).catch(() => undefined);
  }, [status, loadedId]);

  const busy = status === "downloading" || status === "checking";

  return (
    <section className="py-3">
      <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Lokaler Helfer</h3>
      <p className="mb-3 text-xs text-muted">
        Optional, lokal, schnell. Kurzbefehle, Titel, Commit-Zeile, Folge-Chips. Nach einer Runde schreibt der Helfer kurze Notizen an den Agenten (Spur: „Helfer · …“). Code, Plan und Chat immer das Hauptmodell. Der Helfer wartet nicht vor der ersten Agent-Antwort und bricht nach wenigen Sekunden ab.
      </p>
      <Row label="Helfer an" hint="Mini-Modell nur, wenn die Heuristik unsicher ist">
        <Toggle on={on} onChange={setOn} />
      </Row>
      <Row label="Automatisch merken" hint="Context, Temperatur, Sliding, Prompt pro Modell. Wechsel stellt sie wieder her.">
        <Toggle on={autoProfile} onChange={useBrain.getState().setAutoProfile} />
      </Row>
      <div className="mb-2 rounded-md border border-border px-2 py-2">
        <p className="text-xs text-muted">Helfer-Profil</p>
        <p className="mb-1 text-[11px] text-subtle">Benannter Stand: Modell, Custom-ID und Slider. Unabhängig vom Agent-Profil.</p>
        {helperProfiles.length ? (
          <ul className="mb-1 space-y-0.5">
            {helperProfiles.map((p) => (
              <li key={p.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-xs text-fg hover:bg-hover"
                  onClick={() => useBrain.getState().applyHelperProfile(p.id)}
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  className="h-7 w-7 shrink-0 rounded-md text-muted hover:text-danger"
                  aria-label="Löschen"
                  onClick={() => useBrain.getState().deleteHelperProfile(p.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-1 flex gap-1">
          <input
            value={profileName}
            placeholder="Name, z. B. Smol schnell"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-sm text-fg"
            onChange={(e) => setProfileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                useBrain.getState().saveHelperProfile(profileName);
                setProfileName("");
              }
            }}
          />
          <Button
            className="h-8 shrink-0"
            onClick={() => {
              useBrain.getState().saveHelperProfile(profileName);
              setProfileName("");
            }}
          >
            Speichern
          </Button>
        </div>
      </div>
      <label className="block py-2">
        <span className="text-xs text-muted">Autonomie</span>
        <select
          value={autonomy}
          className="mt-1 h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg"
          onChange={(e) => useBrain.getState().setAutonomy(e.target.value as "off" | "quiet" | "on")}
        >
          <option value="off">Aus — nur auf Knopfdruck</option>
          <option value="quiet">Still — lernt, keine Hinweise</option>
          <option value="on">An — Hinweise bei Fehlern, Diffs und Commits</option>
        </select>
        <span className="mt-1 block text-[11px] text-subtle">Der Helfer schreibt nie Dateien und ruft nie das Hauptmodell.</span>
      </label>
      <p className="py-1 text-[11px] text-muted">
        Jobs {stats.jobs} · Heuristik {stats.heur} · Cache {stats.cache} · LLM {stats.llm}
      </p>
      {blog.length ? (
        <ul className="mb-2 max-h-24 overflow-auto font-mono text-[10px] text-subtle">
          {blog.slice(0, 8).map((l, i) => (
            <li key={i}>
              {l.src} {l.job}
              {l.ms ? ` ${l.ms}ms` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <Row label="Beim Start laden" hint="Download kann 0.4–2.5 GB sein">
        <Toggle on={autoLoad} onChange={useBrain.getState().setAutoLoad} />
      </Row>
      <Row label="Update prüfen" hint="Runtime + HuggingFace-Stempel">
        <Toggle on={autoUpdate} onChange={useBrain.getState().setAutoUpdate} />
      </Row>
      <Row label="GPU High-Performance" hint="Discrete GPU statt Sparmodus">
        <Toggle
          on={gpuPower === "high-performance"}
          onChange={(v) => useBrain.getState().setGpuPower(v ? "high-performance" : "low-power")}
        />
      </Row>
      <Row label="GPU-Worker" hint="Inferenz nicht im UI-Thread">
        <Toggle on={useWorker} onChange={useBrain.getState().setUseWorker} />
      </Row>
      <Row label="GPU warm halten" hint="Kurzer Ping alle 70 s, damit WebGPU nicht einschläft">
        <Toggle on={gpuKeepAlive} onChange={useBrain.getState().setGpuKeepAlive} />
      </Row>
      <Row label="Puffer anpassen" hint="KV-Cache und Context an maxStorageBuffer der GPU kappen. Helfer hält nur 8 Runden.">
        <Toggle on={gpuFitBuffer} onChange={useBrain.getState().setGpuFitBuffer} />
      </Row>
      <Row label="Shader vorwärmen" hint="Nach dem Laden Prefill+Decode einmal kompilieren, erster Job wird schneller">
        <Toggle on={gpuWarmShaders} onChange={useBrain.getState().setGpuWarmShaders} />
      </Row>
      <Row label="Sliding Window" hint="Weniger VRAM bei langem Context">
        <Toggle on={sliding} onChange={useBrain.getState().setSliding} />
      </Row>
      <ModelPick
        catalog={WEBLLM_SUGGESTIONS}
        live={[]}
        prefer={BRAIN_MODELS.map((m) => m.id)}
        value={(customId.trim() || modelId).trim()}
        onChange={(id) => {
          const spec = BRAIN_MODELS.find((m) => m.id === id || m.alt === id);
          if (spec) {
            useBrain.getState().setModelId(spec.id);
            useBrain.getState().setCustomId("");
          } else {
            useBrain.getState().setCustomId(id.trim());
          }
        }}
        placeholder="Modell wählen oder ID eintippen"
        labelOf={(id) => {
          const m = BRAIN_MODELS.find((x) => x.id === id || x.alt === id);
          if (!m) return id;
          return `${m.label} · ${m.size}${cached[m.id] ? " · Cache" : ""}`;
        }}
        hint={
          BRAIN_MODELS.find((m) => m.id === (customId.trim() || modelId) || m.alt === (customId.trim() || modelId))
            ?.hint ?? "Ein Modell. Laden holt die Gewichte."
        }
      />
      {nativeHelper()?.pathsPick ? (
        <div className="mb-2 rounded-md border border-border px-2 py-2">
          <p className="text-xs text-muted">Helfer-Ordner</p>
          <p className="mb-1 font-mono text-[10px] text-subtle break-all">{helperPath || "…"}</p>
          <Button
            className="h-8"
            variant="quiet"
            onClick={() => {
              void nativeHelper()
                ?.pathsPick?.("helper")
                .then((p) => setHelperPath(p.helper));
            }}
          >
            Ordner wählen
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 py-2">
        <Button
          disabled={busy || !on}
          onClick={() => {
            const spec = BRAIN_MODELS.find((m) => m.id === (customId.trim() || modelId));
            if (spec && spec.vramMb > 2500) {
              const ok = window.confirm(
                `${spec.label} lädt ~${spec.size} von HuggingFace. Der Helfer braucht das nicht — Agent bleibt Ollama. Trotzdem laden?`,
              );
              if (!ok) return;
            }
            void loadBrain(true);
          }}
        >
          {status === "ready" ? "Neu laden" : "Laden"}
        </Button>
        <Button variant="quiet" disabled={!loadedId} onClick={() => void unloadBrain()}>
          Entladen
        </Button>
        <Button variant="quiet" disabled={!loadedId || busy} onClick={() => {
          setPing("prüfe GPU…");
          void brainGenerate({
            messages: [
              { role: "system", content: brainSystem("Antworte mit genau einem Wort: HELFER_OK") },
              { role: "user", content: "ping" },
            ],
            maxTokens: 12,
            temperature: 0,
            pri: 0,
            job: "ping",
          })
            .then((t) => setPing(`Antwort: ${t.trim() || "(leer)"} — Modell läuft.`))
            .catch((err) => setPing(err instanceof Error ? err.message : "kein Ping"));
        }}>
          Testen
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => void checkBrainUpdate()}>
          Update prüfen
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            if (useModelLib.getState().keepHelperCache && !window.confirm("Lokal behalten ist an. Cache trotzdem löschen?")) return;
            void clearBrainCache(undefined, { force: true });
          }}
        >
          Cache löschen
        </Button>
      </div>
      {(status === "downloading" || progress > 0 && progress < 1) ? (
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-hover">
          <div className="h-full bg-accent" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      ) : null}
      <div className={`mb-2 rounded-md border px-2 py-2 ${status === "ready" ? "border-ok/40" : "border-border"}`}>
        <p className={`text-sm ${status === "ready" ? "text-ok" : status === "error" ? "text-danger" : "text-fg"}`}>
          {status === "ready"
            ? `Läuft · ${BRAIN_MODELS.find((m) => m.id === loadedId || m.alt === loadedId)?.label ?? loadedId}`
            : status === "downloading"
              ? "Lädt Gewichte…"
              : status === "error"
                ? "Nicht geladen"
                : "Aus"}
        </p>
        {status === "ready" && loadedId && (() => {
          const want = (customId.trim() || modelId).trim();
          const spec = BRAIN_MODELS.find((m) => m.id === want || m.alt === want);
          const same = loadedId === want || loadedId === spec?.id || loadedId === spec?.alt;
          if (same) return null;
          return (
            <p className="text-[11px] text-danger">
              Gewählt: {spec?.label ?? want} — Neu laden, sonst bleibt das alte Modell.
            </p>
          );
        })()}
        <p className="text-[11px] text-subtle">
          {progressText || (status === "ready" ? "Kurzbefehle / Titel / Commit — nicht der Agent." : "")}
          {gpu || gpuNow ? ` · ${gpu || gpuNow}` : ""}
          {fp16 && status === "ready" ? " · fp16" : ""}
        </p>
        {ping ? <p className="mt-1 font-mono text-[11px] text-fg">{ping}</p> : null}
        {error ? <p className="text-[11px] text-danger">{error}</p> : null}
        {updateHint && updateHint !== "Aktuell" ? (
          <p className="text-[11px] text-subtle">{updateHint === "Modell-Gewichte aktualisiert. Neu laden." ? "Neuere Dateien online — nur bei Bedarf Neu laden." : updateHint}</p>
        ) : null}
      </div>

      <Slider
        label="Context"
        hint="Kleiner = schneller"
        min={1024}
        max={32768}
        step={1024}
        value={context}
        onChange={(n) => useBrain.getState().setContext(n)}
        edit
      />
      <Slider
        label="Temperatur"
        min={0}
        max={1.5}
        step={0.05}
        value={temperature}
        onChange={(n) => useBrain.getState().setTemperature(n)}
        format={(n) => n.toFixed(2)}
      />
      <Slider
        label="Max Tokens"
        min={32}
        max={2048}
        step={32}
        value={maxTokens}
        onChange={(n) => useBrain.getState().setMaxTokens(n)}
        edit
      />
      <Slider
        label="Wiederholungsstrafe"
        hint="Weniger Wiederholungen"
        min={1}
        max={1.4}
        step={0.01}
        value={repeatPenalty}
        onChange={(n) => useBrain.getState().setRepeatPenalty(n)}
        format={(n) => n.toFixed(2)}
      />
      <label className="block py-2">
        <span className="text-xs text-muted">Extra-Systemprompt</span>
        <textarea
          rows={3}
          value={systemExtra}
          placeholder="z. B. Immer duzen, keine Emojis."
          className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg"
          onChange={(e) => useBrain.getState().setSystemExtra(e.target.value)}
        />
      </label>
      <p className="mt-2 text-xs text-muted">Aufgaben</p>
      {(
        [
          ["intent", "Intent (Run/Debug/Suche aus Chat)"],
          ["distill", "Gedächtnis verdichten"],
          ["complete", "Code-Vorschläge"],
          ["palette", "Befehlspalette verstehen"],
          ["compact", "Verlauf kompakt"],
          ["inline", "Ctrl+K lokal (sonst schreibt das Hauptmodell)"],
          ["ask", "Nur Ask-Modus, kurze Fragen. Agent-Modus immer Hauptmodell"],
          ["help", "App-Hilfe (wo ist …)"],
          ["usage", "App-Nutzung still verdichten"],
          ["commit", "Commit-Nachricht"],
          ["errors", "Fehler erklären"],
          ["diffs", "Diff kurz fassen"],
          ["search", "Suche verstehen"],
          ["attach", "Passende Dateien anhängen"],
          ["title", "Chat-Titel"],
          ["doc", "Docstring/Kommentar"],
          ["prompts", "Prompt-Vorschläge in Chat und Ausgabe"],
          ["followup", "Nächste Schritte nach einer Agent-Runde"],
          ["review", "Ein Satz zur Änderung (Risiko)"],
          ["rename", "Dateiname vorschlagen beim Anlegen"],
          ["runpick", "Welche Datei Run nimmt, wenn die aktuelle nicht läuft"],
          ["fixline", "Unterschlangen als konkreten Auftrag"],
          ["tabHint", "Tab-Hinweis (eine Zeile wozu die Datei da ist)"],
          ["secrets", "Geheimnisse vor dem Prompt warnen"],
          ["mention", "@-Dateien nach Relevanz sortieren"],
          ["stopNote", "Nach Stop: 3 Stichpunkte was schon lag"],
          ["planText", "To-do-Schritte aus der Anfrage"],
          ["comment", "Kommentar über die Auswahl"],
          ["i18n", "i18n-Key aus Text (DE/EN)"],
          ["logTrim", "Run-Log auf 5 Zeilen kürzen"],
        ] as const
      ).map(([k, label]) => (
        <Row key={k} label={label}>
          <Toggle on={jobs[k]} onChange={(v) => setJob(k, v)} />
        </Row>
      ))}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg">{label}</p>
        {hint ? <p className="text-[11px] text-subtle">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}
