import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";

import { cn } from "@/lib/cn";

import { BrainSection } from "./brain-settings";
import { ModelLibSection } from "./model-lib-settings";

import { CompanionSetup } from "./companion-setup";

import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";

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

type Cat =
  | "agent"
  | "companion"
  | "brain"
  | "models"
  | "learn"
  | "intern"
  | "editor"
  | "layout"
  | "output"
  | "storage"
  | "input"
  | "keys"
  | "data";

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
          <Suspense fallback={<p className="py-4 text-sm text-muted">{t("settings")} …</p>}>
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
            {(query || cat === "companion") &&
            show("companion") &&
            (!query || /companion|compiler|go|rustc|javac|token|7845|koppeln|pair/i.test(query)) ? (
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
          </Suspense>
        </div>
      </div>
    </div>
  );
}
