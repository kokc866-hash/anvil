export * from "./agent-abort.ts";
import { abortAgent, agentGen } from "./agent-abort.ts";

let externalStop: (() => boolean) | undefined;
export function registerAgentStopHandler(handler: () => boolean) {
  externalStop = handler;
  return () => { if (externalStop === handler) externalStop = undefined; };
}

export function stopAgent(reason = "Gestoppt"): void {
  if (externalStop?.()) return;
  abortAgent(reason);
  const stopped = agentGen();
  void import("./app-log").then((m) => m.appLog("stop", reason));
  void import("@/store/ide").then(({ useIde }) => {
    if (stopped !== agentGen()) return;
    const st = useIde.getState();
    if (st.agentBusy) st.failRunningSteps();
    st.setAgentBusy(false);
    st.setTestsRunning(false);
    st.setNotice(reason);
    if (st.agentJob) st.setAgentJob(null);
    void import("./companion-life").then((m) => {
      if (stopped === agentGen()) return m.idleCompanion();
    }).catch(() => undefined);
  });
  void import("./run-window").then((m) => {
    if (stopped === agentGen()) m.releaseAgentUi();
  });
}
