import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/cn";
import { listModels } from "@/lib/agent-client";
import { wantsThinking, type ThinkingMode } from "@/lib/llm-options";
import type { CompactMode } from "@/lib/compact";
import { CONTEXT_MAX, CONTEXT_MIN, CONTEXT_SIZES, formatContext, matchingContextChip } from "@/lib/tokens";
import { LEARN_DEFAULTS, useLearn, type LearnPrefs } from "@/lib/learn";
import {
  ACTION_LABELS,
  INPUT_ACTIONS,
  prettyKey,
  prettyPad,
  type InputAction,
} from "@/lib/input-map";
import {
  clearLocation,
  diskSupported,
  loadSlotAll,
  locationName,
  pickLocation,
  saveSlot,
  type DiskSlot,
} from "@/lib/disk";
import { ANVIL_ROLES } from "@/lib/anvil";
import { ANVIL_BUILD, ANVIL_VERSION } from "@/lib/version";
import { BrainSection } from "./brain-settings";
import { ModelLibSection } from "./model-lib-settings";
import { newMcpId, type McpServer } from "@/lib/mcp";
import { ModelPick } from "./model-pick";
import { CompanionSetup } from "./companion-setup";
import { loadSecrets, saveSecrets } from "@/lib/secrets";
import {
  dumpGraph,
  dumpHarness,
  GRAPH_PATH,
  HARNESS_PATH,
  guessProjectHarness,
  loadProjectGraph,
  loadProjectHarness,
} from "@/lib/harness-project";
import { BOARD_PATH, filesFromBoard, rebuildBoardFromGraph } from "@/lib/harness-board";
import type { AfterWrite } from "@/lib/harness";
import { loadVault, saveVault, type VaultEntry } from "@/lib/vault";
import { providerOf, type LlmProvider } from "@/lib/providers";
import { nativeHelper } from "@/lib/helper-local";
import { useIntern } from "@/lib/intern";
import {
  PRESETS,
  useIde,
  type MotionLevel,
  type OutputDock,
  type SplitMode,
  type StorageMode,
  type ThemeName,
} from "@/store/ide";
import { applyLang, useT, type Locale } from "@/lib/i18n";
import { confirmApp } from "@/lib/confirm";
import { chordFromEvent, chordOwner, formatChord, KEY_DEFAULTS, KEY_GROUPS, KEY_LABEL, type KeyId } from "@/lib/keymap";
import { applySettingsPack, exportSettingsPack, resetAllSettings } from "@/lib/settings-io";
import { capLabel, getCap, resetCap } from "@/lib/model-caps";
import { appLogOn, appLogLines, clearAppLog, copyAppLog, exportAppLog, setAppLogOn, subscribeAppLog } from "@/lib/app-log";
import { loadSubFromNative, loginSubFromNative, credsForProvider, saveAbo, SUB_KIND_META, type SubKind } from "@/lib/sub-auth";
import { ProviderPick } from "./provider-pick";
import { appLog } from "@/lib/app-log";

type Cat = "agent" | "companion" | "brain" | "models" | "learn" | "intern" | "editor" | "layout" | "output" | "storage" | "input" | "keys" | "data";

const CATS: { id: Cat; key: string }[] = [
  { id: "agent", key: "catAgent" },
  { id: "companion", key: "catCompanion" },
  { id: "brain", key: "catHelper" },
  { id: "models", key: "catModels" },
  { id: "learn", key: "catMemory" },
  { id: "intern", key: "catIntern" },
  { id: "editor", key: "catEditor" },
  { id: "layout", key: "catLayout" },
  { id: "output", key: "catOutput" },
  { id: "storage", key: "catStorage" },
  { id: "input", key: "catInput" },
  { id: "keys", key: "catKeys" },
  { id: "data", key: "catData" },
];

export function SettingsPane() {
  const [cat, setCat] = useState<Cat>("agent");
  const [q, setQ] = useState("");
  const setSettingsOpen = useIde((s) => s.setSettingsOpen);
  const t = useT();
  const query = q.trim().toLowerCase();
  const show = (id: Cat) => !query || id === cat || query.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">{t("settings")}</h2>
        <input
          value={q}
          placeholder={t("searchPh")}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none placeholder:text-subtle"
          onChange={(e) => setQ(e.target.value)}
        />
        <Button variant="quiet" className="h-8 px-2 text-xs" onClick={() => setSettingsOpen(false)}>
          {t("done")}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-36 shrink-0 flex-col gap-0.5 overflow-auto border-r border-border p-2 sm:flex">
          {CATS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setCat(c.id);
                setQ("");
              }}
              className={cn(
                "h-8 rounded-md px-2 text-left text-sm",
                cat === c.id && !query ? "bg-hover text-fg" : "text-muted hover:text-fg",
              )}
            >
              {t(c.key)}
            </button>
          ))}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto px-4 pb-8">
          <div className="bar-scroll flex gap-1 py-3 sm:hidden">
            {CATS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCat(c.id)}
                className={cn(
                  "h-8 shrink-0 rounded-md border px-2 text-xs",
                  cat === c.id ? "border-accent text-fg" : "border-border text-muted",
                )}
              >
                {t(c.key)}
              </button>
            ))}
          </div>
          {(query || cat === "agent") && show("agent") ? <AgentSection q={query} /> : null}
          {(query || cat === "companion") && show("companion") && (!query || /companion|compiler|go|rustc|javac|token|7845|koppeln|pair/i.test(query)) ? (
            <section className="pb-6">
              <h3 className="pt-4 pb-1 text-xs font-medium tracking-wide text-muted uppercase">{t("catCompanion")}</h3>
              <CompanionSetup />
            </section>
          ) : null}
          {(query || cat === "brain") && show("brain") ? <BrainSection /> : null}
          {(query || cat === "models") && show("models") ? <ModelLibSection /> : null}
          {(query || cat === "learn") && show("learn") ? <LearnSection q={query} /> : null}
          {(query || cat === "intern") && show("intern") ? <InternSection q={query} /> : null}
          {(query || cat === "editor") && show("editor") ? <EditorSection q={query} /> : null}
          {(query || cat === "layout") && show("layout") ? <LayoutSection q={query} /> : null}
          {(query || cat === "output") && show("output") ? <OutputSection q={query} /> : null}
          {(query || cat === "storage") && show("storage") ? <StorageSection q={query} /> : null}
          {(query || cat === "input") && show("input") ? <InputSection q={query} /> : null}
          {(query || cat === "keys") && show("keys") ? <KeysSection q={query} /> : null}
          {(query || cat === "data") && show("data") ? <DataSection q={query} /> : null}
        </div>
      </div>
    </div>
  );
}

function InternSection({ q }: { q: string }) {
  const prefs = useIntern((s) => s.prefs);
  const faults = useIntern((s) => s.faults);
  const setPrefs = useIntern((s) => s.setPrefs);
  const setPane = useIntern((s) => s.setPane);
  const restart = useIntern((s) => s.restart);
  const clear = useIntern((s) => s.clear);
  const open = faults.filter((f) => f.open).length;
  const t = useT();
  return (
    <section>
      <Head>{t("intern")}</Head>
      <p className="mb-2 text-xs text-muted">{t("internIntro")}</p>
      <Vis q={q} label="Intern an Auto-heilen Weich">
        <Row label={t("internOn")} hint={t("internOnHint")}>
          <Toggle on={prefs.on} onChange={(v) => setPrefs({ on: v })} />
        </Row>
        <Row label={t("autoHeal")} hint={t("autoHealHint")}>
          <Toggle on={prefs.autoHeal} onChange={(v) => setPrefs({ autoHeal: v })} />
        </Row>
        <Row label={t("softOnFull")} hint={t("softOnFullHint")}>
          <Toggle on={prefs.autoSoft} onChange={(v) => setPrefs({ autoSoft: v })} />
        </Row>
      </Vis>
      <Vis q={q} label="Fehlerbuch Neustart Fabrik factory">
        <p className="py-2 text-xs text-muted">
          {t("openN", { n: open, total: faults.length })}
          {faults[0] ? ` · ${faults[0].kind}` : ""}
        </p>
        <div className="flex flex-wrap gap-1 py-1">
          <Button className="h-8" variant="quiet" onClick={() => setPane(true)}>
            {t("errorBook")}
          </Button>
          <Button className="h-8" variant="quiet" onClick={() => void restart("soft")}>
            {t("softReload")}
          </Button>
          <Button className="h-8" variant="quiet" onClick={() => void restart("hard")}>
            {t("hardReload")}
          </Button>
          <Button
            className="h-8"
            variant="quiet"
            onClick={() => {
              void confirmApp(t("factoryConfirm"), { danger: true, ok: t("factory") }).then((ok) => {
                if (ok) void restart("factory");
              });
            }}
          >
            {t("factory")}
          </Button>
          <Button className="h-8" variant="quiet" onClick={() => clear()}>
            {t("clearBook")}
          </Button>
        </div>
      </Vis>
      <AppLogSettings q={q} />
    </section>
  );
}

function AppLogSettings({ q }: { q: string }) {
  const t = useT();
  const [on, setOn] = useState(appLogOn);
  const [n, setN] = useState(() => appLogLines().length);
  useEffect(() => {
    const un = subscribeAppLog(() => setN(appLogLines().length));
    setOn(appLogOn());
    return un;
  }, []);
  return (
    <Vis q={q} label="App-Log debug kopieren export">
      <Row label={t("appLog")} hint={t("appLogHint")}>
        <Toggle
          on={on}
          onChange={(v) => {
            setAppLogOn(v);
            setOn(v);
          }}
        />
      </Row>
      <p className="py-1 text-xs text-muted">{n ? `${n} Zeilen` : t("appLogEmpty")}</p>
      <div className="flex flex-wrap gap-1 py-1">
        <Button
          className="h-8"
          variant="quiet"
          disabled={!n}
          onClick={() => {
            void copyAppLog().then((ok) => {
              if (ok) useIde.getState().setNotice(t("appLogCopied"));
            });
          }}
        >
          {t("appLogCopy")}
        </Button>
        <Button className="h-8" variant="quiet" disabled={!n} onClick={() => exportAppLog()}>
          {t("appLogExport")}
        </Button>
        <Button
          className="h-8"
          variant="quiet"
          disabled={!n}
          onClick={() => {
            void confirmApp(t("appLogClear") + "?", { ok: t("appLogClear") }).then((ok) => {
              if (ok) {
                clearAppLog();
                setN(0);
              }
            });
          }}
        >
          {t("appLogClear")}
        </Button>
      </div>
    </Vis>
  );
}

function AgentSection({ q }: { q: string }) {
  const t = useT();
  const llmProvider = useIde((s) => s.llmProvider);
  const llmAuthMode = useIde((s) => s.llmAuthMode);
  const llmBaseUrl = useIde((s) => s.llmBaseUrl);
  const llmModel = useIde((s) => s.llmModel);
  const llmApiKey = useIde((s) => s.llmApiKey);
  const agentRules = useIde((s) => s.agentRules);
  const agentMode = useIde((s) => s.agentMode);
  const autoAcceptDiffs = useIde((s) => s.autoAcceptDiffs);
  const autoRunAgent = useIde((s) => s.autoRunAgent);
  const learnOn = useLearn((s) => s.on);
  const setLlmProvider = useIde((s) => s.setLlmProvider);
  const setLlmAuthMode = useIde((s) => s.setLlmAuthMode);
  const setLlmBaseUrl = useIde((s) => s.setLlmBaseUrl);
  const setLlmModel = useIde((s) => s.setLlmModel);
  const setLlmApiKey = useIde((s) => s.setLlmApiKey);
  const setAgentRules = useIde((s) => s.setAgentRules);
  const setAgentMode = useIde((s) => s.setAgentMode);
  const setAutoAcceptDiffs = useIde((s) => s.setAutoAcceptDiffs);
  const setAutoRunAgent = useIde((s) => s.setAutoRunAgent);
  const llmContext = useIde((s) => s.llmContext);
  const llmContextAuto = useIde((s) => s.llmContextAuto);
  const setLlmContext = useIde((s) => s.setLlmContext);
  const setLlmContextAuto = useIde((s) => s.setLlmContextAuto);
  const llmThinking = useIde((s) => s.llmThinking);
  const llmTemperature = useIde((s) => s.llmTemperature);
  const llmMaxOut = useIde((s) => s.llmMaxOut);
  const setLlmThinking = useIde((s) => s.setLlmThinking);
  const setLlmTemperature = useIde((s) => s.setLlmTemperature);
  const setLlmMaxOut = useIde((s) => s.setLlmMaxOut);
  const llmCompact = useIde((s) => s.llmCompact);
  const setLlmCompact = useIde((s) => s.setLlmCompact);
  const llmRetries = useIde((s) => s.llmRetries);
  const setLlmRetries = useIde((s) => s.setLlmRetries);
  const llmHardStopMin = useIde((s) => s.llmHardStopMin);
  const setLlmHardStopMin = useIde((s) => s.setLlmHardStopMin);
  const [ctxCustom, setCtxCustom] = useState(false);
  const ctxChip = matchingContextChip(llmContext);
  const llmProfiles = useIde((s) => s.llmProfiles);
  const saveLlmProfile = useIde((s) => s.saveLlmProfile);
  const applyLlmProfile = useIde((s) => s.applyLlmProfile);
  const deleteLlmProfile = useIde((s) => s.deleteLlmProfile);
  const [probe, setProbe] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [subMsg, setSubMsg] = useState("");
  const spec = providerOf(llmProvider);
  const creds = credsForProvider(llmProvider, llmAuthMode);
  const aboOn = creds.via === "abo";

  async function probeLocal(silent = false) {
    const url = llmBaseUrl || spec.baseUrl;
    if (!silent) setProbe(`Prüfe ${url || spec.label} …`);
    setModelsBusy(true);
    try {
      const ids = await listModels({
        provider: llmProvider,
        baseUrl: llmBaseUrl,
        apiKey: creds.token || llmApiKey,
      });
      setModels(ids);
      if (!llmModel && ids[0]) setLlmModel(ids[0]);
      if (ids.length && llmModel && !ids.includes(llmModel)) setLlmModel(ids[0]);
      setProbe(ids.length ? `${ids.length} Modelle` : `Verbunden, keine Modelle`);
      const note = await import("@/lib/model-context").then((m) => m.applyCloudContext());
      if (note) setProbe((p) => `${p} · Kontext ${note}`);
    } catch (err) {
      if (!silent) setModels([]);
      setProbe(err instanceof Error ? err.message : `Keine Verbindung`);
    } finally {
      setModelsBusy(false);
    }
  }

  useEffect(() => {
    if (llmProvider === "grok") {
      setModels([]);
      return;
    }
    if (llmAuthMode === "key" && spec.needsKey && !llmApiKey.trim() && !creds.token) return;
    if (llmAuthMode === "abo" && spec.needsSub && !creds.token) return;
    const t = window.setTimeout(() => void probeLocal(true), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmProvider, llmBaseUrl, llmApiKey]);

  function takeSub(kind: SubKind, how: "load" | "login") {
    const meta = SUB_KIND_META.find((m) => m.kind === kind);
    if (meta) {
      setLlmAuthMode("abo");
      setLlmProvider(meta.provider as LlmProvider);
    }
    const run = how === "login" ? loginSubFromNative : loadSubFromNative;
    if (how === "login") setSubMsg(`${t("subSignIn")}…`);
    void run(kind).then((r) => {
      if (!r.ok) {
        setSubMsg(r.error);
        return;
      }
      saveAbo(kind, r);
      setSubMsg(`${t("subOk")}${r.email ? ` · ${r.email}` : ""}`);
      appLog("sub", `${kind} ${r.email || r.preview}`);
      void probeLocal(true);
    });
  }

  return (
    <section>
      <Head>Agent</Head>
      <p className="mb-2 text-xs text-muted">{ANVIL_ROLES.model} Die App handelt selbst (Run, Git, Dateien). {ANVIL_ROLES.helper}</p>
      <Vis q={q} label="Anbieter Modell Key">
        <ProviderPick
          value={llmProvider}
          via={llmAuthMode}
          status={subMsg || (aboOn ? t("subOk") : undefined)}
          onChange={(id, via) => {
            setLlmAuthMode(via);
            setLlmProvider(id);
            setProbe("");
            setModels([]);
            setSubMsg("");
          }}
          onLoadSub={(k) => takeSub(k, "load")}
          onLoginSub={(k) => takeSub(k, "login")}
        />
        <p className="pb-2 text-xs text-muted text-pretty">{spec.hint}</p>
        {spec.needsUrl ? (
          <Field
            label={spec.id === "azure" ? "Resource-URL" : "API-URL"}
            value={llmBaseUrl}
            onChange={setLlmBaseUrl}
            placeholder={spec.baseUrl || "https://…"}
          />
        ) : null}
        {spec.id !== "grok" ? (
          spec.id === "azure" ? (
            <Field label="Deployment" value={llmModel} onChange={setLlmModel} placeholder={spec.model || "Deployment"} />
          ) : (
            <ModelPick
              catalog={spec.models}
              live={models}
              value={llmModel}
              onChange={setLlmModel}
              placeholder={spec.model || "Modell-ID"}
              loading={modelsBusy}
            />
          )
        ) : null}
        {spec.id !== "grok" && llmAuthMode === "key" && (spec.needsKey || spec.kind === "local") ? (
          <Field
            label={spec.needsKey ? "API-Key" : "API-Key (optional)"}
            value={llmApiKey}
            onChange={setLlmApiKey}
            type="password"
            placeholder={spec.needsKey ? "sk-…" : "meist leer"}
          />
        ) : null}
        {aboOn ? <p className="py-1 text-xs text-muted">{t("subNoKey")}</p> : null}
        {llmAuthMode === "abo" && spec.needsSub && !aboOn ? <p className="py-1 text-xs text-subtle">{t("subNeed")}</p> : null}
        {spec.id !== "grok" ? (
          <div className="flex items-center gap-2 py-1">
            <Button className="h-8" onClick={() => void probeLocal()}>
              Verbindung prüfen
            </Button>
            {probe ? <span className="text-xs text-muted">{probe}</span> : null}
          </div>
        ) : null}
        <div className="mb-2 mt-2 rounded-md border border-border px-2 py-2">
          <p className="text-xs text-muted">Profil</p>
          <p className="mb-1 text-[11px] text-subtle">URL, Modell, Context merken. Nicht das Abo.</p>
          {llmProfiles.length ? (
            <ul className="mb-1 space-y-0.5">
              {llmProfiles.map((p) => (
                <li key={p.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-xs text-fg hover:bg-hover"
                    onClick={() => applyLlmProfile(p.id)}
                  >
                    {p.name}
                  </button>
                  <button
                    type="button"
                    className="h-7 w-7 shrink-0 rounded-md text-muted hover:text-danger"
                    aria-label="Löschen"
                    onClick={() => deleteLlmProfile(p.id)}
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
              placeholder="Name, z.B. Ollama LAN"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-sm text-fg"
              onChange={(e) => setProfileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  saveLlmProfile(profileName);
                  setProfileName("");
                }
              }}
            />
            <Button
              className="h-8 shrink-0"
              onClick={() => {
                saveLlmProfile(profileName);
                setProfileName("");
              }}
            >
              Speichern
            </Button>
          </div>
        </div>
        <p className="pt-1 text-xs text-subtle text-pretty">
          {spec.kind === "local"
            ? "Ollama/LM Studio/LAN holt Anvil selbst — ohne CORS. URL z. B. http://192.168.178.41:11434/v1."
            : spec.needsSub
              ? "Abo-Login bleibt auf diesem Rechner. Kein API-Key."
              : "Keys bleiben auf diesem Rechner. Cloud geht über Anvil."}
        </p>
      </Vis>
      <Vis q={q} label="Context Länge Fenster Tokens">
        <Row
          label="Context-Länge"
          hint={
            llmContextAuto
              ? "Cloud/Abo: beim Wechsel Auto aus Katalog. Lokal: num_ctx."
              : "Fenster für das Modell. Cloud/Abo besser Auto. Ollama: num_ctx."
          }
        >
          <div className="flex flex-col items-end gap-1">
            <label className="flex items-center gap-2 text-xs text-muted">
              Auto
              <button
                type="button"
                role="switch"
                aria-checked={llmContextAuto}
                className={`relative h-5 w-8 rounded-full border ${llmContextAuto ? "border-accent bg-accent" : "border-border bg-bg"}`}
                onClick={() => setLlmContextAuto(!llmContextAuto)}
              >
                <span className={`absolute top-0.5 left-0.5 size-3.5 rounded-full bg-fg ${llmContextAuto ? "translate-x-[0.7rem] bg-accent-fg" : ""}`} />
              </button>
            </label>
            <Seg<string>
              value={ctxCustom || !ctxChip ? "custom" : String(ctxChip)}
              onChange={(v) => {
                setLlmContextAuto(false);
                if (v === "custom") {
                  setCtxCustom(true);
                  return;
                }
                setCtxCustom(false);
                setLlmContext(Number(v));
              }}
              options={[
                ...CONTEXT_SIZES.map((n) => ({
                  id: String(n),
                  label: formatContext(n),
                })),
                { id: "custom", label: "Zahl" },
              ]}
            />
            {ctxCustom || !ctxChip ? (
              <input
                type="number"
                min={CONTEXT_MIN}
                max={CONTEXT_MAX}
                step={1000}
                value={llmContext}
                onChange={(e) => {
                  setLlmContextAuto(false);
                  setCtxCustom(true);
                  setLlmContext(Number(e.target.value));
                }}
                className="h-8 w-28 rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg outline-none focus:ring-2 focus:ring-ring"
                title="Tokens, max 2M"
              />
            ) : null}
          </div>
        </Row>
      </Vis>
      <Vis q={q} label="Thinking Reasoning Denken low mid high">
        <Row
          label="Thinking"
          hint={
            wantsThinking({ provider: llmProvider, model: llmModel, context: llmContext, thinking: llmThinking })
              ? "An · Effort an die API (reasoning_effort / budget)"
              : "Aus, außer Low/Mid/High erzwungen"
          }
        >
          <Seg<ThinkingMode>
            value={llmThinking}
            onChange={setLlmThinking}
            options={[
              { id: "off", label: "Aus" },
              { id: "auto", label: "Auto" },
              { id: "low", label: "Low" },
              { id: "medium", label: "Mid" },
              { id: "high", label: "High" },
            ]}
          />
        </Row>
      </Vis>
      <Vis q={q} label="Temperatur max tokens Antwort Länge">
        <Slider
          label="Temperatur"
          hint="Geht an Ollama/llama.cpp (options.temperature). 0 = bestimmt, 1+ = frei."
          min={0}
          max={2}
          step={0.05}
          value={llmTemperature}
          onChange={setLlmTemperature}
          format={(n) => n.toFixed(2)}
        />
        <Slider
          label="Antwort-Länge"
          hint="0 = Auto aus Context. Sonst max_tokens / num_predict an den Server."
          min={0}
          max={32768}
          step={256}
          value={llmMaxOut}
          onChange={setLlmMaxOut}
          format={(n) => (n <= 0 ? "Auto" : String(n))}
        />
      </Vis>
      <Vis q={q} label="Modell Format Tools 400">
        <CapRow provider={llmProvider} model={llmModel} />
      </Vis>
      <Vis q={q} label="Retry Versuche Abbruch lokal">
        <Slider
          label="Versuche"
          hint="Bei Abbruch oder leerem Stream erneut versuchen. 1 = nicht wiederholen."
          min={1}
          max={8}
          step={1}
          value={llmRetries}
          onChange={setLlmRetries}
        />
        <Slider
          label="Harter Stop"
          hint="0 = aus (wie eine lange Ollama-Sitzung, nur Stop-Taste). Sonst Minuten ohne Token."
          min={0}
          max={480}
          step={30}
          value={llmHardStopMin}
          onChange={setLlmHardStopMin}
          format={(n) => (n <= 0 ? "Aus" : `${n} Min`)}
        />
      </Vis>
      <Vis q={q} label="Context compacting kompakt Verlauf">
        <Row
          label="Compacting"
          hint="Alter Chat wird gekürzt, wenn das Fenster voll ist. Auto ab etwa 70 %. Ziel, Dateien und Korrekturen bleiben in der Sitzung."
        >
          <Seg<CompactMode>
            value={llmCompact}
            onChange={setLlmCompact}
            options={[
              { id: "off", label: "Aus" },
              { id: "auto", label: "Auto" },
              { id: "aggressive", label: "Aggressiv" },
            ]}
          />
        </Row>
      </Vis>
      <Vis q={q} label="Ask Agent Modus">
        <Row label="Standard-Modus" hint="Ask erklärt, Agent schreibt Dateien">
          <Seg
            value={agentMode}
            onChange={setAgentMode}
            options={[
              { id: "ask", label: "Ask" },
              { id: "agent", label: "Agent" },
            ]}
          />
        </Row>
      </Vis>
      <Vis q={q} label="Diffs automatisch übernehmen">
        <Row label={t("autoDiffs")} hint={t("autoDiffsHint")}>
          <Toggle on={autoAcceptDiffs} onChange={setAutoAcceptDiffs} />
        </Row>
      </Vis>
      <Vis q={q} label="Run nach Agent automatisch">
        <Row label="Nach der Runde Run" hint="Wenn die Run-Schleife aus ist, nach der Runde trotzdem ausführen">
          <Toggle on={autoRunAgent} onChange={setAutoRunAgent} />
        </Row>
      </Vis>
      <HarnessFields q={q} />
      <Vis q={q} label="Lernen Gedächtnis Skills">
        <Row label="Lernen" hint="Feineinstellungen unter Gedächtnis">
          <Toggle on={learnOn} onChange={(v) => useLearn.getState().setOn(v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Regeln Projektregeln AGENTS">
        <label className="block py-2">
          <span className="text-xs text-muted">Regeln</span>
          <textarea
            value={agentRules}
            rows={5}
            placeholder="Zusatz zu AGENTS.md und .anvil/rules.md im Workspace."
            className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg outline-none placeholder:text-subtle focus:ring-2 focus:ring-ring"
            onChange={(e) => setAgentRules(e.target.value)}
          />
          <span className="mt-1 block text-[11px] text-subtle">AGENTS.md und .anvil/rules.md gelten immer. Dieses Feld kommt extra dazu.</span>
        </label>
      </Vis>
      <McpFields />
    </section>
  );
}

function HarnessFields({ q }: { q: string }) {
  const runLoop = useIde((s) => s.runLoop);
  const testLoop = useIde((s) => s.testLoop);
  const graphLoop = useIde((s) => s.graphLoop);
  const engineLoop = useIde((s) => s.engineLoop);
  const loopTries = useIde((s) => s.loopTries);
  const afterWrite = useIde((s) => s.harnessAfterWrite);
  const maxRounds = useIde((s) => s.harnessMaxRounds);
  const graphSees = useIde((s) => s.graphSees);
  const files = useIde((s) => s.files);
  const setRunLoop = useIde((s) => s.setRunLoop);
  const setTestLoop = useIde((s) => s.setTestLoop);
  const setGraphLoop = useIde((s) => s.setGraphLoop);
  const setEngineLoop = useIde((s) => s.setEngineLoop);
  const setLoopTries = useIde((s) => s.setLoopTries);
  const setAfter = useIde((s) => s.setHarnessAfterWrite);
  const setRounds = useIde((s) => s.setHarnessMaxRounds);
  const setSees = useIde((s) => s.setGraphSees);
  const writeFile = useIde((s) => s.writeFile);
  const setNotice = useIde((s) => s.setNotice);
  const proj = loadProjectHarness(files);
  const graph = loadProjectGraph(files);

  function saveProject() {
    const harness = {
      name: proj?.name ?? "app",
      when: proj?.when ?? "Nach Write",
      runLoop,
      graphLoop,
      testLoop,
      engineLoop,
      loopTries,
      maxRounds,
      afterWrite,
      graphSees,
    };
    const edges = graph?.edges ?? guessProjectHarness(files).graph.edges;
    const g = { name: graph?.name ?? "app", edges };
    writeFile(HARNESS_PATH, dumpHarness(harness));
    writeFile(GRAPH_PATH, dumpGraph(g));
    const board = rebuildBoardFromGraph(edges ?? [], {
      runLoop,
      graphLoop,
      testLoop,
      engineLoop: Boolean(engineLoop) || afterWrite === "engine",
      afterWrite: afterWrite ?? "run",
      loopTries,
      maxRounds: maxRounds ?? 12,
    });
    writeFile(BOARD_PATH, filesFromBoard(board, {
      runLoop,
      graphLoop,
      testLoop,
      engineLoop: Boolean(engineLoop) || afterWrite === "engine",
      afterWrite: afterWrite ?? "run",
      loopTries,
      maxRounds: maxRounds ?? 12,
    })[BOARD_PATH]);
    setNotice("Harness ins Projekt geschrieben");
  }

  function loadProject() {
    if (!proj && !graph) {
      setNotice("Keine .anvil/harness.json");
      return;
    }
    if (proj) {
      if (proj.runLoop != null) setRunLoop(proj.runLoop);
      if (proj.graphLoop != null) setGraphLoop(proj.graphLoop);
      if (proj.testLoop != null) setTestLoop(proj.testLoop);
      if (proj.engineLoop != null) setEngineLoop(Boolean(proj.engineLoop));
      else if (proj.afterWrite === "engine") setEngineLoop(true);
      if (proj.loopTries != null) setLoopTries(proj.loopTries);
      if (proj.maxRounds != null) setRounds(proj.maxRounds);
      if (proj.afterWrite) setAfter(proj.afterWrite);
      if (proj.graphSees != null) setSees(proj.graphSees);
    }
    setNotice("Aus Projekt geladen");
  }

  function guess() {
    const g = guessProjectHarness(files);
    setRunLoop(g.harness.runLoop ?? true);
    setGraphLoop(Boolean(g.harness.graphLoop));
    setTestLoop(Boolean(g.harness.testLoop));
    setEngineLoop(Boolean(g.harness.engineLoop) || g.harness.afterWrite === "engine");
    setLoopTries(g.harness.loopTries ?? 3);
    setAfter(g.harness.afterWrite ?? "run");
    const s = {
      runLoop: g.harness.runLoop ?? true,
      graphLoop: Boolean(g.harness.graphLoop),
      testLoop: Boolean(g.harness.testLoop),
      engineLoop: Boolean(g.harness.engineLoop) || g.harness.afterWrite === "engine",
      afterWrite: g.harness.afterWrite ?? ("run" as const),
      loopTries: g.harness.loopTries ?? 3,
      maxRounds: g.harness.maxRounds ?? 12,
    };
    writeFile(HARNESS_PATH, dumpHarness(g.harness));
    writeFile(GRAPH_PATH, dumpGraph(g.graph));
    writeFile(BOARD_PATH, filesFromBoard(rebuildBoardFromGraph(g.graph.edges ?? [], s), s)[BOARD_PATH]);
    setNotice(`Geraten: ${g.harness.name ?? "app"}`);
  }

  return (
    <>
      <Vis q={q} label="Harness Loop Run-Schleife nach write patch Tests Runde">
        <Head>Harness-Loop</Head>
        <Row label="An" hint="Nach Write: in derselben Runde ausführen. Fehler → Patch. Projektdatei hat Vorrang, wenn vorhanden.">
          <Toggle on={runLoop} onChange={setRunLoop} />
        </Row>
        <Row label="Tests nach Runde" hint="Wenn Testdateien da sind: nach der Agent-Runde automatisch laufen. Rot bleibt in der Spur.">
          <Toggle on={testLoop} onChange={setTestLoop} />
        </Row>
        <Row label="Nach Write" hint="Was nach dem Schreiben verlangt wird.">
          <Seg<AfterWrite>
            value={afterWrite ?? "run"}
            onChange={setAfter}
            options={[
              { id: "run", label: "Run" },
              { id: "engine", label: "Engine" },
              { id: "preview", label: "Vorschau" },
              { id: "none", label: "Nichts" },
            ]}
          />
        </Row>
        <Row label="Versuche" hint="Patch und Run bei Fehler.">
          <Seg
            value={String(loopTries)}
            onChange={(v) => setLoopTries(Number(v))}
            options={[
              { id: "1", label: "1" },
              { id: "2", label: "2" },
              { id: "3", label: "3" },
              { id: "5", label: "5" },
            ]}
          />
        </Row>
        <Row label="Runden" hint="Modell-Runden mit Tools. Lange Aufträge: 24–48.">
          <Seg
            value={String(maxRounds ?? 24)}
            onChange={(v) => setRounds(Number(v))}
            options={[
              { id: "12", label: "12" },
              { id: "24", label: "24" },
              { id: "32", label: "32" },
              { id: "48", label: "48" },
            ]}
          />
        </Row>
      </Vis>
      <Vis q={q} label="Graph Schleife Canvas Frame see_run play">
        <Head>Graph</Head>
        <Row label="An" hint="Nach Run: Graph-Kanten (Frame, Tests, Format, Engine, MCP, …) — Tafel hat die volle Tool-Liste.">
          <Toggle on={graphLoop} onChange={setGraphLoop} />
        </Row>
        <Row label="Engine" hint="Godot/Unity/Bevy: nach Write engine_run. Reines Cargo.toml zählt nicht.">
          <Toggle on={engineLoop} onChange={setEngineLoop} />
        </Row>
        <Row label="Frames" hint="Wie oft see_run / play in einer Runde.">
          <Seg
            value={String(graphSees ?? 4)}
            onChange={(v) => setSees(Number(v))}
            options={[
              { id: "1", label: "1" },
              { id: "2", label: "2" },
              { id: "4", label: "4" },
              { id: "8", label: "8" },
            ]}
          />
        </Row>
      </Vis>
      <Vis q={q} label="Harness Tafel Raster einrasten grafisch">
        <Head>Tafel</Head>
        <Row label="Öffnen" hint="Grafische Arbeitsfläche für Harness- und Graph-Kanten. Speichern schreibt .anvil/.">
          <Button className="h-8" onClick={() => useIde.getState().setHarnessBoardOpen(true)}>
            Tafel
          </Button>
        </Row>
        <BoardToggles />
      </Vis>
      <Vis q={q} label="Harness Projekt Datei graph.json raten">
        <p className="py-1 text-[11px] text-subtle">
          {proj ? `.anvil/harness.json · ${proj.name ?? "app"} · ${proj.afterWrite ?? "run"}` : "Keine Projektdatei — Einstellungen gelten."}
          {graph?.edges?.length ? ` · ${graph.edges.length} Graph-Kanten` : ""}
        </p>
        <div className="mb-2 flex flex-wrap gap-2">
          <Button className="h-8" onClick={saveProject}>
            Ins Projekt
          </Button>
          <Button className="h-8" variant="quiet" onClick={loadProject}>
            Laden
          </Button>
          <Button className="h-8" variant="quiet" onClick={guess}>
            Raten
          </Button>
        </div>
      </Vis>
    </>
  );
}

function BoardToggles() {
  const grid = useIde((s) => s.harnessBoardGrid);
  const snap = useIde((s) => s.harnessBoardSnap);
  const setGrid = useIde((s) => s.setHarnessBoardGrid);
  const setSnap = useIde((s) => s.setHarnessBoardSnap);
  return (
    <>
      <Row label="Raster" hint="Punkte im Hintergrund der Tafel.">
        <Toggle on={grid} onChange={setGrid} />
      </Row>
      <Row label="Einrasten" hint="Knoten an 24px-Raster.">
        <Toggle on={snap} onChange={setSnap} />
      </Row>
    </>
  );
}

function McpFields() {
  const servers = useIde((s) => s.mcpServers);
  const setMcpServers = useIde((s) => s.setMcpServers);
  const setNotice = useIde((s) => s.setNotice);
  const mcpStream = useIde((s) => s.mcpStream);
  const setMcpStream = useIde((s) => s.setMcpStream);
  const liveEditor = useIde((s) => s.liveEditor);
  const setLiveEditor = useIde((s) => s.setLiveEditor);
  const t = useT();

  function patch(i: number, p: Partial<McpServer>) {
    setMcpServers(servers.map((s, n) => (n === i ? { ...s, ...p } : s)));
  }

  return (
    <div className="py-2">
      <Row label={t("liveEditor")} hint={t("liveEditorH")}>
        <Toggle on={liveEditor} onChange={setLiveEditor} />
      </Row>
      <Row label={t("mcpStream")} hint={t("mcpStreamH")}>
        <Toggle on={mcpStream} onChange={setMcpStream} />
      </Row>
      <p className="text-xs text-muted">MCP (HTTP JSON-RPC). Der Server muss CORS erlauben.</p>
      {servers.map((s, i) => (
        <div key={s.id} className="mt-2 rounded-md border border-border p-2">
          <input
            value={s.name}
            placeholder="Name"
            className="mb-1 h-8 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg"
            onChange={(e) => patch(i, { name: e.target.value })}
          />
          <input
            value={s.url}
            placeholder="https://…/mcp"
            className="h-8 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg"
            onChange={(e) => patch(i, { url: e.target.value })}
          />
          <input
            type="password"
            placeholder="Bearer (optional)"
            value={loadSecrets().keys[`mcp:${s.id}`] ?? ""}
            className="mt-1 h-8 w-full rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg"
            onChange={(e) => {
              const cur = loadSecrets();
              saveSecrets({ keys: { ...cur.keys, [`mcp:${s.id}`]: e.target.value } });
              setMcpServers([...useIde.getState().mcpServers]);
            }}
          />
          <div className="mt-1 flex gap-2">
            <label className="text-[11px] text-muted">
              <input type="checkbox" checked={s.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} /> an
            </label>
            <button type="button" className="text-[11px] text-danger" onClick={() => setMcpServers(servers.filter((_, n) => n !== i))}>
              Weg
            </button>
          </div>
        </div>
      ))}
      <div className="mt-2 flex gap-2">
        <Button
          className="h-8"
          onClick={() => setMcpServers([...servers, { id: newMcpId(), name: "MCP", url: "", enabled: true }])}
        >
          Server
        </Button>
        <Button
          variant="quiet"
          className="h-8"
          onClick={() => {
            void import("@/lib/mcp").then((m) =>
              m.mcpList(useIde.getState().mcpServers).then((list) => {
                setNotice(list.length ? list.map((t) => `${t.server}.${t.name}`).join(", ") : "Keine Tools");
              }),
            );
          }}
        >
          Tools prüfen
        </Button>
        <Button
          variant="quiet"
          className="h-8"
          onClick={() => useIde.getState().setSidebar("mcp")}
        >
          Pane
        </Button>
      </div>
    </div>
  );
}

function EditorSection({ q }: { q: string }) {
  const theme = useIde((s) => s.theme);
  const fontSize = useIde((s) => s.fontSize);
  const tabSize = useIde((s) => s.tabSize);
  const lineNumbers = useIde((s) => s.lineNumbers);
  const wordWrap = useIde((s) => s.wordWrap);
  const suggestOn = useIde((s) => s.suggestOn);
  const insertSpaces = useIde((s) => s.insertSpaces);
  const formatOnSave = useIde((s) => s.formatOnSave);
  const autoPreview = useIde((s) => s.autoPreview);
  const liveRun = useIde((s) => s.liveRun);
  const setTheme = useIde((s) => s.setTheme);
  const setFontSize = useIde((s) => s.setFontSize);
  const setTabSize = useIde((s) => s.setTabSize);
  const setLineNumbers = useIde((s) => s.setLineNumbers);
  const setWordWrap = useIde((s) => s.setWordWrap);
  const setSuggestOn = useIde((s) => s.setSuggestOn);
  const setInsertSpaces = useIde((s) => s.setInsertSpaces);
  const setFormatOnSave = useIde((s) => s.setFormatOnSave);
  const setAutoPreview = useIde((s) => s.setAutoPreview);
  const setLiveRun = useIde((s) => s.setLiveRun);
  const locale = useIde((s) => s.locale);
  const setLocale = useIde((s) => s.setLocale);
  const t = useT();

  return (
    <section>
      <Head>{t("editor")}</Head>
      <Vis q={q} label="Sprache Language Deutsch English">
        <Row label={t("language")} hint={t("languageHint")}>
          <Seg<Locale>
            value={locale}
            onChange={(v) => {
              setLocale(v);
              applyLang(v);
            }}
            options={[
              { id: "de", label: "Deutsch" },
              { id: "en", label: "English" },
            ]}
          />
        </Row>
      </Vis>
      <Vis q={q} label="Thema Dunkel Hell Theme Dark Light">
        <Row label={t("theme")}>
          <Seg<ThemeName>
            value={theme}
            onChange={setTheme}
            options={[
              { id: "dark", label: t("dark") },
              { id: "light", label: t("light") },
            ]}
          />
        </Row>
      </Vis>
      <Vis q={q} label="Schriftgröße Font">
        <Row label={t("fontSize")} hint={t("fontSizeHint")}>
          <Seg<string>
            value={String(fontSize)}
            onChange={(v) => setFontSize(Number(v))}
            options={["10", "12", "13", "14", "16", "18", "20", "22"].map((id) => ({ id, label: id }))}
          />
        </Row>
      </Vis>
      <Vis q={q} label="Einzug Tab">
        <Row label={t("indent")}>
          <Seg<string>
            value={String(tabSize)}
            onChange={(v) => setTabSize(Number(v) as 2 | 4 | 8)}
            options={[
              { id: "2", label: "2" },
              { id: "4", label: "4" },
              { id: "8", label: "8" },
            ]}
          />
        </Row>
      </Vis>
      <Vis q={q} label="Leerzeichen statt Tab">
        <Row label={t("spacesNotTab")}>
          <Toggle on={insertSpaces} onChange={setInsertSpaces} />
        </Row>
      </Vis>
      <Vis q={q} label="Zeilennummern">
        <Row label={t("lineNumbers")}>
          <Toggle on={lineNumbers} onChange={setLineNumbers} />
        </Row>
      </Vis>
      <Vis q={q} label="Zeilenumbruch">
        <Row label={t("wordWrap")}>
          <Toggle on={wordWrap} onChange={setWordWrap} />
        </Row>
      </Vis>
      <Vis q={q} label="Minimap Übersicht">
        <Row label={t("editorMinimap")} hint={t("editorMinimapHint")}>
          <Toggle on={useIde((s) => s.editorMinimap)} onChange={(v) => useIde.getState().setEditorMinimap(v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Sticky klebrig Überschrift">
        <Row label={t("editorSticky")} hint={t("editorStickyHint")}>
          <Toggle on={useIde((s) => s.editorSticky)} onChange={(v) => useIde.getState().setEditorSticky(v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Einzug Klammern Guides">
        <Row label={t("editorGuides")} hint={t("editorGuidesHint")}>
          <Toggle on={useIde((s) => s.editorGuides)} onChange={(v) => useIde.getState().setEditorGuides(v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Zoom Mausrad">
        <Row label={t("editorWheelZoom")} hint={t("editorWheelZoomHint")}>
          <Toggle on={useIde((s) => s.editorWheelZoom)} onChange={(v) => useIde.getState().setEditorWheelZoom(v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Vorschläge Autocomplete Handy">
        <Row label={t("suggest")} hint={t("suggestHint")}>
          <Toggle on={suggestOn} onChange={setSuggestOn} />
        </Row>
      </Vis>
      <Vis q={q} label="Beim Speichern formatieren">
        <Row label={t("formatOnSave")} hint="Ctrl+S">
          <Toggle on={formatOnSave} onChange={setFormatOnSave} />
        </Row>
      </Vis>
      <Vis q={q} label="Vorschau automatisch">
        <Row label={t("autoPreview")} hint={t("autoPreviewHint")}>
          <Toggle on={autoPreview} onChange={setAutoPreview} />
        </Row>
      </Vis>
      <Vis q={q} label="Live ausführen bei Änderung">
        <Row label={t("liveRun")} hint={t("liveRunHint")}>
          <Toggle on={liveRun} onChange={setLiveRun} />
        </Row>
      </Vis>
    </section>
  );
}

function LayoutSection({ q }: { q: string }) {
  const splitMode = useIde((s) => s.splitMode);
  const showStatusBar = useIde((s) => s.showStatusBar);
  const motion = useIde((s) => s.motion);
  const trailOn = useIde((s) => s.panels.trail);
  const trailInChat = useIde((s) => s.trailInChat);
  const trailWidth = useIde((s) => s.trailWidth);
  const trailThinkH = useIde((s) => s.trailThinkH);
  const autoHw = useIde((s) => s.autoHw);
  const hwNote = useIde((s) => s.hwNote);
  const setSplitMode = useIde((s) => s.setSplitMode);
  const setShowStatusBar = useIde((s) => s.setShowStatusBar);
  const setMotion = useIde((s) => s.setMotion);
  const setPanels = useIde((s) => s.setPanels);
  const setTrailInChat = useIde((s) => s.setTrailInChat);
  const setTrailWidth = useIde((s) => s.setTrailWidth);
  const setTrailThinkH = useIde((s) => s.setTrailThinkH);
  const setAutoHw = useIde((s) => s.setAutoHw);
  const t = useT();
  const presetKey: Record<string, string> = { ide: "presetIde", pair: "presetPair", focus: "presetFocus", run: "presetRun" };

  return (
    <section>
      <Head>{t("layout")}</Head>
      <Vis q={q} label="Preset IDE Code Agent">
        <p className="pt-1 text-xs text-muted">{t("layout")}</p>
        <div className="flex flex-wrap gap-1.5 py-2">
          {PRESETS.map((p) => (
            <Button key={p.id} className="h-8" onClick={() => setPanels(p.panels)}>
              {t(presetKey[p.id] || p.label)}
            </Button>
          ))}
        </div>
      </Vis>
      <Vis q={q} label="Anordnung neben untereinander side stacked">
        <Row label={t("arrange")} hint={t("arrangeHint")}>
          <Seg<SplitMode>
            value={splitMode}
            onChange={setSplitMode}
            options={[
              { id: "auto", label: t("auto") },
              { id: "side", label: t("sideBySide") },
              { id: "stack", label: t("stacked") },
            ]}
          />
        </Row>
      </Vis>
      <Vis q={q} label="Statusleiste status bar">
        <Row label={t("statusBar")}>
          <Toggle on={showStatusBar} onChange={setShowStatusBar} />
        </Row>
      </Vis>
      <Vis q={q} label="Spur Denken Run To-do trail">
        <Row label={t("trail")} hint={t("trailHint")}>
          <Toggle
            on={trailOn}
            onChange={(v) => setPanels({ ...useIde.getState().panels, trail: v })}
          />
        </Row>
        <Row label={t("trailInChat")} hint={t("trailInChatHint")}>
          <Toggle on={trailInChat} onChange={setTrailInChat} />
        </Row>
        <Slider
          label={t("trailWidth")}
          min={220}
          max={560}
          step={10}
          value={trailWidth}
          onChange={setTrailWidth}
          format={(n) => `${n}px`}
        />
        <Slider
          label={t("trailThinkH")}
          hint={t("trailThinkHHint")}
          min={72}
          max={720}
          step={8}
          value={trailThinkH}
          onChange={setTrailThinkH}
          format={(n) => `${n}px`}
        />
      </Vis>
      <Vis q={q} label="Hardware GPU automatisch anpassen Gerät">
        <Row label={t("autoHw")} hint={t("autoHwHint")}>
          <Toggle
            on={autoHw}
            onChange={(v) => {
              setAutoHw(v);
              if (v) void import("@/lib/hw").then((h) => h.applyHwTune());
            }}
          />
        </Row>
        <div className="flex flex-wrap items-center gap-2 py-1.5">
          <Button
            className="h-8"
            onClick={() => void import("@/lib/hw").then((h) => h.applyHwTune())}
          >
            {t("autoHwNow")}
          </Button>
          {hwNote ? <span className="text-[11px] text-subtle">{hwNote}</span> : null}
        </div>
      </Vis>
      <Vis q={q} label="Animation Bewegung Motion">
        <Row label={t("animation")} hint={t("animationHint")}>
          <Seg<MotionLevel>
            value={motion}
            onChange={setMotion}
            options={[
              { id: "off", label: t("off") },
              { id: "reduced", label: t("reduced") },
              { id: "full", label: t("full") },
            ]}
          />
        </Row>
      </Vis>
    </section>
  );
}

function LearnSection({ q }: { q: string }) {
  const on = useLearn((s) => s.on);
  const raw = useLearn((s) => s.prefs);
  const p: LearnPrefs = { ...LEARN_DEFAULTS, ...(raw ?? {}) };
  const setPref = useLearn((s) => s.setPref);
  const facts = useLearn((s) => s.facts);
  const skills = useLearn((s) => s.skills);
  const events = useLearn((s) => s.events);
  const negs = useLearn((s) => s.negs);

  return (
    <section>
      <Head>Gedächtnis</Head>
      <p className="mb-2 text-xs text-muted">
        {facts.length} Fakten · {skills.length} Skills · {negs.length} Verbote · {events.length} Log
      </p>
      <Vis q={q} label="Lernen merken an aus">
        <Row label="Lernen" hint="Aus: nichts Neues merken, nichts an den Agenten geben.">
          <Toggle on={on} onChange={(v) => useLearn.getState().setOn(v)} />
        </Row>
      </Vis>
      <Head>An das Modell</Head>
      <Vis q={q} label="Kontext Prompt injizieren Agent">
        <Row label="In den Prompt" hint="Gelerntes vor jeder Agent-Runde. Aus = merken ohne zu teilen.">
          <Toggle on={p.inject} onChange={(v) => setPref("inject", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Person Fakten Stil immer lieber">
        <Row label="Person" hint="Stil, Sprache, „immer/lieber“.">
          <Toggle on={p.person} onChange={(v) => setPref("person", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Projekt Fakten pytest stack">
        <Row label="Projekt" hint="Nur dieses Repo (pytest, Stack, Ordner).">
          <Toggle on={p.project} onChange={(v) => setPref("project", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Profil Statistik Run Debug">
        <Row label="Nutzungsprofil" hint="Run/Debug/Diff-Zahlen. Kurz, keine Inhalte.">
          <Toggle on={p.profile} onChange={(v) => setPref("profile", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Negatives verworfene Diffs nicht so">
        <Row label="Verbote" hint="Abgelehnte Diffs und „nicht so“.">
          <Toggle on={p.negatives} onChange={(v) => setPref("negatives", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Skills Liste Prompt">
        <Row label="Skills nennen" hint="Namen und Wann, damit der Agent skill_run nutzt.">
          <Toggle on={p.skills} onChange={(v) => setPref("skills", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Skill Body Anweisung Tokens">
        <Row label="Skill-Text" hint="Voller Text der passenden Skills. Kostet Context.">
          <Toggle on={p.skillBodies} onChange={(v) => setPref("skillBodies", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Fakten Limit Anzahl">
        <Row label="Fakten im Prompt">
          <Seg
            value={String(p.factLimit)}
            onChange={(v) => setPref("factLimit", Number(v))}
            options={[
              { id: "8", label: "8" },
              { id: "12", label: "12" },
              { id: "16", label: "16" },
            ]}
          />
        </Row>
      </Vis>
      <Vis q={q} label="Skills Limit Anzahl">
        <Row label="Skills im Prompt">
          <Seg
            value={String(p.skillLimit)}
            onChange={(v) => setPref("skillLimit", Number(v))}
            options={[
              { id: "2", label: "2" },
              { id: "5", label: "5" },
              { id: "8", label: "8" },
            ]}
          />
        </Row>
      </Vis>
      <Head>Automatik</Head>
      <Vis q={q} label="Destillieren Fakten aus Nutzung">
        <Row label="Destillieren" hint="Aus Runs, Diffs, „immer…“ Fakten schreiben.">
          <Toggle on={p.distill} onChange={(v) => setPref("distill", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="IDE anpassen Live-Run Auto-Diffs">
        <Row label="IDE anpassen" hint="Nur Hinweis, keine stillen Änderungen an Auto-Diffs / Live-Run.">
          <Toggle on={p.adaptIde} onChange={(v) => setPref("adaptIde", v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Plugin Skills Datei schreiben">
        <Row label="Skills als Plugin" hint="Neue Plugin-Skills nach plugins/skills/.">
          <Toggle on={p.pluginSkills} onChange={(v) => setPref("pluginSkills", v)} />
        </Row>
      </Vis>
      <Head>Aufräumen</Head>
      <Vis q={q} label="Löschen Log Fakten Skills zurücksetzen">
        <div className="flex flex-wrap gap-2 py-3">
          <Button className="h-8" onClick={() => useLearn.getState().clearLog()}>
            Nur Log
          </Button>
          <Button className="h-8" onClick={() => useLearn.getState().clear()}>
            Alles löschen
          </Button>
          <Button className="h-8" onClick={() => useLearn.getState().resetPrefs()}>
            Standard
          </Button>
        </div>
      </Vis>
    </section>
  );
}

function OutputSection({ q }: { q: string }) {
  const outputDock = useIde((s) => s.outputDock);
  const openOutputOnRun = useIde((s) => s.openOutputOnRun);
  const runInWindow = useIde((s) => s.runInWindow);
  const setOutputDock = useIde((s) => s.setOutputDock);
  const setOpenOutputOnRun = useIde((s) => s.setOpenOutputOnRun);
  const setRunInWindow = useIde((s) => s.setRunInWindow);
  const t = useT();

  return (
    <section>
      <Head>{t("output")}</Head>
      <Vis q={q} label="Konsole docken unten seite fenster console">
        <Row label={t("consoleDock")} hint={t("consoleDockHint")}>
          <Seg<OutputDock>
            value={outputDock}
            onChange={setOutputDock}
            options={[
              { id: "bottom", label: t("bottom") },
              { id: "side", label: t("side") },
            ]}
          />
        </Row>
      </Vis>
      <Vis q={q} label="Ausgabe beim Run öffnen">
        <Row label={t("openOnRun")}>
          <Toggle on={openOutputOnRun} onChange={setOpenOutputOnRun} />
        </Row>
      </Vis>
      <Vis q={q} label="Run eigenes Fenster Popup Spiel">
        <Row label={t("runInWindow")} hint={t("runInWindowHint")}>
          <Toggle on={runInWindow} onChange={setRunInWindow} />
        </Row>
      </Vis>
    </section>
  );
}

function StorageSection({ q }: { q: string }) {
  const storageMode = useIde((s) => s.storageMode);
  const autoSaveDisk = useIde((s) => s.autoSaveDisk);
  const loadOnStart = useIde((s) => s.loadOnStart);
  const diskName = useIde((s) => s.diskName);
  const backupName = useIde((s) => s.backupName);
  const setStorageMode = useIde((s) => s.setStorageMode);
  const setAutoSaveDisk = useIde((s) => s.setAutoSaveDisk);
  const setLoadOnStart = useIde((s) => s.setLoadOnStart);
  const setDiskName = useIde((s) => s.setDiskName);
  const setBackupName = useIde((s) => s.setBackupName);
  const applyFiles = useIde((s) => s.applyFiles);
  const openFile = useIde((s) => s.openFile);
  const setNotice = useIde((s) => s.setNotice);
  const ok = diskSupported();
  const native = nativeHelper();
  const [paths, setPaths] = useState<{ data: string; helper: string; logs: string; packages?: string } | null>(null);

  useEffect(() => {
    void native?.pathsGet?.().then(setPaths);
  }, [native]);

  async function pickNative(kind: "data" | "helper" | "logs" | "packages") {
    if (!native?.pathsPick) return;
    try {
      const next = await native.pathsPick(kind);
      setPaths(next);
      if (kind === "packages" && next.packages) {
        try {
          const { companionSetHome, DEFAULT_COMPANION } = await import("@/lib/companion");
          const url = useIde.getState().companionUrl || DEFAULT_COMPANION;
          await companionSetHome(next.packages, url);
        } catch {
          /* Companion aus — Pfad gilt beim nächsten Start */
        }
      }
      setNotice(
        kind === "helper"
          ? `Helfer-Modelle: ${next.helper}`
          : kind === "logs"
            ? `Logs: ${next.logs}`
            : kind === "packages"
              ? `Pakete: ${next.packages}`
              : `App-Daten: ${next.data}`,
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Ordner nicht gewählt");
    }
  }

  async function dumpToData() {
    if (!native?.pathsWrite) return;
    try {
      const p = await native.pathsWrite("anvil-settings.json", JSON.stringify(exportSettingsPack(), null, 2));
      setNotice(`Einstellungen → ${p}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Sichern fehlgeschlagen");
    }
  }

  async function loadFromData() {
    if (!native?.pathsRead) return;
    try {
      const raw = await native.pathsRead("anvil-settings.json");
      if (!raw) {
        setNotice("Keine anvil-settings.json in App-Daten");
        return;
      }
      applySettingsPack(JSON.parse(raw) as Record<string, unknown>);
      applyLang(useIde.getState().locale);
      setNotice("Einstellungen aus App-Daten geladen");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Laden fehlgeschlagen");
    }
  }

  async function choose(slot: DiskSlot, load: boolean) {
    try {
      const name = await pickLocation(slot);
      if (slot === "workspace") setDiskName(name);
      else setBackupName(name);
      if (load) {
        const pack = await loadSlotAll(slot);
        applyFiles(pack.files, pack.dirs);
        const first = Object.keys(pack.files).sort()[0];
        if (first) openFile(first);
        const n = Object.keys(pack.files).length;
        setNotice(pack.skipped ? `${n} Dateien, ${pack.skipped} übersprungen (${name})` : `${n} Dateien aus ${name}`);
      } else {
        setNotice(`Speicherort: ${name}`);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Ordner nicht gewählt");
    }
  }

  async function saveNow(slot: DiskSlot) {
    try {
      await saveSlot(slot, useIde.getState().files, useIde.getState().dirs);
      setNotice(slot === "backup" ? "Backup geschrieben" : "Auf Platte gespeichert");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    }
  }

  async function drop(slot: DiskSlot) {
    await clearLocation(slot);
    if (slot === "workspace") setDiskName("");
    else setBackupName("");
    setNotice("Ordner getrennt");
  }

  return (
    <section>
      <Head>Speicher</Head>
      <Vis q={q} label="Speicherort Browser Ordner">
        <Row label="Arbeitskopie" hint="Browser bleibt immer. Ordner zusätzlich auf der Platte.">
          <Seg<StorageMode>
            value={storageMode}
            onChange={(v) => {
              setStorageMode(v);
              if (v === "disk") setAutoSaveDisk(true);
              else setAutoSaveDisk(false);
            }}
            options={[
              { id: "browser", label: "Browser" },
              { id: "disk", label: "Ordner" },
            ]}
          />
        </Row>
      </Vis>
      {!ok ? (
        <p className="py-2 text-xs text-muted text-pretty">
          Ordnerwahl braucht Chrome oder Edge als eigene Seite — nicht in einem iframe.
        </p>
      ) : null}
      <Vis q={q} label="Workspace Ordner Projekt wählen laden">
        <p className="pt-3 text-xs font-medium text-fg">Workspace</p>
        <p className="text-xs text-muted">{diskName || locationName("workspace") || "Kein Ordner gewählt"}</p>
        <div className="flex flex-wrap gap-1.5 py-2">
          <Button className="h-8" onClick={() => void choose("workspace", false)}>
            Ordner wählen
          </Button>
          <Button className="h-8" onClick={() => void choose("workspace", true)}>
            Öffnen
          </Button>
          <Button className="h-8" onClick={() => void saveNow("workspace")}>
            Speichern
          </Button>
          <Button className="h-8" onClick={() => void drop("workspace")}>
            Trennen
          </Button>
        </div>
      </Vis>
      <Vis q={q} label="Beim Start vom Ordner laden">
        <Row label="Beim Start laden" hint="Workspace-Ordner nach dem Öffnen der App">
          <Toggle on={loadOnStart} onChange={setLoadOnStart} />
        </Row>
      </Vis>
      <Vis q={q} label="Automatisch auf Platte speichern">
        <Row label="Automatisch speichern" hint="Kurz nach Änderungen in den Workspace-Ordner">
          <Toggle on={autoSaveDisk} onChange={setAutoSaveDisk} />
        </Row>
      </Vis>
      <Vis q={q} label="Backup Ordner Kopie">
        <p className="pt-3 text-xs font-medium text-fg">Backup</p>
        <p className="text-xs text-muted">{backupName || locationName("backup") || "Kein Backup-Ordner"}</p>
        <div className="flex flex-wrap gap-1.5 py-2">
          <Button className="h-8" onClick={() => void choose("backup", false)}>
            Ordner wählen
          </Button>
          <Button className="h-8" onClick={() => void saveNow("backup")}>
            Jetzt kopieren
          </Button>
          <Button className="h-8" onClick={() => void drop("backup")}>
            Trennen
          </Button>
        </div>
      </Vis>
      {native?.pathsPick ? (
        <Vis q={q} label="Helfer Modelle App-Daten Logs Pfad Festplatte">
          <p className="pt-4 text-xs font-medium text-fg">App auf diesem Rechner</p>
          <p className="mb-2 text-xs text-muted">
            Jeder Bereich hat einen eigenen Ordner. Compiler und Sprachserver: Pakete. API-Keys bleiben im App-Speicher.
          </p>
          {(
            [
              ["data", "Einstellungen / Sicherung", paths?.data],
              ["helper", "Helfer-Modelle", paths?.helper],
              ["packages", "Pakete (Compiler, LSP)", paths?.packages],
              ["logs", "Logs", paths?.logs],
            ] as const
          ).map(([kind, label, path]) => (
            <div key={kind} className="py-2">
              <p className="text-sm text-fg">{label}</p>
              <p className="font-mono text-[10px] text-subtle break-all">{path || "…"}</p>
              <Button className="mt-1 h-8" onClick={() => void pickNative(kind)}>
                Ordner wählen
              </Button>
            </div>
          ))}
          <Button className="mt-1 h-8" onClick={() => void dumpToData()}>
            Einstellungen in App-Daten sichern
          </Button>
          <Button className="mt-1 h-8" onClick={() => void loadFromData()}>
            Aus App-Daten laden
          </Button>
        </Vis>
      ) : (
        <p className="pt-3 text-xs text-muted">
          Helfer-Modelle und Logs: Ordnerwahl nur im Anvil-Fenster (start.bat). Workspace und Backup gehen hier.
        </p>
      )}
    </section>
  );
}

function InputSection({ q }: { q: string }) {
  const inputMap = useIde((s) => s.inputMap);
  const setInputMap = useIde((s) => s.setInputMap);
  const resetInputMap = useIde((s) => s.resetInputMap);
  const [cap, setCap] = useState<{ action: InputAction; kind: "key" | "pad" } | null>(null);

  useEffect(() => {
    if (!cap) return;
    if (cap.kind === "key") {
      const action = cap.action;
      function onKey(e: KeyboardEvent) {
        e.preventDefault();
        e.stopPropagation();
        const m = structuredClone(inputMap);
        const cur = m[action].keys.filter((k) => k !== e.key);
        m[action].keys = [e.key, ...cur].slice(0, 4);
        setInputMap(m);
        setCap(null);
      }
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
    }
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const pads = navigator.getGamepads?.() ?? [];
      for (const g of pads) {
        if (!g) continue;
        for (let i = 0; i < g.buttons.length; i++) {
          if (g.buttons[i]?.pressed && performance.now() - start > 180) {
            const m = structuredClone(inputMap);
            const cur = m[cap.action].pad.filter((n) => n !== i);
            m[cap.action].pad = [i, ...cur].slice(0, 3);
            setInputMap(m);
            setCap(null);
            return;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cap, inputMap, setInputMap]);

  function dropKey(action: InputAction, key: string) {
    const m = structuredClone(inputMap);
    m[action].keys = m[action].keys.filter((k) => k !== key);
    setInputMap(m);
  }
  function dropPad(action: InputAction, id: number) {
    const m = structuredClone(inputMap);
    m[action].pad = m[action].pad.filter((n) => n !== id);
    setInputMap(m);
  }

  return (
    <section>
      <Head>Eingabe</Head>
      <p className="py-2 text-xs text-muted text-pretty">
        Belegt Tastatur und Controller für die Spiel-Engine. Danach Play, damit das Spiel die neue Belegung lädt.
        {cap ? (cap.kind === "key" ? " Jetzt eine Taste drücken …" : " Jetzt eine Pad-Taste drücken …") : ""}
      </p>
      {INPUT_ACTIONS.filter((a) => !q || `${ACTION_LABELS[a]} ${a}`.toLowerCase().includes(q)).map((action) => (
        <div key={action} className="border-b border-border py-2">
          <p className="text-sm text-fg">{ACTION_LABELS[action]}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {inputMap[action].keys.map((k) => (
              <button
                key={k}
                type="button"
                className="h-7 rounded-md border border-border px-2 font-mono text-[11px] text-muted hover:text-danger"
                onClick={() => dropKey(action, k)}
                title="Entfernen"
              >
                {prettyKey(k)}
              </button>
            ))}
            {inputMap[action].pad.map((id) => (
              <button
                key={`p${id}`}
                type="button"
                className="h-7 rounded-md border border-border px-2 text-[11px] text-muted hover:text-danger"
                onClick={() => dropPad(action, id)}
                title="Entfernen"
              >
                {prettyPad(id)}
              </button>
            ))}
            <Button
              className="h-7 px-2 text-[11px]"
              variant={cap?.action === action && cap.kind === "key" ? "primary" : "quiet"}
              onClick={() => setCap({ action, kind: "key" })}
            >
              Taste
            </Button>
            <Button
              className="h-7 px-2 text-[11px]"
              variant={cap?.action === action && cap.kind === "pad" ? "primary" : "quiet"}
              onClick={() => setCap({ action, kind: "pad" })}
            >
              Pad
            </Button>
          </div>
        </div>
      ))}
      <Vis q={q} label="Stick analog Deadzone">
        <Row label="Analog-Stick" hint="Stick als Richtung">
          <Toggle
            on={inputMap.stick}
            onChange={(v) => setInputMap({ ...inputMap, stick: v })}
          />
        </Row>
        <Slider
          label="Deadzone"
          hint="Stick ignoriert kleine Ausschläge"
          min={0.05}
          max={0.8}
          step={0.01}
          value={inputMap.deadzone}
          onChange={(n) => setInputMap({ ...inputMap, deadzone: n })}
          format={(n) => n.toFixed(2)}
        />
      </Vis>
      <div className="py-3">
        <Button className="h-8" onClick={() => { resetInputMap(); setCap(null); }}>
          Standardbelegung
        </Button>
      </div>
    </section>
  );
}

function KeysSection({ q }: { q: string }) {
  const t = useT();
  const keyMap = useIde((s) => s.keyMap);
  const setKeyBind = useIde((s) => s.setKeyBind);
  const resetKeyMap = useIde((s) => s.resetKeyMap);
  const setNotice = useIde((s) => s.setNotice);
  const [cap, setCap] = useState<KeyId | null>(null);

  useEffect(() => {
    if (!cap) return;
    (window as Window & { __anvilBindKey?: boolean }).__anvilBindKey = true;
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCap(null);
        return;
      }
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      const chord = chordFromEvent(e);
      const hit = chordOwner(keyMap, chord, cap!);
      if (hit) setNotice(`${t("keyConflict")}: ${t(KEY_LABEL[hit])}`);
      setKeyBind(cap!, chord);
      setCap(null);
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      (window as Window & { __anvilBindKey?: boolean }).__anvilBindKey = false;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [cap, setKeyBind, keyMap, setNotice, t]);

  const qn = q.trim().toLowerCase();

  return (
    <section>
      <Head>{t("keys")}</Head>
      <p className="py-1 text-[11px] text-subtle">{t("keyHint")}</p>
      {KEY_GROUPS.map((g) => {
        const ids = g.ids.filter((id) => {
          if (!qn) return true;
          const chord = keyMap[id] ?? KEY_DEFAULTS[id];
          return `${t(KEY_LABEL[id])} ${formatChord(chord)}`.toLowerCase().includes(qn);
        });
        if (!ids.length) return null;
        return (
          <div key={g.i18n} className="py-2">
            <p className="pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{t(g.i18n)}</p>
            <ul className="space-y-1 text-sm text-muted">
              {ids.map((id) => {
                const chord = keyMap[id] ?? KEY_DEFAULTS[id];
                const clash = chordOwner(keyMap, chord, id);
                return (
                  <li key={id} className="flex items-center justify-between gap-3">
                    <span className={clash ? "text-danger" : ""}>
                      {t(KEY_LABEL[id])}
                      {clash ? <span className="ml-1 text-[10px] text-subtle">({t(KEY_LABEL[clash])})</span> : null}
                    </span>
                    <button
                      type="button"
                      className={cn(
                        "h-7 min-w-28 rounded-md border px-2 font-mono text-xs",
                        cap === id ? "border-accent text-fg" : "border-border text-subtle hover:text-fg",
                      )}
                      onClick={() => setCap(id)}
                    >
                      {cap === id ? "…" : formatChord(chord)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <Button className="h-8" onClick={() => { resetKeyMap(); setCap(null); }}>
        {t("keyReset")}
      </Button>
    </section>
  );
}

function VaultFields() {
  const [rows, setRows] = useState<VaultEntry[]>(() => (typeof window === "undefined" ? [] : loadVault()));
  const setNotice = useIde((s) => s.setNotice);

  function persist(next: VaultEntry[]) {
    setRows(next);
    saveVault(next);
  }

  return (
    <div className="py-2">
      <p className="mb-1 text-xs text-muted">Tresor — auf diesem Rechner (anvil-secrets), nicht im Chat und nicht im Zip. Agent liest .env nicht.</p>
      {rows.map((r, i) => (
        <div key={r.id} className="mb-1 flex gap-1">
          <input
            value={r.name}
            placeholder="Name"
            className="h-8 w-28 rounded-md border border-border bg-bg px-2 text-sm text-fg"
            onChange={(e) => persist(rows.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))}
          />
          <input
            type="password"
            value={r.value}
            placeholder="Wert"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-sm text-fg"
            onChange={(e) => persist(rows.map((x, n) => (n === i ? { ...x, value: e.target.value } : x)))}
          />
          <button type="button" className="text-[11px] text-danger" onClick={() => persist(rows.filter((_, n) => n !== i))}>
            Weg
          </button>
        </div>
      ))}
      <Button
        className="mt-1 h-8"
        onClick={() => {
          persist([...rows, { id: `v-${Date.now().toString(36)}`, name: "", value: "" }]);
          setNotice("Im Tresor gespeichert");
        }}
      >
        Secret
      </Button>
    </div>
  );
}

function DataSection({ q }: { q: string }) {
  const resetWorkspace = useIde((s) => s.resetWorkspace);
  const setLlmApiKey = useIde((s) => s.setLlmApiKey);
  const setNotice = useIde((s) => s.setNotice);

  function exportSettings() {
    const blob = new Blob([JSON.stringify(exportSettingsPack(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "anvil-settings.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importSettings() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.text().then((raw) => {
        try {
          const data = JSON.parse(raw) as Record<string, unknown>;
          applySettingsPack(data);
          const loc = useIde.getState().locale;
          applyLang(loc === "en" || loc === "de" ? loc : "de");
          setNotice("Einstellungen importiert");
        } catch {
          setNotice("Ungültige Datei");
        }
      });
    };
    input.click();
  }

  return (
    <section>
      <Head>Daten</Head>
      <p className="py-2 font-mono text-[11px] text-muted">Anvil {ANVIL_VERSION} · {ANVIL_BUILD}</p>
      <VaultFields />
      <Vis q={q} label="Einstellungen exportieren importieren">
        <div className="flex flex-wrap gap-2 py-3">
          <Button className="h-8" onClick={exportSettings}>
            Exportieren
          </Button>
          <Button className="h-8" onClick={importSettings}>
            Importieren
          </Button>
        </div>
      </Vis>
      <Vis q={q} label="API-Key löschen">
        <div className="py-2">
          <Button className="h-8" onClick={() => setLlmApiKey("")}>
            API-Key löschen
          </Button>
        </div>
      </Vis>
      <Vis q={q} label="Einstellungen zurücksetzen">
        <div className="py-2">
          <Button
            className="h-8"
            onClick={() => {
              resetAllSettings();
              applyLang(useIde.getState().locale);
              setNotice("Einstellungen zurückgesetzt");
            }}
          >
            Nur Einstellungen zurücksetzen
          </Button>
        </div>
      </Vis>
      <Vis q={q} label="Workspace zurücksetzen Beispiel">
        <div className="py-2">
          <Button
            variant="danger"
            className="h-8"
            onClick={() => {
              void confirmApp("Dateien und Chat zurücksetzen?", { danger: true, ok: "Zurücksetzen" }).then((ok) => {
                if (ok) resetWorkspace();
              });
            }}
          >
            Workspace zurücksetzen
          </Button>
        </div>
      </Vis>
    </section>
  );
}

function CapRow({ provider, model }: { provider: string; model: string }) {
  const t = useT();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    window.addEventListener("anvil-caps", on);
    return () => window.removeEventListener("anvil-caps", on);
  }, []);
  const cap = getCap(provider, model);
  void tick;
  const known = cap.tools !== "unknown" || cap.noThinkWithTools || cap.noStreamTools || cap.noRequired || cap.note;
  return (
    <Row label={t("capFormat")} hint={t("capHint")}>
      <div className="flex max-w-[16rem] flex-col items-end gap-1">
        <p className="text-right font-mono text-[11px] text-muted">{capLabel(cap)}</p>
        {known ? (
          <Button className="h-7 text-[11px]" variant="quiet" onClick={() => resetCap(provider, model)}>
            {t("capReset")}
          </Button>
        ) : null}
      </div>
    </Row>
  );
}

function Head({ children }: { children: ReactNode }) {
  return <p className="pt-4 pb-1 text-xs font-medium tracking-wide text-subtle uppercase">{children}</p>;
}

function Vis({ q, label, children }: { q: string; label: string; children: ReactNode }) {
  if (q && !label.toLowerCase().includes(q)) return null;
  return <>{children}</>;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm text-fg">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted text-pretty">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap rounded-md border border-border bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "h-8 rounded-sm px-2.5 text-xs font-medium",
            value === o.id ? "bg-hover text-fg" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block py-2">
      <span className="text-xs text-muted">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-9 w-full rounded-md border border-border bg-bg px-2 font-mono text-xs text-fg outline-none placeholder:text-subtle focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-7 w-11 rounded-full border transition-colors duration-150",
        on ? "border-accent bg-accent" : "border-border bg-bg",
      )}
    >
      <span
        className={cn(
          "ui-switch-knob absolute top-0.5 left-0.5 size-5 rounded-full bg-fg",
          on ? "translate-x-[1.15rem] bg-accent-fg" : "",
        )}
      />
    </button>
  );
}
