import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import path from "node:path";

// Load the real Zustand store, with its TS aliases, rather than duplicating setter logic.
test("provider switching and profiles keep endpoints, auth modes and explicit models isolated", async (t) => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  globalThis.window = Object.assign(new EventTarget(), {
    localStorage: globalThis.localStorage,
    setTimeout,
    clearTimeout,
  });
  globalThis.document = new EventTarget();
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    resolve: { alias: { "@": path.resolve("src") } },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await server.close();
    delete globalThis.localStorage;
    delete globalThis.window;
    delete globalThis.document;
  });
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  const initial = useIde.getState();
  useIde.setState({
    llmSlots: {},
    llmProfiles: [],
    llmProvider: "ollama",
    llmAuthMode: "key",
    llmBaseUrl: "http://192.168.1.20:11434/v1",
    llmModel: "qwen",
    llmApiKey: "",
  });
  const actions = useIde.getState();
  actions.setLlmProvider("lmstudio", "key");
  assert.equal(useIde.getState().llmBaseUrl, "http://127.0.0.1:1234/v1");
  actions.setLlmProvider("llamacpp", "key");
  assert.equal(useIde.getState().llmBaseUrl, "http://127.0.0.1:8080/v1");
  actions.setLlmProvider("ollama", "key");
  assert.equal(useIde.getState().llmBaseUrl, "http://192.168.1.20:11434/v1");

  actions.setLlmProvider("anthropic", "key");
  actions.setLlmApiKey("api-test");
  actions.setLlmModel("claude-sonnet-4-5");
  actions.saveLlmProfile("API");
  const apiProfile = useIde.getState().llmProfiles[0];
  actions.setLlmProvider("anthropic", "abo");
  actions.setLlmModel("claude-opus-5");
  actions.saveLlmProfile("CLI");
  const cliProfile = useIde.getState().llmProfiles[1];
  actions.applyLlmProfile(apiProfile.id);
  assert.equal(useIde.getState().llmAuthMode, "key");
  assert.equal(useIde.getState().llmModel, "claude-sonnet-4-5");
  actions.applyLlmProfile(cliProfile.id);
  assert.equal(useIde.getState().llmAuthMode, "abo");
  actions.setLlmProvider("anthropic", "key");
  assert.equal(useIde.getState().llmModel, "claude-sonnet-4-5");
  assert.equal(useIde.getState().llmApiKey, "api-test");
  actions.setLlmProvider("custom", "key");
  assert.equal(useIde.getState().llmApiKey, "");
  actions.setLlmBaseUrl("https://private.example/inference");
  actions.setLlmModel("my-model");
  actions.setLlmContext(8192);
  actions.setLlmContextAuto(false);
  actions.setLlmProvider("ollama", "key");
  actions.setLlmProvider("custom", "key");
  assert.equal(useIde.getState().llmBaseUrl, "https://private.example/inference");
  assert.equal(useIde.getState().llmContext, 8192);

  const merge = useIde.persist.getOptions().merge;
  const migrated = merge(
    {
      llmProvider: "github",
      llmAuthMode: "key",
      llmBaseUrl: "https://api.githubcopilot.com",
      llmModel: "gpt-4.1",
      llmProfiles: [{ ...apiProfile, authMode: undefined }],
    },
    initial,
  );
  assert.equal(migrated.llmBaseUrl, "");
  assert.equal(migrated.llmAuthMode, "abo");
  assert.equal(migrated.llmModel, "gpt-4.1");
  assert.equal(migrated.llmProfiles[0].authMode, "key");
});
