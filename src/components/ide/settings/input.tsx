import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/cn";

import { ACTION_LABELS, INPUT_ACTIONS, prettyKey, prettyPad, type InputAction } from "@/lib/input-map";

import { useIde } from "@/store/ide";
import { useT } from "@/lib/i18n";

import { chordFromEvent, chordOwner, formatChord, KEY_DEFAULTS, KEY_GROUPS, KEY_LABEL, type KeyId } from "@/lib/keymap";

import { Head, Vis, Row, Toggle } from "./fields";

export function InputSection({ q }: { q: string }) {
  const inputMap = useIde((s) => s.inputMap);
  const setInputMap = useIde((s) => s.setInputMap);
  const resetInputMap = useIde((s) => s.resetInputMap);
  const [cap, setCap] = useState<{ action: InputAction; kind: "key" | "pad" } | null>(null);

  useEffect(() => {
    if (!cap) return;
    if (cap.kind === "key") {
      const action = cap.action;
      function onKey(e: KeyboardEvent) {
        e.preventDefault();
        e.stopPropagation();
        const m = structuredClone(inputMap);
        const cur = m[action].keys.filter((k) => k !== e.key);
        m[action].keys = [e.key, ...cur].slice(0, 4);
        setInputMap(m);
        setCap(null);
      }
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
    }
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const pads = navigator.getGamepads?.() ?? [];
      for (const g of pads) {
        if (!g) continue;
        for (let i = 0; i < g.buttons.length; i++) {
          if (g.buttons[i]?.pressed && performance.now() - start > 180) {
            const m = structuredClone(inputMap);
            const cur = m[cap.action].pad.filter((n) => n !== i);
            m[cap.action].pad = [i, ...cur].slice(0, 3);
            setInputMap(m);
            setCap(null);
            return;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cap, inputMap, setInputMap]);

  function dropKey(action: InputAction, key: string) {
    const m = structuredClone(inputMap);
    m[action].keys = m[action].keys.filter((k) => k !== key);
    setInputMap(m);
  }
  function dropPad(action: InputAction, id: number) {
    const m = structuredClone(inputMap);
    m[action].pad = m[action].pad.filter((n) => n !== id);
    setInputMap(m);
  }

  return (
    <section>
      <Head>Eingabe</Head>
      <p className="py-2 text-xs text-muted text-pretty">
        Belegt Tastatur und Controller für die Spiel-Engine. Danach Play, damit das Spiel die neue Belegung lädt.
        {cap ? (cap.kind === "key" ? " Jetzt eine Taste drücken …" : " Jetzt eine Pad-Taste drücken …") : ""}
      </p>
      {INPUT_ACTIONS.filter((a) => !q || `${ACTION_LABELS[a]} ${a}`.toLowerCase().includes(q)).map((action) => (
        <div key={action} className="border-b border-border py-2">
          <p className="text-sm text-fg">{ACTION_LABELS[action]}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {inputMap[action].keys.map((k) => (
              <button
                key={k}
                type="button"
                className="h-7 rounded-md border border-border px-2 font-mono text-[11px] text-muted hover:text-danger"
                onClick={() => dropKey(action, k)}
                title="Entfernen"
              >
                {prettyKey(k)}
              </button>
            ))}
            {inputMap[action].pad.map((id) => (
              <button
                key={`p${id}`}
                type="button"
                className="h-7 rounded-md border border-border px-2 text-[11px] text-muted hover:text-danger"
                onClick={() => dropPad(action, id)}
                title="Entfernen"
              >
                {prettyPad(id)}
              </button>
            ))}
            <Button
              className="h-7 px-2 text-[11px]"
              variant={cap?.action === action && cap.kind === "key" ? "primary" : "quiet"}
              onClick={() => setCap({ action, kind: "key" })}
            >
              Taste
            </Button>
            <Button
              className="h-7 px-2 text-[11px]"
              variant={cap?.action === action && cap.kind === "pad" ? "primary" : "quiet"}
              onClick={() => setCap({ action, kind: "pad" })}
            >
              Pad
            </Button>
          </div>
        </div>
      ))}
      <Vis q={q} label="Stick analog Deadzone">
        <Row label="Analog-Stick" hint="Stick als Richtung">
          <Toggle on={inputMap.stick} onChange={(v) => setInputMap({ ...inputMap, stick: v })} />
        </Row>
        <Slider
          label="Deadzone"
          hint="Stick ignoriert kleine Ausschläge"
          min={0.05}
          max={0.8}
          step={0.01}
          value={inputMap.deadzone}
          onChange={(n) => setInputMap({ ...inputMap, deadzone: n })}
          format={(n) => n.toFixed(2)}
        />
      </Vis>
      <div className="py-3">
        <Button
          className="h-8"
          onClick={() => {
            resetInputMap();
            setCap(null);
          }}
        >
          Standardbelegung
        </Button>
      </div>
    </section>
  );
}

export function KeysSection({ q }: { q: string }) {
  const t = useT();
  const keyMap = useIde((s) => s.keyMap);
  const setKeyBind = useIde((s) => s.setKeyBind);
  const resetKeyMap = useIde((s) => s.resetKeyMap);
  const setNotice = useIde((s) => s.setNotice);
  const [cap, setCap] = useState<KeyId | null>(null);

  useEffect(() => {
    if (!cap) return;
    (window as Window & { __anvilBindKey?: boolean }).__anvilBindKey = true;
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCap(null);
        return;
      }
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      const chord = chordFromEvent(e);
      const hit = chordOwner(keyMap, chord, cap!);
      if (hit) setNotice(`${t("keyConflict")}: ${t(KEY_LABEL[hit])}`);
      setKeyBind(cap!, chord);
      setCap(null);
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      (window as Window & { __anvilBindKey?: boolean }).__anvilBindKey = false;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [cap, setKeyBind, keyMap, setNotice, t]);

  const qn = q.trim().toLowerCase();

  return (
    <section>
      <Head>{t("keys")}</Head>
      <p className="py-1 text-[11px] text-subtle">{t("keyHint")}</p>
      {KEY_GROUPS.map((g) => {
        const ids = g.ids.filter((id) => {
          if (!qn) return true;
          const chord = keyMap[id] ?? KEY_DEFAULTS[id];
          return `${t(KEY_LABEL[id])} ${formatChord(chord)}`.toLowerCase().includes(qn);
        });
        if (!ids.length) return null;
        return (
          <div key={g.i18n} className="py-2">
            <p className="pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{t(g.i18n)}</p>
            <ul className="space-y-1 text-sm text-muted">
              {ids.map((id) => {
                const chord = keyMap[id] ?? KEY_DEFAULTS[id];
                const clash = chordOwner(keyMap, chord, id);
                return (
                  <li key={id} className="flex items-center justify-between gap-3">
                    <span className={clash ? "text-danger" : ""}>
                      {t(KEY_LABEL[id])}
                      {clash ? <span className="ml-1 text-[10px] text-subtle">({t(KEY_LABEL[clash])})</span> : null}
                    </span>
                    <button
                      type="button"
                      className={cn(
                        "h-7 min-w-28 rounded-md border px-2 font-mono text-xs",
                        cap === id ? "border-accent text-fg" : "border-border text-subtle hover:text-fg",
                      )}
                      onClick={() => setCap(id)}
                    >
                      {cap === id ? "…" : formatChord(chord)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <Button
        className="h-8"
        onClick={() => {
          resetKeyMap();
          setCap(null);
        }}
      >
        {t("keyReset")}
      </Button>
    </section>
  );
}
