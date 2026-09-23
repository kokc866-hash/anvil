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
  const backgroundAgent = useIde((s) => s.backgroundAgent);
  const backgroundWriteThrough = useIde((s) => s.backgroundWriteThrough);
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
  const thinkingLabels: Record<ThinkingMode, string> = { off: "Aus", auto: "Auto", minimal: "Minimal", low: "Niedrig", medium: "Mittel", high: "Hoch", xhigh: "Sehr hoch", max: "Maximal" };
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
        {useIde.getState().locale === "en" ? "Choose the AI connection for your chat here. Ask explains and investigates; Agent can edit files and run tools. The separate local helper is optional." : "Hier wählst du die KI-Verbindung für deinen Chat. Im Modus „Fragen“ erhältst du Erklärungen und Analysen. Im Modus „Agent“ kann die KI auch Dateien bearbeiten und Werkzeuge ausführen. Der zusätzliche lokale Helfer ist optional."}
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
            label={spec.needsKey ? "API-Schlüssel" : "API-Schlüssel (optional)"}
            value={llmApiKey}
            onChange={setLlmApiKey}
            type="password"
            placeholder={spec.needsKey ? "sk-…" : "Bei Bedarf eintragen"}
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
            Speichere Anbieter, Zugangsart, Serveradresse, Modell und Kontextgröße als Profil. Zugangsdaten werden separat gespeichert.
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
              placeholder="Profilname, z. B. Ollama im Netzwerk"
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
            ? "Für Ollama, LM Studio oder andere Modellserver die API-Adresse des jeweiligen Servers eintragen. Anvil stellt die Verbindung her."
            : spec.needsSub
              ? "CLI-Anmeldungen werden lokal gespeichert. Dafür ist kein API-Schlüssel nötig."
              : "API-Schlüssel werden lokal gespeichert. Anfragen gehen an den gewählten Anbieter."}
        </p>
      </Vis>
      <Vis q={q} label="Context Länge Fenster Tokens">
        <Row
          label="Kontextgröße"
          hint={
            aboOn
              ? "Begrenzt den Kontext, den Anvil für eine Anfrage zusammenstellt. Das tatsächliche Kontextfenster verwaltet die CLI."
              : llmContextAuto
                ? "Für Cloud- und API-Modelle übernimmt Anvil die Kontextgröße aus dem Modellkatalog. Bei lokalen Modellen wird sie als num_ctx übergeben."
                : "Legt die gewünschte Kontextgröße fest. Für Cloud- und API-Modelle wird die automatische Einstellung empfohlen."
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
                { id: "custom", label: "Eigener Wert" },
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
                title="Anzahl der Tokens, höchstens 2 Millionen"
              />
            ) : null}
          </div>
        </Row>
      </Vis>
      <Vis q={q} label="Thinking Reasoning Denken minimal low mid high xhigh max">
        <Row
          label="Denkaufwand"
          hint={
            activeThinking !== llmThinking
              ? `Gespeichert ist „${thinkingLabels[llmThinking]}“. Dieses Modell unterstützt die Einstellung nicht. Deshalb gilt „Auto“.`
              : thinkModes.length === 1
                ? "Für dieses Modell ist keine einstellbare Denkstufe bekannt. Es gilt die Modellvorgabe."
                : isLocalThinking(llmProvider) && !aboOn
                  ? "„Auto“ richtet sich nach den Denkfähigkeiten des Modells. Mit einer festen Stufe bestimmst du den gewünschten Denkaufwand."
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
              hint="Steuert bei Ollama und llama.cpp, wie stark Antworten variieren. Niedrige Werte liefern gleichmäßigere Antworten, hohe Werte mehr Abwechslung."
              min={0}
              max={2}
              step={0.05}
              value={llmTemperature}
              onChange={setLlmTemperature}
              format={(n) => n.toFixed(2)}
            />
            <Slider
              label="Maximale Antwortlänge"
              hint="Bei 0 bestimmt Anvil das Limit anhand der Kontextgröße. Andere Werte begrenzen die Antwort auf die angegebene Anzahl an Tokens."
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
      <Vis q={q} label="Retry Versuche Abbruch lokal Hintergrund Test Hintergrundbetrieb">
        <Row label="Hintergrundbetrieb (Test)" hint="Agentenaufträge mit lokalen API- und CLI-Modellen laufen unabhängig vom Editorfenster. Dateien, Compiler, HTML-Vorschau, Engine-Aktionen und freigegebene Dienste bleiben nutzbar. Bildanhänge benötigen ein Modell mit Bildverständnis. Wenn du Anvil beendest, wird der Auftrag gestoppt.">
          <Toggle on={backgroundAgent} onChange={(backgroundAgent) => useIde.setState({ backgroundAgent })} />
        </Row>
        {backgroundAgent && <Row label="Direkt im Projekt speichern" hint="Speichert Dateiänderungen bereits während des Auftrags im gewählten Projektordner. Vorherige Inhalte werden gesichert. Bei Konflikten hält der Auftrag an. Ist diese Option ausgeschaltet, kannst du die Entwürfe anschließend prüfen.">
          <Toggle on={backgroundWriteThrough} onChange={(backgroundWriteThrough) => useIde.setState({ backgroundWriteThrough })} />
        </Row>}
        <Slider
          label="Versuche"
          hint="Anzahl der Verbindungsversuche bei vorübergehenden Fehlern. Bei 1 gibt es keine Wiederholung. Ein lokales Modell wird nicht erneut geladen, nur weil es noch keine Antwortdaten sendet."
          min={1}
          max={8}
          step={1}
          value={llmRetries}
          onChange={setLlmRetries}
        />
        <Slider
          label="Zeitlimit pro Modellanfrage"
          hint="Bricht eine Modellanfrage nach der angegebenen Anzahl an Minuten ab. Bei 0 gilt kein Zeitlimit."
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
          label="Kontext zusammenfassen"
          hint="Kürzt den an das Modell gesendeten Verlauf. Der gespeicherte Chat bleibt vollständig. „Auto“ greift ab etwa 70 % der verfügbaren Kontextgröße."
        >
          <Seg<CompactMode>
            value={llmCompact}
            onChange={setLlmCompact}
            options={[
              { id: "off", label: "Aus" },
              { id: "auto", label: "Auto" },
              { id: "aggressive", label: "Stärker" },
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
        <Row label="Nach dem Auftrag ausführen" hint="Führt das Projekt nach dem Agentenauftrag aus, auch wenn die automatische Ausführung nach Änderungen ausgeschaltet ist.">
          <Toggle on={autoRunAgent} onChange={setAutoRunAgent} />
        </Row>
      </Vis>
      <HarnessFields q={q} />
      <Vis q={q} label="Lernen Gedächtnis Skills">
        <Row label="Gedächtnis verwenden" hint="Speichert Wissen für spätere Aufgaben. Weitere Einstellungen findest du unter „Gedächtnis“.">
          <Toggle on={learnOn} onChange={(v) => useLearn.getState().setOn(v)} />
        </Row>
      </Vis>
      <Vis q={q} label="Regeln Projektregeln AGENTS">
        <label className="block py-2">
          <span className="text-xs text-muted">Regeln</span>
          <textarea
            value={agentRules}
            rows={5}
            placeholder="Zusätzliche Anweisungen zu AGENTS.md und .anvil/rules.md im Projekt."
            className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg outline-none placeholder:text-subtle focus:ring-2 focus:ring-ring"
            onChange={(e) => setAgentRules(e.target.value)}
          />
          <span className="mt-1 block text-[11px] text-subtle">
            Die Regeln aus AGENTS.md und .anvil/rules.md gelten immer. Die Anweisungen in diesem Feld ergänzen sie.
          </span>
        </label>
      </Vis>
      <Vis q={q} label="MCP Server Tools Werkzeuge verbinden aktiv Kontext Context Bearer Token"><McpFields /></Vis>
    </SettingsSection>
  );
}

function HarnessFields({ q }: { q: string }) {
  const en = useIde(s => s.locale === "en");
  const runLoop = useIde((s) => s.runLoop);
  const testLoop = useIde((s) => s.testLoop);
  const graphLoop = useIde((s) => s.graphLoop);
  const engineLoop = useIde((s) => s.engineLoop);
  const loopTries = useIde((s) => s.loopTries);
  const afterWrite = useIde((s) => s.harnessAfterWrite);
  const maxRounds = useIde((s) => s.harnessMaxRounds);
  const autoContinue = useIde((s) => s.harnessAutoContinue);
  const graphSees = useIde((s) => s.graphSees);
  const files = useIde((s) => s.files);
  const setRunLoop = useIde((s) => s.setRunLoop);
  const setTestLoop = useIde((s) => s.setTestLoop);
  const setGraphLoop = useIde((s) => s.setGraphLoop);
  const setEngineLoop = useIde((s) => s.setEngineLoop);
  const setLoopTries = useIde((s) => s.setLoopTries);
  const setAfter = useIde((s) => s.setHarnessAfterWrite);
  const setRounds = useIde((s) => s.setHarnessMaxRounds);
  const setAutoContinue = useIde((s) => s.setHarnessAutoContinue);
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
      setNotice("Einstellungen in die Projektdateien übernommen. Die vorhandene Tafel und zusätzliche Projekteinstellungen bleiben erhalten.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Projekteinstellungen konnten nicht gespeichert werden");
    }
  }

  function loadProject() {
    if (!proj && !graph) {
      setNotice("Keine Projekteinstellungen in .anvil/harness.json gefunden.");
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
    setNotice("Einstellungen aus dem Projekt geladen.");
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
    setNotice(`Vorschlag für ${g.harness.name ?? "app"} erstellt. Mit „Ins Projekt übernehmen“ anwenden. Vorhandene Verbindungen auf der Tafel bleiben erhalten.`);
  }

  return (
    <SettingsSection q={q}>
      <Vis q={q} label="Harness Loop Run-Schleife nach write patch Tests Runde automatisch weiterarbeiten Rundenlimit Prüfintervall">
        <Head>Automatische Ausführung und Prüfung</Head>
        <Row
          label="Nach Änderungen ausführen"
          hint="Führt das Projekt nach einer Dateiänderung in derselben Arbeitsrunde aus. Fehler werden dem Agenten zur Korrektur übergeben. Diese Einstellung hat Vorrang vor der Projektdatei."
        >
          <Toggle on={runLoop} onChange={setRunLoop} />
        </Row>
        <Row
          label="Tests nach dem Auftrag"
          hint="Führt vorhandene Testdateien nach dem Agentenauftrag automatisch aus. Fehlgeschlagene Tests bleiben im Ablaufprotokoll sichtbar."
        >
          <Toggle on={testLoop} onChange={setTestLoop} />
        </Row>
        <Row label="Prüfung nach Änderungen" hint="Bestimmt, welche Prüfung nach einer Dateiänderung erforderlich ist.">
          <Seg<AfterWrite>
            value={afterWrite ?? "run"}
            onChange={setAfter}
            options={[
              { id: "run", label: "Ausführen" },
              { id: "engine", label: "Engine" },
              { id: "preview", label: "Vorschau" },
              { id: "none", label: "Keine" },
            ]}
          />
        </Row>
        <Row label="Korrekturversuche" hint={`Bei Fehlern kann der Agent Änderungen vornehmen und erneut ausführen. Aktuell gelten ${effective.loopTries} Versuche. Quelle: ${proj?.loopTries != null ? "Projekt" : "Anvil"}.`}>
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
        <Row
          label={en ? "Continue automatically" : "Automatisch weiterarbeiten"}
          hint={en ? "Continue the same task without a fixed round or tool budget while new successful actions occur. Stop and configured time limits remain active." : "Der Agent arbeitet ohne festes Limit für Runden oder Werkzeugaufrufe weiter, solange neue Arbeitsschritte erfolgreich sind. Du kannst ihn jederzeit stoppen. Eingestellte Zeitlimits bleiben aktiv."}
        >
          <Toggle on={autoContinue} onChange={setAutoContinue} />
        </Row>
        <Row
          label={autoContinue ? (en ? "Rounds without progress" : "Runden ohne Fortschritt") : (en ? "Fixed round limit" : "Festes Rundenlimit")}
          hint={autoContinue
            ? (en ? "Pause after this many model rounds without a new successful action. A round may use several tools. Repeated calls do not count as new progress." : "Unterbricht den Auftrag nach dieser Anzahl an Modellrunden ohne neuen erfolgreichen Arbeitsschritt. Eine Runde kann mehrere Werkzeuge verwenden. Wiederholte Aufrufe zählen nicht als neuer Fortschritt.")
            : (en ? "Pause after this many model rounds. Send again to continue with the existing history." : "Nach dieser Anzahl an Modellrunden hält der Auftrag an. Sende eine weitere Nachricht, um mit dem bisherigen Verlauf fortzufahren.")}
        >
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
        <Row label="Ablauf aktivieren" hint="Führt nach dem Programmstart die auf der Tafel verknüpften Schritte aus, etwa Bildaufnahme, Tests oder Formatierung. Auf der Tafel findest du alle verfügbaren Werkzeuge.">
          <Toggle on={graphLoop} onChange={setGraphLoop} />
        </Row>
        <Row label="Engine ausführen" hint="Führt erkannte Godot-, Unity- und Bevy-Projekte nach Dateiänderungen in der Engine aus. Eine Cargo.toml allein reicht nicht zur Erkennung eines Bevy-Projekts.">
          <Toggle on={engineLoop} onChange={setEngineLoop} />
        </Row>
        <Row label="Vorschauprüfungen" hint="Maximale Anzahl an Bildaufnahmen und Vorschauinteraktionen pro Arbeitsrunde.">
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
        <Row label="Abläufe bearbeiten" hint="Verknüpfe Arbeitsschritte auf einer grafischen Tafel. Die Abläufe werden im Projektordner .anvil gespeichert.">
          <Button className="h-8" onClick={() => useIde.getState().setHarnessBoardOpen(true)}>
            Tafel öffnen
          </Button>
        </Row>
        <BoardToggles />
      </Vis>
      <Vis q={q} label="Harness Projekt Datei graph.json raten wirksam Vorrang Vorgaben effective settings source">
        {proj ? (
          <details className="my-2 rounded-md border border-border px-2 py-2">
            <summary className="cursor-pointer text-xs text-muted">Wirksame Einstellungen im Projekt</summary>
            <p className="py-2 text-xs text-subtle">Anvil legt fest, ob Ausführung, Tests, Graph und Engine aktiv sind und wie viele Runden erlaubt sind. Auch das automatische Weiterarbeiten wird hier eingestellt. Die Anzahl der Korrekturversuche kann das Projekt vorgeben. Mit „Aus Projekt laden“ übernimmst du dessen Werte in die Anvil-Einstellungen.</p>
            <table className="w-full text-left text-xs">
              <thead><tr><th className="py-1">Einstellung</th><th>Wirksam</th><th>Quelle</th></tr></thead>
              <tbody>{[
                ["Automatische Ausführung", effective.runLoop ? "An" : "Aus", "Anvil"],
                ["Tests", effective.testLoop ? "An" : "Aus", "Anvil"],
                ["Graph", effective.graphLoop ? "An" : "Aus", "Anvil"],
                ["Engine", effective.engineLoop ? "An" : "Aus", "Anvil"],
                ["Prüfung nach Änderungen", { run: "Ausführen", engine: "Engine", preview: "Vorschau", none: "Keine" }[effective.afterWrite ?? "none"], "Anvil-Einstellung"],
                ["Korrekturversuche", effective.loopTries, proj.loopTries != null ? "Projekt" : "Anvil"],
                ["Automatisch weiterarbeiten", autoContinue ? "An" : "Aus", "Anvil"],
                [autoContinue ? "Prüfintervall (Runden)" : "Festes Rundenlimit", effective.maxRounds, "Anvil"],
                ["Vorschauprüfungen", effective.graphSees, "Anvil"],
              ].map(([label, value, source]) => <tr key={label}><td className="py-1">{label}</td><td>{value}</td><td className="text-muted">{source}</td></tr>)}</tbody>
            </table>
          </details>
        ) : null}
        {suggestion ? <p className="py-2 text-xs text-muted">Vorschlag: {suggestion.harness.name} · {suggestion.graph.edges?.length ?? 0} Verbindungen. „Ins Projekt übernehmen“ ergänzt fehlende Verbindungen auf der Tafel und übernimmt die angezeigten Einstellungen.</p> : null}
        <p className="py-1 text-[11px] text-subtle">
          {proj
            ? `.anvil/harness.json · ${proj.name ?? "app"} · ${proj.afterWrite ?? "run"}`
            : "Keine Projektdatei vorhanden. Es gelten die Anvil-Einstellungen."}
          {graph?.edges?.length ? ` · ${graph.edges.length} Graph-Kanten` : ""}
        </p>
        <div className="mb-2 flex flex-wrap gap-2">
          <Button className="h-8" onClick={saveProject}>
            Ins Projekt übernehmen
          </Button>
          <Button className="h-8" variant="quiet" onClick={loadProject}>
            Aus Projekt laden
          </Button>
          <Button className="h-8" variant="quiet" onClick={guess}>
            Vorschlag erstellen
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
      <Row label="Raster anzeigen" hint="Zeigt ein Punktraster im Hintergrund der Tafel.">
        <Toggle on={grid} onChange={setGrid} />
      </Row>
      <Row label="Am Raster ausrichten" hint="Richtet die Elemente der Tafel an einem Raster mit 24 Pixeln Abstand aus.">
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
      <p className="text-xs text-muted">Verbinde zusätzliche Werkzeuge über einen MCP-Server. Für den Zugriff aus dem Browser muss der Server CORS erlauben.</p>
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
              <input type="checkbox" checked={s.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} /> Aktiv
            </label>
            <button
              type="button"
              className="text-[11px] text-danger"
              onClick={() => setMcpServers(servers.filter((_, n) => n !== i))}
            >
              Verbindung entfernen
            </button>
          </div>
        </div>
      ))}
      <div className="mt-2 flex gap-2">
        <Button
          className="h-8"
          onClick={() => setMcpServers([...servers, { id: newMcpId(), name: "MCP", url: "", enabled: true }])}
        >
          Server hinzufügen
        </Button>
        <Button
          variant="quiet"
          className="h-8"
          onClick={() => {
            void import("@/lib/mcp").then((m) =>
              m.mcpList(useIde.getState().mcpServers).then((list) => {
                setNotice(list.length ? list.map((t) => `${t.server}.${t.name}`).join(", ") : "Keine Werkzeuge verfügbar.");
              }),
            );
          }}
        >
          Werkzeuge prüfen
        </Button>
        <Button variant="quiet" className="h-8" onClick={() => useIde.getState().setSidebar("mcp")}>
          MCP-Verbindungen öffnen
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
    standard: "Verwendet die bisherige Auswahl an Werkzeugen. Bei einer Aktualisierung bleibt dieser Modus aktiv.",
    compact: "Stellt bis zu 8 passende Werkzeuge bereit. Weitere kann der Agent gezielt nachladen. Bei eindeutigem Stillstand versucht Anvil einmal, die Aufrufe als Text zu übermitteln.",
    text: "Beschreibt bis zu 8 Werkzeuge im Text. Das Modell antwortet mit einem vollständigen JSON-Aufruf statt mit einem nativen Funktionsaufruf.",
  } : {
    standard: "Existing tool selection. Updates keep this mode active.",
    compact: "Up to 8 relevant tools; select more as needed. One text fallback for this task on a clear stall.",
    text: "Up to 8 tools as text. One complete JSON call per answer; no native function calls.",
  };
  return <div className="py-3" role="group" aria-label={de ? "Werkzeugkompatibilität" : "Tool compatibility"}>
    <p className="mb-2 text-sm text-fg">{de ? "Werkzeugkompatibilität" : "Tool compatibility"}</p>
    <div className="flex flex-wrap gap-1">
      {(["standard", "compact", "text"] as ToolCompatibility[]).map((value, i) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`rounded-md border border-border px-3 py-2 text-xs ${mode === value ? "bg-hover text-fg" : "bg-bg text-muted"}`}>{(de ? ["Bisherig", "Kompakt", "Text"] : ["Existing", "Compact", "Text"])[i]}</button>)}
    </div>
    <p className="mt-2 text-xs text-muted">{hints[mode]} {de ? "Die Einstellung gilt ab dem nächsten Auftrag für dieses Modell an dieser Serveradresse. Der gewählte Denkaufwand bleibt unverändert." : "Applies to this model at this server address, starting with the next task. Keeps your thinking setting."}</p>
  </div>;
}
