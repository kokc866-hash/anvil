import type { IdeState, LlmSlot } from "../store/ide-types.ts";
import { connectionDefaults, connectionMode, connectionSlot, modelForProvider, providerOf } from "./providers.ts";
import { fitCloudAbo } from "./llm-fit.ts";

export function connectionValues(s: Pick<IdeState, "llmAuthMode" | "llmContextAuto" | "llmBaseUrl" | "llmModel" | "llmContext" | "llmThinking" | "llmCompact" | "llmTemperature" | "llmMaxOut">): LlmSlot {
  return {
    authMode: s.llmAuthMode, contextAuto: s.llmContextAuto, baseUrl: s.llmBaseUrl, model: s.llmModel,
    context: s.llmContext, thinking: s.llmThinking, compact: s.llmCompact,
    temperature: s.llmTemperature, maxOut: s.llmMaxOut,
  };
}

/** One transition for the picker, settings import and restored profiles. Credentials stay outside it. */
export function connectionSettings(cur: IdeState, provider: string, mode?: string) {
  const d = providerOf(provider);
  const slots = { ...cur.llmSlots, [connectionSlot(cur.llmProvider, cur.llmAuthMode)]: connectionValues(cur) };
  const authMode = connectionMode(d.id, mode ?? (d.id === cur.llmProvider ? cur.llmAuthMode : "key"));
  const defaults = connectionDefaults(d.id, authMode);
  const legacy = slots[d.id];
  const saved = slots[connectionSlot(d.id, authMode)] ?? (connectionMode(d.id, legacy?.authMode) === authMode ? legacy : undefined);
  const model = modelForProvider(d.id, saved?.model || defaults.model);
  const fit = saved ? null : fitCloudAbo(d.id, model, authMode);
  return {
    llmSlots: slots, llmProvider: d.id, llmAuthMode: authMode,
    llmBaseUrl: d.id === "github" || d.id === "codex" ? "" : saved?.baseUrl ?? defaults.baseUrl,
    llmModel: d.id === "github" ? model.replace(/^openai\//, "") : model,
    llmCompact: saved?.compact ?? cur.llmCompact,
    ...(fit ?? {
      llmContext: saved?.context ?? cur.llmContext, llmThinking: saved?.thinking ?? cur.llmThinking,
      llmTemperature: saved?.temperature ?? cur.llmTemperature, llmMaxOut: saved?.maxOut ?? cur.llmMaxOut,
      llmContextAuto: saved?.contextAuto ?? (d.kind === "local" || d.id === "custom" ? cur.llmContextAuto : true),
    }),
  };
}
