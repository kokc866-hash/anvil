import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import path from "node:path";

const flush = () => new Promise(resolve => setImmediate(resolve));
test("memory stays scoped, durable and controllable", async t => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  const m = await server.ssrLoadModule("/src/lib/learn.ts");
  const { EMPTY_JOURNAL, sessionFileText } = await server.ssrLoadModule("/src/lib/session.ts");
  const { useLearn } = m;
  const writes = [], deletes = [];
  const warn = console.warn;
  console.warn = (...args) => { if (!String(args[0]).startsWith("[zustand persist middleware]")) warn(...args); };
  useIde.setState({ writeFile: (p, text) => writes.push({ p, text }), deleteFile: p => deletes.push(p) });
  t.after(async () => { await flush(); await server.close(); console.warn = warn; });
  const reset = () => {
    useLearn.setState({ on: true, prefs: { ...m.LEARN_DEFAULTS }, facts: [], skills: [], negs: [], forgotten: [], forgottenFacts: [], activeSkills: [], events: [], eventCount: 0 });
    useIde.setState({ workspaceCwd: "C:/A", githubRepo: "", memoryWorkspace: "v2:path:c:/a", workspaceMemoryId: "fixture-local", workspaceSessions: {}, chat: [], sessionJournal: { ...EMPTY_JOURNAL }, sessionTokens: { prompt: 0, completion: 0 }, files: {}, dirty: {}, pendingDiffs: [] });
    writes.length = deletes.length = 0;
  };
  const open = async cwd => { useIde.getState().setWorkspaceCwd(cwd); useIde.getState().applyFiles({}); await flush(); };

  await t.test("switch and return restores each project's chat and journal", async () => {
    reset();
    useIde.setState({ chat: [{ id: "a", role: "user", content: "Nur Projekt A" }], sessionJournal: { ...EMPTY_JOURNAL, goal: "Ziel A" } });
    useIde.getState().setWorkspaceCwd("D:/B");
    useIde.getState().applyFiles({ ".anvil/session.md": sessionFileText({ ...EMPTY_JOURNAL, goal: "Ziel B" }) });
    await flush();
    assert.deepEqual(useIde.getState().chat, []);
    assert.equal(useIde.getState().sessionJournal.goal, "Ziel B");
    await open("C:/A");
    assert.equal(useIde.getState().chat[0].content, "Nur Projekt A");
    assert.equal(useIde.getState().sessionJournal.goal, "Ziel A");
    await open("D:/B");
    assert.equal(useIde.getState().sessionJournal.goal, "Ziel B");
  });
  await t.test("late file hydration never attaches another project's journal or skills", async () => {
    reset();
    useIde.getState().applyFiles({ ".anvil/session.md": sessionFileText({ ...EMPTY_JOURNAL, goal: "Altes Ziel" }), ".anvil/skills/old.md": "Alte Anweisung aus A." });
    useIde.getState().setWorkspaceCwd("D:/B"); useIde.getState().applyFiles({});
    await flush();
    assert.equal(useIde.getState().sessionJournal.goal, "");
    assert.deepEqual(useLearn.getState().skills, []);
  });
  await t.test("reload hydrates an empty journal and forgetting cancels queued file imports", async () => {
    reset();
    useIde.getState().applyFiles({ ".anvil/session.md": sessionFileText({ ...EMPTY_JOURNAL, goal: "Vom Datenträger" }) }, [], { keepDirty: true });
    assert.equal(useIde.getState().sessionJournal.goal, "Vom Datenträger");
    useIde.getState().applyFiles({ ".anvil/skills/old.md": "Alte Anweisung aus A." });
    useLearn.getState().clear();
    await flush();
    assert.deepEqual(useLearn.getState().skills, []);
  });
  await t.test("learning cadence continues after the log reaches its cap", () => {
    reset();
    useLearn.setState({ events: Array.from({ length: 200 }, () => ({ k: "run", d: "main.py", t: 1 })), eventCount: 203 });
    useLearn.getState().track("run", "main.py");
    assert.equal(useLearn.getState().events.length, 200);
    assert.ok(useLearn.getState().facts.some(f => /python/.test(f.text)));
  });
  await t.test("negative examples are project scoped and old mirrored facts are forgotten together", async () => {
    reset(); useLearn.getState().addNeg("index.html", "Kein automatischer Start");
    assert.match(m.learnPrompt(), /Kein automatischer Start/);
    await open("D:/B");
    assert.doesNotMatch(m.learnPrompt(), /Kein automatischer Start/);
    const neg = useLearn.getState().negs[0];
    useLearn.setState({ facts: [{ id: "mirror", text: `Nicht so (${neg.path}): ${neg.text}`, scope: "user", kind: "lesson", conf: 0.7, at: 1, hits: 1 }] });
    useLearn.getState().forgetNeg(neg.id);
    assert.deepEqual(useLearn.getState().facts, []);
    assert.deepEqual(useLearn.getState().negs, []);
  });
  await t.test("same skill name in two projects does not overwrite or execute across projects", async () => {
    reset();
    const a = useLearn.getState().writeSkill({ name: "build", when: "Python build", body: "Python aus Projekt A bauen.", scope: "project" });
    await open("D:/B");
    assert.ok((await m.agentLearn("run", { name: a.id })).error);
    assert.deepEqual(m.matchSkills("Blumen zeichnen"), []);
    const b = useLearn.getState().writeSkill({ name: "build", when: "Rust build", body: "Rust aus Projekt B bauen.", scope: "project" });
    assert.notEqual(a.id, b.id);
    assert.equal(useLearn.getState().skills.length, 2);
    assert.match((await m.agentLearn("run", { name: "build" })).body, /Projekt B/);
    useLearn.getState().forgetSkill(b.id);
    assert.deepEqual(useLearn.getState().skills.map(s => s.id), [a.id]);
    assert.ok(!deletes.includes(`.anvil/skills/${a.id}.md`));
  });
  await t.test("forgetting suppresses rediscovery and preserves more than 48 facts", () => {
    reset();
    const first = useLearn.getState().addFact("user", "Bevorzugt deutsche Antworten");
    for (let i = 0; i < 60; i++) useLearn.getState().addFact("user", `Erinnerung Nummer ${i}`);
    assert.ok(useLearn.getState().facts.some(f => f.id === first.id));
    useLearn.getState().forgetFact(first.id);
    useLearn.getState().addFact("user", first.text);
    assert.equal(useLearn.getState().facts.length, 60);
  });
  await t.test("prompt switches also apply to agent memory tools", async () => {
    reset(); useLearn.getState().addFact("user", "Private Vorliebe");
    useLearn.getState().writeSkill({ name: "test", when: "test", body: "Test-Anweisung ausführen" });
    useLearn.getState().setPref("person", false);
    assert.deepEqual((await m.agentLearn("list", {})).person, []);
    useLearn.getState().setPref("skillBodies", false);
    assert.ok((await m.agentLearn("run", { name: "test" })).error);
    useLearn.getState().setPref("inject", false);
    assert.equal(m.learnPrompt(), "");
    assert.ok((await m.agentLearn("list", {})).error);
    assert.deepEqual(await m.agentLearn("state", {}), { on: true, inject: false });
  });
  await t.test("legacy project facts stay intact but inactive until explicitly assigned", () => {
    reset(); const f = useLearn.getState().addFact("project", "Alte Projektregel");
    useLearn.setState({ facts: [{ ...f, ws: "apps/game" }] });
    assert.doesNotMatch(m.learnPrompt(), /Alte Projektregel/);
    useLearn.getState().assignLegacy(f.id);
    assert.match(m.learnPrompt(), /Alte Projektregel/);
  });
  await t.test("project skill files update their own body without touching other projects", async () => {
    reset();
    m.hydrateLearnFromFiles({ ".anvil/skills/build.md": "Erste ausführliche Anweisung" });
    m.hydrateLearnFromFiles({ ".anvil/skills/build.md": "Geänderte ausführliche Anweisung" });
    assert.equal(useLearn.getState().skills.length, 1);
    assert.match(useLearn.getState().skills[0].body, /Geänderte/);
    await open("D:/B");
    m.hydrateLearnFromFiles({ ".anvil/skills/build.md": "Projekt B ausführliche Anweisung" });
    assert.equal(useLearn.getState().skills.length, 2);
  });
  await t.test("journal writes go through one captured write and clear preserves session context", async () => {
    reset(); useIde.getState().setSessionJournal({ ...EMPTY_JOURNAL, goal: "Aktueller Auftrag" });
    assert.equal(writes.length, 1); assert.equal(writes[0].p, ".anvil/session.md");
    useLearn.getState().clear(); await flush();
    assert.equal(useIde.getState().sessionJournal.goal, "Aktueller Auftrag");
    assert.equal(writes.length, 1);
  });
});
