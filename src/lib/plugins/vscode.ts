import { grammarOf, registerGrammar } from "@/lib/syntax";
import { unzipFiles } from "@/lib/archive";
import { joinManifest, parseSnippetFile, type VsSnip } from "./vscode-snip";

export type { VsSnip };
export { parseSnippetFile };
export type VsPack = { id: string; name: string; snippets: number; languages: number; note: string };

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

export function ingestContrib(files: Record<string, string>, manifestPath: string): VsPack | null {
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
    if (lang.configuration) {
      const cfgPath = join(manifestPath, lang.configuration);
      const cfg = readJson(files, cfgPath) as { comments?: { lineComment?: string } } | null;
      const line = cfg?.comments?.lineComment;
      if (line) {
        extraComment[langId] = line;
        if (!grammarOf(langId)?.lineComment) {
          registerGrammar({ id: langId, aliases: lang.aliases?.map((a) => a.toLowerCase()), keywords: grammarOf(langId)?.keywords ?? [], lineComment: line, builtins: grammarOf(langId)?.builtins, types: grammarOf(langId)?.types });
        }
      }
    }
  }
  for (const sn of c.snippets ?? []) {
    if (!sn.path) continue;
    const p = join(manifestPath, sn.path);
    const raw = files[p];
    if (!raw) continue;
    const got = parseSnippetFile(raw, sn.language || "*");
    extraSnips.push(...got);
    snippets += got.length;
  }
  const skip = json.main ? "Aktivierungscode (vscode-Modul) übersprungen." : "Nur Beiträge: Snippets, Sprachen, Kommentare.";
  const pack: VsPack = { id, name, snippets, languages, note: skip };
  packs.push(pack);
  return pack;
}

export function loadVscodeFromWorkspace(files: Record<string, string>): VsPack[] {
  resetVscode();
  const found: VsPack[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith(".code-snippets") || (path.startsWith(".vscode/") && path.endsWith(".json") && path.includes("snippet"))) {
      const got = parseSnippetFile(content, "*");
      extraSnips.push(...got);
      if (got.length) found.push({ id: path, name: path, snippets: got.length, languages: 0, note: "Workspace-Snippets" });
    }
    if (/(^|\/)package\.json$/.test(path) && (path.startsWith("plugins/") || path.startsWith(".vscode/"))) {
      const pack = ingestContrib(files, path);
      if (pack) found.push(pack);
    }
  }
  packs.splice(0, packs.length, ...found);
  return found;
}

export async function importVsix(buf: ArrayBuffer, dest = "plugins/vscode"): Promise<{ files: Record<string, string>; skipped: number; name: string }> {
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
    const keep =
      /(^|\/)package\.json$/.test(p) ||
      /\.code-snippets$/.test(p) ||
      /language-configuration\.json$/.test(p) ||
      /snippets?\/.+\.json$/i.test(p) ||
      /\.vsixmanifest$/i.test(p);
    if (!keep) {
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
