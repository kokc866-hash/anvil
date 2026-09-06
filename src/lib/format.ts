import { langFromPath } from "./languages";
import { useIde } from "@/store/ide";
import { captureDocument, applyDocument } from "./document";
import type { Options } from "prettier";

export async function formatCode(path: string, code: string): Promise<string> {
  const s = useIde.getState();
  const lang = langFromPath(path);
  const options: Options = { tabWidth: s.tabSize, useTabs: !s.insertSpaces };
  // JSON configuration is data; never execute workspace JS configuration in the renderer.
  const parents = path.split("/"); parents.pop();
  for (let i = 0; i <= parents.length; i++) {
    const prefix = parents.slice(0, i).join("/");
    for (const name of [".prettierrc", ".prettierrc.json"]) {
      const raw = s.files[(prefix ? prefix + "/" : "") + name];
      if (!raw) continue;
      try {
        const cfg = JSON.parse(raw) as Record<string, unknown>;
        for (const key of ["tabWidth", "useTabs", "printWidth", "singleQuote", "semi", "trailingComma", "bracketSpacing", "endOfLine"])
          if (["string", "number", "boolean"].includes(typeof cfg[key])) Object.assign(options, { [key]: cfg[key] });
      } catch { /* Non-JSON configurations require a local formatter. */ }
    }
  }
  if (["go", "rust", "c", "cpp", "python"].includes(lang)) {
    const { companionFormat } = await import("./companion");
    const r = await companionFormat({ path, content: code }, s.companionUrl || undefined);
    if (r.ok && r.via && r.via !== "none") return r.content;
    throw new Error(r.error || `Kein Formatter für ${lang} verfügbar.`);
  }
  const parser = ({ javascript: "babel", typescript: "typescript", json: "json", html: "html", markdown: "markdown", css: "css", yaml: "yaml" } as Record<string, string>)[lang];
  if (!parser) throw new Error(`Kein Formatter für ${lang} verfügbar.`);
  const prettier = await import("prettier/standalone");
  const plugins = parser === "html" ? [await import("prettier/plugins/html")]
    : parser === "markdown" ? [await import("prettier/plugins/markdown")]
    : parser === "css" ? [await import("prettier/plugins/postcss")]
    : parser === "yaml" ? [await import("prettier/plugins/yaml")]
    : await Promise.all([import("prettier/plugins/babel"), import("prettier/plugins/estree"), import("prettier/plugins/typescript")]);
  return prettier.format(code, { ...options, parser, plugins });
}

export async function formatDocument(path = useIde.getState().activePath): Promise<void> {
  if (!path) return;
  const snap = captureDocument(path);
  if (snap.content == null) return;
  try {
    const next = await formatCode(path, snap.content);
    const applied = applyDocument(snap, next);
    useIde.getState().setNotice(applied ? "Formatiert" : "Datei inzwischen geändert; Formatierung nicht übernommen.");
  } catch (e) { useIde.getState().setNotice(e instanceof Error ? e.message : "Format fehlgeschlagen"); }
}
