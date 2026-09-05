import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchModels, normalizeBaseUrl } from "./connection.ts";
import { cliKindFor, cliPrompt, parseCliChoice } from "./cli-protocol.ts";

test("explicit Custom prefixes and full completion URLs are normalized consistently", () => {
  assert.equal(normalizeBaseUrl("http://localhost:1234"), "http://localhost:1234/v1");
  assert.equal(
    normalizeBaseUrl("https://gateway.example/inference"),
    "https://gateway.example/inference",
  );
  assert.equal(
    normalizeBaseUrl("https://gateway.example/api/v2/chat/completions"),
    "https://gateway.example/api/v2",
  );
  assert.throws(() => normalizeBaseUrl("https://user:pass@api.example/v1"));
  assert.throws(() => normalizeBaseUrl("https://api.example/v1?key=secret"));
});
test("model catalog never turns HTTP, HTML, network failures into success", async () => {
  const opts = { provider: "openai", baseUrl: "", apiKey: "test" };
  await assert.rejects(
    fetchModels(opts, async () => new Response('{"error":"invalid key"}', { status: 401 })),
    /401/,
  );
  await assert.rejects(
    fetchModels(opts, async () => new Response("<html>Login</html>")),
    /JSON/,
  );
  await assert.rejects(
    fetchModels(opts, async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  await assert.rejects(
    fetchModels(opts, async () => Response.json({ message: "ok" })),
    /Modellliste/,
  );
  assert.deepEqual((await fetchModels(opts, async () => Response.json({ data: [] }))).ids, []);
});
test("Anthropic and Azure probes really send their required headers", async () => {
  const seen: { url: string; headers: Headers }[] = [];
  const send = async (url: string, init: RequestInit) => {
    seen.push({ url, headers: new Headers(init.headers) });
    return Response.json({ data: [{ id: "model" }] });
  };
  await fetchModels({ provider: "anthropic", baseUrl: "", apiKey: "test" }, send);
  await fetchModels(
    { provider: "azure", baseUrl: "https://resource.openai.azure.com", apiKey: "azure" },
    send,
  );
  assert.equal(seen[0].headers.get("anthropic-version"), "2023-06-01");
  assert.equal(seen[0].headers.get("x-api-key"), "test");
  assert.equal(seen[1].headers.get("api-key"), "azure");
  assert.match(seen[1].url, /\/openai\/models\?api-version=/);
});
test("Abo routes to CLI regardless of any API key; unsupported providers use API", () => {
  assert.equal(cliKindFor("codex", "key"), "codex");
  assert.equal(cliKindFor("anthropic", "abo"), "claude");
  assert.equal(cliKindFor("github", "abo"), "copilot");
  assert.equal(cliKindFor("anthropic", "key"), null);
  assert.equal(cliKindFor("huggingface", "abo"), null);
});
test("CLI tool requests return to Anvil; unadvertised tools and malformed output are rejected", () => {
  const raw = JSON.stringify({
    content: "",
    tool_calls: [{ name: "read_file", arguments: '{"path":"src/main.ts"}' }],
  });
  const choice = parseCliChoice(raw, ["read_file"]);
  assert.equal(choice.tool_calls?.[0].function.name, "read_file");
  assert.deepEqual(JSON.parse(choice.tool_calls![0].function.arguments), { path: "src/main.ts" });
  assert.throws(() => parseCliChoice(raw, []), /unbekannt/);
  assert.throws(() => parseCliChoice("not JSON", []), /Antwortformat/);
  assert.throws(() => parseCliChoice('{"content":"","tool_calls":[]}', []), /Leere/);
  assert.match(cliPrompt([{ role: "tool", content: "file result" }], []), /file result/);
});
