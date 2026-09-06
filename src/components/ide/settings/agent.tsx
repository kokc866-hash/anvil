import { SecretStorageStatus } from "./secret-storage-status";
import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

import { listModels } from "@/lib/agent-client";
import { wantsThinking, type ThinkingMode } from "@/lib/llm-options";
import type { CompactMode } from "@/lib/compact";
import { CONTEXT_MAX, CONTEXT_MIN, CONTEXT_SIZES, formatContext, matchingContextChip } from "@/lib/tokens";
import { useLearn } from "@/lib/learn";

import { ANVIL_ROLES } from "@/lib/anvil";

import { newMcpId, type McpServer } from "@/lib/mcp";
import { ModelPick } from "../model-pick";

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
import { normalizePlanWho, type PlanWho } from "@/lib/plan";

import { providerOf, type LlmProvider } from "@/lib/providers";

import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";

import { capLabel, getCap, resetCap } from "@/lib/model-caps";

import { cliKindFor, probeCli, loginCli, cliStatusText, CLI_PROVIDERS, type CliKind } from "@/lib/cli-client";
import { ProviderPick } from "../provider-pick";

import { Head, Vis, Row, Seg, Field, Toggle } from "./fields";

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
          setProbe(cliStatusText(status));
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
      setProbe(
        snapshot.llmProvider === "azure"
          ? "Azure-Zugang geprüft; Deployment wird beim Senden geprüft"
          : ids.length
            ? `Modellliste geladen · ${ids.length} Modelle`
            : "Server erreichbar · Modellliste leer",
      );
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
    if (llmProvider === "grok") return;
    if (!aboOn && spec.needsKey && !llmApiKey.trim()) return;
    const timer = window.setTimeout(() => void probeLocal(true), 400);
    return () => {
      window.clearTimeout(timer);
      probeController.current?.abort();
    };
    // Each request reads a fresh store snapshot and rejects stale results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmProvider, llmBaseUrl, llmApiKey, llmAuthMode]);

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
        setProbe(cliStatusText(status));
      }
    } catch (err) {
      if (current()) setSubMsg(err instanceof Error ? err.message : "CLI-Anmeldung fehlgeschlagen.");
    } finally {
      if (loginController.current === controller) setSubBusy(false);
    }
  }

  return (
    <section>
      <Head>Agent</Head>
      <p className="mb-2 text-xs text-muted">
        {ANVIL_ROLES.model} Die App handelt selbst (Run, Git, Dateien). {ANVIL_ROLES.helper}
      </p>
      <Vis q={q} label="Anbieter Modell Key">
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
      {!aboOn ? (
        <>
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
        </>
      ) : (
        <p className="py-2 text-xs text-muted">Thinking, Temperatur und Antwortlimit werden von der CLI gesteuert.</p>
      )}
      <Vis q={q} label="Modell Format Tools 400">
        <CapRow provider={llmProvider} model={llmModel} />
      </Vis>
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
    writeFile(
      BOARD_PATH,
      filesFromBoard(board, {
        runLoop,
        graphLoop,
        testLoop,
        engineLoop: Boolean(engineLoop) || afterWrite === "engine",
        afterWrite: afterWrite ?? "run",
        loopTries,
        maxRounds: maxRounds ?? 12,
      })[BOARD_PATH],
    );
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
        <Row
          label="An"
          hint="Nach Write: in derselben Runde ausführen. Fehler → Patch. Projektdatei hat Vorrang, wenn vorhanden."
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
