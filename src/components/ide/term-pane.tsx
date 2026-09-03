import { useEffect, useRef, useState } from "react";
import { companionPing, termKill, termRead, termStart, termWrite } from "@/lib/companion";
import { holdCompanion, releaseCompanion } from "@/lib/companion-life";
import { evalSnippet } from "@/lib/run-client";
import { useIde } from "@/store/ide";

type TermLike = {
  write: (s: string) => void;
  dispose: () => void;
  loadAddon: (a: { fit: () => void }) => void;
  open: (el: HTMLElement) => void;
  onData: (cb: (d: string) => void) => void;
};

function named<T>(mod: Record<string, unknown>, key: string): T {
  const inner = mod.default && typeof mod.default === "object" ? (mod.default as Record<string, unknown>) : null;
  const hit = mod[key] ?? inner?.[key] ?? mod.default;
  if (typeof hit !== "function") throw new Error(`${key} fehlt in Modul`);
  return hit as T;
}

async function loadXterm() {
  const [raw, fitRaw] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
  await import("@xterm/xterm/css/xterm.css");
  const Terminal = named<new (opts: object) => TermLike>(raw as unknown as Record<string, unknown>, "Terminal");
  const FitAddon = named<new () => { fit: () => void }>(fitRaw as unknown as Record<string, unknown>, "FitAddon");
  return { Terminal, FitAddon };
}

export function TermPane() {
  const host = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"shell" | "local" | "boot">("boot");
  const [hint, setHint] = useState("Terminal startet…");

  useEffect(() => {
    let disposed = false;
    let term: TermLike | null = null;
    let fit: { fit: () => void } | null = null;
    let id = "";
    let poll = 0;
    let localLine = "";
    let held = false;
    const base = useIde.getState().companionUrl;

    async function boot() {
      const el = host.current;
      if (!el) return;
      const { Terminal, FitAddon } = await loadXterm();
      if (disposed || !el.isConnected) return;
      const t = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        theme: { background: "#0a0a0b", foreground: "#e8e8ea", cursor: "#e8e8ea" },
      });
      const f = new FitAddon();
      t.loadAddon(f);
      t.open(el);
      f.fit();
      term = t;
      fit = f;
      held = await holdCompanion();
      if (disposed) return;
      const ping = await companionPing(base);
      if (disposed) return;
      if (ping.ok) {
        const s = await termStart(undefined, base);
        if (s.ok && s.id) {
          id = s.id;
          setMode("shell");
          setHint(s.shell || "shell");
          t.write(`\r\n${s.shell || "shell"}\r\n`);
          t.onData((d) => {
            void termWrite(id, d, base);
          });
          const tick = async () => {
            const r = await termRead(id, base);
            if (r.data) t.write(r.data.replace(/\n/g, "\r\n"));
            if (!r.alive && id) {
              t.write("\r\n[Shell zu]\r\n");
              return;
            }
            poll = window.setTimeout(tick, 80);
          };
          void tick();
          return;
        }
      }
      setMode("local");
      setHint("JS — Companion startet mit Run, oder Anlassen in den Einstellungen");
      t.write("Anvil REPL. JavaScript, Enter sendet.\r\n> ");
      t.onData((d) => {
        if (d === "\r") {
          const line = localLine;
          localLine = "";
          t.write("\r\n");
          void evalSnippet(line, useIde.getState().files, useIde.getState().activePath ?? "repl.js").then((r) => {
            const out = (r.ok ? r.stdout : r.stderr) || "";
            t.write((out || (r.ok ? "" : "Fehler")).replace(/\n/g, "\r\n") + "\r\n> ");
          });
          return;
        }
        if (d === "\u007f") {
          if (!localLine) return;
          localLine = localLine.slice(0, -1);
          t.write("\b \b");
          return;
        }
        if (d.length === 1 && d >= " ") {
          localLine += d;
          t.write(d);
        }
      });
    }
    void boot();
    const onResize = () => fit?.fit();
    window.addEventListener("resize", onResize);
    const hostEl = host.current;
    const obs = hostEl && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => fit?.fit()) : null;
    if (hostEl && obs) obs.observe(hostEl);
    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      obs?.disconnect();
      window.clearTimeout(poll);
      if (id) void termKill(id, base);
      if (held) void releaseCompanion();
      term?.dispose();
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 px-2 py-1 text-[11px] text-muted">
        {mode === "shell" ? "System-Shell" : mode === "local" ? "JS-REPL" : "…"} · {hint}
      </p>
      <div ref={host} className="min-h-0 flex-1" />
    </div>
  );
}
