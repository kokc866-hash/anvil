import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { diskSupported, pickFolder } from "@/lib/disk";
import { CompanionSetup } from "./companion-setup";
import { ModelPick } from "./model-pick";
import { listModels } from "@/lib/agent-client";
import { PROVIDER_GROUPS, providerOf, type ProviderId } from "@/lib/providers";
import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";
import { AnvilMark } from "./anvil-mark";
import { ANVIL_VERSION } from "@/lib/version";
import { credsForProvider } from "@/lib/sub-auth";

type Ping = "idle" | "ok" | "bad";

export function FirstRun() {
  const t = useT();
  const done = useIde((s) => s.setupDone);
  const diskName = useIde((s) => s.diskName);
  const provider = useIde((s) => s.llmProvider);
  const url = useIde((s) => s.llmBaseUrl);
  const model = useIde((s) => s.llmModel);
  const apiKey = useIde((s) => s.llmApiKey);
  const setLlmProvider = useIde((s) => s.setLlmProvider);
  const setLlmBaseUrl = useIde((s) => s.setLlmBaseUrl);
  const setLlmModel = useIde((s) => s.setLlmModel);
  const setLlmApiKey = useIde((s) => s.setLlmApiKey);
  const [models, setModels] = useState<string[]>([]);
  const [probe, setProbe] = useState<Ping>("idle");
  const [probeMsg, setProbeMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const spec = providerOf(provider);
  const groups = PROVIDER_GROUPS.filter((g) => g.ids.some((id) => id !== "brain"));

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (done) return;
    try {
      if (window.self !== window.top || !diskSupported()) useIde.getState().setSetupDone(true);
    } catch {
      useIde.getState().setSetupDone(true);
    }
  }, [done]);

  useEffect(() => {
    if (provider === "grok") return;
    if (spec.needsKey && !apiKey.trim() && !credsForProvider(provider).token) return;
    if (spec.needsSub && !apiKey.trim() && !credsForProvider(provider).token) return;
    const tmr = window.setTimeout(() => void checkModel(), 400);
    return () => window.clearTimeout(tmr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, url, apiKey]);

  async function checkModel() {
    setProbe("idle");
    setProbeMsg(t("setupCheck") + "…");
    try {
      const ids = await listModels({ provider, baseUrl: url, apiKey });
      setModels(ids);
      setProbe("ok");
      setProbeMsg(ids.length ? `${ids.length} ${t("setupModels")}` : t("setupModelOk"));
      if (ids.length && !model) setLlmModel(ids[0]);
    } catch (err) {
      setModels([]);
      setProbe("bad");
      setProbeMsg(err instanceof Error ? err.message : t("setupModelBad"));
    }
  }

  async function openFolder() {
    setBusy(true);
    try {
      const pack = await pickFolder();
      const st = useIde.getState();
      st.applyFiles(pack.files, pack.dirs);
      const { diskFolderName } = await import("@/lib/disk");
      st.setDiskName(diskFolderName());
      const first = Object.keys(pack.files).sort()[0];
      if (first) st.openFile(first);
      st.setNotice(t("folderOpen"));
    } catch (err) {
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
        <ol className="mt-4 space-y-4 text-[12px]">
          <li className="flex items-start justify-between gap-2">
            <span>
              <span className="text-fg">1. {t("setupFolder")}</span>
              <span className="mt-0.5 block text-muted">{diskName || t("setupFolderH")}</span>
            </span>
            <Button className="h-7 px-2 text-[11px]" disabled={busy || !diskSupported()} onClick={() => void openFolder()}>
              {t("openFolder")}
            </Button>
          </li>
          <li>
            <span className="text-fg">2. {t("setupModel")}</span>
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
                  }}
                >
                  {g.id === "local" ? t("setupLocal") : g.id === "cloud" ? t("setupCloud") : t("setupBuiltin")}
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
              }}
            >
              {groups.map((g) => (
                <optgroup key={g.id} label={g.id === "local" ? t("setupLocal") : g.id === "cloud" ? t("setupCloud") : t("setupBuiltin")}>
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
            {spec.needsKey && credsForProvider(provider).via !== "abo" ? (
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
          </li>
          <li>
            <span className="text-fg">3. {t("setupComp")}</span>
            <div className="mt-2">
              <CompanionSetup compact />
            </div>
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
