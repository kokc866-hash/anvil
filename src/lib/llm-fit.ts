import type { ThinkingMode } from "./llm-options.ts";
import { anvilContext, lookupKnown } from "./model-context.ts";
import { providerOf } from "./providers.ts";

export type CloudAboFit = {
  llmContextAuto: true;
  llmContext: number;
  llmThinking: ThinkingMode;
  llmTemperature: number;
  llmMaxOut: number;
};

/** Nur Cloud-API und Abo. Lokal, Custom, Anvil-Grok bleiben unangetastet. */
export function isCloudOrAbo(provider: string): boolean {
  if (provider === "custom" || provider === "grok" || provider === "brain") return false;
  const d = providerOf(provider);
  return d.kind === "cloud" || Boolean(d.needsSub);
}

/** Passende sichere Werte für diesen Anbieter/dieses Modell — Kontext Auto, Denken Auto, kein starres maxOut. */
export function fitCloudAbo(provider: string, model: string): CloudAboFit | null {
  if (!isCloudOrAbo(provider)) return null;
  const hit = lookupKnown(model);
  const abo = Boolean(providerOf(provider).needsSub) || provider === "codex";
  return {
    llmContextAuto: true,
    llmContext: hit ? anvilContext(hit.n) : 128_000,
    llmThinking: "auto",
    llmTemperature: abo ? 1 : 0.3,
    llmMaxOut: 0,
  };
}
