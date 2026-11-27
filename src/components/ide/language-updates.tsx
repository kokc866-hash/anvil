import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";
import { type LanguageUpdateItem, type LanguageUpdateState } from "@/lib/companion";
import { checkLanguageUpdates, configureLanguageUpdates, languageUpdateSnapshot, readLanguageUpdates, watchLanguageUpdates } from "@/lib/language-updates";

const statusKeys: Record<LanguageUpdateItem["status"], string> = {
  update: "langUpdateAvailable", "new-series": "langUpdateNewSeries", current: "langUpdateCurrent",
  "newer-installed": "langUpdateNewer", unknown: "langUpdateUnknown", bundled: "langUpdateBundled",
  "not-installed": "langUpdateMissing", error: "langUpdateFailed",
  "provider-reference": "langUpdateReference",
};

export function LanguageUpdates({ base, probeOnMount = true, homeKey = "" }: { base: string; probeOnMount?: boolean; homeKey?: string }) {
  const t = useT();
  const locale = useIde((s) => s.locale);
  const [state, setState] = useState<LanguageUpdateState | null>(() => languageUpdateSnapshot(base));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let alive = true;
    setError("");
    setState(languageUpdateSnapshot(base));
    const stop = watchLanguageUpdates(base, (value) => { if (alive) { setState(value); setError(""); } });
    if (probeOnMount) void readLanguageUpdates(base).catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; stop(); };
  }, [base, homeKey, probeOnMount]);

  const perform = async (action: () => Promise<LanguageUpdateState>) => {
    setBusy(true); setError("");
    try { setState(await action()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const working = busy || Boolean(state?.checking);
  const date = (value: number) => new Date(value).toLocaleString(locale === "de" ? "de-DE" : "en-GB", { dateStyle: "short", timeStyle: "short" });
  const sorted = [...(state?.items || [])].sort((a, b) => {
    const rank = (row: LanguageUpdateItem) => ["update", "new-series"].includes(row.status) ? 0 : row.status === "error" ? 1 : row.status === "not-installed" ? 3 : 2;
    return rank(a) - rank(b) || a.label.localeCompare(b.label);
  });

  return (
    <section aria-label={t("langUpdateTitle")} className="mt-4 rounded-md border border-border p-3">
      <p className="text-sm text-fg">{t("langUpdateTitle")}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{t("langUpdateHint")}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-fg">
          <input type="checkbox" role="switch" checked={state?.automatic ?? true} disabled={busy}
            onChange={(e) => {
              const automatic = e.target.checked, previous = state;
              if (state) setState({ ...state, automatic });
              void perform(() => configureLanguageUpdates(automatic, base).catch((reason) => { setState(previous); throw reason; }));
            }} />
          {t("langUpdateAutomatic")}
        </label>
        <Button variant="quiet" className="h-auto min-h-8 whitespace-normal px-2 text-xs" disabled={working}
          onClick={() => { setExpanded(true); void perform(() => checkLanguageUpdates(true, base)); }}>
          {working ? t("langUpdateChecking") : t("langUpdateCheck")}
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-subtle" role="status">
        {working ? t("langUpdateChecking") : state?.checkedAt ? t("langUpdateLast", { date: date(state.checkedAt) }) : t("langUpdateNever")}
        {state && !working && state.updateCount > 0 ? ` · ${t(state.updateCount === 1 ? "langUpdateOne" : "langUpdateCount", { n: state.updateCount })}` : ""}
        {state?.errorCount ? ` · ${t(state.errorCount === 1 ? "langUpdateErrorOne" : "langUpdateErrors", { n: state.errorCount })}` : ""}
      </p>
      {state?.incomplete && !working ? <p className="mt-2 text-xs text-muted">{t("langUpdateInterrupted")}</p> : null}
      {error || state?.error ? <p role="alert" className="mt-2 break-words text-xs text-danger">{error || state?.error}</p> : null}
      {sorted.length ? (
        <details open={expanded} onToggle={(e) => setExpanded(e.currentTarget.open)} className="mt-3">
          <summary className="cursor-pointer text-xs text-fg">{t("langUpdateDetails", { n: sorted.length })}</summary>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">{t("langUpdateSeriesHint")}</p>
          <ul className="mt-2 divide-y divide-border">
            {sorted.map((row) => (
              <li key={row.id} className="py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-xs text-fg">{row.label}</span>
                  <span className={`text-[11px] ${["update", "new-series"].includes(row.status) ? "text-accent" : row.status === "error" ? "text-danger" : "text-muted"}`}>
                    {t(statusKeys[row.status] || "langUpdateUnknown")}
                  </span>
                </div>
                <p className="mt-1 break-words text-[11px] text-muted">
                  {t("langUpdateInstalled")}: <span className="font-mono">{row.installed || "—"}</span>
                  {" · "}{t("langUpdateLatest")}: <span className="font-mono">{row.latest || "—"}</span>
                  {row.channel ? ` · ${t("langUpdateSeries")}: ${row.channel}` : ""}
                </p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-subtle">
                  <span>{row.location === "anvil" ? t("langUpdateInAnvil") : row.location === "system" ? t("langUpdateInSystem") : t("langUpdateMissing")}
                    {row.backup ? ` · ${t("langUpdateBackup")}` : ""}</span>
                  {row.source?.startsWith("https://") ? <a href={row.source} target="_blank" rel="noopener noreferrer" className="text-muted underline underline-offset-2">{t("langUpdateSource")}</a> : null}
                </div>
                {row.status === "error" ? <p className="mt-1 break-words text-[11px] text-danger">
                  {row.error}{row.checkedAt ? ` · ${t("langUpdatePrevious", { date: date(row.checkedAt) })}` : ""}
                </p> : null}
                {row.status === "unknown" ? <p className="mt-1 text-[11px] text-muted">{t("langUpdateUnknownHint")}</p> : null}
                {row.status === "provider-reference" ? <p className="mt-1 text-[11px] text-muted">{t("langUpdateReferenceHint")}</p> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
