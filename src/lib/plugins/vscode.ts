import { grammarOf, registerGrammar } from "@/lib/syntax";
import { unzipFiles } from "@/lib/archive";
import { joinManifest, parseSnippetFile, type VsSnip } from "./vscode-snip";
import { vsPackPluginId } from "./util";
import { keywordsFromTm, shouldKeepVsixPath } from "./vscode-keep";

export type { VsSnip };
export { parseSnippetFile };
export { keywordsFromTm, shouldKeepVsixPath };
export type VsPack = {
  id: string;
  name: string;
  snippets: number;
  languages: number;
  note: string;
  path: string;
};

const extraSnips: VsSnip[] = [];
const extraExt: Record<string, string> = {};
const extraComment: Record<string, string> = {};
const packs: VsPack[] = [];

export function vscodeSnippets(lang: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of extraSnips) {
    if (s.lang === lang || s.lang === "*" || s.lang === "plaintext") out[s.prefix] = s.body;
  }
  return out;
}

export function vscodeExt(ext: string): string | undefined {
  return extraExt[ext.toLowerCase().replace(/^\./, "")];
}

export function vscodeLineComment(lang: string): string | undefined {
  return extraComment[lang];
}

export function listVsPacks(): VsPack[] {
  return packs.slice();
}

export function resetVscode() {
  extraSnips.length = 0;
  packs.length = 0;
  for (const k of Object.keys(extraExt)) delete extraExt[k];
  for (const k of Object.keys(extraComment)) delete extraComment[k];
}

type Contrib = {
  languages?: Array<{ id?: string; extensions?: string[]; aliases?: string[]; configuration?: string }>;
  snippets?: Array<{ language?: string; path?: string }>;
  grammars?: Array<{ language?: string; path?: string; scopeName?: string }>;
};

function readJson(files: Record<string, string>, path: string): unknown {
  const raw = files[path];
  if (!raw) return null;
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function join(base: string, rel: string): string {
  return joinManifest(base, rel);
}

function dirOf(manifestPath: string): string {
  return manifestPath.includes("/") ? manifestPath.slice(0, manifestPath.lastIndexOf("/")) : manifestPath;
}

export function ingestContrib(
  files: Record<string, string>,
  manifestPath: string,
  apply = true,
): VsPack | null {
  const json = readJson(files, manifestPath) as {
    name?: string;
    displayName?: string;
    contributes?: Contrib;
    main?: string;
  } | null;
  if (!json?.contributes) return null;
  const c = json.contributes;
  const id = json.name || manifestPath;
  const name = json.displayName || json.name || manifestPath;
  let snippets = 0;
  let languages = 0;
  for (const lang of c.languages ?? []) {
    const langId = lang.id;
    if (!langId) continue;
    languages += 1;
    if (apply) {
      for (const ext of lang.extensions ?? []) {
        extraExt[ext.replace(/^\./, "").toLowerCase()] = langId;
      }
      if (!grammarOf(langId)) {
        registerGrammar({
          id: langId,
          aliases: lang.aliases?.map((a) => a.toLowerCase()),
          keywords: [],
          lineComment: extraComment[langId],
        });
      }
    }
    if (lang.configuration) {
      const cfgPath = join(manifestPath, lang.configuration);
      const cfg = readJson(files, cfgPath) as { comments?: { lineComment?: string } } | null;
      const line = cfg?.comments?.lineComment;
      if (line && apply) {
        extraComment[langId] = line;
        const prev = grammarOf(langId);
        registerGrammar({
          id: langId,
          aliases: lang.aliases?.map((a) => a.toLowerCase()),
          keywords: prev?.keywords ?? [],
          lineComment: line,
          builtins: prev?.builtins,
          types: prev?.types,
        });
      }
    }
  }
  for (const g of c.grammars ?? []) {
    if (!g.path) continue;
    const p = join(manifestPath, g.path);
    const raw = files[p];
    if (!raw) continue;
    let data: unknown = raw;
    try {
      data = JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch {
      data = raw;
    }
    const kws = keywordsFromTm(data);
    const langId = g.language;
    if (apply && langId && kws.length) {
      const prev = grammarOf(langId);
      registerGrammar({
        id: langId,
        aliases: prev?.aliases,
        keywords: [...new Set([...(prev?.keywords ?? []), ...kws])],
        lineComment: extraComment[langId] ?? prev?.lineComment,
        builtins: prev?.builtins,
        types: prev?.types,
      });
    }
  }
  for (const sn of c.snippets ?? []) {
    if (!sn.path) continue;
    const p = join(manifestPath, sn.path);
    const raw = files[p];
    if (!raw) continue;
    const got = parseSnippetFile(raw, sn.language || "*");
    if (apply) extraSnips.push(...got);
    snippets += got.length;
  }
  const skip = json.main
    ? "Aktivierungscode (vscode-Modul) übersprungen."
    : "Nur Beiträge: Snippets, Sprachen, Kommentare.";
  const pack: VsPack = { id, name, snippets, languages, note: skip, path: dirOf(manifestPath) };
  packs.push(pack);
  return pack;
}

export function loadVscodeFromWorkspace(files: Record<string, string>, disabled: string[] = []): VsPack[] {
  resetVscode();
  const found: VsPack[] = [];
  const off = new Set(disabled);
  for (const [path, content] of Object.entries(files)) {
    if (
      path.endsWith(".code-snippets") ||
      (path.startsWith(".vscode/") && path.endsWith(".json") && path.includes("snippet"))
    ) {
      const pid = vsPackPluginId(path);
      const apply = !off.has(pid);
      const got = parseSnippetFile(content, "*");
      if (apply) extraSnips.push(...got);
      if (got.length) found.push({ id: path, name: path, snippets: got.length, languages: 0, note: "Workspace-Snippets", path });
    }
    if (/(^|\/)package\.json$/.test(path) && (path.startsWith("plugins/") || path.startsWith(".vscode/"))) {
      const preview = readJson(files, path) as { name?: string; contributes?: Contrib } | null;
      const pid = vsPackPluginId(preview?.name || path);
      const pack = ingestContrib(files, path, !off.has(pid));
      if (pack) found.push(pack);
    }
  }
  packs.splice(0, packs.length, ...found);
  return found;
}

export function vsPackFilePaths(files: Record<string, string>, packPath: string): string[] {
  if (!packPath) return [];
  return Object.keys(files).filter((p) => p === packPath || p.startsWith(`${packPath}/`));
}

export async function importVsix(
  buf: ArrayBuffer,
  dest = "plugins/vscode",
): Promise<{ files: Record<string, string>; skipped: number; name: string }> {
  const raw = await unzipFiles(buf);
  const files: Record<string, string> = {};
  let skipped = 0;
  let name = dest.split("/").pop() ?? "vscode";
  for (const [path, content] of Object.entries(raw)) {
    const p = path.replace(/^extension\//, "");
    if (!p || p.endsWith("/")) continue;
    if (/(^|\/)node_modules\//.test(p)) {
      skipped += 1;
      continue;
    }
    if (!shouldKeepVsixPath(p)) {
      skipped += 1;
      continue;
    }
    files[`${dest}/${p}`] = content;
    if (p.endsWith("package.json")) {
      try {
        const j = JSON.parse(content) as { displayName?: string; name?: string };
        name = j.displayName || j.name || name;
      } catch {
        /* ignore */
      }
    }
  }
  return { files, skipped, name };
}
