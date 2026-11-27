import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const REVIEW_ARTIFACT_LIMITS = Object.freeze({
  fileBytes: 10 * 1024 ** 2,
  totalBytes: 128 * 1024 ** 2,
  files: 256,
  manifestBytes: 1024 ** 2,
});
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ID = /^[a-zA-Z0-9._:-]{1,128}$/;
const locks = new Map();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const text = (value, max) =>
  typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= max;
const plain = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const validScope = (input) =>
  input && text(input.project, 4096) && typeof input.jobId === "string" && ID.test(input.jobId);
function validFile(name) {
  if (
    !text(name, 1024) ||
    [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    /[\\:]/.test(name) ||
    name.startsWith("/") ||
    name.split("/").some((p) => !p || p === "." || p === "..")
  )
    return false;
  const base = name.split("/").at(-1);
  if (/\.env\.(example|sample|template)$/i.test(base)) return true;
  if (
    /(^|\/)\.env($|\.)|(^|\/)(\.git-credentials|id_rsa|credentials)$/i.test(name) ||
    /\.(pem|p12|pfx)$/i.test(base)
  )
    return false;
  if (/\.(md|ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/i.test(base)) return true;
  return (
    !/^(secrets?|password|token)(\.|$)|api[_-]?key/i.test(base) &&
    !/(^|\/)(secrets?|vault)(\.|\/|$)/i.test(name)
  );
}
function validStamps(value) {
  return (
    plain(value) &&
    Object.keys(value).length <= 500 &&
    Object.entries(value).every(
      ([name, stamp]) => validFile(name) && typeof stamp === "string" && HASH.test(stamp),
    )
  );
}
function validRecord(record, limits) {
  return (
    plain(record) &&
    typeof record.id === "string" &&
    UUID.test(record.id) &&
    validScope(record) &&
    typeof record.jobVersion === "string" &&
    ID.test(record.jobVersion) &&
    ["screenshot", "log", "review", "interaction"].includes(record.kind) &&
    ["image/png", "image/jpeg", "image/webp", "text/plain", "application/json"].includes(
      record.mime,
    ) &&
    (record.kind === "screenshot"
      ? record.mime.startsWith("image/") && record.observation === "image-captured"
      : !record.mime.startsWith("image/")) &&
    [
      "program-started",
      "image-captured",
      "interaction-checked",
      "behavior-confirmed",
      "review-reported",
      "diagnostic",
    ].includes(record.observation) &&
    ["success", "failure", "unknown"].includes(record.result) &&
    (record.observation !== "behavior-confirmed" ||
      (record.kind === "interaction" && record.result === "success")) &&
    Number.isSafeInteger(record.bytes) &&
    record.bytes >= 0 &&
    record.bytes <= limits.fileBytes &&
    HASH.test(record.sha256 || "") &&
    Number.isSafeInteger(record.at) &&
    record.at > 0 &&
    plain(record.origin) &&
    typeof record.origin.stepId === "string" &&
    ID.test(record.origin.stepId) &&
    typeof record.origin.evidenceId === "string" &&
    ID.test(record.origin.evidenceId) &&
    text(record.origin.tool, 128) &&
    validStamps(record.fileStamps)
  );
}
async function absent(file) {
  try {
    return await fs.lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function directory(location, create) {
  const absolute = path.resolve(location);
  let current = path.parse(absolute).root;
  for (const segment of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let info = await absent(current);
    if (!info && create) {
      try {
        await fs.mkdir(current);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      info = await fs.lstat(current);
    }
    if (!info) return false;
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error("Prüfarbeitsordner ist keine sichere lokale Ablage.");
  }
  const actual = await fs.realpath(absolute);
  const equal =
    process.platform === "win32"
      ? actual.toLowerCase() === absolute.toLowerCase()
      : actual === absolute;
  if (!equal) throw Error("Verknüpfte Prüfartefakt-Ablage ist gesperrt.");
  return true;
}
async function boundedRead(file, max) {
  const info = await absent(file);
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink() || info.size > max)
    throw Error("Prüfartefakt-Datei ist ungültig oder zu groß.");
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat();
    if (before.size > max || before.ino !== info.ino)
      throw Error("Prüfartefakt wurde während des Lesens ersetzt.");
    const content = Buffer.alloc(before.size);
    let position = 0;
    while (position < content.length) {
      const result = await handle.read(content, position, content.length - position, position);
      if (!result.bytesRead) break;
      position += result.bytesRead;
    }
    const after = await handle.stat();
    if (
      position !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw Error("Prüfartefakt während des Lesens verändert.");
    return content;
  } finally {
    await handle.close();
  }
}
async function atomicManifest(file, manifest, limit) {
  const data = JSON.stringify(manifest);
  if (Buffer.byteLength(data) > limit)
    throw Error("Prüfartefakt-Manifest überschreitet das Budget.");
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temp, file);
  } catch (error) {
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}
async function serial(root, work) {
  const key = process.platform === "win32" ? root.toLowerCase() : root;
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

/** Stores selected bounded evidence outside job JSON. The host must explicitly opt in and supply captured provenance. */
export class ReviewArtifactStore {
  constructor({ storageRoot, limits = {} }) {
    if (typeof storageRoot !== "string" || !path.isAbsolute(storageRoot))
      throw Error("Absolute Prüfartefakt-Ablage erforderlich.");
    this.root = path.join(path.resolve(storageRoot), "review-artifacts");
    this.limits = { ...REVIEW_ARTIFACT_LIMITS, ...limits };
    for (const [name, limit] of Object.entries(this.limits))
      if (
        !Object.hasOwn(REVIEW_ARTIFACT_LIMITS, name) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > REVIEW_ARTIFACT_LIMITS[name]
      )
        throw Error("Ungültiges Prüfartefakt-Budget.");
    this.manifest = path.join(this.root, "manifest.json");
  }
  async load(create = false) {
    if (!(await directory(this.root, create))) return { version: 1, artifacts: [] };
    const raw = await boundedRead(this.manifest, this.limits.manifestBytes);
    if (!raw) return { version: 1, artifacts: [] };
    const value = JSON.parse(raw.toString("utf8"));
    if (
      !plain(value) ||
      value.version !== 1 ||
      !Array.isArray(value.artifacts) ||
      value.artifacts.length > this.limits.files ||
      !value.artifacts.every((record) => validRecord(record, this.limits)) ||
      new Set(value.artifacts.map((record) => record.id)).size !== value.artifacts.length ||
      value.artifacts.reduce((total, record) => total + record.bytes, 0) > this.limits.totalBytes
    )
      throw Error("Ungültiges Prüfartefakt-Manifest.");
    return value;
  }
  async save(input) {
    return serial(this.root, async () => {
      if (!validScope(input)) throw Error("Projekt- oder Auftragskennung ungültig.");
      const size =
        typeof input.data === "string"
          ? Buffer.byteLength(input.data, "utf8")
          : input.data instanceof Uint8Array
            ? input.data.byteLength
            : -1;
      if (size < 0 || size > this.limits.fileBytes)
        throw Error("Prüfartefakt überschreitet das Dateibudget oder enthält keine Bytes.");
      const data = Buffer.from(input.data);
      const record = {
        id: randomUUID(),
        project: input.project,
        jobId: input.jobId,
        jobVersion: input.jobVersion,
        at: Date.now(),
        kind: input.kind,
        mime: input.mime,
        observation: input.observation,
        result: input.result,
        origin: input.origin
          ? {
              tool: input.origin.tool,
              stepId: input.origin.stepId,
              evidenceId: input.origin.evidenceId,
            }
          : null,
        fileStamps: input.fileStamps ? { ...input.fileStamps } : null,
        sha256: digest(data),
        bytes: data.length,
      };
      if (!validRecord(record, this.limits))
        throw Error("Prüfartefakt-Herkunft, Dateistand oder Medientyp ungültig.");
      const manifest = await this.load(true);
      if (
        manifest.artifacts.length >= this.limits.files ||
        manifest.artifacts.reduce((n, item) => n + item.bytes, 0) + data.length >
          this.limits.totalBytes
      )
        throw Error("Prüfartefakt-Ablage ist voll. Keine vorhandenen Nachweise wurden gelöscht.");
      const target = path.join(this.root, `${record.id}.bin`);
      const handle = await fs.open(target, "wx", 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await atomicManifest(
          this.manifest,
          { version: 1, artifacts: [...manifest.artifacts, record] },
          this.limits.manifestBytes,
        );
      } catch (error) {
        await fs.unlink(target).catch(() => {});
        throw error;
      }
      return record;
    });
  }
  async list(scope) {
    if (!validScope(scope)) throw Error("Projekt- oder Auftragskennung ungültig.");
    return (await this.load()).artifacts.filter(
      (record) => record.project === scope.project && record.jobId === scope.jobId,
    );
  }
  async read(scope) {
    if (!validScope(scope) || typeof scope.id !== "string" || !UUID.test(scope.id))
      throw Error("Ungültige Prüfartefakt-Anfrage.");
    const record = (await this.list(scope)).find((item) => item.id === scope.id);
    if (!record)
      return {
        status: "missing",
        reason: "Für dieses Projekt und diesen Auftrag ist kein Artefakt vorhanden.",
      };
    if (scope.jobVersion !== undefined && scope.jobVersion !== record.jobVersion)
      return {
        status: "stale",
        artifact: record,
        reason: "Nachweis gehört zu einer anderen Auftragsversion.",
      };
    if (
      scope.fileStamps !== undefined &&
      (!validStamps(scope.fileStamps) ||
        Object.entries(record.fileStamps).some(([name, stamp]) => scope.fileStamps[name] !== stamp))
    )
      return {
        status: "stale",
        artifact: record,
        reason: "Geprüfter Dateistand wurde verändert oder fehlt.",
      };
    let data;
    try {
      data = await boundedRead(path.join(this.root, `${record.id}.bin`), this.limits.fileBytes);
    } catch {
      return {
        status: "corrupt",
        artifact: record,
        reason: "Artefakt ist nicht mehr sicher lesbar.",
      };
    }
    if (!data) return { status: "missing", artifact: record, reason: "Artefaktdatei fehlt." };
    if (data.length !== record.bytes || digest(data) !== record.sha256)
      return {
        status: "corrupt",
        artifact: record,
        reason: "Artefakt-Fingerabdruck stimmt nicht mehr überein.",
      };
    return {
      status: "ready",
      freshness:
        scope.jobVersion !== undefined && scope.fileStamps !== undefined ? "current" : "unverified",
      artifact: record,
      data,
    };
  }
}
