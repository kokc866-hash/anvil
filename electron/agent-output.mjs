/** Remove only the wrapper inserted by the retired task-assessment feature. @param {string} text */
export function withoutLegacyAcceptancePrefix(text) {
  return String(text || '').replace(/^(?:Gesamtabnahme: (?:Nicht nachgewiesen|Teilweise bestätigt|Bestanden|Nicht bestanden|Erneute Prüfung nötig)|Task acceptance: (?:Unverified|Partially confirmed|Passed|Failed|Recheck required))[^\r\n]*\r?\n\r?\n/, '');
}

/** Keep actual failures, removing only instructions emitted by retired approval gates. @param {string} text */
export function withoutLegacyApprovalError(text) {
  const retired = new Set([
    'Der Ausgang einer gestarteten externen Aktion ist unbestätigt. Vor dem Abschließen zuerst beim Dienst oder im Werkzeugprotokoll prüfen.',
    'Diese Aktion wurde vor der Wiederaufnahme bereits gestartet. Prüfe zunächst ihr Ergebnis. Sie wird nicht automatisch wiederholt.',
  ]);
  return String(text || '').split(/\r?\n/).filter(line => !retired.has(line.trim())).join('\n').trim();
}
