import { providerOf } from "@/lib/providers";
import { langFromPath, langLabel } from "@/lib/languages";
import { BRAIN_MODELS, useBrain } from "@/lib/brain";
import { useLearn } from "@/lib/learn";
import { problemsPrompt } from "@/lib/lsp";
import { Tip } from "@/components/ui/tooltip";
import { saveNow } from "@/lib/save";
import { useIntern } from "@/lib/intern";
import { useIde } from "@/store/ide";
import { ANVIL_SURFACE, surfaceLabel } from "@/lib/surface";
import { useT } from "@/lib/i18n";
import { useKbd } from "@/lib/use-kbd";

export function StatusBar() {
  const path = useIde((s) => s.activePath);
  const cursor = useIde((s) => s.cursor);
  const provider = useIde((s) => s.llmProvider);
  const model = useIde((s) => s.llmModel);
  const pending = useIde((s) => s.pendingDiffs.length);
  const agentBusy = useIde((s) => s.agentBusy);
  const debug = useIde((s) => s.debug);
  const pluginStatus = useIde((s) => s.pluginStatus);
  const lspN = useIde((s) => s.lspProblems.length);
  const revealOutput = useIde((s) => s.revealOutput);
  const learnOn = useLearn((s) => s.on);
  const skillN = useLearn((s) => s.skills.length);
  const brainStatus = useBrain((s) => s.status);
  const brainOn = useBrain((s) => s.on);
  const brainProg = useBrain((s) => s.progress);
  const brainBusy = useBrain((s) => s.busy);
  const brainLoaded = useBrain((s) => s.loadedId);
  const brainModel = useBrain((s) => s.customId.trim() || s.modelId);
  const brainLast = useBrain((s) => s.lastAuto);
  const engineLink = useIde((s) => s.engineLink);
  const internN = useIntern((s) => s.faults.filter((f) => f.open).length);
  const setInternPane = useIntern((s) => s.setPane);
  const surfaceId = useIde((s) => s.activeSurfaceId);
  const surfaceMode = useIde((s) => s.surfaceMode);
  const mcpServers = useIde((s) => s.mcpServers);
  const kSave = useKbd("save");
  const kGoto = useKbd("gotoLine");
  const kCopy = useKbd("copyPath");
  const kWrap = useKbd("wrap");
  const setSettingsOpen = useIde((s) => s.setSettingsOpen);
  const refN = useIde((s) => Object.keys(s.files).filter((p) => p.startsWith("ref/") || p.startsWith("ref\\")).length);
  const tabSize = useIde((s) => s.tabSize);
  const setTabSize = useIde((s) => s.setTabSize);
  const wordWrap = useIde((s) => s.wordWrap);
  const setWordWrap = useIde((s) => s.setWordWrap);
  const setSidebar = useIde((s) => s.setSidebar);
  const lang = path ? langLabel(langFromPath(path)) : "—";
  const spec = providerOf(provider);
  const t = useT();
  const helperId = brainLoaded || brainModel;
  const helperName =
    BRAIN_MODELS.find((m) => m.id === helperId || m.alt === helperId)?.label ||
    (helperId ? helperId.replace(/-Instruct.*$/, "").replace(/-q4f16_1-MLC$/, "") : "") ||
    "Helfer";
  const helperState = !brainOn
    ? t("off")
    : brainStatus === "ready"
      ? brainBusy
        ? t("busy")
        : t("ready")
      : brainStatus === "downloading"
        ? `${Math.round(brainProg * 100)}%`
        : brainStatus === "error"
          ? t("error")
          : t("idle");

  return (
    <footer className={`flex h-6 shrink-0 items-center gap-3 border-t border-border bg-surface px-2 font-mono text-[11px] text-muted ${agentBusy ? "ui-busy" : ""}`}>
      <Tip label={t("mainModel")} side="top">
        <button
          type="button"
          className="truncate text-left hover:text-fg"
          onClick={() => setSettingsOpen(true)}
        >
          {spec.label}
          {model ? ` · ${model}` : ""}
        </button>
      </Tip>
      {surfaceId !== ANVIL_SURFACE || surfaceMode === "bridge" ? (
      <Tip label={t("surface")} side="top">
        <button type="button" className="truncate text-left hover:text-fg" onClick={() => setSidebar("mcp")}>
          {t("surface")} · {surfaceLabel(surfaceId, mcpServers)}
          {surfaceMode === "bridge" && surfaceId !== ANVIL_SURFACE ? ` · ${t("surfaceBridge")}` : ""}
        </button>
      </Tip>
      ) : null}
      <Tip label={t("helperTip")} side="top">
        <button
          type="button"
          className={`truncate text-left hover:text-fg ${
            brainBusy ? "think-live text-fg" : brainStatus === "ready" ? "helper-ready" : ""
          }`}
          onClick={() => setSettingsOpen(true)}
        >
          {brainBusy
            ? t("helperThink", { name: helperName })
            : `${t("helperLine", { name: helperName, state: helperState })}${brainLast && brainStatus === "ready" ? ` · ${brainLast}` : ""}`}
        </button>
      </Tip>
      {debug.paused && debug.path ? (
        <button
          type="button"
          className="text-fg hover:underline"
          title={t("agentDebug")}
          onClick={() => void import("@/lib/fix-agent").then((m) => m.askDebug())}
        >
          ⏸ {debug.path}:{debug.line}
        </button>
      ) : debug.active ? (
        <span>Debug…</span>
      ) : null}
      {refN ? (
        <Tip label={t("refBasket")} side="top">
          <button type="button" className="hover:text-fg" onClick={() => setSidebar("ref")}>
            {t("refsN", { n: refN })}
          </button>
        </Tip>
      ) : null}
      {lspN ? (
        <Tip label={t("problemsTip")} side="top">
          <button
            type="button"
            className="text-danger hover:underline"
            onClick={() => revealOutput()}
            onContextMenu={(e) => {
              e.preventDefault();
              const st = useIde.getState();
              useIde.getState().pushAgent(problemsPrompt(st.lspProblems, st.files));
            }}
          >
            {lspN} {t("problems")}
          </button>
        </Tip>
      ) : null}
      {pluginStatus ? <span className="truncate text-fg">{pluginStatus}</span> : null}
      {learnOn ? (
        <Tip label={t("learnTip")} side="top">
          <span>{t("learnN", { n: skillN })}</span>
        </Tip>
      ) : null}
      {engineLink?.ok ? (
        <Tip label={t("engineOk")} side="top">
          <button type="button" className="hover:text-fg" onClick={() => setSettingsOpen(true)}>
            {engineLink.label} · ok
          </button>
        </Tip>
      ) : null}
      {internN ? (
        <Tip label={t("internErr")} side="top">
          <button type="button" className="text-danger hover:underline" onClick={() => setInternPane(true)}>
            {t("internN", { n: internN })}
          </button>
        </Tip>
      ) : null}
      {pending ? <span className="text-fg">{t("diffsN", { n: pending })}</span> : null}
      <Tip label={t("save")} kbd={kSave} side="top">
        <button type="button" className="hover:text-fg" onClick={() => void saveNow()}>
          {t("save")}
        </button>
      </Tip>
      <Tip label={t("gotoLine")} kbd={kGoto} side="top">
        <button
          type="button"
          className="ml-auto tabular-nums hover:text-fg"
          onClick={() => window.dispatchEvent(new Event("anvil-goto"))}
        >
          {t("lnCol", { line: cursor.line, col: cursor.col })}
        </button>
      </Tip>
      <Tip label={t("indentTip")} side="top">
        <button
          type="button"
          className="hover:text-fg"
          onClick={() => setTabSize(tabSize === 2 ? 4 : tabSize === 4 ? 8 : 2)}
        >
          {t("spacesN", { n: tabSize })}
        </button>
      </Tip>
      <Tip label={t("wordWrap")} kbd={kWrap} side="top">
        <button
          type="button"
          className="hover:text-fg"
          onClick={() => setWordWrap(!wordWrap)}
        >
          {wordWrap ? t("wrap") : t("noWrap")}
        </button>
      </Tip>
      <Tip label={t("copyPath")} kbd={kCopy} side="top">
        <button
          type="button"
          className="hidden max-w-[40%] truncate hover:text-fg sm:inline"
          onClick={() => {
            if (!path) return;
            void navigator.clipboard.writeText(path);
            useIde.getState().revealPath(path);
          }}
        >
          {path ?? ""}
        </button>
      </Tip>
    </footer>
  );
}
