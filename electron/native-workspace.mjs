import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, opendirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { hasAsciiControl } from "./text-controls.mjs";
import { listTree, listWorkspaceResults, mkdirRel, moveRel, readRelFiles, removeRel, resolveCwd, workspaceResultDestination, writeRel } from "../companion/git.mjs";
import { restoreRel } from "../companion/restore.mjs";
import { isSecretPath } from "./agent-secret-path.mjs";
import { validWorkspaceResultPath } from "../scripts/workspace-results.mjs";
import { verifyWorkspaceFile } from "./workspace-file-proof.mjs";

const MAX_ROOTS = 64;
const MAX_ROOT_LENGTH = 4096;
const MAX_RESTORE_ENTRIES = 10_000;
const MAX_PAYLOAD_BYTES = 24_000_000;
const SCAN_TIMEOUT = 30_000;
const rootKey = (value) => process.platform === "win32" ? value.toLowerCase() : value;
const validRoot = (value) => typeof value === "string" && value.length <= MAX_ROOT_LENGTH
  && path.isAbsolute(value) && !hasAsciiControl(value) && !/^\\\\[?.]\\/.test(value);

function authorizedRoot(input) {
  if (!validRoot(input)) throw new Error("Projektordner ungültig.");
  // Resolve aliases before applying the system-directory checks and recording the grant.
  const root = resolveCwd(realpathSync(resolveCwd(input)));
  const info = lstatSync(root, { bigint: true });
  if (!info.isDirectory()) throw new Error("Projektordner fehlt.");
  return { root, identity: `${info.dev}:${info.ino}` };
}

function checkRelative(root, relative) {
  if (typeof relative !== "string" || !relative || relative.length > 1024 || hasAsciiControl(relative)) {
    throw new Error("Pfad ungültig.");
  }
  let current = root;
  let info;
  for (const segment of relative.split("/")) {
    if (!segment || segment.length > 255 || /[\\:<>|"*?]/.test(segment) || /[. ]$/.test(segment)
      || /^(?:__proto__|prototype|constructor)$/i.test(segment)
      || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment)) {
      throw new Error("Pfad ungültig.");
    }
    current = path.join(current, segment);
    info = undefined;
    try {
      info = lstatSync(current);
      if (info.isSymbolicLink()) throw new Error("Verknüpfungen sind für diese Projektaktion gesperrt.");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const fromRoot = path.relative(root, current);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(".." + path.sep) || path.isAbsolute(fromRoot)) {
    throw new Error("Pfad liegt außerhalb des Projektordners.");
  }
  return info;
}

function checkValues(values) {
  let bytes = 0;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value !== "string") throw new Error("Dateiinhalt ungültig.");
    bytes += Buffer.byteLength(value);
    if (bytes > MAX_PAYLOAD_BYTES) throw new Error("Dateidaten für diese Aktion sind zu groß.");
  }
}

function readGrants(file) {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) return [];
    const saved = JSON.parse(readFileSync(file, "utf8"));
    if (saved.schema !== 1 || !Array.isArray(saved.roots) || saved.roots.length > MAX_ROOTS) return [];
    return saved.roots.filter((row) => validRoot(row?.root) && /^\d+:\d+$/.test(row?.identity) && row.identity.length <= 80);
  } catch { return []; }
}

function writeGrants(file, roots) {
  const temp = file + "." + randomUUID() + ".tmp";
  const fd = openSync(temp, "wx", 0o600);
  try {
    try {
      writeFileSync(fd, JSON.stringify({ schema: 1, roots }));
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

function scanWorkspace(userData, root, action, identity) {
  return new Promise((resolve) => {
    // Use the same scanner without locking the Electron UI. Do not inherit
    // provider credentials or test/diagnostic Node launch options.
    const env = {};
    for (const name of ["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "ANVIL_HOME", "ANVIL_INSTALL_DIR"]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    let worker;
    try {
      worker = new Worker(new URL(import.meta.url), {
        workerData: { nativeWorkspaceScan: true, userData, root, action, identity }, env, execArgv: [],
      });
    } catch {
      resolve({ ok: false, error: "Das Lesen des Projektordners konnte nicht gestartet werden." });
      return;
    }
    const finish = (result) => {
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      finish({ ok: false, error: "Der Projektordner konnte nicht rechtzeitig gelesen werden." });
      void worker.terminate().catch(() => undefined);
    }, SCAN_TIMEOUT);
    worker.once("message", finish);
    worker.once("error", () => finish({ ok: false, error: "Projektordner konnte nicht gelesen werden." }));
    worker.once("exit", () => finish({ ok: false, error: "Das Lesen des Projektordners wurde unterbrochen." }));
  });
}

export function scanBoundWorkspaceResults(root, identity) {
  return scanWorkspace(undefined, root, "results", identity);
}

export function createNativeWorkspace(userData) {
  const file = path.join(userData, "native-workspace-roots.json");
  let roots = readGrants(file);
  const scans = new Map();
  const grantFor = (root) => validRoot(root)
    ? roots.find((candidate) => rootKey(candidate.root) === rootKey(path.resolve(root))) : undefined;
  return {
    remember(selected) {
      const grant = authorizedRoot(selected);
      const previous = roots.find((candidate) => rootKey(candidate.root) === rootKey(grant.root));
      if (previous?.identity !== grant.identity || roots.at(-1) !== previous) {
        const next = [...roots.filter((candidate) => rootKey(candidate.root) !== rootKey(grant.root)), grant].slice(-MAX_ROOTS);
        writeGrants(file, next);
        roots = next;
      }
      return grant.root;
    },
    runTree(request) {
      const grant = grantFor(request?.root);
      if (!grant) return Promise.resolve({ ok: false, code: "workspace-not-authorized", error: "Wähle diesen Projektordner erneut aus." });
      const action = request.action === "results" ? "results" : "tree";
      const scan = scans.get(action);
      if (scan?.root === grant.root) return scan.promise;
      if (scan) return Promise.resolve({ ok: false, error: "Ein Projektordner wird bereits gelesen." });
      const promise = scanWorkspace(userData, grant.root, action).finally(() => { scans.delete(action); });
      scans.set(action, { root: grant.root, promise });
      return promise;
    },
    run(request) {
      try {
        if (!validRoot(request?.root)) throw new Error("Projektordner ungültig.");
        const bound = grantFor(request.root);
        if (!bound) return { ok: false, code: "workspace-not-authorized", error: "Wähle diesen Projektordner erneut aus." };
        const { root, identity } = authorizedRoot(bound.root);
        if (rootKey(root) !== rootKey(bound.root) || identity !== bound.identity) {
          return { ok: false, code: "workspace-not-authorized", error: "Projektordner geändert. Wähle ihn erneut aus." };
        }
        switch (request.action) {
          case "verifyFile": return verifyWorkspaceFile(root, identity, request);
          case "results": return listWorkspaceResults(root);
          case "resultDestination": {
            return { ok: true, path: workspaceResultDestination(root, request.path, request.directory === true) };
          }
          case "resultReveal": {
            if (typeof request.path !== "string" || !validWorkspaceResultPath(request.path) || isSecretPath(request.path) || !checkRelative(root, request.path)?.isFile()) {
              throw new Error("Datei im Projektordner nicht gefunden.");
            }
            return { ok: true, path: path.join(root, request.path) };
          }
          case "tree": {
            // A failed root directory read must be visible, even though the
            // shared scanner deliberately skips inaccessible nested folders.
            const empty = readdirSync(root).length === 0;
            return { ...listTree(root), empty };
          }
          case "empty": {
            const directory = opendirSync(root);
            try {
              return { ok: true, empty: directory.readSync() === null };
            } finally {
              directory.closeSync();
            }
          }
          case "read": {
            if (!Array.isArray(request.paths)) throw new Error("Dateiliste ungültig.");
            const paths = request.paths.slice(0, 64);
            for (const rel of paths) checkRelative(root, rel);
            return readRelFiles(root, paths);
          }
          case "write": {
            const info = checkRelative(root, request.path);
            if (info?.isFile() && info.nlink > 1) throw new Error("Datei hat weitere Festverknüpfungen und wurde nicht überschrieben.");
            if (typeof request.content !== "string") throw new Error("Dateiinhalt ungültig.");
            checkValues([request.content, request.expected]);
            return writeRel(root, request.path, request.content, request.expected);
          }
          case "move":
            checkRelative(root, request.from);
            checkRelative(root, request.to);
            return moveRel(root, request.from, request.to);
          case "mkdir":
            checkRelative(root, request.path);
            return mkdirRel(root, request.path);
          case "remove":
            checkRelative(root, request.path);
            return removeRel(root, request.path);
          case "restore": {
            const { mkdir, rmdir, files } = request;
            if (![mkdir, rmdir, files].every((value) => Array.isArray(value) && value.length <= MAX_RESTORE_ENTRIES)) {
              throw new Error("Rücknahmeplan ungültig.");
            }
            for (const rel of [...mkdir, ...rmdir, ...files.map((entry) => entry?.path)]) checkRelative(root, rel);
            checkValues(files.flatMap((entry) => [entry.expected, entry.after]));
            return restoreRel(root, { mkdir, rmdir, files });
          }
          default:
            throw new Error("Unbekannte Projektaktion.");
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

if (!isMainThread && workerData?.nativeWorkspaceScan === true) {
  const { userData, root, action, identity } = workerData;
  try {
    if (typeof identity === "string" && action === "results") {
      const authorized = authorizedRoot(root);
      if (authorized.identity !== identity || rootKey(authorized.root) !== rootKey(root)) throw new Error("Der Projektordner wurde seit dem Auftragsstart ausgetauscht.");
      parentPort.postMessage(listWorkspaceResults(root));
    } else parentPort.postMessage(createNativeWorkspace(userData).run({ action, root }));
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
