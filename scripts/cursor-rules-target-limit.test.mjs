import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

test("A new write target beyond the 64-path history is loaded before execution with an accurate skip reason", async (t) => {
  const root = path.resolve("artifacts/cursor-adoption-2026-10-19/review/rule-boundary");
  await fs.mkdir(root, { recursive: true });
  const cacheDir = await fs.mkdtemp(path.join(root, "vite-"));
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir,
    resolve: { alias: { "@": path.resolve("src") } },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
  });
  t.after(async () => {
    await server.close();
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const { runAgentLoop } = await server.ssrLoadModule("/src/lib/agent-core.ts");
  const { beginAgent } = await server.ssrLoadModule("/src/lib/agent-abort.ts");
  const { workspaceRules } = await server.ssrLoadModule("/src/lib/rules.ts");
  const files = {
    ...Object.fromEntries(
      Array.from({ length: 64 }, (_, i) => [`old/file-${i}.ts`, `// old ${i}`]),
    ),
    "special/AGENTS.md": "SCOPED_TARGET_GUIDANCE_65: Keep the target declaration concise.",
  };
  const prefer = Object.keys(files).filter((path) => path.startsWith("old/"));
  let rounds = 0,
    writes = 0;
  const selections = [];
  const write = () => ({
    tool_calls: [
      {
        id: crypto.randomUUID(),
        type: "function",
        function: {
          name: "write_file",
          arguments: JSON.stringify({
            path: "special/result.ts",
            content: "export const result = 1;",
          }),
        },
      },
    ],
  });
  beginAgent();
  const result = await runAgentLoop(
    {
      files: Object.entries(files).map(([path, content]) => ({ path, content })),
      prefer,
      messages: [
        {
          role: "user",
          content:
            "Create special/result.ts with one exported result constant. Preserve all existing source.",
        },
      ],
      context: 131072,
      compact: "off",
      autoRunAgent: false,
      maxRounds: 8,
      runLoop: false,
      graphLoop: false,
      testLoop: false,
    },
    async (messages) => {
      rounds++;
      if (rounds === 1) {
        assert.doesNotMatch(String(messages[0].content), /SCOPED_TARGET_GUIDANCE_65/);
        return write();
      }
      if (rounds === 2) {
        assert.equal(
          writes,
          0,
          "The unstarted write must wait for its previously unloaded scoped guidance",
        );
        assert.match(String(messages[0].content), /SCOPED_TARGET_GUIDANCE_65/);
        const skipped = messages.filter((message) => message.role === "tool").at(-1);
        const reason = JSON.parse(skipped.content).reason;
        assert.match(reason, /applicable project rules/i);
        assert.doesNotMatch(reason, /user correction/i);
        return write();
      }
      return {
        content:
          "The single declaration was created after reading its applicable project guidance. It was not executed.",
      };
    },
    {
      rulesForFiles: (paths, current) => {
        selections.push(paths);
        return workspaceRules(current, "", paths);
      },
      onWorkspace: (event) => {
        if (event.op === "write") writes++;
      },
    },
  );
  assert.equal(writes, 1);
  assert.ok(result.files.some((file) => file.path === "special/result.ts"));
  assert.ok(selections.every((paths) => paths.length <= 64));
  assert.ok(selections.some((paths) => paths[0] === "special/result.ts"));
});
