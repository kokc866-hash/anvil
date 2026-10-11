import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createServer } from "vite";
import { fileBytes } from "../../scripts/file-content.mjs";

// A browser File System Access handle, with byte storage and real DOM failures.
// No user folders, services or application profile are opened by this fixture.
class MemoryFile {
  kind = "file" as const;
  name: string;
  bytes: Uint8Array;
  reportedSize?: number;
  reads = 0;
  constructor(name: string, bytes: Uint8Array = new Uint8Array()) { this.name = name; this.bytes = bytes; }
  async getFile() {
    return {
      size: this.reportedSize ?? this.bytes.length, type: "application/octet-stream",
      arrayBuffer: async () => { this.reads++; return Uint8Array.from(this.bytes).buffer; },
      text: async () => { this.reads++; return new TextDecoder().decode(this.bytes); },
    };
  }
  async createWritable() {
    let staged = this.bytes;
    return {
      write: async (value: ArrayBuffer) => { staged = new Uint8Array(value).slice(); },
      close: async () => { this.bytes = staged; },
    };
  }
}

class MemoryDirectory {
  kind = "directory" as const;
  name: string;
  children = new Map<string, MemoryDirectory | MemoryFile>();
  constructor(name: string) { this.name = name; }
  async queryPermission() { return "granted"; }
  async *entries() { yield* this.children.entries(); }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectory> {
    const value = this.children.get(name);
    if (value?.kind === "directory") return value;
    if (value) throw new DOMException("Not a directory", "TypeMismatchError");
    if (!options?.create) throw new DOMException("Missing directory", "NotFoundError");
    const child = new MemoryDirectory(name); this.children.set(name, child); return child;
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFile> {
    const value = this.children.get(name);
    if (value?.kind === "file") return value;
    if (value) throw new DOMException("Not a file", "TypeMismatchError");
    if (!options?.create) throw new DOMException("Missing file", "NotFoundError");
    const child = new MemoryFile(name); this.children.set(name, child); return child;
  }
  async removeEntry(name: string, options?: { recursive?: boolean }) {
    const value = this.children.get(name);
    if (!value) throw new DOMException("Missing entry", "NotFoundError");
    if (value.kind === "directory" && value.children.size && !options?.recursive)
      throw new DOMException("Not empty", "InvalidModificationError");
    this.children.delete(name);
  }
  async put(relative: string, content: string | Uint8Array) {
    const parts = relative.split("/"), name = parts.pop()!;
    const parent = await parts.reduce((pending, part) => pending.then(dir => dir.getDirectoryHandle(part, { create: true })), Promise.resolve<MemoryDirectory>(this));
    const file = await parent.getFileHandle(name, { create: true });
    file.bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    return file;
  }
}

test("browser disk APIs preserve imported package resources through reopen, write and removal", async t => {
  const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": path.resolve("src") } }, ssr: { external: ["react", "react-dom", "zustand", "js-yaml"] }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
  t.after(() => server.close());
  // Load stores without a window, so this disk-focused test has no profile timers.
  const { useIde } = await server.ssrLoadModule("/src/store/ide.ts");
  const disk = await server.ssrLoadModule("/src/lib/disk.ts");
  await server.ssrLoadModule("/src/lib/save.ts");
  await server.ssrLoadModule("/src/lib/abort.ts");
  const root = new MemoryDirectory("test-project");
  const descriptors = new Map(["window", "indexedDB", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const requests: string[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { showDirectoryPicker: async () => root } });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() { throw new Error("No IndexedDB in disk fixture"); } } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url: unknown) => { requests.push(String(url)); throw new Error("No network in disk fixture"); } });
  t.after(() => { for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { if (!String(args[0]).startsWith("[zustand persist middleware]")) warn(...args); };
  t.after(() => { console.warn = warn; });
  useIde.setState({ files: {}, dirty: {}, workspaceCwd: "", agentBusy: false, pathOperation: null });
  const prefix = ".anvil/skills/package-fixture/";
  const binary = new Uint8Array([137, 80, 78, 71, 0, 255]);
  const binaryText = "data:application/octet-stream;base64,iVBORwD/";
  const originals = {
    [prefix + ".codex-plugin/plugin.json"]: '{"name":"fixture"}',
    [prefix + ".cursor-plugin/plugin.json"]: '{"name":"fixture"}',
    [prefix + ".mcp.json"]: '{"mcpServers":{}}',
    [prefix + "dist/helper.js"]: "export {};",
    [prefix + "assets/picture.png"]: binary,
    ".anvil/plugin-imports/fixture.json": '{"schema":1}',
    "README.md": "ordinary source",
  };
  for (const [relative, content] of Object.entries(originals)) await root.put(relative, content);
  await root.put(prefix + ".env", "TOKEN=not-imported");
  await root.put(prefix + "key.pem", "fake key");
  await root.put("src/.codex-plugin/plugin.json", "{}");
  await root.put("src/picture.png", binary);
  const oversized = await root.put(prefix + "assets/oversized.dat", "placeholder");
  oversized.reportedSize = 16 * 1024 * 1024 + 1;

  await t.test("pickFolder reads hidden package manifests and exact bytes without reading oversized resources", async () => {
    const reopened = await disk.pickFolder();
    const expected = { ...originals, [prefix + "assets/picture.png"]: binaryText };
    assert.deepEqual(reopened.files, expected);
    assert.equal(oversized.reads, 0);
    assert.ok(reopened.skipped >= 3);
    assert.deepEqual((await disk.loadSlotAll("workspace")).files, expected);
  });

  await t.test("readDiskFiles applies binary encoding, secret filtering and size bounds", async () => {
    assert.deepEqual(await disk.readDiskFiles([prefix + "assets/picture.png", prefix + ".mcp.json", prefix + ".env", prefix + "assets/oversized.dat", prefix + "missing.txt"]), {
      [prefix + "assets/picture.png"]: binaryText,
      [prefix + ".mcp.json"]: originals[prefix + ".mcp.json"],
      [prefix + "missing.txt"]: null,
    });
    assert.equal(oversized.reads, 0);
  });

  await t.test("restore writes byte content and removes only owned files and empty directories", async () => {
    const file = prefix + "created/new.bin", other = prefix + "created/foreign.txt";
    await disk.restoreDiskPlan({ mkdir: [], rmdir: [], files: [{ path: file, before: null, expected: null, after: binaryText }] }, root);
    assert.deepEqual(await disk.readDiskFiles([file]), { [file]: binaryText });
    const created = await (await (await root.getDirectoryHandle(".anvil")).getDirectoryHandle("skills")).getDirectoryHandle("package-fixture");
    assert.deepEqual((await (await created.getDirectoryHandle("created")).getFileHandle("new.bin")).bytes, binary);
    await root.put(other, "keep user file");
    const removed = await disk.restoreDiskPlan({ mkdir: [], rmdir: [prefix + "created"], files: [{ path: file, before: binaryText, expected: binaryText, after: null }] }, root);
    assert.deepEqual(removed, []);
    assert.deepEqual(await disk.readDiskFiles([file, other]), { [file]: null, [other]: "keep user file" });
    assert.deepEqual(await disk.restoreDiskPlan({ mkdir: [], rmdir: [prefix + "created"], files: [{ path: other, before: "keep user file", expected: "keep user file", after: null }] }, root), [prefix + "created"]);
  });
  await t.test("FreeCAD project and backup archives preserve bytes through browser reopen and targeted reload", async () => {
    const bytes = new Uint8Array([80, 75, 3, 4, 0, 255, 128, 65]);
    const names = ["docs/Stage.FCStd", "docs/Stage.FCStd1", "docs/Stage.20261008-051748.FCBak"];
    for (const name of names) await root.put(name, bytes);
    useIde.setState({ files: {}, dirty: {}, pendingDiffs: [], agentBusy: false, pathOperation: null });
    const reopened = await disk.pickFolder();
    const reread = await disk.readDiskFiles(names);
    for (const name of names) {
      assert.deepEqual(fileBytes(reopened.files[name]), bytes, `Folder import changed ${name}`);
      assert.deepEqual(fileBytes(reread[name]), bytes, `Targeted reload changed ${name}`);
    }
    await disk.saveSlot("workspace", Object.fromEntries(names.map(name => [name, reread[name]])));
    for (const name of names) assert.deepEqual((await (await root.getDirectoryHandle("docs")).getFileHandle(name.split("/").pop()!)).bytes, bytes);
  });
  assert.deepEqual(requests, []);
});
