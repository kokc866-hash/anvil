import { existsSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";

// The per-user Store registration also works when Anvil is launched from Explorer.
// Look up the publisher's package, without scanning WindowsApps or running a shell wrapper.
const packageQuery = [
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
  "Get-AppxPackage -Name OpenAI.Codex -ErrorAction Stop | Where-Object { $_.PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' -and [int]$_.Status -eq 0 } | Select-Object -First 1 -ExpandProperty InstallLocation",
].join("; ");
const numericOrder = new Intl.Collator("en", { numeric: true });
let registration;

function checkAbort(signal) {
  if (signal?.aborted) throw new Error("CLI abgebrochen.");
}

async function registeredCli({ env, run, signal, refresh }) {
  const system = env.SystemRoot || env.SYSTEMROOT;
  if (!system || !isAbsolute(system)) return null;
  if (!refresh && registration?.system === system && Date.now() < registration.until &&
      (!registration.command || existsSync(registration.command.file))) return registration.command;
  const shell = join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const result = await run({ file: shell, args: [] }, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", packageQuery], { env, signal, timeoutMs: 5000 });
  if (result.code !== 0) return null;
  const root = result.stdout.trim();
  const trusted = isAbsolute(root) && !/[\r\n]/.test(root) && /^OpenAI\.Codex_[\d.]+_(?:x64|x86|arm64|neutral)_[^\\/]*_2p2nqsd0c76g0$/i.test(basename(root));
  const file = trusted && join(root, "app", "resources", "codex.exe");
  const command = file && existsSync(file) ? { file, args: [] } : null;
  registration = { system, command, until: Date.now() + 60000 };
  return command;
}

async function versionOf(command, { run, env, signal }) {
  try {
    const result = await run(command, ["--version"], { env, signal, timeoutMs: 5000 });
    if (result.code === 0) {
      return /^codex-cli (\d+\.\d+\.\d+)(?:-([0-9a-z.-]+))?(?:\+[0-9a-z.-]+)?\s*$/im.exec(result.stdout.trim());
    }
  } catch { checkAbort(signal); }
  return null;
}

function compareVersions(left, right) {
  const core = numericOrder.compare(left[1], right[1]);
  if (core) return core;
  if (left[2] && right[2]) return numericOrder.compare(left[2], right[2]);
  // A stable release comes after any prerelease of the same version.
  return Number(!left[2]) - Number(!right[2]);
}

export async function resolveWindowsCodex(primary, options) {
  checkAbort(options.signal);
  let desktop;
  try { desktop = await registeredCli(options); }
  catch { checkAbort(options.signal); }
  checkAbort(options.signal);
  if (!desktop) return primary;
  if (!primary || (!primary.args.length && primary.file.toLowerCase() === desktop.file.toLowerCase())) return desktop;
  const [pathVersion, desktopVersion] = await Promise.all([versionOf(primary, options), versionOf(desktop, options)]);
  checkAbort(options.signal);
  if (!desktopVersion) return primary;
  if (!pathVersion) return { ...desktop, version: desktopVersion[0] };
  return compareVersions(desktopVersion, pathVersion) > 0
    ? { ...desktop, version: desktopVersion[0] }
    : { ...primary, version: pathVersion[0] };
}
