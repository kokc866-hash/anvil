import test from "node:test";
import assert from "node:assert/strict";
import { interactionSnapshot, parseInteractionScenarios, validateInteractionScenario, interactionResultCurrent } from "../src/lib/interaction-checks.ts";
const scenario = { id: "one", name: "Speichern", entry: "index.html", steps: [{ action: "fill", selector: "#task", value: "Küche" }, { action: "click", selector: "button" }, { action: "reload" }, { action: "text", selector: "li", value: "Küche" }] };
test("persisted scenario preserves action sequence and expectation", () => {
  assert.deepEqual(parseInteractionScenarios(JSON.stringify({ version: 1, scenarios: [scenario] })), [scenario]);
  assert.throws(() => parseInteractionScenarios('{"version":2,"scenarios":[]}'), /Version/);
  assert.throws(() => parseInteractionScenarios(JSON.stringify({ version: 1, scenarios: [scenario, scenario] })), /Kennung/);
});
test("a click alone never counts as a functional test; invalid entries/counts rejected", () => {
  assert.throws(() => validateInteractionScenario({ ...scenario, steps: [{ action: "click", selector: "button" }] }), /Erwartung/);
  assert.throws(() => validateInteractionScenario({ ...scenario, entry: "../index.html" }), /HTML/);
  assert.throws(() => validateInteractionScenario({ ...scenario, steps: [{ action: "count", selector: "li", value: "-1" }] }), /Anzahl/);
});
test("results are scoped to both app source and scenario; metadata does not invalidate itself", () => {
  const files = { "index.html": "<h1>Hi</h1>", ".anvil/interaction-results.json": "old", ".anvil/session.md": "memo" };
  assert.deepEqual(interactionSnapshot(files), { "index.html": "<h1>Hi</h1>" });
  const result = { revision: "source-one", scenarioRevision: "test-one" };
  assert.equal(interactionResultCurrent(result, "source-one", "test-one"), true);
  assert.equal(interactionResultCurrent(result, "source-two", "test-one"), false);
  assert.equal(interactionResultCurrent(result, "source-one", "test-two"), false);
});
