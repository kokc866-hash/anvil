import { builtinSkill, skillRequirements, type SkillEnvironment, type RequirementStatus } from './skill-library.ts';

export type ProductWorkflowId = "understand" | "change" | "debug" | "review" | "scene" | "cad";
export const PRODUCT_WORKFLOWS = [
  { id: "understand", skill: "anvil-projekt-verstehen", mode: "ask", title: "Projekt verstehen", titleEn: "Understand project", hint: "Startweg und wichtige Dateien. Nur lesen.", hintEn: "Entry points and important files. Read only.",
    steps: "Lies Dateiliste und Projektanleitungen. Erkläre Zweck, Einstiegspunkte, vorhandenen Startweg und wichtige Dateien anhand gelesener Stellen. Keine Dateien ändern, Programme ausführen oder Pakete installieren. Unbekannte Voraussetzungen als unbekannt benennen. Ergebnis: Projektübersicht, belegter Startweg, offene Fragen.",
    stepsEn: "Read the file list and project instructions. Explain purpose, entry points, existing start instructions and important files from evidence. Do not edit files, execute programs or install packages. Label unknown prerequisites as unknown. Return overview, evidenced start instructions and open questions." },
  { id: "change", skill: "anvil-code-aendern", mode: "agent", title: "Änderung umsetzen", titleEn: "Make a change", hint: "Gezielt ändern und passend prüfen.", hintEn: "Make a focused change and verify it.",
    steps: "Ermittle die konkret gewünschte Änderung; fehlt sie, frage gezielt nach. Lies die vorhandene Stelle und Projektanleitungen. Erhalte Gestaltung und andere Funktionen. Ändere nur nötige Dateien. Prüfe passend: Textänderung durch Vergleich, Verhalten durch geeigneten Test oder Run. Keine unnötigen Downloads, Gerüste oder Bibliotheken. Ergebnis: Änderung, tatsächlich ausgeführte Prüfung und verbleibende Grenzen. Keine Prüfung ohne Ergebnis behaupten.",
    stepsEn: "Identify the concrete requested change; ask if missing. Read existing code and project instructions. Preserve styling and unrelated behavior. Change only necessary files. Verify proportionately: compare wording edits, test behavior with an appropriate test or Run. Avoid unnecessary downloads, scaffolding or libraries. Report change, actual verification and limits. Never claim a check without evidence." },
  { id: "debug", skill: "anvil-fehler-beheben", mode: "agent", title: "Fehler beheben", titleEn: "Fix a problem", hint: "Ursache finden, korrigieren, nachprüfen.", hintEn: "Find the cause, fix and verify.",
    steps: "Ermittle erwartetes und tatsächliches Verhalten aus Auftrag, Fehlern und betroffenen Dateien; fehlt der Fehlerfall, frage danach. Reproduziere ihn wenn möglich vor der Änderung. Prüfe eine konkrete Ursache statt mehrere Änderungen zu raten. Korrigiere gezielt und wiederhole den ursprünglichen Fehlerfall. Fehlt Laufzeit oder Zugang, nenne den konkreten nächsten Schritt. Nach zweimal demselben erfolglosen Versuch nicht unverändert wiederholen: Ursache neu eingrenzen oder mit konkretem Hindernis stoppen. Ergebnis: Ursache, Korrektur, tatsächliche Prüfung, offene Punkte.",
    stepsEn: "Identify expected and actual behavior from the request, errors and affected files; ask if the failing case is missing. Reproduce it before editing where possible. Test a specific cause rather than guessing changes. Fix narrowly and repeat the original case. If a runtime or access is missing, name the next step. Never repeat the same failed attempt unchanged more than twice: investigate a different cause or stop with a concrete blocker. Report cause, fix, actual verification and open issues." },
  { id: "review", skill: "anvil-aenderungen-pruefen", mode: "ask", title: "Änderung prüfen", titleEn: "Review a change", hint: "Änderungen lesen, Risiken und offene Tests zeigen.", hintEn: "Read changes, identify risks and missing tests.",
    steps: "Lies Änderungen und betroffene Dateien. Nutze vorhandene Vergleiche und Testergebnisse als Belege, nicht allein Modellbehauptungen. Keine Dateien ändern oder Programme ausführen. Fehlt der Vergleichsstand, benenne das statt Änderungen zu erfinden. Nenne konkrete Auffälligkeiten mit Dateibezug, belegte Prüfungen und noch nötige Tests. Ein Run ohne Bedienprüfung bestätigt nicht die komplette Funktion. Ergebnis: Befunde, Nachweise, offene Prüfungen; keine automatische Freigabe.",
    stepsEn: "Read changes and affected files. Use available diffs and test results as evidence, not model claims alone. Do not edit files or execute programs. If the baseline is missing, say so rather than inventing changes. Report specific findings with file references, evidenced checks and tests still needed. A Run without interaction testing does not verify all behavior. Return findings, evidence and open checks; do not automatically approve." },
  { id: "scene", skill: "", mode: "agent", title: "Szene bearbeiten", titleEn: "Edit a scene", hint: "Engine oder Blender prüfen, gezielt ändern und testen.", hintEn: "Check the engine or Blender, make a focused change and test it.",
    steps: "Bestimme Projekt, Engine oder Blender-Szene und die gewünschte Änderung. Prüfe Laufzeit, geöffnete Szene und tatsächlich verfügbare Werkzeuge. Sichere den Vorzustand einschließlich Assets. Ändere nur die betroffenen Objekte und Dateien. Prüfe Laden, Verhalten und Speicherung mit der Zielsoftware. Bereite eine kontrollierte Rücknahme vor; externe Szenen werden durch Anvils Projektrücknahme nicht automatisch wiederhergestellt. Ergebnis: Änderungen, gespeicherte Dateien, tatsächlich ausgeführte Prüfungen und offene Punkte.",
    stepsEn: "Identify the project, engine or Blender scene and the requested change. Check runtime, open scene and actual tools. Save the baseline including assets. Change only relevant objects and files. Verify loading, behavior and saving in the target application. Prepare controlled restoration; Anvil project rollback does not automatically restore external scenes. Report changes, saved files, actual checks and open issues." },
  { id: "cad", skill: "", mode: "agent", title: "Bauteil erstellen", titleEn: "Create a part", hint: "Maße festlegen, Geometrie und Export prüfen.", hintEn: "Define dimensions, verify geometry and export.",
    steps: "Bestimme OpenSCAD oder FreeCAD, Maße, Einheiten und Speicherziel. Prüfe die tatsächliche CAD-Verbindung und verfügbare Werkzeuge. Sichere einen bestehenden Dokumentstand vor Änderungen. Konstruiere mit nachvollziehbaren Parametern. Prüfe Neuberechnung, gültige Geometrie und Maße; eine Vorschau allein reicht nicht. Exportiere das gewünschte Format und öffne es zur Prüfung in geeigneter Software. Fehlende Voraussetzungen konkret benennen; keine ungefragten Installationen. Ergebnis: Konstruktion, Speicherort, Geometrie-/Exportnachweise und offene Punkte.",
    stepsEn: "Identify OpenSCAD or FreeCAD, dimensions, units and destination. Check the actual CAD connection and tools. Save the existing document baseline before editing. Construct with clear parameters. Verify recomputation, valid geometry and dimensions; a preview alone is insufficient. Export the requested format and open it in suitable software to verify it. Name missing prerequisites; do not install software without authorization. Report the part, saved location, geometry/export evidence and open issues." },
] as const;

export function readOnlyWorkflow(text: string): boolean {
  return PRODUCT_WORKFLOWS.some(flow => flow.mode === "ask" && (text.startsWith(`Arbeitsablauf: ${flow.title}\n\n`) || text.startsWith(`Workflow: ${flow.titleEn}\n\n`)));
}

export function workflowSkills(id: ProductWorkflowId, env: SkillEnvironment, files: Record<string, string> = {}): string[] {
  const flow = PRODUCT_WORKFLOWS.find(item => item.id === id)!;
  if (flow.skill) return [flow.skill];
  const service = (name: string) => env.services.some(item => item.enabled && item.name.toLowerCase().includes(name));
  if (id === 'scene') return env.engines.length ? env.engines.slice(0, 2).map(engine => `anvil-${engine}`) : service('blender') ? ['anvil-blender'] : [];
  if (id === 'cad') return Object.keys(files).some(path => /\.scad$/i.test(path)) || service('openscad') ? ['anvil-openscad'] : service('freecad') ? ['anvil-freecad'] : [];
  return [];
}

export function workflowRequirements(ids: string[], env: SkillEnvironment): RequirementStatus[] {
  const seen = new Set<string>();
  return ids.flatMap(id => skillRequirements(id, env)).filter(item => {
    const key = `${item.kind}:${item.match || ''}:${item.label}`;
    if (seen.has(key) || item.status === 'ready') return false;
    seen.add(key); return true;
  });
}

export function workflowDraft(id: ProductWorkflowId, task: string, locale = "de", skills: string[] = []): { mode: "ask" | "agent"; text: string } {
  const flow = PRODUCT_WORKFLOWS.find(item => item.id === id)!;
  const en = locale === "en";
  const prepared = PRODUCT_WORKFLOWS.some(item => task.startsWith(`Arbeitsablauf: ${item.title}\n\n`) || task.startsWith(`Workflow: ${item.titleEn}\n\n`));
  if (prepared) {
    const marker = /\n\n(?:Mein Auftrag|My task): /g;
    const match = marker.exec(task);
    if (match) task = task.slice(match.index + match[0].length).replace(/\n\n(?:Skill für diese Aufgabe|Skill for this task): \$[^\n]+$/, '');
  }
  const chosen = skills.filter(id => builtinSkill(id)).slice(0, 2);
  const skillNote = chosen.length ? `\n\n${en ? 'Skill for this task' : 'Skill für diese Aufgabe'}: ${chosen.map(id => `$${id}`).join(', ')}` : '';
  return { mode: flow.mode, text: `${en ? "Workflow" : "Arbeitsablauf"}: ${en ? flow.titleEn : flow.title}\n\n${en ? flow.stepsEn : flow.steps}\n\n${en ? "My task" : "Mein Auftrag"}: ${task.trim()}${skillNote}` };
}
