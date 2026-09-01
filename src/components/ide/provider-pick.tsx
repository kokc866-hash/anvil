import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { PROVIDER_GROUPS, providerOf, type LlmProvider, type ProviderId } from "@/lib/providers";
import { loadSecrets } from "@/lib/secrets";
import {
  hasSubNative,
  scanSubsFromNative,
  SUB_KIND_META,
  type SubKind,
  type SubScanRow,
} from "@/lib/sub-auth";
import { useT } from "@/lib/i18n";

type Tab = "local" | "cloud" | "abo" | "other";

function tabOf(id: ProviderId, via: "abo" | "key"): Tab {
  const spec = providerOf(id);
  if (spec.kind === "local") return "local";
  if (id === "codex" || (via === "abo" && spec.needsSub)) return "abo";
  if (spec.kind === "cloud") return "cloud";
  return "other";
}

function idsFor(tab: Tab): ProviderId[] {
  if (tab === "abo") return SUB_KIND_META.map((m) => m.provider as ProviderId);
  if (tab === "local") return PROVIDER_GROUPS.find((g) => g.id === "local")?.ids ?? [];
  if (tab === "cloud") {
    return (PROVIDER_GROUPS.find((g) => g.id === "cloud")?.ids ?? []).filter((id) => id !== "codex");
  }
  return ["grok", "custom"];
}

export function ProviderPick({
  value,
  via = "key",
  onChange,
  onLoadSub,
  onLoginSub,
  status,
  loading,
}: {
  value: LlmProvider;
  via?: "abo" | "key";
  onChange: (id: LlmProvider, via: "abo" | "key") => void;
  onLoadSub: (kind: SubKind) => void;
  onLoginSub?: (kind: SubKind) => void;
  status?: string;
  loading?: boolean;
}) {
  const t = useT();
  const spec = providerOf(value);
  const [tab, setTab] = useState<Tab>(() => tabOf(value, via));
  const [q, setQ] = useState("");
  const [scan, setScan] = useState<SubScanRow[]>([]);
  const desktop = hasSubNative();

  useEffect(() => {
    void scanSubsFromNative().then(setScan);
  }, []);

  useEffect(() => {
    setTab(tabOf(value, via));
  }, [value, via]);

  const found = useMemo(() => new Set(scan.filter((s) => s.found).map((s) => s.kind)), [scan]);
  const secrets = loadSecrets();
  const ids = idsFor(tab).filter((id) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    const p = providerOf(id);
    return p.label.toLowerCase().includes(s) || p.id.includes(s) || p.hint.toLowerCase().includes(s);
  });

  const tabs: { id: Tab; label: string }[] = [
    { id: "local", label: t("tabLocal") },
    { id: "cloud", label: t("tabCloud") },
    { id: "abo", label: t("tabAbo") },
    { id: "other", label: t("tabOther") },
  ];

  return (
    <div className="py-2">
      <p className="text-xs text-muted">{t("provider")}</p>
      <p className="mt-0.5 text-sm text-fg">{spec.label}</p>
      <div className="mt-2 overflow-hidden rounded-md border border-border bg-bg">
        <div className="grid grid-cols-4 border-b border-border">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              className={cn(
                "h-8 px-1 text-xs",
                tab === tb.id ? "bg-hover text-fg" : "text-muted hover:text-fg",
              )}
              onClick={() => {
                setTab(tb.id);
                setQ("");
              }}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <input
          value={q}
          placeholder={t("search")}
          className="h-8 w-full border-b border-border bg-transparent px-2 text-xs text-fg outline-none placeholder:text-subtle"
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="max-h-72 overflow-auto">
          {tab === "abo"
            ? SUB_KIND_META.filter((m) => {
                const s = q.trim().toLowerCase();
                if (!s) return true;
                return m.label.toLowerCase().includes(s) || m.kind.includes(s);
              }).map((m) => {
                const p = providerOf(m.provider);
                const on = value === m.provider && via === "abo";
                const da = found.has(m.kind);
                const keyed = Boolean(secrets.keys[m.kind]);
                return (
                  <li
                    key={m.kind}
                    className={cn(
                      "grid grid-cols-[minmax(0,1fr)_5.75rem] items-center gap-2 border-b border-border/60 px-2 py-2 last:border-b-0",
                      on && "bg-hover",
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => onChange(m.provider as LlmProvider, "abo")}
                    >
                      <p className="truncate text-sm text-fg">{m.label}</p>
                      <p className="truncate text-[11px] text-subtle">
                        {t("subSignInHint")}
                        {da || keyed ? ` · ${t("subOnDisk")}` : ""}
                      </p>
                    </button>
                    <div className="flex w-[5.75rem] shrink-0 flex-col gap-1">
                      <Button
                        className="h-7 w-full px-0 text-xs"
                        disabled={loading || !desktop || !onLoginSub}
                        onClick={() => onLoginSub?.(m.kind)}
                      >
                        {t("subSignIn")}
                      </Button>
                      {da ? (
                        <Button
                          className="h-7 w-full px-0 text-xs"
                          disabled={loading || !desktop}
                          onClick={() => onLoadSub(m.kind)}
                        >
                          CLI
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })
            : ids.map((id) => {
                const p = providerOf(id);
                const on = value === id && (tab !== "cloud" || via === "key");
                return (
                  <li key={id} className="border-b border-border/60 last:border-b-0">
                    <button
                      type="button"
                      className={cn(
                        "flex w-full flex-col px-2 py-2 text-left",
                        on ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg",
                      )}
                      onClick={() => onChange(id, "key")}
                    >
                      <span className="text-sm">{p.label}</span>
                      <span className="truncate text-[11px] text-subtle">{p.hint}</span>
                    </button>
                  </li>
                );
              })}
          {tab !== "abo" && ids.length === 0 ? (
            <li className="px-2 py-2 text-xs text-subtle">{t("noHits")}</li>
          ) : null}
        </ul>
      </div>
      {status ? <p className="mt-1.5 text-xs text-muted">{status}</p> : null}
      {!desktop ? <p className="mt-1 text-xs text-subtle">{t("subDesktop")}</p> : null}
    </div>
  );
}
