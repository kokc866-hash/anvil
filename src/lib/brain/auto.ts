import { useLearn } from "@/lib/learn";
import { useIde } from "@/store/ide";
import { brainCommitMessage, brainExplainError, brainNextAction } from "./apps";
import { brainUsage } from "./tasks";
import { brainReady, useBrain, type BrainAutonomy } from "./store";

const cool = new Map<string, number>();

function due(key: string, ms: number) {
  const n = Date.now();
  if ((cool.get(key) ?? 0) + ms > n) return false;
  cool.set(key, n);
  return true;
}

function voice(): boolean {
  return useBrain.getState().autonomy === "on";
}

function active(): boolean {
  const s = useBrain.getState();
  return s.on && s.autonomy !== "off";
}

let lastSaid = "";

function say(text: string) {
  const t = text.trim().slice(0, 180);
  if (!t || t === lastSaid) return;
  lastSaid = t;
  useBrain.getState().setLastAuto(t);
  if (voice()) useIde.getState().setNotice(t);
}

async function tick() {
  if (!active() || document.hidden) return;
  if (useIde.getState().agentBusy) return;
  const ide = useIde.getState();
  const next = brainNextAction();
  if (next) useBrain.getState().setLastAuto(next);

  const last = ide.output.at(-1);
  if (last && !last.ok && due(`err:${last.label}:${last.stderr.slice(0, 48)}`, 120_000)) {
    useLearn.getState().addFact("lesson", `Fehler: ${last.label}`, 0.45);
    if (voice() && useBrain.getState().jobs.errors) {
      if (brainReady()) {
        const t = await brainExplainError(last.stderr || last.stdout, last.label);
        if (t) {
          say(t);
          const { pushLane } = await import("./lane");
          pushLane("error", t);
        }
        const hit = await import("./apps").then((m) => m.brainBreakpoint(last.stderr || last.stdout));
        if (hit) {
          const path = hit.path in ide.files ? hit.path : ide.activePath;
          if (path) ide.toggleBreakpoint(path, hit.line, true);
        }
      } else say(`Fehler in ${last.label}`);
    }
  }

  const dirty = Object.keys(ide.dirty).filter(Boolean);
  if (dirty.length >= 2 && due("dirty", 180_000) && voice() && useBrain.getState().jobs.commit) {
    if (brainReady()) {
      const msg = await brainCommitMessage(dirty, dirty.slice(0, 4).join(", "));
      say(`${dirty.length} Dateien · ${msg}`);
    } else say(`${dirty.length} Dateien uncommitted`);
  }

  if (ide.debug.paused && due("dbg", 90_000) && voice()) {
    say("Debugger hält · F10 Step / F5 Continue");
  }

  if (ide.pendingDiffs.length && due("diff", 120_000) && voice()) {
    say(`${ide.pendingDiffs.length} Diffs prüfen`);
  }

  if (due("usage", 90_000)) void brainUsage();
  if (due("prompts", 25_000) && useBrain.getState().jobs.prompts !== false) {
    void import("./apps").then((m) => m.brainSuggestPrompts());
  }
}

export function startBrainAuto() {
  if (typeof window === "undefined") return;
  const w = window as Window & { __anvilBrainAuto?: boolean };
  if (w.__anvilBrainAuto) return;
  w.__anvilBrainAuto = true;
  let t = 0;
  const kick = () => {
    window.clearTimeout(t);
    t = window.setTimeout(() => void tick(), 1600);
  };
  useIde.subscribe((s, p) => {
    if (s.output !== p.output || s.dirty !== p.dirty || s.pendingDiffs !== p.pendingDiffs || s.debug !== p.debug) kick();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) kick();
  });
  kick();
}

export const AUTONOMY_HINT: Record<BrainAutonomy, string> = {
  off: "Nur auf Knopf. Kein Hintergrund.",
  quiet: "Lernt still. Keine Hinweise.",
  on: "Hinweise bei Fehler, Diffs, Commit. Schreibt nie Dateien. Denken bleibt beim Hauptmodell.",
};
