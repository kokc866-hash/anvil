import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { diskSupported, pickFolder, diskFolderName } from "@/lib/disk";
import { canOpenOsWorkspace, openOsWorkspace } from "@/lib/workspace-open";
import { CompanionSetup } from "./companion-setup";
import { ConnectionSummary } from "./connection-summary";
import { connectionProbeSummary } from "@/lib/connection-capabilities";
import { FIRST_SUCCESS_HTML, firstSuccessPath, firstSuccessPrompt } from "@/lib/first-success";
import { runFromEditor } from "@/lib/editor-run";
import { ModelPick } from "./model-pick";
import { listModels } from "@/lib/agent-client";
import { PROVIDER_GROUPS, providerOf, type ProviderId } from "@/lib/providers";
import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";
import { AnvilMark } from "./anvil-mark";
import { ANVIL_VERSION } from "@/lib/version";
import { cliKindFor, probeCli } from "@/lib/cli-client";

type Ping = "idle" | "ok" | "bad" | "unknown";

export function FirstRun() {
  const t = useT();
  const locale = useIde(s => s.locale);
  const en = locale === "en";
  const agentBusy = useIde(s => s.agentBusy);
  const done = useIde((s) => s.setupDone);
  const diskName = useIde((s) => s.diskName);
  const provider = useIde((s) => s.llmProvider);
  const url = useIde((s) => s.llmBaseUrl);
  const model = useIde((s) => s.llmModel);
  const apiKey = useIde((s) => s.llmApiKey);
  const authMode = useIde((s) => s.llmAuthMode);
  const cli = cliKindFor(provider, authMode);
  const request = useRef<AbortController | null>(null);
  const setLlmProvider = useIde((s) => s.setLlmProvider);
  const setLlmBaseUrl = useIde((s) => s.setLlmBaseUrl);
  const setLlmModel = useIde((s) => s.setLlmModel);
  const setLlmApiKey = useIde((s) => s.setLlmApiKey);
  const [models, setModels] = useState<string[]>([]);
  const [probe, setProbe] = useState<Ping>("idle");
  const [probeMsg, setProbeMsg] = useState("");
  const [probeDetails, setProbeDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [modelSetupOpen, setModelSetupOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const spec = providerOf(provider);
  const groups = PROVIDER_GROUPS.filter((g) => g.ids.some((id) => id !== "brain"));
  const groupLabel = (id: (typeof PROVIDER_GROUPS)[number]["id"]) =>
    t({ local: "setupLocal", cloud: "setupCloud", builtin: "setupBuiltin", other: "tabOther" }[id]);
  const folderSupported = canOpenOsWorkspace() || diskSupported();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (done) return;
    try {
      if (window.self !== window.top) useIde.getState().setSetupDone(true);
    } catch {
      useIde.getState().setSetupDone(true);
    }
  }, [done, folderSupported]);

  useEffect(() => {
    request.current?.abort();
    setProbe("idle"); setProbeMsg(""); setProbeDetails(""); setModels([]);
    if (done || !modelSetupOpen || provider === "grok" || (!cli && spec.needsKey && !apiKey.trim())) return;
    const timer = window.setTimeout(() => void checkModel(), 400);
    return () => { window.clearTimeout(timer); request.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, modelSetupOpen, provider, url, apiKey, authMode]);

  async function checkModel() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const snapshot = useIde.getState();
    const current = () => {
      const now = useIde.getState();
      return !controller.signal.aborted && now.llmProvider === snapshot.llmProvider && now.llmAuthMode === snapshot.llmAuthMode && now.llmBaseUrl === snapshot.llmBaseUrl && now.llmApiKey === snapshot.llmApiKey;
    };
    setProbe("idle"); setProbeMsg(t("setupCheck") + "…"); setProbeDetails("");
    try {
      if (cli) {
        const status = await probeCli(cli, controller.signal);
        if (current()) { setProbe(status.installed === false || status.authenticated === false ? "bad" : status.authenticated === true ? "ok" : "unknown"); setProbeMsg(connectionProbeSummary("cli", status, locale)); }
        return;
      }
      const ids = await listModels({ provider, baseUrl: url, apiKey, signal: controller.signal });
      if (!current()) return;
      setModels(ids); setProbe("ok");
      setProbeMsg(connectionProbeSummary("catalog", { count: ids.length }, locale));
      if (ids.length && !useIde.getState().llmModel && provider !== "azure") setLlmModel(ids[0]);
    } catch (err) {
      if (!current()) return;
      setModels([]); setProbe("bad");
      const message = err instanceof Error ? err.message : t("setupModelBad");
      if (!cli && spec.kind === "local") {
        setProbeMsg(t("setupLocalModelBad", { provider: spec.label }));
        setProbeDetails(message);
      } else {
        setProbeMsg(message);
      }
    }
  }

  async function tryExample() {
    const st = useIde.getState();
    if (busy || st.agentBusy || st.running) return;
    setBusy(true);
    const path = firstSuccessPath(st.files, st.dirs);
    st.writeFile(path, FIRST_SUCCESS_HTML);
    st.openFile(path);
    const hasDraft = Boolean(st.agentDraft.trim());
    if (!hasDraft) {
      st.setAgentMode("agent");
      st.setAgentDraft(firstSuccessPrompt(path, locale));
    }
    st.setSetupDone(true);
    st.setNotice(hasDraft
      ? (en ? "Example added. Try the button in Run. Your existing chat draft is unchanged." : "Beispiel ergänzt. Teste den Knopf im Run-Fenster. Dein vorhandener Chat-Entwurf bleibt erhalten.")
      : (en ? "Example added. Try the button in Run. Your first change is ready as an editable chat draft." : "Beispiel ergänzt. Teste den Knopf im Run-Fenster. Deine erste Änderung liegt als bearbeitbarer Chat-Entwurf bereit."));
    try { await runFromEditor(path); } finally { setBusy(false); }
  }

  async function openFolder() {
    if (busy) return;
    setBusy(true);
    try {
      if (canOpenOsWorkspace()) {
        const result = await openOsWorkspace();
        if (!result.ok) {
          if (result.error && result.error !== "Kein Ordner") useIde.getState().setNotice(result.error);
          return;
        }
        useIde.getState().setNotice(t("folderOpen"));
        return;
      }
      const pack = await pickFolder();
      const st = useIde.getState();
      st.applyFiles(pack.files, pack.dirs);
      st.setDiskName(diskFolderName());
      const first = Object.keys(pack.files).sort()[0];
      if (first) st.openFile(first);
      st.setNotice(t("folderOpen"));
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      useIde.getState().setNotice(err instanceof Error ? err.message : t("folderFail"));
    } finally {
      setBusy(false);
    }
  }

  if (!mounted || done) return null;

  return (
    <div className="ui-overlay absolute inset-0 z-40 flex items-center justify-center bg-bg/80 p-6">
      <div className="ui-sheet max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-3">
          <AnvilMark className="size-10 shrink-0" />
          <div>
            <p className="text-sm font-medium text-fg">{t("setupTitle")}</p>
            <p className="font-mono text-[11px] text-subtle">Anvil {ANVIL_VERSION}</p>
            <p className="mt-1 text-[12px] text-muted">{t("setupHint")}</p>
          </div>
        </div>
        <div className="rounded-md border border-border p-3 text-[12px]">
          <p className="font-medium text-fg">{en ? "See a result in one minute" : "In einer Minute zum ersten Ergebnis"}</p>
          <p className="mt-1 text-muted">{en ? "Open a folder or try the built-in counter. It runs without a model, account or extra download. The example is added alongside your files." : "Öffne einen Ordner oder teste den eingebauten Zähler. Er läuft ohne Modell, Konto oder weiteren Download. Das Beispiel wird neben deinen Dateien ergänzt."}</p>
          <Button className="mt-2 h-8 px-3 text-xs" disabled={busy || agentBusy} onClick={() => void tryExample()}>{en ? "Run example without AI" : "Beispiel ohne KI starten"}</Button>
        </div>
        <ol className="mt-4 space-y-4 text-[12px]">
          <li className="flex items-start justify-between gap-2">
            <span>
              <span className="text-fg">1. {t("setupFolder")}</span>
              <span className="mt-0.5 block text-muted">{diskName || t("setupFolderH")}</span>
            </span>
            <Button className="h-7 px-2 text-[11px]" disabled={busy || !folderSupported} onClick={() => void openFolder()}>
              {t("openFolder")}
            </Button>
          </li>
          <li>
            <details open={modelSetupOpen} onToggle={(e) => setModelSetupOpen(e.currentTarget.open)}>
            <summary className="cursor-pointer text-fg">2. {en ? "Connect AI for chat and changes" : "KI für Chat und Änderungen verbinden"}</summary>
            <span className="mt-0.5 block text-muted">{t("setupModelH")}</span>
            <div className="mt-2 flex flex-wrap gap-1">
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`h-7 rounded-md px-2 text-[11px] ${g.ids.includes(provider as ProviderId) ? "bg-hover text-fg" : "text-muted hover:text-fg"}`}
                  onClick={() => {
                    const next = g.ids.find((id) => id !== "brain") ?? g.ids[0];
                    if (next) setLlmProvider(next);
                    setProbe("idle");
                    setModels([]);
                    setProbeMsg("");
                    setProbeDetails("");
                  }}
                >
                  {groupLabel(g.id)}
                </button>
              ))}
            </div>
            <select
              value={provider}
              className="mt-2 h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none"
              onChange={(e) => {
                setLlmProvider(e.target.value as ProviderId);
                setProbe("idle");
                setModels([]);
                setProbeMsg("");
                setProbeDetails("");
              }}
            >
              {groups.map((g) => (
                <optgroup key={g.id} label={groupLabel(g.id)}>
                  {g.ids.filter((id) => id !== "brain").map((id) => (
                    <option key={id} value={id}>
                      {providerOf(id).label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-subtle">{spec.hint}</p>
            {spec.needsUrl ? (
              <label className="mt-2 block">
                <span className="text-[11px] text-muted">{t("setupUrl")}</span>
                <input
                  value={url}
                  onChange={(e) => setLlmBaseUrl(e.target.value)}
                  className="mt-0.5 h-8 w-full rounded-md border border-border bg-bg px-2 font-mono text-[12px] text-fg outline-none"
                />
              </label>
            ) : null}
            {!cli && provider !== "grok" ? (
              <label className="mt-2 block">
                <span className="text-[11px] text-muted">{t("setupKey")}</span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
                  className="mt-0.5 h-8 w-full rounded-md border border-border bg-bg px-2 font-mono text-[12px] text-fg outline-none"
                />
              </label>
            ) : null}
            <ConnectionSummary />
            <ModelPick
              catalog={spec.models}
              live={models}
              value={model}
              onChange={setLlmModel}
              placeholder={spec.model || t("setupModelName")}
              loading={probe === "idle" && Boolean(probeMsg)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button className="h-7 px-2 text-[11px]" onClick={() => void checkModel()}>
                {t("setupCheck")}
              </Button>
              <span className={probe === "ok" ? "text-ok" : probe === "bad" ? "text-danger" : "text-muted"}>
                {probeMsg || spec.label}
              </span>
            </div>
            {probeDetails ? (
              <details className="mt-2 text-[11px] text-muted">
                <summary className="cursor-pointer">{t("setupConnectionDetails")}</summary>
                <p className="mt-1 break-words whitespace-pre-wrap">{probeDetails}</p>
              </details>
            ) : null}
            </details>
          </li>
          <li>
            <span className="text-fg">3. {en ? "Make one small change" : "Eine kleine Änderung machen"}</span>
            <p className="mt-1 text-muted">{en ? "Ask the agent to change a heading. Inspect the file changes in the step history (Trail). Depending on your settings, you accept them yourself or Anvil applies them automatically." : "Bitte den Agenten, eine Überschrift zu ändern. Prüfe die Dateiänderungen im Verlauf der Arbeitsschritte (Spur). Je nach Einstellung übernimmst du sie selbst oder Anvil wendet sie automatisch an."}</p>
          </li>
          <li>
            <span className="text-fg">4. {en ? "Run, check and save" : "Ausführen, prüfen und speichern"}</span>
            <p className="mt-1 text-muted">{en ? "Choose Run, test the changed behavior and save. Trail shows what was checked and lets you undo changes." : "Wähle Run (Ausführen), teste das geänderte Verhalten und speichere. Die Spur zeigt, was geprüft wurde, und lässt dich Änderungen zurücknehmen."}</p>
          </li>
          <li>
            <details><summary className="cursor-pointer text-muted">{en ? "Optional: local tools and other languages" : "Optional: lokale Werkzeuge und weitere Sprachen"}</summary>
            <div className="mt-2">
              <CompanionSetup compact probeOnMount={false} />
            </div></details>
          </li>
        </ol>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="quiet" className="h-8 px-3 text-xs" onClick={() => useIde.getState().setSetupDone(true)}>
            {t("setupSkip")}
          </Button>
          <Button variant="primary" className="h-8 px-3 text-xs" onClick={() => useIde.getState().setSetupDone(true)}>
            {t("setupGo")}
          </Button>
        </div>
      </div>
    </div>
  );
}
