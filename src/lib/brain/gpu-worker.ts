import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";
import { installRuntimeEnvironment, type RuntimeEnvironment } from "./runtime-environment";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (ev: MessageEvent) => {
  if (ev.data?.type === "anvil-helper-runtime") {
    installRuntimeEnvironment(ev.data.environment as RuntimeEnvironment);
    return;
  }
  handler.onmessage(ev);
};
