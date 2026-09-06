/** Release gate against the user's Windows toolchain; downloads stay in CI's fixture directory. */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

if (process.platform !== "win32") throw new Error("Windows verification requires Windows.");
const dir = path.join(process.env.RUNNER_TEMP || os.tmpdir(), "anvil-zig-0.16-fixture");
mkdirSync(dir, { recursive: true });
const indexResponse = await fetch("https://ziglang.org/download/index.json", { signal: AbortSignal.timeout(30000) });
if (!indexResponse.ok) throw new Error(`Zig index HTTP ${indexResponse.status}`);
const info = (await indexResponse.json())["0.16.0"]?.["x86_64-windows"];
if (!info?.tarball || new URL(info.tarball).origin !== "https://ziglang.org" || !info.shasum) throw new Error("Official Zig 0.16.0 metadata missing.");
const download = await fetch(info.tarball, { signal: AbortSignal.timeout(120000) });
if (!download.ok) throw new Error(`Zig download HTTP ${download.status}`);
const archive = Buffer.from(await download.arrayBuffer());
if (createHash("sha256").update(archive).digest("hex") !== info.shasum) throw new Error("Zig checksum differs from official metadata.");
const archivePath = path.join(dir, "zig.zip");
writeFileSync(archivePath, archive);
const sevenZip = path.join(process.env.ProgramFiles || "C:\\Program Files", "7-Zip", "7z.exe");
if (!existsSync(sevenZip)) throw new Error("Windows runner's 7-Zip installation is missing.");
const unpack = spawnSync(sevenZip, ["x", "-y", "-bd", "-bso0", "-o" + dir, archivePath], {
  stdio: "pipe", encoding: "utf8", timeout: 180000,
});
if (unpack.status !== 0) throw new Error(`Zig extraction failed: ${unpack.error?.message || unpack.stderr || unpack.status}`);
const folder = readdirSync(dir, { withFileTypes: true }).find((f) => f.isDirectory() && f.name.startsWith("zig-"));
if (!folder) throw new Error("Zig folder missing.");
const zig = path.join(dir, folder.name, "zig.exe");
const terminal = spawnSync(process.execPath, ["--test", "--test-name-pattern=Windows terminal", "scripts/native-run.test.mjs"], {
  env: { ...process.env, ANVIL_NATIVE_ZIG: zig }, stdio: "inherit", timeout: 30000,
});
if (terminal.status !== 0) throw new Error("Interactive Windows terminal verification failed.");
const result = spawnSync(process.execPath, ["--test", "scripts/native-run.test.mjs"], {
  env: { ...process.env, ANVIL_NATIVE_ZIG: zig }, stdio: "inherit", timeout: 480000,
});
process.exitCode = result.status ?? 1;
