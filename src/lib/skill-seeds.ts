import { SKILL_CREATOR_BODY } from "./skill-debug.ts";

type Seed = {
  id: string;
  name: string;
  when: string;
  body: string;
  kind: "guide";
  uses: number;
  at: number;
  score: number;
  wins: number;
  fails: number;
  scope: "user";
};

function seed(id: string, name: string, when: string, body: string, score = 0.7): Seed {
  return {
    id,
    name,
    when,
    body,
    kind: "guide",
    uses: 0,
    at: 0,
    score,
    wins: 0,
    fails: 0,
    scope: "user",
  };
}

export const SEED: Seed[] = [
  seed(
    "skill-creator",
    "skill-creator",
    "Skill schreiben Skill fixen Skill debuggen skill-creator neuer Ablauf",
    SKILL_CREATOR_BODY,
    0.88,
  ),
  seed(
    "engine",
    "engine-projekt",
    "Godot Unity Unreal Bevy Engine Companion MCP",
    "1. engine_detect im Workspace.\n2. Scripts mit edit_file/read_file ändern.\n3. engine_run play oder mcp_call. Keine eigene Engine in Anvil — HTML-Vorschau nur Demo.",
    0.72,
  ),
  seed(
    "tests",
    "tests-schreiben",
    "Tests pytest npm test absichern unittest",
    "1. tests/ anlegen (write_file).\n2. Python: def test_* . JS: test()/it() (kein Vitest-Import nötig).\n3. shell pytest oder npm test — Anvil führt die Testdateien aus (Flags wie -q / -k ok). Output lesen, bei Fehler edit_file.",
    0.7,
  ),
  seed(
    "html-spiel",
    "html-spiel",
    "Canvas Spiel HTML UI Vorschau Steuerung Tastatur",
    "1. Bestehende HTML/JS mit read_file lesen, nicht neu erfinden.\n2. edit_file oder write_file. Kein leeres Gerüst.\n3. run_file auf die HTML.\n4. see_run — was sichtbar ist, kurz sagen.\n5. Bei Steuerung play. Runde nicht ohne Frame beenden.",
    0.82,
  ),
  seed(
    "nach-write-pruefen",
    "nach-write-pruefen",
    "schreiben speichern fertig Datei ändern Patch",
    "1. Nach write_file/edit_file sofort run_file oder open_preview.\n2. Bei Fehler edit_file, nicht die Datei komplett neu.\n3. format_file auf die angefasste Datei.\n4. Ohne Run keine Runde schließen.",
    0.84,
  ),
  seed(
    "git-gruen",
    "git-gruen",
    "Commit git speichern Repository gruen",
    "1. run_file oder Tests. Bei Rot: kein Commit.\n2. git_status.\n3. Nur wenn grün: git_commit mit kurzer Message.\n4. Kein git_push ohne Status.",
    0.78,
  ),
  seed(
    "ui-ueberarbeiten",
    "ui-ueberarbeiten",
    "Layout Farben CSS UI überarbeiten Design",
    "1. Offene HTML/CSS mit read_file.\n2. Nur edit_file, keine zweite Kopie.\n3. run_file + see_run. Farben/Abstände am Frame prüfen.\n4. Fertig erst nach sichtbarer Änderung.",
    0.76,
  ),
  seed(
    "debugger",
    "debugger",
    "hängt Exception Breakpoint Python debug Crash",
    "1. Fehlerzeile mit read_file.\n2. debug_start, nicht raten.\n3. Bei Halt: Stack lesen, edit_file.\n4. Nochmal run_file. debug_stop am Ende.",
    0.74,
  ),
  seed(
    "lsp-sauber",
    "lsp-sauber",
    "Typfehler YAML gopls HTML CSS Lint Probleme",
    "1. Offene Probleme lesen, nicht ignorieren.\n2. Datei read_file um die Stelle.\n3. edit_file gezielt. Companion-LSP nur holen wenn Server fehlt.\n4. Erneut prüfen, nicht die Datei neu schreiben.",
    0.7,
  ),
  seed(
    "mcp-flaeche",
    "mcp-flaeche",
    "MCP Godot Unity Fläche Tool Companion Server",
    "1. mcp_list. Nur gelistete Tools.\n2. Kontextzeile setzen (eine Zeile).\n3. mcp_call mit echten Argumenten.\n4. Antwort lesen. Kein HTTP auf den Companion raten.",
    0.73,
  ),
  seed(
    "harness-setzen",
    "harness-setzen",
    "Harness Loop Board Graph wiederholen nach Write",
    "1. harness_read oder Board lesen.\n2. Einmal harness_write / passende Kante, nicht jedes Mal denselben Run erfinden.\n3. Nach Write: run_file wenn der Harness das verlangt.\n4. Schleife nicht von Hand nachbauen.",
    0.68,
  ),
  seed(
    "suche-zuerst",
    "suche-zuerst",
    "wo ist suchen finden Bug Symbol grep",
    "1. grep oder list_files vor dem ersten write_file.\n2. Treffer read_file.\n3. Dann edit_file an der Stelle. Nichts Neues anlegen, wenn es schon existiert.",
    0.8,
  ),
  seed(
    "refactor-klein",
    "refactor-klein",
    "Aufräumen umbenennen refactor dupliziert",
    "1. grep nach dem Namen.\n2. edit_file an allen Treffern. Keine neuen Dateien.\n3. run_file. Bei Rot zurück mit edit_file.",
    0.72,
  ),
  seed(
    "ref-halten",
    "ref-halten",
    "Spec Referenz Design ref/ Vorgabe Screenshot",
    "1. list_files auf ref/ (prefix ref).\n2. read_file der passenden Ref, nicht den Happen aus dem Index raten.\n3. Dagegen edit_file. Nicht gegen die Spec bauen. Kein Code nach ref/ schreiben.\n4. Am Ende kurz: welche Ref galt.",
    0.75,
  ),
  seed(
    "run-budget",
    "run-budget",
    "Schleife Patch hängt erneut versuchen Run",
    "1. run_file. Fehler lesen.\n2. Ein edit_file, nochmal run_file.\n3. Höchstens drei Runs. Dann stoppen und den Fehler nennen.\n4. Denselben Patch nicht dreimal.",
    0.77,
  ),
  seed(
    "todo-schliessen",
    "todo-schliessen",
    "fertig Runde To-do Plan abhaken Abschluss",
    "1. Vor der Schlusszeile Plan/To-do prüfen.\n2. Erledigtes nicht offen lassen. Offenes benennen.\n3. set_plan nur aktualisieren, nicht neu erfinden.\n4. Kein „fertig“ bei offenen Schritten.",
    0.79,
  ),
  seed(
    "preview-html",
    "preview-html",
    "Markdown Seite statisch HTML Vorschau öffnen",
    "1. Datei write_file oder edit_file.\n2. open_preview.\n3. Kurz was zu sehen ist. Nicht behaupten ohne Preview.",
    0.7,
  ),
  seed(
    "ein-frame",
    "ein-frame",
    "Graph aus HTML Frame see_run einmal sehen",
    "1. HTML run_file.\n2. Genau einmal see_run, auch wenn die Graph-Schleife aus ist.\n3. Sichtbares in einem Satz. Kein play-Loop wenn nicht verlangt.",
    0.74,
  ),
  seed(
    "format-commit",
    "format-commit",
    "Format prettier formatieren vor Commit",
    "1. format_file auf angefasste Dateien.\n2. git_status.\n3. Nur dann git_commit wenn der Diff bewusst ist.",
    0.66,
  ),
  seed(
    "probleme-lesen",
    "probleme-lesen",
    "rot Leiste Diagnose Fehler Lint Problem",
    "1. Offene Hits nennen (Datei:Zeile).\n2. read_file um die Stelle.\n3. edit_file gezielt. Nicht die Datei neu bauen.\n4. Nach dem Patch erneut prüfen.",
    0.71,
  ),
  seed(
    "python-script",
    "python-script",
    "Python py CLI Script pytest",
    "1. read_file des Skripts.\n2. run_file. stderr lesen.\n3. Import-Fehler: Companion-Python, nicht so tun als ginge es in der Vorschau.\n4. edit_file, nochmal run_file.",
    0.69,
  ),
  seed(
    "plan-klein",
    "plan-klein",
    "Auftrag unklar Plan Schritte set_plan",
    "1. set_plan mit 3–5 kurzen Schritten.\n2. Dann Tools, kein Essay.\n3. Nach jedem Schritt den Haken setzen.\n4. Schluss erst wenn der Plan leer oder ehrlich offen ist.",
    0.73,
  ),
  seed(
    "starter-lassen",
    "starter-lassen",
    "neues Projekt Starter Gerüst Scaffold",
    "1. list_files. Starter-Struktur nicht löschen.\n2. Lücken mit edit_file/write_file füllen.\n3. run_file auf den Einstieg.\n4. Keine zweite App daneben.",
    0.65,
  ),
  seed(
    "go-modul",
    "go-modul",
    "Go go.mod gopls Test Paket",
    "1. list_files, go.mod read_file.\n2. Fehlt das SDK: Companion, nicht raten.\n3. edit_file, dann shell go test oder run_file.\n4. Fehlerzeile patchen.",
    0.64,
  ),
  seed(
    "node-tool",
    "node-tool",
    "npm tsc node package.json Frontend Tool",
    "1. package.json read_file.\n2. Companion-Toolchain, nicht so tun als liefe Node in der HTML-Vorschau.\n3. edit_file, dann den echten Test/Build-Befehl.\n4. Output lesen.",
    0.64,
  ),
  seed(
    "mcp-einmal-listen",
    "mcp-einmal-listen",
    "unbekannter MCP Server Tools list ping",
    "1. Einmal mcp_list.\n2. Nur existierende Tools mcp_call.\n3. Bei Failed-to-fetch: Companion koppeln, nicht die URL erfinden.",
    0.67,
  ),
];
