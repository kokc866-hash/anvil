import assert from "node:assert/strict";
import { test } from "node:test";
import { forgetMcpOutputs, modelMcpResult, readMcpOutput } from "./mcp-results.ts";

test("oversized MCP previews show the first and final diagnostics within the preview limit", (t) => {
  const server = "preview-diagnostics";
  t.after(() => forgetMcpOutputs(server));
  const raw = {
    content: [{ type: "text", text: `BUILD START\n${"progress\n".repeat(5000)}FATAL: missing build artifact` }],
    isError: true,
  };
  const result = modelMcpResult(server, raw);
  const preview = String(result.text);
  assert.equal(result.truncated, true);
  assert.equal(result.isError, true);
  assert.ok(preview.includes("BUILD START"));
  assert.ok(preview.includes("FATAL: missing build artifact"), "the final diagnostic must remain visible");
  assert.match(preview, /omitted|omission|ausgelassen|gekürzt|entfernt/i);
  assert.ok(preview.length <= 12000);
  assert.equal(result.totalCharacters, JSON.stringify(raw).length);
});

test("MCP preview paging reconstructs the complete original envelope and requires every authorized server", (t) => {
  const servers = ["preview-paging-a", "preview-paging-b"];
  t.after(() => servers.forEach(forgetMcpOutputs));
  const raw = {
    content: [{ type: "text", text: `HEAD\n${"🧰 intermediate output\n".repeat(1800)}TAIL` }],
    structuredContent: { answer: 42, cursor: "original-cursor", status: "pending" },
    isError: false,
  };
  const result = modelMcpResult(servers, raw);
  const id = String(result.outputId);
  assert.equal(result.retained, true);
  assert.throws(() => readMcpOutput(id, [servers[0]]), /nicht mehr verfügbar/);
  let complete = "";
  let offset: number | null = 0;
  while (offset !== null) {
    const page = readMcpOutput(id, servers, offset, 997);
    complete += page.text;
    offset = page.nextOffset;
  }
  assert.equal(complete, JSON.stringify(raw));
  assert.deepEqual(JSON.parse(complete), raw);
  forgetMcpOutputs(servers[1]);
  assert.throws(() => readMcpOutput(id, servers), /nicht mehr verfügbar/);
});

test("oversized MCP results keep actual pending and exit metadata", (t) => {
  const server = "preview-pending";
  t.after(() => forgetMcpOutputs(server));
  const raw = {
    text: "queued output\n".repeat(3000),
    ok: true,
    pending: true,
    running: true,
    queued: true,
    status: "pending",
    code: null,
    exitCode: null,
    exit_code: null,
    isError: false,
  };
  const result = modelMcpResult(server, raw);
  assert.equal(result.ok, true);
  assert.equal(result.pending, true);
  assert.equal(result.running, true);
  assert.equal(result.queued, true);
  assert.equal(result.status, "pending");
  assert.equal(result.code, null);
  assert.equal(result.exitCode, null);
  assert.equal(result.exit_code, null);
  assert.equal(result.isError, false);
});

test("oversized MCP results retain explicit failure and cancellation metadata", (t) => {
  const server = "preview-failure";
  t.after(() => forgetMcpOutputs(server));
  const raw = {
    text: "failure details\n".repeat(3000),
    ok: false,
    success: false,
    error: { code: "E_BUILD", message: "The compiler failed" },
    status: "failed",
    code: 2,
    exitCode: 2,
    exit_code: 2,
    expectedExitCode: 0,
    exitExpectationMatched: false,
    signal: "SIGTERM",
    aborted: true,
    timedOut: true,
    interrupted: true,
    cancelled: true,
    canceled: true,
    isError: true,
  };
  const result = modelMcpResult(server, raw);
  assert.equal(result.ok, false);
  assert.equal(result.success, false);
  assert.deepEqual(result.error, raw.error);
  assert.equal(result.status, "failed");
  assert.equal(result.code, 2);
  assert.equal(result.exitCode, 2);
  assert.equal(result.exit_code, 2);
  assert.equal(result.expectedExitCode, 0);
  assert.equal(result.exitExpectationMatched, false);
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.aborted, true);
  assert.equal(result.timedOut, true);
  assert.equal(result.interrupted, true);
  assert.equal(result.cancelled, true);
  assert.equal(result.canceled, true);
  assert.equal(result.isError, true);
});

test("ordinary MCP envelopes do not gain a success or completion claim when previewed", (t) => {
  const server = "preview-unknown-state";
  t.after(() => forgetMcpOutputs(server));
  const result = modelMcpResult(server, {
    content: [{ type: "text", text: "result data\n".repeat(3000) }],
  });
  for (const field of ["ok", "success", "pending", "running", "status", "code", "exitCode"])
    assert.equal(Object.hasOwn(result, field), false, field);
});

test("MCP previews keep Unicode pairs intact at both omission boundaries", (t) => {
  const server = "preview-unicode";
  t.after(() => forgetMcpOutputs(server));
  for (let prefix = 0; prefix < 4; prefix++) {
    const result = modelMcpResult(server, {
      text: `${" ".repeat(prefix)}HEAD ${"🧰".repeat(16000)} TAIL`,
    });
    const preview = String(result.text);
    assert.ok(preview.includes("HEAD"));
    assert.ok(preview.includes("TAIL"));
    assert.ok(preview.length <= 12000);
    assert.doesNotMatch(preview, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  }
});

test("MCP preview image omission retains image counts and original structured content", (t) => {
  const server = "preview-images";
  t.after(() => forgetMcpOutputs(server));
  const images = ["data:image/png;base64,AAAA", "data:image/png;base64,BBBB"];
  const raw = {
    text: "large image tool output\n".repeat(2000),
    content: [
      { type: "image", mimeType: "image/png", data: "AAAA" },
      { type: "image", mimeType: "image/png", data: "BBBB" },
    ],
    structuredContent: { asset: "output.png", width: 512, height: 512 },
    image: images[0],
    images,
    isError: false,
  };
  const result = modelMcpResult(server, raw, { images: false });
  assert.deepEqual(result.mcpImages, []);
  assert.equal(result.imageCount, 2);
  assert.equal(result.isError, false);
  assert.ok(!String(result.text).includes("data:image/png;base64,"));
  let complete = "";
  let offset: number | null = 0;
  while (offset !== null) {
    const page = readMcpOutput(String(result.outputId), [server], offset);
    complete += page.text;
    offset = page.nextOffset;
  }
  assert.equal(complete, JSON.stringify(raw));
  assert.deepEqual(JSON.parse(complete).structuredContent, raw.structuredContent);
  const visible = modelMcpResult(server, raw);
  assert.deepEqual(visible.mcpImages, images);
});

test("oversized MCP textual status fields remain bounded and retain their closing diagnostic", (t) => {
  const server = "preview-bounded-status";
  t.after(() => forgetMcpOutputs(server));
  const result = modelMcpResult(server, {
    text: "output\n".repeat(5000),
    error: `ERROR HEAD ${"details ".repeat(5000)} ERROR TAIL`,
    status: "failed",
    isError: true,
  });
  const error = String(result.error);
  assert.ok(error.includes("ERROR HEAD"));
  assert.ok(error.includes("ERROR TAIL"));
  assert.ok(error.length <= 2000);
  assert.ok(String(result.text).length <= 12000);
  assert.equal(result.status, "failed");
  assert.equal(result.isError, true);
});
