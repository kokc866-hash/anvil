import { toolTargetKey, toolCompatibility, type ToolCompatibility } from "@/lib/tool-compat";
import { ToolLearningRow } from "./tool-learning";
import { SecretStorageStatus } from "./secret-storage-status";
import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

import { listModels } from "@/lib/agent-client";
import type { ThinkingMode } from "@/lib/llm-options";
import { effectiveThinking, isLocalThinking, thinkingModes } from "../../../../electron/thinking-support.mjs";
import type { CompactMode } from "@/lib/compact";
import { CONTEXT_MAX, CONTEXT_MIN, CONTEXT_SIZES, formatContext, matchingContextChip } from "@/lib/tokens";
import { useLearn } from "@/lib/learn";


import { newMcpId, type McpServer } from "@/lib/mcp";
import { ModelPick } from "../model-pick";

import { loadSecrets, saveSecrets } from "@/lib/secrets";
import {
  mergeOpts,
  HARNESS_PATH,
  guessProjectHarness,
  loadProjectGraph,
  loadProjectHarness,
} from "@/lib/harness-project";
import { projectSettingsWrites } from "@/lib/project-settings";
import type { AfterWrite } from "@/lib/harness";
import { normalizePlanWho, type PlanWho } from "@/lib/plan";

import { providerOf, type LlmProvider } from "@/lib/providers";

import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";

import { capLabel, getCap, resetCap } from "@/lib/model-caps";

import { cliKindFor, probeCli, loginCli, cliStatusText, CLI_PROVIDERS, type CliKind } from "@/lib/cli-client";
import { ProviderPick } from "../provider-pick";
import { ConnectionSummary } from "../connection-summary";
import { connectionProbeSummary } from "@/lib/connection-capabilities";

import { SettingsSection, Head, Vis, Row, Seg, Field, Toggle } from "./fields";

export function AgentSection({ q }: { q: string }) {
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
  const planWho = useIde((s) => s.planWho);
  const learnOn = useLearn((s) => s.on);
  const setLlmProvider = useIde((s) => s.setLlmProvider);
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
  const aboKind = cliKindFor(llmProvider, llmAuthMode);
  const aboOn = Boolean(aboKind);
  const thinkModes = thinkingModes(llmProvider, llmModel, aboKind);
  const activeThinking = effectiveThinking(llmProvider, llmModel, llmThinking, aboKind);
  const thinkingLabels: Record<ThinkingMode, string> = { off: "Aus", auto: "Auto", minimal: "Minimal", low: "Low", medium: "Mid", high: "High", xhigh: "XHigh", max: "Max" };
  const probeController = useRef<AbortController | null>(null);
  const loginController = useRef<AbortController | null>(null);
  const [subBusy, setSubBusy] = useState(false);

  async function probeLocal(silent = false) {
    probeController.current?.abort();
    const controller = new AbortController();
    probeController.current = controller;
    const snapshot = useIde.getState();
    const current = () => {
      const now = useIde.getState();
      return (
        !controller.signal.aborted &&
        now.llmProvider === snapshot.llmProvider &&
        now.llmAuthMode === snapshot.llmAuthMode &&
        now.llmBaseUrl === snapshot.llmBaseUrl &&
        now.llmApiKey === snapshot.llmApiKey
      );
    };
    const kind = cliKindFor(snapshot.llmProvider, snapshot.llmAuthMode);
    if (!silent) setProbe(`Prüfe ${kind ? `${kind} CLI` : snapshot.llmBaseUrl || spec.label} …`);
    setModelsBusy(true);
    try {
      if (kind) {
        const status = await probeCli(kind, controller.signal);
        if (current()) {
          setProbe(connectionProbeSummary("cli", status, useIde.getState().locale));
          setModels([]);
        }
        return;
      }
      const ids = await listModels({
        provider: snapshot.llmProvider,
        baseUrl: snapshot.llmBaseUrl,
        apiKey: snapshot.llmApiKey,
        signal: controller.signal,
      });
      if (!current()) return;
      setModels(ids);
      // Catalogs can be incomplete. Never replace a model or deployment chosen by the user.
      if (!useIde.getState().llmModel && ids[0] && snapshot.llmProvider !== "azure") setLlmModel(ids[0]);
      setProbe(connectionProbeSummary("catalog", { count: ids.length }, useIde.getState().locale));
    } catch (err) {
      if (!current()) return;
      setModels([]);
      setProbe(err instanceof Error ? err.message : "Keine Verbindung");
    } finally {
      if (current()) setModelsBusy(false);
    }
  }

  useEffect(() => {
    probeController.current?.abort();
    setProbe("");
    setModels([]);
    setModelsBusy(false);
    setSubMsg("");
    if (q || llmProvider === "grok") return;
    if (!aboOn && spec.needsKey && !llmApiKey.trim()) return;
    const timer = window.setTimeout(() => void probeLocal(true), 400);
    return () => {
      window.clearTimeout(timer);
      probeController.current?.abort();
    };
    // Each request reads a fresh store snapshot and rejects stale results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmProvider, llmBaseUrl, llmApiKey, llmAuthMode, q]);

  useEffect(
    () => () => {
      loginController.current?.abort();
    },
    [],
  );

  async function takeSub(kind: CliKind, how: "load" | "login") {
    loginController.current?.abort();
    const controller = new AbortController();
    loginController.current = controller;
    const meta = CLI_PROVIDERS.find((m) => m.kind === kind)!;
    setLlmProvider(meta.provider as LlmProvider, "abo");
    const current = () =>
      !controller.signal.aborted && cliKindFor(useIde.getState().llmProvider, useIde.getState().llmAuthMode) === kind;
    setSubBusy(true);
    setSubMsg(how === "login" ? `${meta.cmd} …` : "CLI prüfen …");
    try {
      const status =
        how === "login"
          ? await loginCli(kind, controller.signal, (text) => {
              if (current()) setSubMsg((prev) => (prev + text).slice(-4000));
            })
          : await probeCli(kind, controller.signal);
      if (current()) {
        setSubMsg(cliStatusText(status));
        setProbe(connectionProbeSummary("cli", status, useIde.getState().locale));
      }
    } catch (err) {
      if (current()) setSubMsg(err instanceof Error ? err.message : "CLI-Anmeldung fehlgeschlagen.");
    } finally {
      if (loginController.current === controller) setSubBusy(false);
    }
  }

  return (
    <SettingsSection q={q}>
      <Head>Agent</Head>
      <p className="mb-2 text-xs text-muted">
        {useIde.getState().locale === "en" ? "Choose the AI connection for your chat here. Ask explains and investigates; Agent can edit files and run tools. The separate local helper is optional." : "Hier wählst du die KI-Verbindung für deinen Chat. Fragen erklärt und untersucht; Agent kann Dateien bearbeiten und Werkzeuge ausführen. Der zusätzliche lokale Helfer ist optional."}
      </p>
      <Vis q={q} label="Anbieter Provider Verbindung Connection Modell Model API URL Key Lokal Local Cloud Abo CLI Custom Profil Profile">
        <ProviderPick
          value={llmProvider}
          via={llmAuthMode}
          status={subMsg}
          loading={subBusy}
          onChange={(id, via) => {
            loginController.current?.abort();
            setSubBusy(false);
            setLlmProvider(id, via);
            setProbe("");
            setModels([]);
            setSubMsg("");
          }}
          onLoadSub={(k) => takeSub(k, "load")}
          onLoginSub={(k) => takeSub(k, "login")}
        />
        {subBusy ? (
          <Button
            className="mb-2 h-7 text-xs"
            onClick={() => {
              loginController.current?.abort();
              setSubBusy(false);
              setSubMsg("Anmeldung abgebrochen.");
            }}
          >
            Anmeldung abbrechen
          </Button>
        ) : null}
        <p className="pb-2 text-xs text-muted text-pretty">
          {aboKind ? `Nutzt die installierte ${aboKind} CLI und deren Abo-Anmeldung.` : spec.hint}
        </p>
        {spec.needsUrl && !aboOn ? (
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
        {spec.id !== "grok" && !aboOn ? (
          <Field
            label={spec.needsKey ? "API-Key" : "API-Key (optional)"}
            value={llmApiKey}
            onChange={setLlmApiKey}
            type="password"
            placeholder={spec.needsKey ? "sk-…" : "meist leer"}
          />
        ) : null}
        <ConnectionSummary />
        {aboOn ? <p className="py-1 text-xs text-muted">{t("subNoKey")}</p> : <SecretStorageStatus />}
        {spec.id !== "grok" ? (
          <div className="flex items-center gap-2 py-1">
            <Button className="h-8" disabled={modelsBusy || subBusy} onClick={() => void probeLocal()}>
              {aboOn ? "CLI-Status laden" : "Modellliste laden"}
            </Button>
            {probe ? <span className="text-xs text-muted">{probe}</span> : null}
          </div>
        ) : null}
        {!aboOn && probe ? (
          <p className="py-1 text-xs text-subtle">
            Die Modellliste bestätigt die Erreichbarkeit des Servers. Den Antwortstatus des gewählten Modells zeigt der Chat beim
            Senden.
          </p>
        ) : null}
        <div className="mb-2 mt-2 rounded-md border border-border px-2 py-2">
          <p className="text-xs text-muted">Profil</p>
          <p className="mb-1 text-[11px] text-subtle">
            Anbieter, API/Abo, URL, Modell und Kontext speichern. Zugangsdaten bleiben separat.
          </p>
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
            aboOn
              ? "Budget für Anvils Anfragekontext. Das tatsächliche Modellfenster verwaltet die CLI."
              : llmContextAuto
                ? "Cloud/API/Abo: Auto aus Katalog (Fenster des Modells). Lokal: num_ctx."
                : "Fenster für das Modell. Cloud/API besser Auto."
          }
        >
          <div className="flex flex-col items-end gap-1">
            <label className="flex items-center gap-2 text-xs text-muted">
              Auto
              <button
                type="button"
                role="switch"
                aria-checked={llmContextAuto}
                aria-label="Kontext automatisch"
                className={`relative h-5 w-8 rounded-full border ${llmContextAuto ? "border-accent bg-accent" : "border-border bg-bg"}`}
                onClick={() => setLlmContextAuto(!llmContextAuto)}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-3.5 rounded-full bg-fg ${llmContextAuto ? "translate-x-[0.7rem] bg-accent-fg" : ""}`}
                />
              </button>
            </label>
            <Seg<string>
              value={llmContextAuto ? "auto" : ctxCustom || !ctxChip ? "custom" : String(ctxChip)}
              onChange={(v) => {
                if (v === "auto") {
                  setLlmContextAuto(true);
                  setCtxCustom(false);
                  return;
                }
                setLlmContextAuto(false);
                if (v === "custom") {
                  setCtxCustom(true);
                  return;
                }
                setCtxCustom(false);
                setLlmContext(Number(v));
              }}
              options={[
                { id: "auto", label: "Auto" },
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
      <Vis q={q} label="Thinking Reasoning Denken minimal low mid high xhigh max">
        <Row
          label="Thinking"
          hint={
            activeThinking !== llmThinking
              ? `Gespeichert: ${thinkingLabels[llmThinking]}. Für dieses Modell nicht verfügbar; wirksam ist Auto.`
              : thinkModes.length === 1
                ? "Für dieses Modell ist keine einstellbare Denkstufe bekannt. Es gilt die Modellvorgabe."
                : isLocalThinking(llmProvider) && !aboOn
                  ? "Auto erkennt Thinking am Modell; Low/Mid/High legen die Denkstufe fest."
                  : "Auto verwendet die CLI- bzw. Modellvorgabe. Höhere Stufen können länger dauern und mehr Tokens verbrauchen."
          }
        >
          <Seg<ThinkingMode>
            value={activeThinking}
            onChange={setLlmThinking}
            options={thinkModes.map(id => ({ id, label: thinkingLabels[id] }))}
          />
        </Row>
      </Vis>
      {!aboOn ? (
        <>
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
        </>
      ) : (
        <p className="py-2 text-xs text-muted">Temperatur und Antwortlimit werden von der CLI gesteuert.</p>
      )}
      {!aboOn && llmProvider !== "grok" && llmProvider !== "brain" ? (
        <Vis q={q} label="Modell Format Tools Werkzeuge Kompatibilität kompakt Text 400 Lernen gelernt Zuordnung learning">
          <ToolModeRow provider={llmProvider} model={llmModel} baseUrl={llmBaseUrl} />
          <ToolLearningRow provider={llmProvider} model={llmModel} baseUrl={llmBaseUrl} />
          <CapRow provider={llmProvider} model={llmModel} baseUrl={llmBaseUrl} />
        </Vis>
      ) : null}
      <Vis q={q} label="Retry Versuche Abbruch lokal">
        <Slider
          label="Versuche"
          hint="Wiederholungen bei geeigneten Verbindungsfehlern. 1 = keine Wiederholung; lokale Modellladevorgänge werden nicht wegen eines leeren Streams neu gestartet."
          min={1}
          max={8}
          step={1}
          value={llmRetries}
          onChange={setLlmRetries}
        />
        <Slider
          label="Harter Stop"
          hint="0 = kein Zeitlimit. Sonst maximales Zeitbudget der Modellanfrage in Minuten."
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
          hint="Begrenzt den an das Modell gesendeten Kontext. Das gespeicherte Chatarchiv bleibt vollständig. Auto ab etwa 70 %."
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
        <Vis q={q} label="Ask Fragen Agent Modus">
          <Row label="Standard-Modus" hint={t("defaultModeHint")}>
          <Seg
            value={agentMode}
            onChange={setAgentMode}
            options={[
              { id: "ask", label: t("ask") },
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
      <Vis q={q} label="To-do Plan set_plan Anvil Helfer Agent Auto Checkliste">
        <Row label={t("planWho")} hint={t("planWhoH")}>
          <Seg<PlanWho>
            value={normalizePlanWho(planWho)}
            onChange={(v) => useIde.getState().setPlanWho(v)}
            options={[
              { id: "auto", label: t("planWhoAuto") },
              { id: "anvil", label: t("planWhoAnvil") },
              { id: "helper", label: t("planWhoHelper") },
              { id: "agent", label: t("planWhoAgent") },
            ]}
          />
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
          <span className="mt-1 block text-[11px] text-subtle">
            AGENTS.md und .anvil/rules.md gelten immer. Dieses Feld kommt extra dazu.
          </span>
        </label>
      </Vis>
      <Vis q={q} label="MCP Server Tools Werkzeuge verbinden aktiv Kontext Context Bearer Token"><McpFields /></Vis>
    </SettingsSection>
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
  const [suggestion, setSuggestion] = useState<ReturnType<typeof guessProjectHarness> | undefined>();
  const workspaceEpoch = useIde((s) => s.workspaceEpoch);
  useEffect(() => setSuggestion(undefined), [workspaceEpoch]);
  const effective = mergeOpts({ runLoop, testLoop, graphLoop, engineLoop, loopTries, maxRounds, afterWrite, graphSees }, proj);

  function saveProject() {
    try {
      const writes = projectSettingsWrites(useIde.getState().files, {
        runLoop, graphLoop, testLoop, engineLoop, loopTries, maxRounds, afterWrite, graphSees,
      }, suggestion);
      for (const [path, content] of Object.entries(writes)) writeFile(path, content);
      setSuggestion(undefined);
      setNotice("Einstellungen ins Projekt übernommen. Vorhandene Tafel und zusätzliche Projektwerte bleiben erhalten.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Projekteinstellungen konnten nicht gespeichert werden");
    }
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
    setSuggestion(undefined);
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
    setRounds(g.harness.maxRounds ?? 24);
    setSuggestion(g);
    setNotice(`Vorschlag: ${g.harness.name ?? "app"}. Mit „Ins Projekt“ übernehmen; vorhandene Kanten bleiben erhalten.`);
  }

  return (
    <SettingsSection q={q}>
      <Vis q={q} label="Harness Loop Run-Schleife nach write patch Tests Runde">
        <Head>Harness-Loop</Head>
        <Row
          label="An"
          hint="Anvil-Vorgabe: Nach Write in derselben Runde ausführen. Fehler → Patch. Aus bleibt aus, auch mit Projektdatei."
        >
          <Toggle on={runLoop} onChange={setRunLoop} />
        </Row>
        <Row
          label="Tests nach Runde"
          hint="Wenn Testdateien da sind: nach der Agent-Runde automatisch laufen. Rot bleibt in der Spur."
        >
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
        <Row label="Versuche" hint={`Patch und Run bei Fehler. Wirksam: ${effective.loopTries} · ${proj?.loopTries != null ? "Projekt" : "Anvil"}.`}>
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
      <Vis q={q} label="Harness Projekt Datei graph.json raten wirksam Vorrang Vorgaben effective settings source">
        {proj ? (
          <details className="my-2 rounded-md border border-border px-2 py-2">
            <summary className="cursor-pointer text-xs text-muted">Wirksame Einstellungen im Projekt</summary>
            <p className="py-2 text-xs text-subtle">Run-, Test-, Graph- und Engine-Schalter sowie Runden gelten aus Anvil. Die Versuchszahl kann das Projekt vorgeben. „Laden“ übernimmt Projektwerte in die Anvil-Vorgaben.</p>
            <table className="w-full text-left text-xs">
              <thead><tr><th className="py-1">Einstellung</th><th>Wirksam</th><th>Quelle</th></tr></thead>
              <tbody>{[
                ["Run-Schleife", effective.runLoop ? "An" : "Aus", "Anvil"],
                ["Tests", effective.testLoop ? "An" : "Aus", "Anvil"],
                ["Graph", effective.graphLoop ? "An" : "Aus", "Anvil"],
                ["Engine", effective.engineLoop ? "An" : "Aus", "Anvil"],
                ["Nach Write", effective.afterWrite ?? "none", "Anvil-Schalter"],
                ["Versuche", effective.loopTries, proj.loopTries != null ? "Projekt" : "Anvil"],
                ["Runden", effective.maxRounds, "Anvil"],
                ["Frames", effective.graphSees, "Anvil"],
              ].map(([label, value, source]) => <tr key={label}><td className="py-1">{label}</td><td>{value}</td><td className="text-muted">{source}</td></tr>)}</tbody>
            </table>
          </details>
        ) : null}
        {suggestion ? <p className="py-2 text-xs text-muted">Vorschlag: {suggestion.harness.name} · {suggestion.graph.edges?.length ?? 0} Kanten. „Ins Projekt“ ergänzt fehlende Kanten und übernimmt die angezeigten Vorgaben.</p> : null}
        <p className="py-1 text-[11px] text-subtle">
          {proj
            ? `.anvil/harness.json · ${proj.name ?? "app"} · ${proj.afterWrite ?? "run"}`
            : "Keine Projektdatei — Einstellungen gelten."}
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
            Raten · Vorschlag
          </Button>
        </div>
      </Vis>
    </SettingsSection>
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
            <button
              type="button"
              className="text-[11px] text-danger"
              onClick={() => setMcpServers(servers.filter((_, n) => n !== i))}
            >
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
        <Button variant="quiet" className="h-8" onClick={() => useIde.getState().setSidebar("mcp")}>
          Pane
        </Button>
      </div>
    </div>
  );
}

function CapRow({ provider, model, baseUrl }: { provider: string; model: string; baseUrl: string }) {
  const t = useT();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    window.addEventListener("anvil-caps", on);
    return () => window.removeEventListener("anvil-caps", on);
  }, []);
  const cap = getCap(provider, model, baseUrl || providerOf(provider).baseUrl);
  void tick;
  const known = cap.tools !== "unknown" || cap.noThinkWithTools || cap.noStreamTools || cap.noRequired || cap.note;
  return (
    <Row label={t("capFormat")} hint={t("capHint")}>
      <div className="flex max-w-[16rem] flex-col items-end gap-1">
        <p className="text-right font-mono text-[11px] text-muted">{capLabel(cap)}</p>
        {known ? (
          <Button className="h-7 text-[11px]" variant="quiet" onClick={() => resetCap(provider, model, baseUrl || providerOf(provider).baseUrl)}>
            {t("capReset")}
          </Button>
        ) : null}
      </div>
    </Row>
  );
}

function ToolModeRow({ provider, model, baseUrl }: { provider: string; model: string; baseUrl: string }) {
  const modes = useIde((s) => s.llmToolModes);
  const setMode = useIde((s) => s.setLlmToolMode);
  const locale = useIde((s) => s.locale);
  const de = locale !== "en";
  const key = toolTargetKey(provider, model, baseUrl || providerOf(provider).baseUrl);
  const mode = toolCompatibility(modes[key]);
  const hints = de ? {
    standard: "Bisherige Tool-Auswahl. Beim Update bleibt dieser Modus aktiv.",
    compact: "Bis zu 8 passende Tools. Weitere gezielt nachladen. Bei eindeutigem Stillstand ein Textversuch für diesen Auftrag.",
    text: "Bis zu 8 Tools als Text. Ein vollständiger JSON-Aufruf pro Antwort; keine nativen Function Calls.",
  } : {
    standard: "Existing tool selection. Updates keep this mode active.",
    compact: "Up to 8 relevant tools; select more as needed. One text fallback for this task on a clear stall.",
    text: "Up to 8 tools as text. One complete JSON call per answer; no native function calls.",
  };
  return <div className="py-3" role="group" aria-label={de ? "Tool-Kompatibilität" : "Tool compatibility"}>
    <p className="mb-2 text-sm text-fg">{de ? "Tool-Kompatibilität" : "Tool compatibility"}</p>
    <div className="flex flex-wrap gap-1">
      {(["standard", "compact", "text"] as ToolCompatibility[]).map((value, i) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`rounded-md border border-border px-3 py-2 text-xs ${mode === value ? "bg-hover text-fg" : "bg-bg text-muted"}`}>{(de ? ["Bisherig", "Kompakt", "Text"] : ["Existing", "Compact", "Text"])[i]}</button>)}
    </div>
    <p className="mt-2 text-xs text-muted">{hints[mode]} {de ? "Gilt für dieses Modell an dieser Serveradresse; ab dem nächsten Auftrag. Thinking bleibt wie eingestellt." : "Applies to this model at this server address, starting with the next task. Keeps your thinking setting."}</p>
  </div>;
}
