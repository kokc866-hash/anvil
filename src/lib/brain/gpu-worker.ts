import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (ev: MessageEvent) => {
  handler.onmessage(ev);
};
