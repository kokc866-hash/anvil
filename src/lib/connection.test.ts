import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchModels, normalizeBaseUrl } from "./connection.ts";
import { PROVIDERS } from "./providers.ts";

test("Qwen loads the native workspace catalog completely, using model IDs rather than display names", async () => {
  const requests: { url: URL; headers: Headers }[] = [];
  const result = await fetchModels({ provider: "qwen", baseUrl: "https://qa-workspace.eu-central-1.maas.aliyuncs.com/compatible-mode/v1", apiKey: "fixture" }, async (url, init) => {
    requests.push({ url: new URL(url), headers: new Headers(init.headers) });
    const page = requests.length;
    return Response.json({ success: true, output: { total: 2, page_no: page, page_size: 1, models: [{ model: page === 1 ? "qwen-current" : "future-unknown-id", name: "Display label", model_info: { context_window: 131072 } }] } });
  });
  assert.deepEqual(result.ids, ["qwen-current", "future-unknown-id"]);
  assert.equal(result.rows[1].id, "future-unknown-id");
  assert.equal(requests[0].url.pathname, "/api/v1/models");
  assert.equal(requests[1].url.searchParams.get("page_no"), "2");
  assert.equal(requests[1].url.origin, requests[0].url.origin);
  assert.equal(requests[0].headers.get("authorization"), "Bearer fixture");
});

test("Qwen Coding Plan queries its configured compatible catalog without crossing to pay-as-you-go", async () => {
  let target = "";
  const result = await fetchModels({ provider: "qwen", baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1", apiKey: "fixture" }, async url => {
    target = url;
    return Response.json({ data: [{ id: "a-model-reported-by-this-plan" }] });
  });
  assert.equal(target, "https://coding-intl.dashscope.aliyuncs.com/v1/models");
  assert.deepEqual(result.ids, ["a-model-reported-by-this-plan"]);
  await assert.rejects(fetchModels({ provider: "qwen", baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1", apiKey: "fixture" }, async () => new Response("Not Found", { status: 404 })), /404/);
});

test("Qwen reports rejected or incomplete native catalogs as errors, never partial success", async () => {
  const opts = { provider: "qwen", baseUrl: "https://qa-workspace.eu-central-1.maas.aliyuncs.com/compatible-mode/v1", apiKey: "fixture" };
  await assert.rejects(fetchModels(opts, async () => Response.json({ success: false, code: "InvalidApiKey", message: "rejected" })), /InvalidApiKey|rejected/);
  for (const output of [
    { total: 2, page_no: 1, page_size: 1, models: [] },
    { total: 2, page_no: 2, page_size: 1, models: [{ model: "a" }] },
    { total: 2, page_no: 1, page_size: 1, models: [{ model: "a" }] },
  ]) await assert.rejects(fetchModels(opts, async () => Response.json({ success: true, output })), /Modellliste|Folgeseite/);
});

test("Together's top-level array is a model list, including previously unknown IDs", async () => {
  const result = await fetchModels({ provider: "together", baseUrl: "", apiKey: "fixture" }, async () =>
    Response.json([{ id: "vendor/future-model", context_length: 131072 }]));
  assert.deepEqual(result.ids, ["vendor/future-model"]);
  assert.equal(result.rows[0].context_length, 131072);
});

test("Anthropic catalog follows all pages and preserves exact model IDs and metadata", async () => {
  const requests: URL[] = [];
  const result = await fetchModels({ provider: "anthropic", baseUrl: "", apiKey: "fixture" }, async (url) => {
    requests.push(new URL(url));
    return requests.length === 1
      ? Response.json({ data: [{ id: "claude-old" }], has_more: true, last_id: "claude-old" })
      : Response.json({ data: [{ id: "claude-future", max_input_tokens: 131072 }], has_more: false });
  });
  assert.deepEqual(result.ids, ["claude-old", "claude-future"]);
  assert.equal(requests[1].searchParams.get("after_id"), "claude-old");
  assert.equal(requests[0].origin, requests[1].origin);
  assert.equal(result.rows[1].max_input_tokens, 131072);
});

test("Google-style page tokens are encoded, deduplicated, and retained on the configured endpoint", async () => {
  const requests: URL[] = [];
  const result = await fetchModels({ provider: "google", baseUrl: "", apiKey: "fixture" }, async (url) => {
    requests.push(new URL(url));
    return requests.length === 1
      ? Response.json({ models: [{ name: "models/gemini-current" }], nextPageToken: "opaque /+&?=cursor" })
      : Response.json({ models: [{ name: "models/gemini-current" }, { name: "models/gemini-future" }] });
  });
  assert.deepEqual(result.ids, ["gemini-current", "gemini-future"]);
  assert.equal(requests[1].searchParams.get("pageToken"), "opaque /+&?=cursor");
  assert.equal(requests[1].pathname, "/v1beta/openai/models");
});

test("Cohere lists chat models through its models API and follows its page_token", async () => {
  const requests: URL[] = [];
  const result = await fetchModels({ provider: "cohere", baseUrl: "", apiKey: "fixture" }, async (url) => {
    requests.push(new URL(url));
    return requests.length === 1
      ? Response.json({ models: [{ name: "command-current" }], next_page_token: "next" })
      : Response.json({ models: [{ name: "command-future" }] });
  });
  assert.deepEqual(result.ids, ["command-current", "command-future"]);
  assert.equal(requests[0].pathname, "/v1/models");
  assert.equal(requests[0].searchParams.get("endpoint"), "chat");
  assert.equal(requests[1].searchParams.get("page_token"), "next");
});

test("unfinished catalogs fail explicitly on repeated cursors, missing cursors, page errors, or cancellation", async () => {
  const opts = { provider: "anthropic", baseUrl: "", apiKey: "fixture" };
  await assert.rejects(fetchModels(opts, async () => Response.json({ data: [{ id: "a" }], has_more: true, last_id: "a" })), /Seite|Modellliste/);
  await assert.rejects(fetchModels(opts, async () => Response.json({ data: [], has_more: true })), /Seite|Modellliste/);
  let calls = 0;
  await assert.rejects(fetchModels(opts, async () => ++calls === 1
    ? Response.json({ data: [{ id: "a" }], has_more: true, last_id: "a" })
    : new Response("unavailable", { status: 503 })), /503/);
  const controller = new AbortController();
  calls = 0;
  await assert.rejects(fetchModels({ ...opts, signal: controller.signal }, async () => {
    calls++;
    controller.abort();
    return Response.json({ data: [{ id: "a" }], has_more: true, last_id: "a" });
  }), /abort/i);
  assert.equal(calls, 1);
});

test("all API providers retain new live IDs instead of filtering through built-in suggestions", async () => {
  for (const spec of PROVIDERS.filter(p => p.kind !== "builtin" && p.id !== "codex" && p.id !== "github")) {
    const result = await fetchModels({ provider: spec.id, baseUrl: spec.baseUrl || "https://resource.example", apiKey: "fixture" }, async () =>
      Response.json({ data: [{ id: "future-model-not-in-any-catalog" }] }));
    assert.deepEqual(result.ids, ["future-model-not-in-any-catalog"], spec.id);
  }
});
import { cliKindFor, cliPrompt, cliRequest, parseCliChoice } from "./cli-protocol.ts";

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

test("CLI keeps user/MCP images and text with ordered references", () => {
  const image = { type: "image_url", image_url: { url: "data:image/png;base64,dGVzdA==" } };
  assert.deepEqual(cliRequest([{ role: "user", content: [{ type: "text", text: "Describe my image" }, image] }], []).images, [image.image_url.url]);
  const original = [{ role: "user", mcpResult: true, content: [{ type: "text", text: "Structured result: 42" }, image] }];
  const copy = JSON.stringify(original);
  const { prompt, images } = cliRequest(original, []);
  assert.match(prompt, /Structured result: 42/);
  assert.match(prompt, /Attached image 1/);
  assert.deepEqual(images, [image.image_url.url]);
  assert.doesNotMatch(prompt, /data:image/);
  assert.equal(JSON.stringify(original), copy);
});

test("CLI image mapping deduplicates repeated images and rejects URLs without fetching", () => {
  const a = "data:image/png;base64,YQ==", b = "data:image/jpeg;base64,Yg==";
  const part = (url: string) => ({ type: "image_url", image_url: { url } });
  const request = cliRequest([{role:"user",content:[part(a),part(b),part(a)]}], []);
  assert.deepEqual(request.images, [a,b]);
  assert.equal((request.prompt.match(/Attached image 1/g)||[]).length,2);
  assert.throws(()=>cliRequest([{role:"user",content:[part("https://private.example/image.png")]}], []),/Externe Bildadressen/);
});
