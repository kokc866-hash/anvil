import { useEffect, useRef, useState, type ReactNode } from "react";
import { SettingsSection, Row as SettingsRow, Toggle } from "./settings/fields";
import { Button } from "@/components/ui/button";
import { BRAIN_MODELS, HELPER_GROUPS, deleteBrainModel, updateBrainModel, modelCached, prefetchBrain } from "@/lib/brain";
import { useBrain } from "@/lib/brain/store";
import { nativeHelper } from "@/lib/helper-local";
import { fmtBytes, storageQuota, useModelLib, type CacheBackendPref } from "@/lib/model-lib";
import { confirmApp } from "@/lib/confirm";



function Row(props: { label: string; hint?: string; children: ReactNode }) {
  return <SettingsRow {...props} compact />;
}

export function ModelLibSection({ q = "" }: { q?: string }) {
  const cacheBackend = useModelLib((s) => s.cacheBackend);
  const keepHelperCache = useModelLib((s) => s.keepHelperCache);
  const prefetchOnStart = useModelLib((s) => s.prefetchOnStart);
  const pinHelper = useModelLib((s) => s.pinHelper);
  const lastQuota = useModelLib((s) => s.lastQuota);
  const desk = Boolean(nativeHelper());
  const loadedId = useBrain((s) => s.loadedId);
  const cacheEpoch = useBrain((s) => s.cacheEpoch);
  const helperOn = useBrain((s) => s.status === "ready" && Boolean(s.loadedId));
  const [local, setLocal] = useState<Record<string, { ready: boolean; bytes: number; mark: string }>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [pct, setPct] = useState(0);
  const [dir, setDir] = useState("");
  const refreshGeneration = useRef(0);

  async function refresh() {
    const generation = ++refreshGeneration.current;
    await storageQuota();
    const n = nativeHelper();
    const loaded = useBrain.getState().loadedId;
    const disk: Record<string, { ready: boolean; bytes: number }> = {};
    if (n) {
      const path = await n.helperDir();
      if (generation !== refreshGeneration.current) return;
      setDir(path);
      const rows = await n.helperList();
      for (const r of rows) disk[r.id] = { ready: r.ready, bytes: r.bytes };
    }
    const cacheHits = await Promise.all(
      BRAIN_MODELS.map(async (m) => {
        const ok = (await modelCached(m.id).catch(() => false)) || (m.alt && m.alt !== m.id ? await modelCached(m.alt).catch(() => false) : false);
        return [m.id, Boolean(ok)] as const;
      }),
    );
    const cached = Object.fromEntries(cacheHits);
    const next: Record<string, { ready: boolean; bytes: number; mark: string }> = {};
    for (const m of BRAIN_MODELS) {
      const d = disk[m.id] || disk[m.alt] || { ready: false, bytes: 0 };
      const run = Boolean(loaded && (loaded === m.id || loaded === m.alt));
      const inCache = Boolean(cached[m.id]);
      const ready = run || d.ready || inCache;
      const mark = run ? "läuft" : d.ready ? "auf der Festplatte" : inCache ? "im Cache" : (disk[m.id] || disk[m.alt]) ? "teilweise" : "fehlt";
      next[m.id] = { ready, bytes: d.bytes, mark };
    }
    if (generation === refreshGeneration.current) setLocal(next);
  }

  useEffect(() => {
    if (!q) void refresh().catch((err) => setNote(err instanceof Error ? err.message : "Modelle konnten nicht gelesen werden"));
    return () => { refreshGeneration.current++; };
  }, [loadedId, cacheEpoch, q]);

  const usedPct = lastQuota.quota ? Math.min(100, Math.round((lastQuota.used / lastQuota.quota) * 100)) : 0;
  const rank: Record<string, number> = { läuft: 0, "auf der Festplatte": 1, "im Cache": 2, teilweise: 3, fehlt: 4 };

  function modelRow(m: (typeof BRAIN_MODELS)[number]) {
    const st = local[m.id] || local[m.alt];
    const ready = Boolean(st?.ready);
    const pin = pinHelper.includes(m.id);
    const run = helperOn && (loadedId === m.id || loadedId === m.alt);
    const mark = st?.mark || (ready ? "auf der Festplatte" : "fehlt");
    return (
      <li key={m.id} className={`flex items-center gap-2 px-2 py-1.5 ${run ? "bg-hover" : ""}`}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-fg">
            {m.label}
            <span className="text-subtle"> · {m.size}</span>
            <span className={run ? "text-ok" : "text-subtle"}> · {mark}</span>
            {pin ? <span className="text-subtle"> · pin</span> : null}
          </p>
          <p className="truncate text-[10px] text-subtle">{st?.bytes ? fmtBytes(st.bytes) : m.hint}</p>
        </div>
        <button
          type="button"
          className={`text-[10px] ${pin ? "text-fg" : "text-muted"}`}
          onClick={() => useModelLib.getState().togglePinHelper(m.id)}
        >
          {pin ? "Pin an" : "Pin"}
        </button>
        <Button
          className="h-7 px-2 text-[11px]"
          disabled={Boolean(busy)}
          onClick={() => {
            setBusy(m.id);
            const report = (p: { progress: number; text: string }) => { setPct(p.progress); setNote(p.text); };
            const job = ready ? updateBrainModel(m.id, report) : prefetchBrain(m.id, report);
            setNote(ready ? "Aktualisiere Modelldateien…" : "Einmal laden, danach lokal.");
            void job
              .then(() => refresh())
              .catch((err) => setNote(err instanceof Error ? err.message : "Download fehlgeschlagen"))
              .finally(() => setBusy(""));
          }}
        >
          {ready ? "Aktualisieren" : "Laden"}
        </Button>
        <Button
          variant="quiet"
          className="h-7 px-2 text-[11px]"
          disabled={(!ready && mark !== "teilweise") || Boolean(busy)}
          onClick={() => {
            const go = () => {
              setBusy(m.id);
              void deleteBrainModel(m.id).then(refresh)
                .catch((err) => setNote(err instanceof Error ? err.message : "Entfernen fehlgeschlagen"))
                .finally(() => setBusy(""));
            };
            if (useModelLib.getState().keepHelperCache) {
              void confirmApp(`${m.label} wirklich entfernen?`, { danger: true, ok: "Weg" }).then((ok) => {
                if (ok) go();
              });
              return;
            }
            go();
          }}
        >
          Weg
        </Button>
      </li>
    );
  }

  return (
    <SettingsSection q={q} className="py-3">
      <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Helfer lokal</h3>
      <p className="mb-3 text-xs text-muted">
        Agent-Modelle bleiben beim gewählten Anbieter. Hier nur der Helfer: einmal aus dem Netz auf die Festplatte, danach startet er ohne HuggingFace.
        {desk ? " Dateien liegen im Anvil-Ordner." : " Im Browser: OPFS-Cache (start.bat ist besser)."}
      </p>
      {dir ? <p className="mb-2 font-mono text-[10px] text-subtle break-all">{dir}</p> : null}

      <Row label="Beim Start vorladen" hint="Angepinnte Modelle still auf die Festplatte laden, wenn sie fehlen.">
        <Toggle on={prefetchOnStart} onChange={useModelLib.getState().setPrefetchOnStart} />
      </Row>
      <Row label="Lokal behalten" hint="Alte Helfer-Gewichte bleiben beim Modellwechsel. Weg und Cache löschen fragen nach.">
        <Toggle on={keepHelperCache} onChange={useModelLib.getState().setKeepHelperCache} />
      </Row>
      {!desk ? (
        <Row label="Cache" hint="Nur Browser. Anvil-Fenster schreibt echte Dateien.">
          <select
            value={cacheBackend}
            className="h-8 rounded-md border border-border bg-bg px-2 text-sm text-fg"
            onChange={(e) => useModelLib.getState().setCacheBackend(e.target.value as CacheBackendPref)}
          >
            <option value="auto">Auto (OPFS)</option>
            <option value="opfs">OPFS</option>
            <option value="indexeddb">IndexedDB</option>
          </select>
        </Row>
      ) : null}

      {!desk ? (
        <div className="my-2">
          <div className="mb-1 flex justify-between text-[11px] text-subtle">
            <span>Browser-Speicher</span>
            <span>
              {fmtBytes(lastQuota.used)} / {fmtBytes(lastQuota.quota)} ({usedPct}%)
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-hover">
            <div className="h-full bg-accent" style={{ width: `${usedPct}%` }} />
          </div>
        </div>
      ) : null}

      {HELPER_GROUPS.map((g) => {
        const rows = BRAIN_MODELS.filter((m) => m.group === g.id)
          .slice()
          .sort((a, b) => {
            const sa = local[a.id]?.mark || "fehlt";
            const sb = local[b.id]?.mark || "fehlt";
            const d = (rank[sa] ?? 9) - (rank[sb] ?? 9);
            if (d) return d;
            return a.vramMb - b.vramMb;
          });
        if (!rows.length) return null;
        return (
          <div key={g.id} className="mt-3">
            <p className="mb-1 px-0.5 text-[10px] font-medium tracking-wide text-muted uppercase">{g.label}</p>
            <ul className="divide-y divide-border rounded-md border border-border">{rows.map((m) => modelRow(m))}</ul>
          </div>
        );
      })}
      {busy ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-hover">
          <div className="h-full bg-accent" style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
      ) : null}
      {note ? <p className="mt-2 text-[11px] text-muted">{note}</p> : null}
      {!desk ? (
        <p className="mt-2 text-[11px] text-subtle">
          Ohne Anvil-Fenster kein Ordner auf der Festplatte — nur Browser-Cache. start.bat nutzen.
        </p>
      ) : null}
    </SettingsSection>
  );
}
