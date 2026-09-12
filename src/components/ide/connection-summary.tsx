import { useIde } from "@/store/ide";
import { connectionCapabilities } from "@/lib/connection-capabilities";

export function ConnectionSummary({ compact = false }: { compact?: boolean }) {
  const provider = useIde(s => s.llmProvider);
  const authMode = useIde(s => s.llmAuthMode);
  const baseUrl = useIde(s => s.llmBaseUrl);
  const model = useIde(s => s.llmModel);
  const en = useIde(s => s.locale === "en");
  const cap = connectionCapabilities({ provider, authMode, baseUrl, model });
  const location = cap.location === "device" ? (en ? "This computer" : "Dieser Rechner") : cap.location === "network" ? (en ? "Server in your network" : "Server in deinem Netzwerk") : cap.location === "cloud" ? (en ? "Provider cloud" : "Cloud des Anbieters") : (en ? "Configured server" : "Eingestellter Server");
  const images = cap.images === "unsupported" ? (en ? "No image transfer" : "Keine Bildübertragung") : (en ? "Images depend on the selected model" : "Bilder abhängig vom gewählten Modell");
  const response = cap.response === "final" ? (en ? "Answer after each CLI call finishes" : "Antwort nach Abschluss jedes CLI-Aufrufs") : (en ? "Live response where the model/server supports streaming" : "Laufende Antwort, soweit Modell/Server Streaming unterstützen");
  if (compact) return <p className="px-3 py-1 text-[11px] text-muted" data-testid="connection-summary">{location} · {images} · {response}</p>;
  return <div className="mt-2 space-y-1 rounded-md border border-border p-3 text-[11px] text-muted" data-testid="connection-summary">
    <p className="font-medium text-fg">{en ? "This connection in Anvil" : "Diese Verbindung in Anvil"}</p>
    <p>{en ? "Request destination" : "Anfrageziel"}: {location}{cap.host && cap.location !== "cloud" ? ` (${cap.host})` : ""}. {en ? "Sent prompts, attachments and required project context go there." : "Gesendete Prompts, Anhänge und benötigter Projektkontext gehen dorthin."}</p>
    {!cap.cli && provider !== "brain" && provider !== "grok" ? <p>{en ? "A server may forward requests. Its configuration determines where the model actually runs." : "Ein Server kann Anfragen weiterleiten. Wo das Modell tatsächlich rechnet, bestimmt dessen Konfiguration."}</p> : null}
    <p>{en ? "Access" : "Zugang"}: {cap.auth === "cli-login" ? (en ? "existing CLI sign-in; provider subscription and usage limits apply" : "vorhandene CLI-Anmeldung; Abo und Nutzungslimits des Anbieters gelten") : cap.auth === "api-key" ? (en ? "API key; billed by the provider separately from a chat subscription" : "API-Key; Abrechnung beim Anbieter getrennt vom Chat-Abo") : cap.auth === "provided" ? (en ? "only when supplied by the app host; its quota and terms apply" : "nur bei Bereitstellung durch den App-Betreiber; dessen Kontingent und Bedingungen gelten") : cap.auth === "local" ? (en ? "local helper; no cloud subscription, model download may be required" : "lokaler Helfer; kein Cloud-Abo, gegebenenfalls Modelldownload nötig") : (en ? "configured server, optional API key; costs depend on its operator" : "eingestellter Server, optionaler API-Key; Kosten hängen vom Betreiber ab")}.</p>
    <p>{images}. {response}.</p>
    <p>Thinking: {cap.thinking.length > 1 ? cap.thinking.join(" · ") : (en ? "Model default; no effort control in this connection" : "Modellstandard; keine Stufensteuerung in dieser Verbindung")}.</p>
  </div>;
}
