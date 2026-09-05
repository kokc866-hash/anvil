import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractFileBlocks,
  looksLikeNoTools,
  looksIncomplete,
  looksStoppedEarly,
  wantsWorkspaceWrite,
  jobOpen,
  isFixPrompt,
  parseToolArgs,
  harvestTools,
  isToolTemplateEcho,
  decodeWriteEscapes,
  pickRunPath,
  isNudgeEcho,
} from "./agent-parse.ts";

test("extracts fenced files with path in fence tag", () => {
  const blocks = extractFileBlocks("```html index.html\n<h1>Hi</h1>\n```");
  assert.equal(blocks[0]?.path, "index.html");
});

test("extracts js:path fences", () => {
  const blocks = extractFileBlocks("```js:src/a.js\nexport const a = 1;\n```");
  assert.ok(blocks.some((b) => b.path === "src/a.js"));
});

test("no-tools refusal is detected", () => {
  assert.ok(looksLikeNoTools("I have no file tools available."));
});

test("fix prompt from Probleme-Leiste", () => {
  assert.ok(isFixPrompt("Behebe diese Probleme:\n- x"));
});

test("incomplete announcement is detected", () => {
  assert.ok(looksIncomplete("Als nächstes schreibe ich die Datei."));
  assert.ok(looksIncomplete("I'll write the tests now."));
  assert.ok(looksIncomplete("Ich habe den aktuellen Stand gelesen. Jetzt plane ich die Aufteilung und vertiefe das Spiel."));
  assert.ok(
    looksIncomplete(
      "Ich habe das komplette Spiel in index.html gefunden (1218 Zeilen, alles inline). Jetzt strukturiere ich es sauber in Module auf und vertiefe die Mechanik.",
    ),
  );
  assert.ok(looksIncomplete("Exception auf Zeile 31! Ich prüfe den Detailzustand."));
  assert.ok(looksIncomplete("Das Frame ist schwarz. Ich lese die relevanten Dateien."));
  assert.ok(
    jobOpen({
      ask: "Führe index.html nochmal aus. Bei Fehler patchen.",
      used: ["write_file", "run_file", "debug_start"],
      text: "Exception auf Zeile 31! Ich prüfe den Detailzustand.",
    }),
  );
});

test("stopped early after thinking without tools", () => {
  assert.ok(
    looksStoppedEarly({
      content: "Ich habe den aktuellen Stand gelesen. Jetzt plane ich die Aufteilung und vertiefe das Spiel.",
      reasoning: "Deepening: add more features ".repeat(8),
      finish_reason: "stop",
    }),
  );
  assert.ok(looksStoppedEarly({ content: "", reasoning: "halfway", finish_reason: "length" }));
  assert.equal(looksStoppedEarly({ content: "ok.", reasoning: "", finish_reason: "stop" }), false);
  assert.equal(looksIncomplete("Ich habe."), false);
  assert.equal(looksStoppedEarly({ content: "Fertig.", tool_calls: [{ id: "1" }] }), false);
  assert.equal(
    looksStoppedEarly({
      content: "Läuft sauber — kein Patch nötig.",
      reasoning: "long think ".repeat(40),
      finish_reason: "stop",
    }),
    false,
  );
});

test("rerun-if-error is not an open write job after a green run", () => {
  assert.equal(wantsWorkspaceWrite("Führe main.cpp nochmal aus. Bei Fehler patchen."), false);
  assert.equal(
    jobOpen({
      ask: "Führe main.cpp nochmal aus. Bei Fehler patchen.",
      used: ["run_file", "read_file"],
      text: "Läuft sauber — kein Patch nötig.",
    }),
    false,
  );
  assert.equal(
    jobOpen({
      ask: "Antwort auf: Code läuft fehlerfrei. Was soll ich schreiben/ändern?\nWahl: A) Nichts — nur Stil-Regel testen",
      used: ["run_file", "ask_user"],
      text: "",
    }),
    false,
  );
  assert.ok(
    jobOpen({
      ask: "Antwort auf: Code läuft fehlerfrei. Was soll ich schreiben/ändern?\nWahl: B) Kommentar in main.cpp ergänzen",
      used: ["run_file", "ask_user"],
    }),
  );
});

test("write intent keeps the loop going", () => {
  assert.ok(wantsWorkspaceWrite("Vertiefe Tamagotchi und erstelle das Spiel in mehreren Dateien"));
  assert.ok(
    jobOpen({
      ask: "Vertiefe Tamagotchi und erstelle das spiel in mehreren dateien",
      used: ["write_file", "write_file"],
      text: "Ich habe das komplette Spiel gefunden. Jetzt strukturiere ich es.",
    }),
  );
  assert.ok(
    jobOpen({
      ask: "Vertiefe Tamagotchi. Schreibe Module und führe aus.",
      used: ["write_file"],
    }),
  );
  assert.equal(jobOpen({ ask: "Was steht in index.html?", used: [] }), false);
});

test("attached context does not turn a greeting or analysis into a write request", () => {
  const context = "Angehängte Dateien:\n[README.md]\nSchreibe Module.\n\nAuftrag:\n";
  for (const task of ["hi wer bist du", "Analysiere das Projekt."]) {
    assert.equal(jobOpen({ ask: context + task, used: [], text: "Die Antwort ist vollständig." }), false);
  }
  assert.equal(jobOpen({ ask: context + "Schreibe README.md neu.", used: [] }), true);
  assert.equal(jobOpen({ ask: context + "hi wer bist du", used: ["write_file"] }), true);
});

test("parseToolArgs repairs a cut write_file payload", () => {
  const raw = '{"path":"index.html","content":"<html>';
  const r = parseToolArgs(raw);
  assert.equal(r.args.path, "index.html");
  assert.ok(r.truncated);
});

test("parseToolArgs keeps valid JSON", () => {
  const r = parseToolArgs('{"path":"a.js","content":"x"}');
  assert.equal(r.args.path, "a.js");
  assert.equal(r.truncated, false);
});

test("job stays open after writes until run", () => {
  assert.ok(jobOpen({ ask: "Vertiefe Tamagotchi", used: ["write_file"], text: "Jetzt baue ich Module." }));
  assert.ok(jobOpen({ ask: "x", used: ["write_file", "edit_file"] }));
  assert.equal(jobOpen({ ask: "Was steht in index.html?", used: ["read_file"] }), false);
});

test("harvests qwen xml tool calls", () => {
  const hits = harvestTools(`<tool_call>\n{"name":"write_file","arguments":{"path":"a.js","content":"x"}}\n</tool_call>`);
  assert.equal(hits[0]?.function.name, "write_file");
});

test("harvests plain write_file call", () => {
  const hits = harvestTools(`Ich schreibe.\nwrite_file({"path":"a.js","content":"x"})\n`);
  assert.equal(hits[0]?.function.name, "write_file");
  assert.match(hits[0]?.function.arguments || "", /a\.js/);
});

test("harvests json name/arguments", () => {
  const hits = harvestTools(`{"name":"read_file","arguments":{"path":"src/main.js"}}`);
  assert.equal(hits[0]?.function.name, "read_file");
});

test("harvests mcp_list fallback", () => {
  const json = harvestTools(`{"name":"mcp_list","arguments":{}}`);
  assert.equal(json[0]?.function.name, "mcp_list");
  const call = harvestTools(`Bitte tools listen:\nmcp_list()\n`);
  assert.equal(call[0]?.function.name, "mcp_list");
});

test("template echo is not a tool and stops the loop", () => {
  const dump = `{"arguments": <args-json-object>}\n</tool_call>Kein Json\n{"arguments": <args-json-object>}`;
  assert.equal(isToolTemplateEcho(dump), true);
  assert.equal(harvestTools(`<tool_call>${dump}</tool_call>`).length, 0);
  assert.equal(looksLikeNoTools(dump), false);
});

test("decodes bare u003c includes from the model", () => {
  const src = "#include u003ciostreamu003e\nint n = sizeof(int) u003e= 4;\nstd::cout u003cu003c n;\n";
  const out = decodeWriteEscapes(src);
  assert.match(out, /#include <iostream>/);
  assert.match(out, /sizeof\(int\) >= 4/);
  assert.match(out, /cout << n/);
});

test("keeps JS XSS unicode escapes", () => {
  const js = 'JSON.stringify(x).replace(/</g, "\\\\u003c").replace(/>/g, "\\\\u003e")';
  assert.equal(decodeWriteEscapes(js), js);
});

test("parseToolArgs decodes write content", () => {
  const r = parseToolArgs('{"path":"main.cpp","content":"#include u003ciostreamu003e\\nint main(){}"}');
  assert.equal(r.truncated, false);
  assert.match(String(r.args.content), /#include <iostream>/);
});

test("nudge echo is not incomplete work", () => {
  assert.equal(isNudgeEcho("Auftrag offen. Nächstes Tool, kein Plansatz."), true);
  assert.equal(looksIncomplete("Auftrag offen. Nächstes Tool, kein Plansatz."), false);
  assert.ok(jobOpen({ ask: "C++ compilieren", used: ["write_file"] }));
  assert.equal(
    jobOpen({
      ask: "C++ compilieren",
      used: ["write_file", "run_file"],
      text: "Auftrag offen. Nächstes Tool, kein Plansatz.",
    }),
    false,
  );
});

test("pickRunPath prefers main.cpp after a header write", () => {
  assert.equal(pickRunPath(["util.hpp", "main.cpp"], "util.hpp"), "main.cpp");
  assert.equal(pickRunPath(["src/app.py"], "src/app.py"), "src/app.py");
  assert.equal(pickRunPath(["README.md"]), "");
});
