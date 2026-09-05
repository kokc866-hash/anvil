import type { LlmChoice, ToolCall } from "./agent-core";
import { asToolCall } from "./agent-core";
import { agentBeat, isLocalLlm, streamIdleMs } from "./abort";
import { useIde } from "@/store/ide";
import { isToolTemplateEcho } from "./agent-parse";
import { applyLiveDraft, applyLiveText } from "./live-write";
import { applyResponsesEvent, choiceFromAcc, emptyResponsesAcc } from "./responses-parse";

const AFTER_FINISH_MS = 8_000;
const AFTER_STOP_MS = 2_000;
const THINK_OFF_IDLE_MS = 12_000;

function thinkOff(): boolean {
  try {
    return useIde.getState().llmThinking === "off";
  } catch {
    return false;
  }
}

function stallWait(gotEvent: boolean): number {
  try {
    const st = useIde.getState();
    return streamIdleMs(gotEvent, st.llmHardStopMin ?? 0, isLocalLlm(st.llmProvider));
  } catch {
    return streamIdleMs(gotEvent, 0, false);
  }
}
