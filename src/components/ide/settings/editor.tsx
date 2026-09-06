import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

import { PRESETS, useIde, type MotionLevel, type OutputDock, type SplitMode, type ThemeName } from "@/store/ide";
import { applyLang, useT, type Locale } from "@/lib/i18n";

import { Head, Vis, Row, Seg, Toggle } from "./fields";

export function EditorSection({ q }: { q: string }) {
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

export function LayoutSection({ q }: { q: string }) {
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
          <Toggle on={trailOn} onChange={(v) => setPanels({ ...useIde.getState().panels, trail: v })} />
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
          <Button className="h-8" onClick={() => void import("@/lib/hw").then((h) => h.applyHwTune())}>
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

export function OutputSection({ q }: { q: string }) {
  const outputDock = useIde((s) => s.outputDock);
  const openOutputOnRun = useIde((s) => s.openOutputOnRun);
  const runInWindow = useIde((s) => s.runInWindow);
  const runHtml = useIde((s) => s.runHtml);
  const setOutputDock = useIde((s) => s.setOutputDock);
  const setOpenOutputOnRun = useIde((s) => s.setOpenOutputOnRun);
  const setRunInWindow = useIde((s) => s.setRunInWindow);
  const setRunHtml = useIde((s) => s.setRunHtml);
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
      <Vis q={q} label="HTML ausführen Vorschau Agent iframe">
        <Row label={t("runHtml")} hint={t("runHtmlHint")}>
          <Toggle on={runHtml} onChange={setRunHtml} />
        </Row>
      </Vis>
    </section>
  );
}
