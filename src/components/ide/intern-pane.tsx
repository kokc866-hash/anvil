import { HEAL_LABEL, useIntern, type InternFault } from "@/lib/intern";
import { Button } from "@/components/ui/button";
import { confirmApp } from "@/lib/confirm";
import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { appLogLines, clearAppLog, copyAppLog, exportAppLog, subscribeAppLog } from "@/lib/app-log";
import { useIde } from "@/store/ide";

export function InternPane() {
  const pane = useIntern((s) => s.pane);
  const faults = useIntern((s) => s.faults);
  const setPane = useIntern((s) => s.setPane);
  const heal = useIntern((s) => s.heal);
  const healOpen = useIntern((s) => s.healOpen);
  const ignore = useIntern((s) => s.ignore);
  const clear = useIntern((s) => s.clear);
  const restart = useIntern((s) => s.restart);
  const t = useT();
  const [logN, setLogN] = useState(() => appLogLines().length);
  useEffect(() => subscribeAppLog(() => setLogN(appLogLines().length)), []);
  if (!pane) return null;
  const open = faults.filter((f) => f.open);
  const rest = faults.filter((f) => !f.open).slice(0, 8);

  return (
    <div className="ui-pop absolute right-3 bottom-10 z-30 w-[min(100%-1.5rem,22rem)] rounded-md border border-border bg-surface shadow-lg">
      <div className="flex h-10 items-center gap-2 border-b border-border px-3">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">{t("intern")}</p>
        <span className="text-[11px] text-subtle">{t("openN", { n: open.length, total: faults.length })}</span>
        <div className="flex-1" />
        <Button className="h-7 px-2 text-[11px]" variant="quiet" onClick={() => void healOpen()} disabled={!open.length}>
          {t("heal")}
        </Button>
        <Button className="h-7 px-2 text-[11px]" variant="quiet" onClick={() => setPane(false)}>
          {t("done")}
        </Button>
      </div>
      <div className="max-h-72 overflow-auto p-2">
        {!faults.length ? <p className="px-1 py-2 text-xs text-muted">{t("noIntern")}</p> : null}
        {open.map((f) => (
          <FaultRow key={f.id} f={f} onHeal={() => void heal(f.id)} onIgnore={() => ignore(f.id)} />
        ))}
        {rest.length ? <p className="mt-2 px-1 text-[10px] tracking-wide text-subtle uppercase">{t("doneLabel")}</p> : null}
        {rest.map((f) => (
          <FaultRow key={f.id} f={f} done />
        ))}
      </div>
      <div className="flex flex-wrap gap-1 border-t border-border p-2">
        <Button className="h-7 px-2 text-[11px]" variant="quiet" onClick={() => void restart("soft")}>
          {t("softReload")}
        </Button>
        <Button className="h-7 px-2 text-[11px]" variant="quiet" onClick={() => void restart("hard")}>
          {t("hardReload")}
        </Button>
        <Button
          className="h-7 px-2 text-[11px]"
          variant="quiet"
          onClick={() => {
            void confirmApp(t("factoryConfirm"), { danger: true, ok: t("factory") }).then((ok) => {
              if (ok) void restart("factory");
            });
          }}
        >
          {t("factory")}
        </Button>
        <Button className="h-7 px-2 text-[11px]" variant="quiet" onClick={() => clear()}>
          {t("clearBook")}
        </Button>
      </div>
      <AppLogBox n={logN} />
    </div>
  );
}

function FaultRow({
  f,
  done,
  onHeal,
  onIgnore,
}: {
  f: InternFault;
  done?: boolean;
  onHeal?: () => void;
  onIgnore?: () => void;
}) {
  const t = useT();
  const when = new Date(f.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="mb-1 rounded-md border border-border px-2 py-1.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-fg">
            {f.n > 1 ? `${f.n}× ` : ""}
            {f.msg}
          </p>
          <p className="text-[10px] text-subtle">
            {f.kind} · {when}
            {f.heal && f.heal !== "none" ? ` · ${HEAL_LABEL[f.heal]}` : ""}
          </p>
        </div>
        {!done ? (
          <div className="flex shrink-0 gap-1">
            {f.heal && f.heal !== "none" ? (
              <button type="button" className="text-[11px] text-fg hover:underline" onClick={onHeal}>
                {HEAL_LABEL[f.heal] || t("heal")}
              </button>
            ) : (
              <button type="button" className="text-[11px] text-fg hover:underline" onClick={onHeal}>
                An Agent
              </button>
            )}
            <button type="button" className="text-[11px] text-muted hover:text-fg" onClick={onIgnore}>
              {t("remove")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AppLogBox({ n }: { n: number }) {
  const t = useT();
  const lines = appLogLines().slice(-8);
  return (
    <div className="border-t border-border p-2">
      <div className="mb-1 flex items-center gap-2">
        <p className="text-[10px] tracking-wide text-subtle uppercase">{t("appLog")}</p>
        <span className="text-[10px] text-subtle">{n}</span>
        <div className="flex-1" />
        <Button
          className="h-7 px-2 text-[11px]"
          variant="quiet"
          disabled={!n}
          onClick={() => {
            void copyAppLog().then((ok) => {
              if (ok) useIde.getState().setNotice(t("appLogCopied"));
            });
          }}
        >
          {t("appLogCopy")}
        </Button>
        <Button className="h-7 px-2 text-[11px]" variant="quiet" disabled={!n} onClick={() => exportAppLog()}>
          {t("appLogExport")}
        </Button>
        <Button
          className="h-7 px-2 text-[11px]"
          variant="quiet"
          disabled={!n}
          onClick={() => {
            void confirmApp(t("appLogClear") + "?", { ok: t("appLogClear") }).then((ok) => {
              if (ok) clearAppLog();
            });
          }}
        >
          {t("appLogClear")}
        </Button>
      </div>
      {!lines.length ? <p className="px-1 py-1 text-[11px] text-muted">{t("appLogEmpty")}</p> : null}
      <div className="max-h-28 overflow-auto font-mono text-[10px] leading-4 text-muted">
        {lines.map((l) => (
          <p key={`${l.at}-${l.tag}-${l.msg.slice(0, 24)}`} className="truncate">
            {new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} {l.tag} {l.msg}
          </p>
        ))}
      </div>
    </div>
  );
}
