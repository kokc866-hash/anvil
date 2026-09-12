import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createGithubReadPackage,
  assertMcpPackageRequest,
  mcpPackageTools,
  assertMcpPackageProbeResult,
} from "./mcp-packages.ts";

test("GitHub package is inert when added and grants only fixed reads", () => {
  const s = createGithubReadPackage();
  assert.equal(s.enabled, false);
  assert.equal(s.transport, "http");
  assert.equal(s.command, undefined);
  assert.match(s.url, /\/repos\/readonly$/);
  assert.doesNotThrow(() =>
    assertMcpPackageRequest(s, "tools/call", { name: "get_file_contents" }),
  );
  for (const name of ["create_repository", "delete_file", "new_read_tool"])
    assert.throws(() => assertMcpPackageRequest(s, "tools/call", { name }), /nicht freigegeben/);
  assert.throws(() => assertMcpPackageRequest(s, "resources/read", {}), /nicht freigegeben/);
  assert.deepEqual(
    mcpPackageTools(s, [
      { name: "get_file_contents" },
      { name: "delete_file" },
      { name: "new_read_tool" },
    ]),
    [{ name: "get_file_contents" }],
  );
});

test("changed and unknown package versions fail closed; custom MCPs keep their contract", () => {
  const s = createGithubReadPackage();
  for (const changed of [
    { ...s, url: "https://api.githubcopilot.com/mcp/" },
    { ...s, url: s.url + "?toolsets=all" },
    { ...s, transport: "stdio" as const },
    { ...s, auth: "oauth" as const },
    { ...s, id: "anvil-pack:github-repos-readonly:v2" },
  ])
    assert.throws(() => assertMcpPackageRequest(changed, "initialize", {}));
  const custom = { ...s, id: "my-existing-custom-mcp" };
  assert.doesNotThrow(() =>
    assertMcpPackageRequest(custom, "tools/call", { name: "my_write_tool" }),
  );
  assert.deepEqual(mcpPackageTools(custom, [{ name: "my_write_tool" }]), [
    { name: "my_write_tool" },
  ]);
});

test("catalogue, empty response and tool errors are not successful file probes", () => {
  for (const raw of [
    null,
    {},
    { text: "" },
    { structuredContent: {} },
    { structuredContent: [] },
    { isError: true, text: "Access denied" },
  ])
    assert.throws(() => assertMcpPackageProbeResult(raw));
  assert.doesNotThrow(() =>
    assertMcpPackageProbeResult({ text: "# GitHub MCP Server", isError: false }),
  );
  assert.doesNotThrow(() =>
    assertMcpPackageProbeResult({
      content: [{ type: "resource", resource: { text: "# README" } }],
    }),
  );
});
