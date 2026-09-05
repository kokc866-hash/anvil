import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_RAM,
  COMPACT_MARK,
  EMPTY_JOURNAL,
  beginJournal,
  extractJournal,
  formatJournal,
  harvestPaths,
  isJournalEmpty,
  journalPrompt,
  mergeJournal,
  packChatHistory,
  parseSessionFile,
  persistChat,
  sessionFileText,
  trimList,
} from "./session.ts";

describe("session", () => {
  it("keeps a short list", () => {
    assert.deepEqual(trimList([1, 2, 3], 10), [1, 2, 3]);
  });
  it("drops the head past the cap", () => {
    const xs = Array.from({ length: CHAT_RAM + 5 }, (_, i) => i);
    const next = trimList(xs, CHAT_RAM);
    assert.equal(next.length, CHAT_RAM);
    assert.equal(next[0], 5);
    assert.equal(next.at(-1), CHAT_RAM + 4);
  });
  it("holds enough turns for a long session", () => {
    assert.ok(CHAT_RAM >= 200);
  });
});

describe("journal", () => {
  it("pulls paths, goal and corrections", () => {
    const j = extractJournal([
      { role: "user", content: "Bau in src/app.ts eine To-do-Liste. Nicht Tailwind." },
      { role: "assistant", content: "Ich schreibe src/app.ts und lib/store.ts. Wir nutzen localStorage." },
      { role: "user", content: "Auftrag:\nBitte index.html dunkler, nicht so hell." },
    ]);
    assert.match(j.goal, /To-do-Liste/);
    assert.ok(j.files.includes("src/app.ts"));
    assert.ok(j.files.includes("lib/store.ts") || j.files.includes("index.html"));
    assert.ok(j.corrections.some((c) => /nicht/i.test(c)));
    assert.equal(isJournalEmpty(j), false);
    assert.match(formatJournal(j), /Ziel:/);
    assert.match(journalPrompt(j), /Sitzung/);
  });
  it("merges without dropping the first goal", () => {
    const a = extractJournal([{ role: "user", content: "Schreibe main.py Fakultät" }]);
    const b = extractJournal([{ role: "user", content: "Bitte Tests in tests/test_main.py" }], a);
    const m = mergeJournal(a, b);
    assert.ok(m.files.includes("main.py") || m.goal.includes("main.py") || m.files.includes("tests/test_main.py"));
    assert.ok(m.files.includes("tests/test_main.py") || /test_main/.test(m.goal));
    assert.ok(m.turns >= 1);
  });
  it("keeps compact marks as notes", () => {
    const j = extractJournal([
      { role: "user", content: `${COMPACT_MARK}, 9 Nachrichten):\nZiel: Memory-Spiel\nDateien: index.html` },
    ]);
    assert.match(j.notes, /Memory-Spiel/);
    assert.ok(j.files.includes("index.html"));
  });
  it("empty stays empty", () => {
    assert.equal(isJournalEmpty(EMPTY_JOURNAL), true);
    assert.equal(journalPrompt(EMPTY_JOURNAL), "");
  });
  it("new task drops stale ask-goal", () => {
    const old = extractJournal([{ role: "user", content: "Antwort auf: Code läuft fehlerfrei. Was soll ich schreiben/ändern?\nWahl: A) Nichts" }]);
    const next = beginJournal("Build a mini gallery language-check as one job. Create index.html and main.py.", old);
    assert.match(next.goal, /language-check|gallery|index.html/i);
    assert.equal(/^Antwort auf:/i.test(next.goal), false);
  });
  it("writes a session file", () => {
    const text = sessionFileText({ ...EMPTY_JOURNAL, goal: "Spiel", files: ["index.html"], at: 1, turns: 2, decisions: [], corrections: [], open: [], notes: "" }, 9);
    assert.match(text, /Anvil Sitzung/);
    assert.match(text, /Spiel/);
    assert.match(text, /index.html/);
    const back = parseSessionFile(text);
    assert.equal(back.goal, "Spiel");
    assert.ok(back.files.includes("index.html"));
  });
  it("empty session file stays empty", () => {
    const back = parseSessionFile("# Anvil Sitzung\n\n(leer)\n\nNachrichten: 0\nStand: \n");
    assert.equal(isJournalEmpty(back), true);
  });
  it("updates the goal when the task clearly changes", () => {
    const j = extractJournal([
      { role: "user", content: "Schreibe main.py Fakultät" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "Jetzt ein Rust-CLI in src/main.rs" },
    ]);
    assert.match(j.goal, /Rust-CLI|main.rs/);
  });
});

describe("harvestPaths", () => {
  it("skips vendor and env", () => {
    const paths = harvestPaths("see node_modules/foo/index.js and .env and src/util.ts");
    assert.ok(paths.includes("src/util.ts"));
    assert.equal(paths.some((p) => p.includes("node_modules")), false);
  });
});

describe("packChatHistory", () => {
  it("replaces the last user and caps length", () => {
    const chat = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `m${i} ${"x".repeat(50)}`,
    }));
    const out = packChatHistory(chat, { content: "NEU" }, 24);
    assert.ok(out.length <= 24);
    assert.equal(out.at(-1)?.role, "user");
    assert.equal(out.at(-1)?.content, "NEU");
  });
  it("shortens older assistant text", () => {
    const chat = [
      { role: "user", content: "a" },
      { role: "assistant", content: "y".repeat(5000) },
      ...Array.from({ length: 16 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` })),
      { role: "user", content: "c" },
    ];
    const out = packChatHistory(chat, { content: "c!" }, 24);
    const firstAsst = out.find((m) => m.role === "assistant" && m.content.startsWith("y"));
    assert.ok(firstAsst);
    assert.ok(firstAsst.content.length <= 1800);
    assert.equal(out.at(-1)?.content, "c!");
  });
});

describe("persistChat", () => {
  it("drops empty assistant shells and keeps the tail", () => {
    const chat = [
      { role: "assistant", content: "", thinking: undefined, steps: undefined },
      ...Array.from({ length: 80 }, (_, i) => ({ role: "user" as const, content: `u${i}` })),
    ];
    const out = persistChat(chat);
    assert.ok(out.length <= 96);
    assert.equal(out.some((m) => m.role === "assistant" && !m.content), false);
    assert.equal(out.at(-1)?.content, "u79");
  });
});
