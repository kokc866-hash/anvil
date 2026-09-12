import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionCapabilities, imageAttachmentError, connectionProbeSummary, historyForConnection } from "./connection-capabilities.ts";
import { FIRST_SUCCESS_HTML, firstSuccessPath, firstSuccessPrompt } from "./first-success.ts";
import { thinkingModes } from "../../electron/thinking-support.mjs";
import vm from "node:vm";

test("Anvil CLI capability matches its text-only, final-answer adapter and existing thinking contract", () => {
  for (const [provider, model, cli] of [["codex", "gpt-5.6-terra", "codex"], ["anthropic", "claude-fable-5", "claude"], ["github", "gpt-5.6-terra", "copilot"]]) {
    const config = { provider, model, authMode: "abo" as const, baseUrl: "http://localhost" };
    const cap = connectionCapabilities(config);
    assert.equal(cap.images, "unsupported");
    assert.equal(cap.response, "final");
    assert.equal(cap.location, "cloud");
    assert.equal(cap.auth, "cli-login");
    assert.deepEqual(cap.thinking, thinkingModes(provider, model, cli));
    assert.ok(imageAttachmentError(config, 1));
    assert.equal(imageAttachmentError(config, 0), "");
  }
});

test("local provider name never promises local processing for a remote URL", () => {
  const config = { provider: "ollama", model: "unknown", authMode: "key" as const, baseUrl: "http://127.0.0.1:11434/v1" };
  assert.equal(connectionCapabilities(config).location, "device");
  assert.equal(connectionCapabilities({ ...config, baseUrl: "http://192.168.1.20:11434/v1" }).location, "network");
  assert.equal(connectionCapabilities({ ...config, baseUrl: "https://remote.example/v1" }).location, "server");
  assert.equal(connectionCapabilities({ ...config, baseUrl: "http://[::1]:11434/v1" }).location, "device");
  assert.equal(connectionCapabilities(config).images, "model-dependent");
  assert.equal(imageAttachmentError(config, 1), "");
});

test("API connections retain image transport and model-specific thinking", () => {
  const config = { provider: "anthropic", model: "claude-fable-5", authMode: "key" as const, baseUrl: "https://api.anthropic.com" };
  const cap = connectionCapabilities(config);
  assert.equal(cap.cli, null);
  assert.equal(cap.images, "model-dependent");
  assert.equal(cap.response, "stream");
  assert.deepEqual(cap.thinking, thinkingModes(config.provider, config.model));
});

test("probe results distinguish reachability and authentication from actual model/tool verification", () => {
  assert.match(connectionProbeSummary("catalog", { count: 3 }), /Modellantwort und Werkzeuge sind noch nicht geprüft/);
  assert.match(connectionProbeSummary("cli", { installed: true, authenticated: null }), /Anmeldung nicht bestätigt/);
  assert.match(connectionProbeSummary("cli", { installed: false }), /nicht installiert/);
  assert.match(connectionProbeSummary("cli", { installed: true, authenticated: true }), /Modellantwort und Werkzeuge sind noch nicht geprüft/);
});

test("switching an existing image conversation to CLI preserves saved images but adapts outgoing history", () => {
  const history = [{ role: "user", content: "Look here", images: ["data:image/png;base64,AAAA"] }, { role: "assistant", content: "Earlier answer" }];
  const before = JSON.stringify(history);
  const cli = { provider: "codex", authMode: "abo" as const, baseUrl: "", model: "gpt-5.6-terra" };
  const wire = historyForConnection(history, cli);
  assert.equal(wire[0].images, undefined);
  assert.match(wire[0].content, /not transmitted/);
  assert.equal(JSON.stringify(history), before);
  assert.equal(wire[1], history[1]);
  assert.equal(historyForConnection(history, { ...cli, provider: "openai", authMode: "key" }), history);
});

test("first result is additive, preserves empty files and runs without network resources", () => {
  const files = { "anvil-erster-test.html": "", "index.html": "user work", "anvil-erster-test-2.html": "keep" };
  const before = { ...files };
  assert.equal(firstSuccessPath(files, ["anvil-erster-test-1.html"]), "anvil-erster-test-3.html");
  assert.equal(firstSuccessPath({ "ANVIL-ERSTER-TEST.HTML": "keep" }), "anvil-erster-test-1.html");
  assert.deepEqual(files, before);
  assert.doesNotMatch(FIRST_SUCCESS_HTML, /(?:src|href)=["']https?:|fetch\(|import\(/);
  const output = { textContent: "0" };
  let click: (() => void) | undefined;
  const document = { querySelector: (selector: string) => selector === "#count" ? output : { addEventListener: (_event: string, fn: () => void) => { click = fn; } } };
  vm.runInNewContext(FIRST_SUCCESS_HTML.match(/<script>([\s\S]+?)<\/script>/)![1], { document });
  assert.ok(click);
  click(); click();
  assert.equal(output.textContent, "2");
  assert.match(firstSuccessPrompt("anvil-erster-test-3.html"), /anvil-erster-test-3\.html/);
  assert.match(firstSuccessPrompt("test.html"), /tatsächlich geprüft/);
});
