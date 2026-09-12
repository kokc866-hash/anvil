import { providerOf } from "./providers.ts";
import { cliKindFor } from "./cli-protocol.ts";
import { thinkingModes } from "../../electron/thinking-support.mjs";

export type ConnectionConfig = { provider: string; authMode: "abo" | "key"; baseUrl: string; model: string };

/** Describes the transport Anvil actually uses, not every feature offered by its vendor. */
export function connectionCapabilities(config: ConnectionConfig) {
  const spec = providerOf(config.provider);
  const cli = cliKindFor(config.provider, config.authMode);
  const url = config.baseUrl || spec.baseUrl;
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { /* unset or invalid endpoint */ }
  const loopback = host === "localhost" || host === "::1" || host === "[::1]" || /^127\./.test(host);
  const privateHost = /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^(?:fc|fd)[a-f\d]{2}:|^\[?(?:fc|fd)[a-f\d]{2}:/.test(host) || host.endsWith(".local");
  const location = cli || config.provider === "grok" ? "cloud" : config.provider === "brain" || loopback ? "device" : privateHost ? "network" : "server";
  return {
    cli, location, host,
    auth: cli ? "cli-login" : config.provider === "grok" ? "provided" : config.provider === "brain" ? "local" : spec.needsKey ? "api-key" : "optional-key",
    billing: cli ? "subscription" : location === "device" ? "local" : "provider",
    images: cli || config.provider === "brain" ? "unsupported" : "model-dependent",
    response: cli ? "final" : "stream",
    thinking: thinkingModes(config.provider, config.model, cli),
  } as const;
}

export function imageAttachmentError(config: ConnectionConfig, count: number, locale = "de"): string {
  if (!count || connectionCapabilities(config).images !== "unsupported") return "";
  return locale === "en"
    ? "This Anvil connection does not transmit images. Keep your draft and choose an API connection with an image-capable model, or remove the images."
    : "Diese Anvil-Verbindung überträgt keine Bilder. Entwurf behalten und eine API-Verbindung mit bildfähigem Modell wählen oder die Bilder entfernen.";
}

/** Keep stored images visible after changing providers; only adapt outgoing history. */
export function historyForConnection<T extends { content: string; images?: string[] }>(history: T[], config: ConnectionConfig): T[] {
  if (connectionCapabilities(config).images !== "unsupported") return history;
  return history.map(message => message.images?.length ? {
    ...message,
    images: undefined,
    content: `${message.content}\n\n[Earlier image remains available in Anvil but is not transmitted through this connection. Do not claim to see it.]`,
  } : message);
}

/** A model catalog is not a successful inference. Unknown CLI login stays unknown. */
export function connectionProbeSummary(kind: "catalog" | "cli", details: { count?: number; authenticated?: boolean | null; installed?: boolean }, locale = "de") {
  const en = locale === "en";
  if (kind === "catalog") return en
    ? `Model list reachable (${details.count ?? 0}). Model response and tools have not been tested.`
    : `Modellliste erreichbar (${details.count ?? 0}). Modellantwort und Werkzeuge sind noch nicht geprüft.`;
  if (details.installed === false) return en ? "CLI not installed." : "CLI nicht installiert.";
  if (details.authenticated === false) return en ? "CLI available. Sign-in is missing; model not tested." : "CLI vorhanden. Anmeldung fehlt; Modell nicht geprüft.";
  return en
    ? `CLI available. ${details.authenticated ? "Sign-in detected." : "Sign-in not confirmed."} Model response and tools have not been tested.`
    : `CLI vorhanden. ${details.authenticated ? "Anmeldung erkannt." : "Anmeldung nicht bestätigt."} Modellantwort und Werkzeuge sind noch nicht geprüft.`;
}
