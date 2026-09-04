import { abortAgent, agentAborted, agentBeatN, beginAgent, stopAgent } from "./abort";
import { note } from "./intern";
import { useIde } from "@/store/ide";

const STALL_NOTE_MS = 90_000;

function killMs(): number {
  const n = useIde.getState().llmHardStopMin ?? 0;
  if (!n) return 0;
  return Math.min(480, Math.max(5, n)) * 60_000;
}

let started = false;
let busySince = 0;
let lastSig = "";
let noted = false;
let timer = 0;

function sig(): string {
  const s = useIde.getState();
  const last = s.chat.at(-1);
  return `${s.agentBusy ? 1 : 0}:${s.chat.length}:${last?.content.length ?? 0}:${last?.thinking?.length ?? 0}:${last?.steps?.length ?? 0}:${agentBeatN()}`;
}

export function recoverSession(): void {
  abortAgent("Neustart");
  const st = useIde.getState();
  st.failRunningSteps();
  st.setAgentBusy(false);
  st.setRunning(false);
  st.setTestsRunning(false);
  void import("./run-window").then((m) => m.releaseAgentUi());
  busySince = 0;
  noted = false;
  beginAgent();
}

function tick(): void {
  const st = useIde.getState();
  if (!st.agentBusy) {
    busySince = 0;
    noted = false;
    lastSig = sig();
    return;
  }
  if (agentAborted()) {
    st.failRunningSteps();
    st.setAgentBusy(false);
    st.setRunning(false);
    busySince = 0;
    noted = false;
    void import("./run-window").then((m) => m.releaseAgentUi());
    return;
  }
  const now = Date.now();
  const cur = sig();
  if (!busySince || cur !== lastSig) {
    busySince = now;
    lastSig = cur;
    noted = false;
    return;
  }
  const wait = now - busySince;
  const kill = killMs();
  if (kill && wait >= kill) {
    const min = Math.round(kill / 60_000);
    note("agent", `Agent ${min} Min ohne Fortschritt`);
    void import("./app-log").then((m) => m.appLog("hang", `${min} min ohne Fortschritt`));
    stopAgent(`Kein Fortschritt seit ${min} Minuten — abgebrochen. Nochmal senden.`);
    st.setNotice(`Agent ${min} Min ohne Fortschritt — abgebrochen.`);
    busySince = 0;
    noted = false;
    return;
  }
  if (wait >= STALL_NOTE_MS && !noted) {
    noted = true;
    st.setNotice("Agent wartet auf das Modell. Stop beendet den Auftrag.");
  }
}

export function startHealth(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  recoverSession();
  timer = window.setInterval(tick, 4000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const st = useIde.getState();
    if (!st.agentBusy || !busySince) return;
    const cap = killMs();
    if (cap && Date.now() - busySince > cap) tick();
  });
  window.addEventListener("beforeunload", () => window.clearInterval(timer));
}

export function agentBusyMs(): number {
  if (!useIde.getState().agentBusy || !busySince) return 0;
  return Date.now() - busySince;
}
