// Real Chromium execution without the user's Anvil profile, workspace or Run.
import { app, BrowserWindow, session } from "electron";
import { runInteractionCheck } from "../electron/interaction-checks.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";

mkdirSync(process.env.ANVIL_INTERACTION_QA_PROFILE, { recursive: true });
app.setPath("userData", process.env.ANVIL_INTERACTION_QA_PROFILE);
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
const html = `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Test</h1><input id="task"><button id="add">Hinzufügen</button><ul id="tasks"></ul><script src="app.js"></script></body></html>`;
const js = `const tasks = JSON.parse(localStorage.getItem('tasks') || '[]'); const draw = () => document.getElementById('tasks').replaceChildren(...tasks.map(t => Object.assign(document.createElement('li'), {textContent:t}))); draw(); document.getElementById('add').onclick = () => { tasks.push(document.getElementById('task').value); localStorage.setItem('tasks', JSON.stringify(tasks)); draw(); };`;
const scenario = { id: "qa", name: "Aufgabe bleibt", entry: "index.html", steps: [{ action: "count", selector: "li", value: "0" }, { action: "fill", selector: "#task", value: "Küche & Büro" }, { action: "value", selector: "#task", value: "Küche & Büro" }, { action: "click", selector: "#add" }, { action: "count", selector: "li", value: "1" }, { action: "reload" }, { action: "visible", selector: "li" }, { action: "text", selector: "li", value: "Küche & Büro" }] };
let count = 0;
const outcomes = [];
const payload = (files = {}, steps = scenario.steps) => ({ id: `qa-${++count}`, scenario: { ...scenario, steps }, files: { "index.html": html, "app.js": js, "style.css": "body{font:16px system-ui}input,button{padding:10px}", ...files }, revision: "a".repeat(64), scenarioRevision: "b".repeat(64) });
async function check(name, data, options, expected) {
  const result = await runInteractionCheck({ BrowserWindow, session }, data, { stepTimeoutMs: 500, ...options });
  outcomes.push({ name, ...result });
  assert.equal(result.status, expected, `${name}: ${JSON.stringify(result)}`);
  return result;
}
try {
  await check("real fill click reload persistence", payload(), {}, "passed");
  await check("second run starts empty", payload(), {}, "passed");
  await check("real defect fails same scenario", payload({ "app.js": js.replace("localStorage.setItem('tasks', JSON.stringify(tasks));", "") }), {}, "failed");
  await check("same scenario passes after fix", payload(), {}, "passed");
  await check("wrong text fails", payload({}, [{ action: "text", selector: "h1", value: "Wrong" }]), {}, "failed");
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  await check("cancellation is open", payload({}, [{ action: "visible", selector: "#never" }]), { signal: controller.signal, stepTimeoutMs: 3000 }, "open");
  await check("runtime errors fail", payload({ "app.js": "throw new Error('Regression')" }, [{ action: "visible", selector: "h1" }]), {}, "failed");
  await check("external resources cannot become success", payload({ "index.html": html.replace("</head>", '<script src="http://127.0.0.1:9999/foreign.js"></script></head>') }), {}, "open");
  await assert.rejects(() => runInteractionCheck({ BrowserWindow, session }, payload({ "../escape.html": "no" })), /Projektdatei/);
  await writeFile(process.env.ANVIL_INTERACTION_QA_RESULT, JSON.stringify({ ok: true, outcomes }, null, 2));
  app.exit(0);
} catch (error) {
  await writeFile(process.env.ANVIL_INTERACTION_QA_RESULT, JSON.stringify({ ok: false, error: error.stack, outcomes }, null, 2));
  app.exit(1);
}
});
