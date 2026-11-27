import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

import { cn } from "@/lib/cn";

import { BrainSection } from "./brain-settings";
import { ModelLibSection } from "./model-lib-settings";

import { CompanionSetup } from "./companion-setup";

import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";
import { resetSettingsCategory } from "@/lib/settings-io";
import type { SettingsCategory } from "@/lib/settings-groups";
import { SettingsSection, Vis } from "./settings/fields";
import { OrientationSection } from "./settings/orientation";
import { HelpSettings } from "./settings/help";

const AgentSection = lazy(() => import("./settings/agent").then((m) => ({ default: m.AgentSection })));
const EditorSection = lazy(() => import("./settings/editor").then((m) => ({ default: m.EditorSection })));
const LayoutSection = lazy(() => import("./settings/editor").then((m) => ({ default: m.LayoutSection })));
const OutputSection = lazy(() => import("./settings/editor").then((m) => ({ default: m.OutputSection })));
const StorageSection = lazy(() => import("./settings/storage").then((m) => ({ default: m.StorageSection })));
const DataSection = lazy(() => import("./settings/storage").then((m) => ({ default: m.DataSection })));
const InputSection = lazy(() => import("./settings/input").then((m) => ({ default: m.InputSection })));
const KeysSection = lazy(() => import("./settings/input").then((m) => ({ default: m.KeysSection })));
const LearnSection = lazy(() => import("./settings/memory").then((m) => ({ default: m.LearnSection })));
const InternSection = lazy(() => import("./settings/diagnostics").then((m) => ({ default: m.InternSection })));
const SupportSection = lazy(() => import("./settings/support").then((m) => ({ default: m.SupportSection })));

type Cat = SettingsCategory | "help" | "overview";

const CATS: { id: Cat; key: string }[] = [
  { id: "overview", key: "orientation" },
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
  { id: "help", key: "help" },
];

export function SettingsPane() {
  const [cat, setCat] = useState<Cat>("agent");
  const [q, setQ] = useState("");
  const results = useRef<HTMLDivElement>(null);
  const setSettingsOpen = useIde((s) => s.setSettingsOpen);
  const t = useT();
  const query = q.trim().toLowerCase();
  const show = (id: Cat) => Boolean(query) || id === cat;
  const de = useIde((s) => s.locale) !== "en";
  const categoryName = (c: typeof CATS[number]) => c.id === "overview" ? (de ? "Orientierung" : "Getting started") : c.id === "help" ? (de ? "Hilfe" : "Help") : t(c.key);
  const selectCategory = (id: Cat) => { setCat(id); setQ(""); };
  useEffect(() => { if (results.current) results.current.scrollTop = 0; }, [cat, query]);

  return (
    <div className="settings-pane flex h-full min-h-0 flex-col bg-surface">
      <div className="flex min-h-12 shrink-0 items-center gap-3 border-b border-border px-3 py-1">
        <h2 id="anvil-settings-title" className="text-sm font-semibold">{t("settings")}</h2>
        <input
          value={q}
          placeholder={t("searchPh")}
          aria-label={de ? "Einstellungen durchsuchen" : "Search settings"}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none placeholder:text-subtle"
          onChange={(e) => setQ(e.target.value)}
        />
        <Button variant="quiet" className="h-8 px-2 text-xs" onClick={() => setSettingsOpen(false)}>
          {t("done")}
        </Button>
      </div>
      <label className="settings-category-picker items-center gap-3 border-b border-border px-3 py-1.5 text-sm text-muted">
        {de ? "Bereich" : "Category"}
        <select aria-label={de ? "Einstellungsbereich" : "Settings category"} value={query ? "" : cat}
          className="min-h-9 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-sm text-fg" onChange={e => selectCategory(e.target.value as Cat)}>
          {query && <option disabled value="">{de ? "Suchergebnisse" : "Search results"}</option>}
          {CATS.map(c => <option key={c.id} value={c.id}>{categoryName(c)}</option>)}
        </select>
      </label>
      <div className="flex min-h-0 flex-1">
        <nav aria-label={de ? "Einstellungsbereiche" : "Settings categories"} className="settings-categories flex w-44 shrink-0 flex-col gap-0.5 overflow-auto border-r border-border p-2">
          {CATS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-label={categoryName(c)}
              aria-current={cat === c.id && !query ? "page" : undefined}
              onClick={() => selectCategory(c.id)}
              className={cn(
                "shrink-0 rounded-md px-2 py-2 text-left text-sm",
                cat === c.id && !query ? "bg-hover text-fg" : "text-muted hover:text-fg",
              )}
            >
              {categoryName(c)}
            </button>
          ))}
        </nav>
        <div ref={results} className="settings-results min-h-0 min-w-0 flex-1 overflow-auto px-4 pb-8">
          <Suspense fallback={<p className="py-4 text-sm text-muted">{t("settings")} …</p>}>
            {!query && cat === "overview" ? <OrientationSection navigate={(next) => { setCat(next); setQ(""); }} /> : null}
            {query ? <SettingsSection q={query}><Vis q={query} label="Erklärhilfen Tooltips Tutorial Tour Hand Orientierung Explanations Delay Verzögerung"><HelpSettings /></Vis></SettingsSection> : null}
            {query ? <p className="settings-empty py-4 text-sm text-muted" role="status">{de ? "Keine passenden Einstellungen gefunden." : "No matching settings found."}</p> : null}
            {show("agent") ? <AgentSection q={query} /> : null}
            {show("companion") ? (
              <SettingsSection q={query} className="pb-6">
                <Vis q={query} label="Companion Ausführen Run Unity Unreal Godot Engine Compiler Pakete Packages Sprachserver Language Server Go Rust Java Python C++ Token koppeln Pairing Verbindung Connection Updates Aktualisierung Versionen Sprachupdates Language updates">
                <h3 className="pt-4 pb-1 text-xs font-medium tracking-wide text-muted uppercase">{t("catCompanion")}</h3>
                <CompanionSetup probeOnMount={!query} revealConnection={Boolean(query)} />
                </Vis>
              </SettingsSection>
            ) : null}
            {show("brain") ? <BrainSection q={query} /> : null}
            {show("models") ? <ModelLibSection q={query} /> : null}
            {show("learn") ? <LearnSection q={query} /> : null}
            {show("intern") ? <InternSection q={query} /> : null}
            {show("editor") ? <EditorSection q={query} /> : null}
            {show("layout") ? <LayoutSection q={query} /> : null}
            {show("output") ? <OutputSection q={query} /> : null}
            {show("storage") ? <StorageSection q={query} /> : null}
            {show("input") ? <InputSection q={query} /> : null}
            {show("keys") ? <KeysSection q={query} /> : null}
            {show("data") ? <DataSection q={query} /> : null}
            {show("help") ? <SupportSection q={query} /> : null}
          </Suspense>
          {!query && cat !== "help" && cat !== "overview" && <div className="mt-4 border-t border-border pt-3">
            <Button variant="quiet" className="min-h-9 px-2 text-sm" onClick={() => {
              resetSettingsCategory(cat);
              useIde.getState().setNotice(de ? "Die Einstellungen dieses Bereichs wurden zurückgesetzt. Profile und Projektinhalte bleiben erhalten." : "Category reset. Profiles and project contents are kept.");
            }}>{de ? "Bereich zurücksetzen" : "Reset category"}</Button>
            <p className="px-2 text-xs text-muted">{de ? "Profile, Zugangsdaten und Projektinhalte bleiben erhalten." : "Keeps profiles, credentials and project contents."}</p>
          </div>}
        </div>
      </div>
    </div>
  );
}
