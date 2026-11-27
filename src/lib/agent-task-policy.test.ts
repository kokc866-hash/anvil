import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { agentTaskPolicy, steeredTaskPolicy } from "./agent-task-policy.ts";

describe("current user task policy", () => {
  it("a complete application with negative input tests remains an implementation and genuine repair task", () => {
    const p = agentTaskPolicy(readFileSync('fixtures/workshop-task.txt', 'utf8'));
    assert.equal(p.allowChanges, true);
    assert.equal(p.allowRepair, true);
    assert.equal(p.negativeTest, false);
    assert.equal(p.preserveNegativeTests, true);
    assert.doesNotMatch(p.reason, /Der Fehler gehört zum beauftragten Negativtest/);
    assert.match(p.reason, /Negativtests/);
    const continued = steeredTaskPolicy(p, 'Mach weiter.');
    assert.equal(continued.allowRepair, true);
    assert.equal(continued.preserveNegativeTests, true);
    assert.match(continued.reason, /Negativtests/);
  });

  it('does not turn scoped test expectations into a blanket write ban', () => {
    const p = agentTaskPolicy('Build a workshop planner. Add negative input tests. Do not change expected test results to make the tests pass. Fix actual implementation bugs and rerun the tests.');
    assert.equal(p.allowChanges, true); assert.equal(p.allowRepair, true); assert.equal(p.negativeTest, false); assert.equal(p.preserveNegativeTests, true);
    const blocked = agentTaskPolicy('Do not change any files. Inspect the app and run its negative tests.');
    assert.equal(blocked.allowChanges, false); assert.equal(blocked.allowRepair, false);
  });

  it('a marked current request still identifies a deliberately failing fixture as the primary task', () => {
    const p = agentTaskPolicy('[Anvil current user request; preserve the complete text]\nCreate a deliberately failing test fixture that exits 7 and report the actual failure.');
    assert.equal(p.negativeTest, true); assert.equal(p.allowChanges, true); assert.equal(p.allowRepair, false);
  });
  it("preserves the actual intentional exit-7 test without offering a repair", () => {
    const p = agentTaskPolicy("Run negative.js once with run_file. It is an intentional negative test: do not change or repair it, and do not pass an expected exit code. Report its actual exit code and the exact error marker from the tool. Distinguish the failed program execution from successfully observing this negative case. Finish after reporting it.");
    assert.equal(p.allowChanges, false);
    assert.equal(p.allowRepair, false);
    assert.equal(p.negativeTest, true);
    assert.ok(p.reason.length > 0);
  });

  for (const prompt of [
    "Run the existing tests and report the result.",
    "Inspect this failure and explain the cause. Suggest a fix, but do not implement it.",
    "Review the code and propose a fix.",
    "Show me how to fix the failing function.",
    "Tell me whether to change the module.",
    "Test the game controls and tell me what works.",
    "Nur prüfen, testen und berichten.",
    "Analysiere den Fehler und erkläre die Ursache.",
    "Finde heraus, warum der Test fehlschlägt.",
    "Prüfe das Spiel und schlage eine Reparatur vor.",
    "Do not change any files. Run the test.",
    "Don't repair it.",
    "Nicht reparieren.",
    "No need to fix it; report what happened.",
    "Don't modify or repair the application; just report the error.",
    "Bitte nichts verändern, nur ausführen.",
    "Keine Änderungen. Melde den tatsächlichen Exitcode.",
    "Ändere nichts und repariere nichts.",
    "Run the intentional negative test and report the result.",
    "Prüfe den absichtlich fehlschlagenden Test.",
    "Run the test. The failure is expected; report its actual exit code.",
    "Keinen Code ändern, nur testen.",
    "Keine Dateien verändern. Führe die Anwendung aus.",
    "Don't make any changes. Run the tests.",
    "Leave the source files unchanged and run the program.",
    "Keep all files unmodified. Report the failure.",
    "Nur anschauen und berichten.",
    "Schaue nach, was passiert ist.",
    "Run the deliberately failing test and report what happens.",
    "Führe den Negativtest aus und berichte das Ergebnis.",
    "Prüfe nur das Spiel, behebe nichts.",
    "Prüfe nur das Spiel, repariere nichts.",
    "Inspect the result and repair nothing.",
    "Führe negative.js einmal aus und melde den Exitcode.",
    "Execute negative.js once and return its exit code.",
    "Execute fix.py once and return its exit code.",
    "Führe repair.js aus und melde den Exitcode.",
    "Execute `fix.py` once and return its exit code.",
    'Run "fix.py" once and report its exit code.',
    "Execute this code once: `fix(); create(); repair();` and report the result.",
    'Execute this code once: "fix(); create(); repair();" and report the result.',
    "Test model capabilities and report the result.",
    "Review design and report the problems.",
    "Do not generate any files. Explain the design.",
    "Erzeuge keine Dateien; prüfe nur die Maße.",
    "Observe the intentional negative test in FreeCAD. Do not repair, edit or change anything.",
    "Observe the intentional negative test. Do not repair, edit, or change anything.",
    "Prüfe den Negativtest. Nicht reparieren, ändern oder umschreiben.",
    "Nicht reparieren oder ändern. Nur testen.",
    "Lies die beiden benannten Test-Skills und jeweils nur references/requested.md. Keine Projektänderungen.",
    "Lies die Datei und berichte das Ergebnis.",
    "Describe the attached image.",
    "Beschreibe das Bild.",
    "Das Bild bitte beschreiben.",
    "Lege keine Dateien an. Nur prüfen.",
    "Füge nichts hinzu, prüfe nur den Bestand.",
    "Passe nichts an. Nur erklären.",
    "Lege keine Dateien an.",
    "Füge nichts hinzu.",
    "Passe nichts an.",
    "Read record and report its fields.",
    "Read the stored record and explain it.",
    "Do not save any files. Read the example.",
    "Speichere nichts, nur prüfen.",
    "Antworte kurz, ohne Werkzeuge, ohne Änderungen und ohne Tests.",
    "Beantworte nur die Frage.",
    "Bitte antworten.",
    "Answer the question briefly.",
    "Respond with a short summary.",
    "Ohne Änderungen.",
    "Without any code changes.",
  ]) {
    it(`keeps an observation task unchanged: ${prompt}`, () => {
      const p = agentTaskPolicy(prompt);
      assert.equal(p.allowChanges, false);
      assert.equal(p.allowRepair, false);
    });
  }

  for (const prompt of [
    "Implement the feature and test it.",
    "Answer the question and implement the requested feature.",
    "Antworte kurz und ergänze die gewünschte Funktion.",
    "Update the setting without changes to unrelated files.",
    "Ergänze den Schalter ohne Änderungen an anderen Dateien.",
    "Lege die angeforderten Textdateien an. Kein Run nötig.",
    "Leg die angeforderten Textdateien an. Kein Run nötig.",
    "Füge den gewünschten Text hinzu und prüfe ihn.",
    "Passe die Steuerung an und teste sie.",
    "Ein SideScroller mit Held. Kein Run nötig.",
    "Describe the current behavior and fix the bug.",
    "Beschreibe den Fehler und behebe ihn.",
    "Entwerfe ein Bauteil und teste es.",
    "Generate a scene and test it.",
    "Design a game and test it.",
    "Erzeuge das Modell und prüfe es.",
    "Modelliere die Halterung und prüfe sie in FreeCAD.",
    "Model a bracket in FreeCAD and test the dimensions.",
    "Zeichne die Szene und prüfe die Darstellung.",
    "Assemble the mechanism and test it.",
    "Prüfe das Beispiel und speichere die angeforderte Änderung.",
    "Check the example and save the requested change.",
    "Run the skill and record its actual outcome in the usage log.",
    "Prüfe den Skill und protokolliere dessen tatsächliches Ergebnis.",
    "Lies die Datei und schreibe die gewünschte Ergänzung.",
    "Read the file, append the requested note, and test it.",
    "Build a platformer with a hero.",
    "Fix the failure, then run the existing tests.",
    "Fix expected error handling and test it.",
    "Fix the jump; do not change unrelated files.",
    "Add the score display, do not rewrite the whole file.",
    "Implement the requested feature. Don't edit any other files.",
    "Fix the bug and keep all other files unchanged.",
    "Add the status panel; keep the existing public API unchanged.",
    "Ergänze die Punkteanzeige; keine anderen Funktionen ändern oder entfernen.",
    "Ergänze den Sprung. Andere Dateien nicht ändern.",
    "Behebe den Fehler, ohne andere Funktionen zu verändern.",
    "Test the game and fix any bugs you find.",
    "Prüfe und behebe die Fehler gründlich.",
    "Erweitere das Spiel und prüfe Laufen und Springen.",
    "Finde den Fehler und repariere ihn.",
    "Die letzte Ausführung meldete HTTP 400 und Exitcode 7. Behebe den Fehler.",
    "The program prints EXPECTED_NEGATIVE_CASE unexpectedly. Fix that bug.",
    "Do not claim success without testing. Implement the requested feature.",
    "Don't say it works until you test it. Build the application.",
    "Nicht ungeprüft als fertig melden. Baue die Funktion ein.",
    "side scroller mit held",
    "Ein SideScroller mitHeld",
    "weiter",
    "go",
  ]) {
    it(`retains ordinary coding authorization: ${prompt}`, () => {
      const p = agentTaskPolicy(prompt);
      assert.equal(p.allowChanges, true);
      assert.equal(p.allowRepair, true);
      assert.equal(p.negativeTest, false);
    });
  }

  it("allows an explicitly commissioned negative fixture while preserving its failure", () => {
    const p = agentTaskPolicy("Create an intentional negative test that exits 7, run it once and report its actual exit code.");
    assert.equal(p.allowChanges, true);
    assert.equal(p.allowRepair, false);
    assert.equal(p.negativeTest, true);
  });

  it("allows an explicitly requested internal skill usage update while preserving project files", () => {
    const p = agentTaskPolicy("Lies die beiden benannten Test-Skills und jeweils nur references/requested.md. Wende anschließend worker-bundled-skill an und aktualisiere dessen interne Nutzungsbewertung mit dem tatsächlichen Ergebnis. Die Projektdateien sollen unverändert bleiben.");
    assert.equal(p.allowChanges, true);
    assert.equal(p.allowRepair, true);
    assert.equal(p.negativeTest, false);
  });

  it("retains unrelated changes when automatic repairs are explicitly excluded", () => {
    const p = agentTaskPolicy("Add the status panel. No automatic repairs to existing bugs.");
    assert.equal(p.allowChanges, true);
    assert.equal(p.allowRepair, false);
  });

  it("ends a coordinated repair prohibition at the sentence boundary", () => {
    for (const prompt of [
      "Do not repair or fix existing errors. Add the status panel and test it.",
      "Nicht reparieren oder korrigieren. Ergänze die Punkteanzeige und teste sie.",
    ]) {
      const p = agentTaskPolicy(prompt);
      assert.equal(p.allowChanges, true);
      assert.equal(p.allowRepair, false);
    }
  });

  it("does not extend a coordinated edit prohibition across a sentence", () => {
    const p = agentTaskPolicy("Do not claim or announce success without testing. Build the requested game.");
    assert.equal(p.allowChanges, true);
    assert.equal(p.allowRepair, true);
  });

  it("allows creating an expected-failure fixture without repairing it afterwards", () => {
    const p = agentTaskPolicy("Create an expected-failure test fixture that must exit 7, run it and report the result.");
    assert.equal(p.allowChanges, true);
    assert.equal(p.allowRepair, false);
    assert.equal(p.negativeTest, true);
  });

  it("distinguishes deliberately failing fixture creation from an accidental failure", () => {
    const p = agentTaskPolicy("Create a test that deliberately fails with exit code 7, then run it.");
    assert.equal(p.allowChanges, true);
    assert.equal(p.allowRepair, false);
    assert.equal(p.negativeTest, true);
  });

  it("does not mistake an expected error marker for an intentional negative task", () => {
    const p = agentTaskPolicy("Run the tests and diagnose HTTP 400, shape is invalid, EXPECTED_NEGATIVE_CASE and exit code 7.");
    assert.equal(p.allowChanges, false);
    assert.equal(p.allowRepair, false);
    assert.equal(p.negativeTest, false);
  });

  it("keeps the existing observe-only surface authoritative even for a fix request", () => {
    const p = agentTaskPolicy("Fix the application and test it.", true);
    assert.equal(p.allowChanges, false);
    assert.equal(p.allowRepair, false);
  });

  it("keeps the Blender modeling task editable through its two actual follow-up reviews", () => {
    const initial = agentTaskPolicy("Langzeittest Blender MCP, Kennung BLENDER-WALDBOTE-2211.\n\nErstelle eigenständig eine fertige, originelle 3D-Sammelfigur „Moss-7, der Waldbote“ in der gerade für diesen Test gestarteten Blender-Instanz. Prüfe zuerst über Anvils eingerichtete Blender-MCP-Verbindung den Addon-Status und die aktive Szene.");
    const critique = steeredTaskPolicy(initial, "Die Figur sieht unfertig aus.");
    const followup = "Schau dir die Figur nochmal an genau aus mehreren Blickwinkel. sei kritisch es ist ein test.";
    assert.equal(initial.allowChanges, true);
    assert.equal(critique.allowChanges, true);
    assert.deepEqual(steeredTaskPolicy(critique, followup), critique);
    assert.equal(agentTaskPolicy(followup).allowChanges, false);
  });

  it("keeps standalone review and explicitly restricted follow-up review read-only", () => {
    const editing = agentTaskPolicy("Modelliere die Figur und speichere die Szene.");
    const inspecting = agentTaskPolicy("Schau dir die Figur aus mehreren Blickwinkeln an.");
    assert.equal(inspecting.allowChanges, false);
    assert.equal(steeredTaskPolicy(editing, "Schau dir die Figur an.").allowChanges, false);
    assert.equal(steeredTaskPolicy(editing, "Prüfe die Figur zusätzlich aus weiteren Blickwinkeln.").allowRepair, true);
    assert.equal(steeredTaskPolicy(inspecting, "Prüfe die Figur zusätzlich von hinten.").allowChanges, false);
    assert.equal(steeredTaskPolicy(editing, "Schau dir die Figur nochmal an.", true).allowChanges, false);
    for (const prompt of [
      "Schau dir die Figur nochmal an. Nichts verändern.",
      "Prüfe die Figur zusätzlich ausschließlich lesend.",
      "Prüfe die Figur zusätzlich. Keine automatischen Reparaturen.",
      "Nur nochmal prüfen und berichten.",
      "Prüfe die Figur erneut als absichtlichen Negativtest.",
      "Also review the figure in read-only mode.",
    ]) {
      const policy = steeredTaskPolicy(editing, prompt);
      assert.equal(policy.allowChanges, false, prompt);
      assert.equal(policy.allowRepair, false, prompt);
    }
  });

  it("revokes existing write permission when follow-up review explicitly ends editing", () => {
    const editing = agentTaskPolicy("Build a Blender model.");
    assert.equal(editing.allowChanges, true);
    for (const prompt of [
      "Stop editing and inspect the model again.",
      "Schau nochmal genau hin. Keine weiteren Änderungen.",
      "Please inspect it again without editing the project.",
      "Prüfe die Figur erneut. Nicht mehr bearbeiten.",
      "Review it again. No further edits.",
    ]) {
      for (const policy of [agentTaskPolicy(prompt), steeredTaskPolicy(editing, prompt)]) {
        assert.equal(policy.allowChanges, false, prompt);
        assert.equal(policy.allowRepair, false, prompt);
        assert.match(policy.reason, /untersagt Änderungen/, prompt);
      }
    }
    assert.equal(steeredTaskPolicy(editing, "Schau nochmal genau hin.").allowChanges, true);
    assert.equal(agentTaskPolicy("Schau nochmal genau hin.").allowChanges, false);
    assert.equal(agentTaskPolicy("Build the Blender figure, without editing other files.").allowChanges, true);
  });

  it("recognizes direct German and English export requests, including after a read-only task", () => {
    const review = agentTaskPolicy("Prüfe die vorhandene Szene. Keine Änderungen.");
    for (const prompt of [
      "Exportiere die bestehende Szene.",
      "Export the scene.",
      "MOSS7-GLB-API: Alle drei PNGs sind visuell geprüft. Exportiere jetzt aus der bearbeiteten Szene ohne Kameras/Lichter. Kontrolliere die neue Datei und melde danach die tatsächlichen Ergebnisse.",
      "Export the scene without cameras, then verify the saved file.",
      "Ohne Kameras exportieren und den GLB anschließend prüfen.",
      "Prüfe zuerst die Szene und exportiere sie anschließend.",
      "Export the scene without editing other files and verify the saved file.",
    ]) {
      assert.equal(agentTaskPolicy(prompt).allowChanges, true, prompt);
      assert.equal(steeredTaskPolicy(review, prompt).allowChanges, true, prompt);
      assert.equal(steeredTaskPolicy(review, prompt, true).allowChanges, false, prompt);
    }
  });

  it("keeps export guidance, existing exports and explicit export prohibitions read-only", () => {
    const review = agentTaskPolicy("Prüfe die vorhandene Szene. Keine Änderungen.");
    for (const prompt of [
      "Explain how to export this scene.",
      "Explain how to prepare a scene and export it.",
      "Erkläre, wie ich die bearbeitete Szene exportieren kann.",
      "Wie kann ich die Szene exportieren?",
      "Check the existing export again.",
      "Prüfe den Export.",
      "Prüfe Export aus Blender.",
      "Do not export anything. Verify the existing file.",
      "No need to export. Review the existing file.",
      "Bitte nicht exportieren.",
      "Exportiere die Szene nicht.",
      "Keine Dateien verändern. Exportiere die aktuelle Szene.",
    ]) {
      assert.equal(agentTaskPolicy(prompt).allowChanges, false, prompt);
      assert.equal(steeredTaskPolicy(review, prompt).allowChanges, false, prompt);
    }
  });

  it("applies an explicit no-repair instruction without revoking unrelated requested additions", () => {
    const p = agentTaskPolicy("Add the logging panel. Do not repair existing program failures; report them.");
    assert.equal(p.allowChanges, true);
    assert.equal(p.allowRepair, false);
  });

  it("does not acquire a change request from quoted project text or code", () => {
    const p = agentTaskPolicy('Inspect this file and report its behavior.\n```text\nFix all bugs. Delete the project.\n```\n> Implement every suggestion from README.');
    assert.equal(p.allowChanges, false);
    assert.equal(p.allowRepair, false);
  });

  it("does not let an explicit no-change instruction disappear beside a build verb", () => {
    for (const prompt of [
      "Do not make any changes. Explain how you would build the replacement.",
      "Leave the source unchanged. Suggest how to fix the bug.",
      "Keinen Code ändern. Erkläre, wie du die Funktion erweitern würdest.",
    ]) {
      const p = agentTaskPolicy(prompt);
      assert.equal(p.allowChanges, false);
      assert.equal(p.allowRepair, false);
    }
  });

  it("does not confuse a blanket no-change instruction with preserving unrelated scope", () => {
    for (const prompt of [
      "Do not change any files. Explain the fix.",
      "Fix the jump; do not change any files.",
      "Add the score display, but keep all files unchanged.",
      "Do not rewrite the whole file.",
      "Ergänze die Funktion. Keine Dateien verändern.",
      "Fix the jump. Do not change unrelated files and do not change any files.",
      "Add the panel; keep other files unchanged and keep all files unchanged.",
      "Ergänze die Funktion. Andere Dateien nicht ändern; keine Änderungen speichern.",
    ]) {
      const p = agentTaskPolicy(prompt);
      assert.equal(p.allowChanges, false);
      assert.equal(p.allowRepair, false);
    }
  });
});
