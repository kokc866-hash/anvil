import { useIde } from "@/store/ide";

export function ConnectionSummary({ compact = false }: { compact?: boolean }) {
  const en = useIde(s => s.locale === "en");
  if (compact) return <p className="px-3 py-1 text-[11px] text-muted" data-testid="connection-summary">{en ? "Local models, network servers or cloud providers. Available inputs and features depend on the model and connection." : "Lokale Modelle, Netzwerkserver oder Cloud-Anbieter. Verfügbare Eingaben und Funktionen hängen von Modell und Verbindung ab."}</p>;
  return <div className="mt-2 space-y-1 rounded-md border border-border p-3 text-[11px] text-muted" data-testid="connection-summary">
    <p className="font-medium text-fg">{en ? "Connections in Anvil" : "Verbindungen in Anvil"}</p>
    <p>{en ? "Anvil supports local models, network servers and cloud providers. Prompts, attachments and required project context are sent to the configured connection. A server may forward requests." : "Anvil unterstützt lokale Modelle, Netzwerkserver und Cloud-Anbieter. Prompts, Anhänge und benötigter Projektkontext werden an die eingestellte Verbindung gesendet. Ein Server kann Anfragen weiterleiten."}</p>
    <p>{en ? "Access depends on the provider: local operation, API key or supported CLI sign-in. API billing may be separate from a chat subscription. Provider terms and usage limits apply." : "Der Zugang erfolgt je nach Anbieter lokal, per API-Key oder über eine unterstützte CLI-Anmeldung. API-Nutzung kann getrennt vom Chat-Abo abgerechnet werden. Bedingungen und Nutzungslimits richten sich nach dem Anbieter."}</p>
    <p>{en ? "Image inputs, streaming responses and thinking controls depend on the model and connection. Anvil offers the settings supported by the selected combination." : "Bildeingaben, laufende Antworten und Thinking-Einstellungen hängen von Modell und Verbindung ab. Anvil bietet die von der gewählten Kombination unterstützten Einstellungen an."}</p>
    <p>{en ? "Provider, model and connection address are configured under Settings → Agent." : "Anbieter, Modell und Verbindungsadresse werden unter Einstellungen → Agent festgelegt."}</p>
  </div>;
}
