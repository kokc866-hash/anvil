import Ajv from "ajv/dist/2020.js";
import Ajv2019 from "ajv/dist/2019.js";
import AjvLegacy from "ajv";
import addFormats from "ajv-formats";
import { isMcpLoopback } from "./mcp-parse.ts";
import { programMaySaveResult, WORKSPACE_RESULT_FOLDER } from "../../scripts/workspace-results.mjs";

const options = { strict: false, allErrors: true, validateFormats: true, addUsedSchema: false };
const ajv = new Ajv(options);
const older = new AjvLegacy(options);
const transitional = new Ajv2019(options);
addFormats(ajv);
addFormats(older);
addFormats(transitional);
const validators = new Map<string, ReturnType<typeof ajv.compile>>();

/** No coercion, removal of arguments, remote schema fetches, or guessed fields. */
export function mcpArguments(
  schema: Record<string, unknown> | undefined,
  args: unknown,
  context?: Record<string, string>,
  cwd?: string,
): Record<string, unknown> {
  if (args != null && (typeof args !== "object" || Array.isArray(args)))
    throw new Error("MCP-Argumente müssen ein JSON-Objekt sein.");
  const out = { ...(args as Record<string, unknown> | undefined) };
  const props = schema?.properties as Record<string, Record<string, unknown>> | undefined;
  for (const [key, raw] of Object.entries({
    ...context,
    ...(cwd && !context?.cwd ? { cwd } : {}),
  })) {
    if (
      ["__proto__", "constructor", "prototype"].includes(key) ||
      Object.hasOwn(out, key) ||
      !props ||
      !Object.hasOwn(props, key)
    )
      continue;
    const type = props[key]?.type;
    if (type == null || type === "string" || (Array.isArray(type) && type.includes("string")))
      out[key] = raw;
    else {
      try {
        out[key] = JSON.parse(raw);
      } catch {
        throw new Error(
          `MCP-Kontext ${key}: gültigen JSON-Wert für ${String(type || "dieses Feld")} eintragen.`,
        );
      }
    }
  }
  if (schema) {
    const key = JSON.stringify(schema);
    let validate = validators.get(key);
    if (!validate) {
      if (validators.size >= 128) validators.clear();
      try {
        validate = (
          /draft-0[467]/.test(String(schema.$schema || ""))
            ? older
            : /2019-09/.test(String(schema.$schema || ""))
              ? transitional
              : ajv
        ).compile(schema);
      } catch {
        throw new Error("Das MCP-Werkzeug liefert ein nicht unterstütztes Argumentschema.");
      }
      validators.set(key, validate);
    }
    if (!validate(out))
      throw new Error(`MCP-Argumente: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
  }
  return out;
}

export function localMcpFiles(server: { transport?: string; url?: string; service?: string }) {
  if (server.service) return false;
  if (server.transport === 'stdio') return true;
  try { return isMcpLoopback(new URL(server.url || '').hostname); }
  catch { return false; }
}

const outputDirectories = new Set(['outputdir', 'outputdirectory', 'savedir', 'exportdir', 'exportdirectory', 'destinationdirectory']);
const outputFiles = new Set(['outputpath', 'outputfile', 'outputfilepath', 'outputfilename', 'savepath', 'savefile', 'exportpath', 'exportfile', 'destinationpath', 'destpath', 'renderpath']);

/** Resolve declared file destinations for local save/export operations. */
export async function workspaceMcpArguments(
  name: string,
  schema: Record<string, unknown> | undefined,
  args: unknown,
  context: Record<string, string> | undefined,
  cwd: string | undefined,
  destination?: (path: string, directory: boolean) => Promise<string> | string,
) {
  if (!destination || !programMaySaveResult(name, args)) return mcpArguments(schema, args, context, cwd);
  const fields = Object.entries(schema?.properties as Record<string, { type?: string | string[] }> || {}).flatMap(([key, property]) => {
    if (!(property?.type === 'string' || Array.isArray(property?.type) && property.type.includes('string'))) return [];
    const normalized = key.toLowerCase().replace(/[_-]/g, '');
    if (outputDirectories.has(normalized)) return [{ key, directory: true }];
    if (outputFiles.has(normalized) || !/execute.*(?:code|script|macro)/i.test(name) &&
        /^(?:path|filepath|filename|destination)$/.test(normalized)) return [{ key, directory: false }];
    return [];
  });
  const defaults = { ...context };
  for (const {key, directory} of fields) if (directory && !Object.hasOwn(defaults, key)) defaults[key] = WORKSPACE_RESULT_FOLDER;
  const checked = mcpArguments(schema, args, defaults, cwd);
  const hasOutputDirectory = fields.some(({key, directory}) => directory && typeof checked[key] === 'string' && checked[key]);
  for (const {key, directory} of fields) {
    if (!directory && hasOutputDirectory && /^(?:output[_-]?)?file[_-]?name$/i.test(key)) {
      if (typeof checked[key] === 'string' && /[/\\:]/.test(checked[key])) throw new Error('Dateinamen ohne Verzeichnispfad angeben, wenn das Ausgabeziel separat gesetzt wird.');
      continue;
    }
    if (typeof checked[key] === 'string' && checked[key]) checked[key] = await destination(checked[key], directory);
  }
  return mcpArguments(schema, checked);
}
