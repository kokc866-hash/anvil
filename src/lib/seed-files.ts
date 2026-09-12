export const SEED_FILES: Record<string, string> = {
  ".anvil/rules.md": `# Anvil

- Auf Deutsch antworten, knapp.
- Nach Dateiänderungen Tests ausführen.
- Keine Secrets in Dateien schreiben.
- Wiederholbare Run/Engine-Schleife: .anvil/harness.json (Agent darf anlegen).
`,
  "ref/README.md": `# Referenzen

Hierhin Specs, API-Beispiele, Screenshots, Stil. Der Agent liest diesen Ordner zuerst.

Nichts ablegen, was der Agent nicht sehen soll.
`,
  "README.md": `# Workspace

Leer. Neue Datei über + oder den Agenten beauftragen.
`,
};

/** Earlier versions reinserted clean templates into cached disk workspaces.
 * Remove only those exact templates after a successful read proves them absent.
 * Never remove edited buffers or files actually present in the selected folder. */
export function withoutStaleSeedFiles(
  files: Record<string, string>, disk: Record<string, string>, dirty: Record<string, boolean>,
): Record<string, string> {
  const next = { ...files };
  for (const [path, template] of Object.entries(SEED_FILES)) {
    if (!(path in disk) && !dirty[path] && next[path] === template) delete next[path];
  }
  return next;
}

/** Alte Demo-Dateien — beim Laden entfernen. */
export const DEMO_PATHS = ["src/math.py", "tests/test_math.py", "src/__init__.py"];

export function isDemoHtml(content: string): boolean {
  return /Anvil\.run\s*\(/.test(content) && /<canvas/i.test(content);
}
