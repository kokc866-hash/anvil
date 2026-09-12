import { useState } from "react";
import { useIde } from "@/store/ide";
import { productInfo, publicationConfigured } from "@/lib/product-info";
import { supportDraft, supportSummary } from "@/lib/product-support";
import { ANVIL_VERSION } from "@/lib/version";
import { SettingsSection, Vis } from "./fields";
import { Button } from "@/components/ui/button";

export function SupportSection({ q }: { q: string }) {
  const en = useIde(s => s.locale) === "en";
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [steps, setSteps] = useState("");
  const [summary, setSummary] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const report = summary ? supportDraft(summary, expected, actual, steps, en) : "";
  const label = (de: string, english: string) => en ? english : de;
  return <SettingsSection q={q}>
    <Vis q={q} label="Hilfe Help Support Fehlerbericht Diagnose Diagnostics Version Lizenz License Datenschutz Privacy Daten Herausgeber Publisher Veröffentlichung Release">
      <h3 className="pt-4 pb-2 text-xs font-medium uppercase text-muted">{label("Hilfe und Produktinformationen", "Help and product information")}</h3>
      <p className="text-sm text-fg">Anvil {ANVIL_VERSION}</p>
      <p className="mt-1 text-xs text-muted">{publicationConfigured ? label("Veröffentlichungsangaben hinterlegt. Den Signaturstatus findest du am heruntergeladenen Windows-Paket.", "Publication details configured. Check the downloaded Windows package for its signature status.") : label("Dieser Stand wird ohne Windows-Signatur bereitgestellt. Herausgeberangaben, Supportkontakt und Lizenz sind noch nicht festgelegt.", "This version is provided without a Windows signature. Publisher details, support contact and license are not configured yet.")}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
        <dt className="text-muted">{label("Herausgeber", "Publisher")}</dt><dd>{productInfo.publisher || label("Noch nicht festgelegt", "Not configured yet")}</dd>
        <dt className="text-muted">Support</dt><dd>{productInfo.supportUrl ? <a href={productInfo.supportUrl} target="_blank" rel="noreferrer" className="underline">{label("Support öffnen", "Open support")}</a> : label("Kontakt wird später ergänzt. Bericht lokal vorbereiten und kopieren.", "Contact will be added later. Prepare and copy a report locally.")}</dd>
        <dt className="text-muted">{label("Lizenz", "License")}</dt><dd>{productInfo.licenseUrl ? <a href={productInfo.licenseUrl} target="_blank" rel="noreferrer" className="underline">{productInfo.licenseName}</a> : label("Noch nicht festgelegt.", "Not configured yet.")}</dd>
      </dl>
      <h4 className="mt-6 mb-2 text-sm font-medium">{label("Wo deine Daten verarbeitet werden", "Where your data is processed")}</h4>
      <ul className="space-y-2 pl-4 text-xs leading-relaxed text-muted list-disc">
        <li>{label("Dateien liegen im gewählten Projektordner. Anvils Profil liegt standardmäßig in data neben Anvil; gewählte Ausnahmen stehen unter Speicher.", "Files live in the selected project folder. Anvil's profile defaults to data beside Anvil; configured exceptions appear under Storage.")}</li>
        <li>{label("Modellanfragen enthalten den für die Aufgabe ausgewählten Kontext und gehen an die gewählte Verbindung: Rechner, LAN oder Anbieter. Externe CLIs können eigene Datenordner verwenden.", "Model requests contain the context selected for the task and go to the chosen connection: this computer, LAN or provider. External CLIs may use their own data folders.")}</li>
        <li>{label("Run führt Projektcode aus. Externe Werkzeuge, MCP-Verbindungen und eine gewählte Netz-Ausführung können weitere Systeme ansprechen.", "Run executes project code. External tools, MCP connections and a selected network execution can contact other systems.")}</li>
        <li>{label("Dieser Fehlerbericht wird nur auf deinen Wunsch vorbereitet. Er wird nicht automatisch hochgeladen. Vor dem Weitergeben siehst du den gesamten Inhalt.", "This report is prepared only when you request it. It is not uploaded automatically. You can inspect everything before sharing.")}</li>
      </ul>
      <h4 className="mt-6 mb-2 text-sm font-medium">{label("Ein Problem melden", "Report a problem")}</h4>
      <p className="mb-3 text-xs text-muted">{label("Beschreibe den Fehler ohne Schlüssel oder vertrauliche Inhalte. Die automatische Zusammenfassung enthält nur Version, Verbindungsart und Zähler – keine Dateien, Pfade, Modelladressen, Chats oder Protokolle.", "Describe the problem without keys or private content. The automatic summary contains version, connection type and counts only—no files, paths, model addresses, chats or logs.")}</p>
      {[[label("Erwartetes Verhalten", "Expected behavior"), expected, setExpected], [label("Tatsächliches Verhalten", "Actual behavior"), actual, setActual], [label("Schritte zum Nachstellen", "Steps to reproduce"), steps, setSteps]].map(([name, value, update]) => <label key={name as string} className="mb-3 block text-xs text-muted">{name as string}<textarea value={value as string} onChange={e => { (update as (v: string) => void)(e.target.value); setCopied(false); }} className="mt-1 block min-h-16 w-full rounded-md border border-border bg-bg p-2 text-fg" /></label>)}
      <Button variant="quiet" onClick={() => { setSummary(supportSummary(useIde.getState())); setCopied(false); setCopyError(false); }}>{label("Bericht vorbereiten", "Prepare report")}</Button>
      {report ? <div className="mt-3">
        <label className="text-xs text-muted">{label("Vollständige Vorschau", "Complete preview")}<textarea aria-label={label("Fehlerbericht Vorschau", "Problem report preview")} readOnly value={report} rows={16} className="mt-1 w-full rounded border border-border bg-bg p-2 font-mono text-xs text-fg" /></label>
        <Button variant="quiet" onClick={async () => { try { await navigator.clipboard.writeText(report); setCopied(true); setCopyError(false); } catch { setCopyError(true); } }}>{label("Bericht kopieren", "Copy report")}</Button>
        {copied ? <p role="status" className="mt-1 text-xs text-muted">{label("Kopiert. Es wurde nichts versendet.", "Copied. Nothing was sent.")}</p> : null}
        {copyError ? <p role="status" className="mt-1 text-xs text-muted">{label("Kopieren nicht möglich. Text in der Vorschau markieren und manuell kopieren.", "Clipboard unavailable. Select and copy the preview text manually.")}</p> : null}
      </div> : null}
    </Vis>
  </SettingsSection>;
}
