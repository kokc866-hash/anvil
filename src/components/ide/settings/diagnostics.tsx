import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

import { useIntern } from "@/lib/intern";
import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";
import { confirmApp } from "@/lib/confirm";

import { appLogOn, appLogLines, clearAppLog, copyAppLog, exportAppLog, setAppLogOn, subscribeAppLog } from "@/lib/app-log";

import { Head, Vis, Row, Toggle } from "./fields";

export function InternSection({ q }: { q: string }) {
  const prefs = useIntern((s) => s.prefs);
  const faults = useIntern((s) => s.faults);
  const setPrefs = useIntern((s) => s.setPrefs);
  const setPane = useIntern((s) => s.setPane);
  const restart = useIntern((s) => s.restart);
  const clear = useIntern((s) => s.clear);
  const open = faults.filter((f) => f.open).length;
  const t = useT();
  return (
    <section>
      <Head>{t("intern")}</Head>
      <p className="mb-2 text-xs text-muted">{t("internIntro")}</p>
      <Vis q={q} label="Intern an Auto-heilen Weich">
        <Row label={t("internOn")} hint={t("internOnHint")}>
          <Toggle on={prefs.on} onChange={(v) => setPrefs({ on: v })} />
        </Row>
        <Row label={t("autoHeal")} hint={t("autoHealHint")}>
          <Toggle on={prefs.autoHeal} onChange={(v) => setPrefs({ autoHeal: v })} />
        </Row>
        <Row label={t("softOnFull")} hint={t("softOnFullHint")}>
          <Toggle on={prefs.autoSoft} onChange={(v) => setPrefs({ autoSoft: v })} />
        </Row>
      </Vis>
      <Vis q={q} label="Fehlerbuch Neustart Fabrik factory">
        <p className="py-2 text-xs text-muted">
          {t("openN", { n: open, total: faults.length })}
          {faults[0] ? ` · ${faults[0].kind}` : ""}
        </p>
        <div className="flex flex-wrap gap-1 py-1">
          <Button className="h-8" variant="quiet" onClick={() => setPane(true)}>
            {t("errorBook")}
          </Button>
          <Button className="h-8" variant="quiet" onClick={() => void restart("soft")}>
            {t("softReload")}
          </Button>
          <Button className="h-8" variant="quiet" onClick={() => void restart("hard")}>
            {t("hardReload")}
          </Button>
          <Button
            className="h-8"
            variant="quiet"
            onClick={() => {
              void confirmApp(t("factoryConfirm"), { danger: true, ok: t("factory") }).then((ok) => {
                if (ok) void restart("factory");
              });
            }}
          >
            {t("factory")}
          </Button>
          <Button className="h-8" variant="quiet" onClick={() => clear()}>
            {t("clearBook")}
          </Button>
        </div>
      </Vis>
      <AppLogSettings q={q} />
    </section>
  );
}

function AppLogSettings({ q }: { q: string }) {
  const t = useT();
  const [on, setOn] = useState(appLogOn);
  const [n, setN] = useState(() => appLogLines().length);
  useEffect(() => {
    const un = subscribeAppLog(() => setN(appLogLines().length));
    setOn(appLogOn());
    return un;
  }, []);
  return (
    <Vis q={q} label="App-Log debug kopieren export">
      <Row label={t("appLog")} hint={t("appLogHint")}>
        <Toggle
          on={on}
          onChange={(v) => {
            setAppLogOn(v);
            setOn(v);
          }}
        />
      </Row>
      <p className="py-1 text-xs text-muted">{n ? `${n} Zeilen` : t("appLogEmpty")}</p>
      <div className="flex flex-wrap gap-1 py-1">
        <Button
          className="h-8"
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
        <Button className="h-8" variant="quiet" disabled={!n} onClick={() => exportAppLog()}>
          {t("appLogExport")}
        </Button>
        <Button
          className="h-8"
          variant="quiet"
          disabled={!n}
          onClick={() => {
            void confirmApp(t("appLogClear") + "?", { ok: t("appLogClear") }).then((ok) => {
              if (ok) {
                clearAppLog();
                setN(0);
              }
            });
          }}
        >
          {t("appLogClear")}
        </Button>
      </div>
    </Vis>
  );
}
