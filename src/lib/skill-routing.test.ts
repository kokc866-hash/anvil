import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { librarySeeds, selectTaskSkills, mergeSkillLibrary, type SkillEnvironment, type SkillRecord } from './skill-library.ts';

const skills = librarySeeds();
const env: SkillEnvironment = { project: true, saved: true, execution: true, engines: ['godot'], services: [] };
const ids = (query: string, environment = env, options = { automatic: true, pinned: [] as string[], limit: 2 }, available: SkillRecord[] = skills) => selectTaskSkills(query, available, environment, options).map(skill => skill.id);

test('excluded products do not become skill suggestions, while a positive project question remains', () => {
  assert.deepEqual(ids('Nutze weder FreeCAD noch Git. Erkläre nur den Projektaufbau.'), ['anvil-projekt-verstehen']);
  assert.equal(ids('Bitte kein FreeCAD verwenden. Prüfe die Godot-Szene.').includes('anvil-freecad'), false);
  assert.equal(ids('Do not use Blender or FreeCAD. Explain the project overview.').some(id => /blender|freecad/.test(id)), false);
  assert.equal(ids('Nutze FreeCAD, aber nicht Git.').includes('anvil-git'), false);
  assert.equal(ids('Nutze FreeCAD, aber nicht Git.').includes('anvil-freecad'), true);
  assert.equal(ids('FreeCAD nicht benutzen. Erkläre das Projekt.').includes('anvil-freecad'), false);
  assert.deepEqual(ids('Use FreeCAD, not Blender.').filter(id => /freecad|blender/.test(id)), ['anvil-freecad']);
  assert.deepEqual(ids('Use FreeCAD and not Blender.').filter(id => /freecad|blender/.test(id)), ['anvil-freecad']);
  assert.equal(ids('No FreeCAD. Use Godot.').includes('anvil-freecad'), false);
});

test('a negative symptom and not-only wording are not use prohibitions', () => {
  assert.equal(ids('FreeCAD funktioniert nicht. Finde den Fehler.').includes('anvil-freecad'), true);
  assert.equal(ids('Nicht nur FreeCAD, sondern auch Blender für den Asset-Export verwenden.').includes('anvil-freecad'), true);
});

test('quoted examples, fenced code and blockquoted text cannot invoke skills', () => {
  assert.deepEqual(ids('Erkläre nur diesen Beispieltext:\n```text\n$anvil-freecad $anvil-godot\n```', env, { automatic: false, pinned: [], limit: 2 }), []);
  assert.deepEqual(ids('Beispiel: "$anvil-freecad". Erkläre das Projekt.', env, { automatic: false, pinned: [], limit: 2 }), []);
  assert.deepEqual(ids('Zitierter Auftrag:\n> $anvil-freecad\nErkläre das Projekt.', env, { automatic: false, pinned: [], limit: 2 }), []);
  assert.deepEqual(ids('Sag mir, was "$anvil-freecad" bedeutet.', env, { automatic: false, pinned: [], limit: 2 }), []);
  assert.deepEqual(ids('Bitte nutze `$anvil-godot` für die Szene.', env, { automatic: false, pinned: [], limit: 2 }), ['anvil-godot']);
  assert.deepEqual(ids('Bitte nutze "$anvil-godot" für die Szene.', env, { automatic: false, pinned: [], limit: 2 }), ['anvil-godot']);
  assert.deepEqual(ids('Beispiel: "$anvil-freecad". Bitte nutze `$anvil-godot` für die Szene.', env, { automatic: false, pinned: [], limit: 2 }), ['anvil-godot']);
});

test('explicit names have Unicode-safe boundaries and stay in requested order beyond the automatic budget', () => {
  assert.deepEqual(ids('$anvil-godotä', env, { automatic: false, pinned: [], limit: 2 }), []);
  assert.deepEqual(ids('text$anvil-godot', env, { automatic: false, pinned: [], limit: 2 }), []);
  assert.deepEqual(ids('$anvil-tests $anvil-godot $anvil-freecad', env, { automatic: false, pinned: [], limit: 2 }), ['anvil-tests', 'anvil-godot', 'anvil-freecad']);
  assert.deepEqual(ids('$anvil-godot', env, { automatic: false, pinned: [], limit: 0 }), ['anvil-godot']);
});

test('all project pins remain visible in their chosen order and an explicit prohibition overrides a pin', () => {
  const pins = ['anvil-tests', 'anvil-godot', 'anvil-freecad'];
  assert.deepEqual(ids('Bearbeite den nächsten Punkt.', env, { automatic: false, pinned: pins, limit: 2 }), pins);
  assert.deepEqual(ids('Nutze kein FreeCAD. Bearbeite den nächsten Punkt.', env, { automatic: false, pinned: pins, limit: 2 }), ['anvil-tests', 'anvil-godot']);
});

test('the opened engine supplies a specialist for a scene task without spelling its brand', () => {
  assert.equal(ids('Füge der geöffneten Szene einen Doppelsprung hinzu.').includes('anvil-godot'), true);
  assert.equal(ids('Füge der geöffneten Szene einen Doppelsprung hinzu.', { ...env, engines: [] }).includes('anvil-godot'), false);
  assert.equal(ids('Erstelle eine CSS-Animation für die Szene im Browser.').includes('anvil-godot'), false);
  assert.equal(ids('Erstelle eine CSS-Animation für die Szene im Browser.').includes('anvil-web'), true);
  assert.deepEqual(ids('Wie spät ist es?'), []);
});

test('CAD geometry and STEP identify the matching configured service, not an arbitrary installed specialist', () => {
  const cad = { ...env, services: [{ name: 'FreeCAD', enabled: true, catalog: true, tools: true }] };
  assert.equal(ids('Modelliere eine parametrische Halterung mit vier Bohrungen und STEP-Export.', cad).includes('anvil-freecad'), true);
  assert.equal(ids('Modelliere eine parametrische Halterung mit vier Bohrungen und STEP-Export.', env).includes('anvil-freecad'), false);
  assert.equal(ids('Erkläre den nächsten Schritt im Formular.', cad).includes('anvil-freecad'), false);
  assert.equal(ids('Erstelle eine CSS-Form und rendere die Weboberfläche.', cad).includes('anvil-freecad'), false);
});

test('general verbs and tests cannot evict a named engine specialist', () => {
  const selected = ids('Erweitere die Godot-Szene: implementiere eine neue Funktion, ändere den Code und erstelle Tests mit pytest und Unittest.');
  assert.equal(selected.includes('anvil-godot'), true);
  assert.ok(selected.length <= 2);
  assert.ok(ids('Godot Unity Unreal Blender GitHub Tests', env, { automatic: true, pinned: [], limit: 8 }).length <= 2);
});

test('an explanation does not attract the general write-code guide just because it mentions code', () => {
  assert.equal(ids('Erkläre den Code und den Projektaufbau.').includes('anvil-code-aendern'), false);
  assert.equal(ids('Erkläre den Code und den Projektaufbau.').includes('anvil-projekt-verstehen'), true);
});

test('a custom skill can match a short specific technology name without a feedback score gate', () => {
  const own = { id: 'sql-pruefen', name: 'sql-pruefen', when: 'SQL Schema prüfen', body: 'Lies das vereinbarte Schema.', score: .05 };
  assert.deepEqual(ids('Prüfe SQL.', env, { automatic: true, pinned: [], limit: 2 }, [own]), ['sql-pruefen']);
});

test('the new workflows match natural commands and do not rely on the exact description word order', () => {
  assert.ok(ids('Setze den unterbrochenen Auftrag fort.').includes('anvil-auftrag-fortsetzen'));
  assert.ok(ids('Prüfe die Anwendung im Browser und teste die Bedienung.').includes('anvil-anwendung-pruefen'));
  assert.ok(ids('Übertrage die GLB-Assets in die Engine.').includes('anvil-assets-uebertragen'));
  assert.ok(ids('Prüfe die Abhängigkeiten des Projekts.').includes('anvil-abhaengigkeiten-pflegen'));
  assert.equal(ids('Erkläre nur das GLB-Dateiformat.').includes('anvil-assets-uebertragen'), false);
  assert.equal(ids('Was ist eine Bibliothek?').includes('anvil-abhaengigkeiten-pflegen'), false);
});

test('the complete workshop endurance request selects browser work and verification, not dependency maintenance', () => {
  const prompt = readFileSync(new URL('../../fixtures/workshop-task.txt', import.meta.url), 'utf8');
  assert.deepEqual(ids(prompt, { ...env, engines: [] }), ['anvil-anwendung-pruefen', 'anvil-web']);
});

test('task dependencies and excluded libraries do not request package maintenance', () => {
  for (const query of [
    'Prüfe Abhängigkeiten zwischen Aufgaben und verhindere zyklische Abhängigkeiten.',
    'Aktualisiere die Abhängigkeiten zwischen Tasks im Projektplaner.',
    'Check task dependencies and prevent dependency cycles.',
    'Check the project dependency graph and reject cycles.',
    'Prüfe die Abhängigkeiten zwischen Projekten im Planer.',
    'Prüfe die Abhängigkeiten der Aufgaben.',
    'Aktualisiere die Aufgaben-Abhängigkeiten im Planer.',
    'Prüfe Prozessabhängigkeiten auf Zyklen.',
    'Prüfe zyklische Abhängigkeiten.',
    'Erstelle eine Browseranwendung ohne externe Bibliotheken. Prüfe die Anwendung im Browser.',
    'Prüfe die Anwendung. Aktualisiere keine Bibliotheken oder npm-Pakete.',
    'Do not update dependencies. Check the task dependency graph.',
    'Keine Sicherheitsupdates. Prüfe nur die Aufgaben im Planer.',
    'Erstelle die Browseranwendung ohne Bibliotheken. Prüfe anschließend die Abhängigkeiten.',
  ]) assert.equal(ids(query).includes('anvil-abhaengigkeiten-pflegen'), false, query);
});

test('real package, lockfile and security maintenance stays eligible even in a task planner', () => {
  for (const query of [
    'Prüfe die Abhängigkeiten des Projekts.',
    'Update project dependencies.',
    'Aktualisiere die npm-Abhängigkeiten und prüfe die package-lock.json.',
    'Prüfe die installierten Bibliotheken auf Sicherheitsupdates.',
    'Prüfe die Versionen verwendeter Bibliotheken.',
    'Aktualisiere das Lockfile.',
    'Review Python package dependencies and requirements.txt for security issues.',
    'Verhindere zyklische Abhängigkeiten zwischen Aufgaben. Aktualisiere anschließend die npm-Pakete.',
    'Prüfe zyklische npm-Abhängigkeiten.',
  ]) assert.ok(ids(query).includes('anvil-abhaengigkeiten-pflegen'), query);
  assert.deepEqual(ids('Aufgabenabhängigkeiten im Planer prüfen.', env, { automatic: false, pinned: ['anvil-abhaengigkeiten-pflegen'], limit: 2 }), ['anvil-abhaengigkeiten-pflegen']);
  assert.deepEqual(ids('$anvil-abhaengigkeiten-pflegen für die Aufgabe verwenden.', env, { automatic: false, pinned: [], limit: 2 }), ['anvil-abhaengigkeiten-pflegen']);
  assert.equal(ids('Nutze nicht $anvil-abhaengigkeiten-pflegen. Prüfe Aufgabenabhängigkeiten im Planer.', env, { automatic: true, pinned: ['anvil-abhaengigkeiten-pflegen'], limit: 2 }).includes('anvil-abhaengigkeiten-pflegen'), false);
});

test('descriptions in build requests do not suppress application verification', () => {
  assert.ok(ids('Erstelle eine Browseranwendung. Aufgaben besitzen Beschreibung und Tags. Prüfe ihre Bedienung.').includes('anvil-anwendung-pruefen'));
  assert.equal(ids('Beschreibe die Anwendung und ihren Projektaufbau.').includes('anvil-anwendung-pruefen'), false);
});

test('library refresh keeps feedback and counters without treating them as a probability', () => {
  const current = skills.find(skill => skill.id === 'anvil-tests')!;
  const feedback = [{ id: 'event', jobId: 'job', version: 'content-v1', kind: 'fail' as const, at: 4, source: 'agent' as const }];
  const merged = mergeSkillLibrary([{ ...current, score: .2, uses: 5, wins: 1, fails: 4, feedback }]);
  const refreshed = merged.find(skill => skill.id === current.id)!;
  assert.deepEqual(refreshed.feedback, feedback);
  assert.equal(refreshed.uses, 5);
  assert.equal(refreshed.fails, 4);
});
