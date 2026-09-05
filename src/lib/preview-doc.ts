import type { LangId } from "./languages";
import { langFromPath, langLabel } from "./languages";
import { looksGraphical, wrapJsGame, withEngine } from "./game-host";
import { renderMarkdown } from "./markdown";
import { rewriteRefMedia } from "./ref";
import { stripTs } from "./run-client";
import { parentDir, cleanPath } from "./fs";
import type { InputMap } from "./input-map";
import type { RunResult } from "@/store/ide";

export const HTML_RUN_OFF = "HTML-Run aus (Einstellungen → Ausgabe).";

export type PreviewView =
  | { kind: "iframe"; srcDoc: string; live: boolean; label: string }
  | { kind: "md"; html: string }
  | { kind: "json"; text: string; rows?: string[][]; cols?: string[] }
  | { kind: "console"; ok: boolean; stdout: string; stderr: string; duration?: number; label: string }
  | { kind: "empty"; hint: string };

function cssDemo(css: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:16px;font:15px/1.45 system-ui,sans-serif;background:#111;color:#eee}
${css}
</style></head><body>
  <h1>Überschrift</h1>
  <p>Absatz mit <a href="#">Link</a> und <strong>fett</strong>.</p>
  <button type="button">Knopf</button>
  <input value="Feld" />
  <ul><li>Liste eins</li><li>Liste zwei</li></ul>
  <div class="card" style="margin-top:12px;padding:12px;border:1px solid #333;border-radius:8px">Karte / .card</div>
</body></html>`;
}

function wrapJsLive(code: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#0a0a0b;color:#e8e8ea;font:14px/1.45 system-ui,sans-serif}
#root{min-height:40vh}
#out{margin:0;padding:10px;white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;color:#9aa;border-top:1px solid #222}
canvas{display:block;max-width:100%}
</style></head><body>
<div id="root"></div>
<pre id="out"></pre>
<script>
(function(){
  const o = document.getElementById("out");
  const line = (xs) => xs.map((x) => {
    try { return typeof x === "object" ? JSON.stringify(x) : String(x); }
    catch { return String(x); }
  }).join(" ");
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = (...a) => { o.textContent += line(a) + "\\n"; orig.log.apply(console, a); };
  console.error = (...a) => { o.textContent += "err: " + line(a) + "\\n"; orig.error.apply(console, a); };
  console.warn = (...a) => { o.textContent += "warn: " + line(a) + "\\n"; orig.warn.apply(console, a); };
  window.onerror = (m) => { o.textContent += String(m) + "\\n"; };
})();
</script>
<script>
${code}
</script>
</body></html>`;
}

function jsonTable(src: string): { text: string; rows?: string[][]; cols?: string[] } {
  try {
    const v = JSON.parse(src) as unknown;
    const text = JSON.stringify(v, null, 2);
    if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
      const cols = [...new Set(v.flatMap((x) => Object.keys(x as object)))].slice(0, 12);
      const rows = v.slice(0, 80).map((x) => cols.map((c) => {
        const n = (x as Record<string, unknown>)[c];
        if (n == null) return "";
        if (typeof n === "object") return JSON.stringify(n);
        return String(n);
      }));
      return { text, cols, rows };
    }
    return { text };
  } catch {
    return { text: src };
  }
}

function resolveRel(fromFile: string, rel: string): string {
  const raw = rel.trim().replace(/^['"]|['"]$/g, "");
  if (!raw || /^(https?:|data:|blob:|javascript:|\/\/|#)/i.test(raw)) return "";
  const cut = raw.split("?")[0].split("#")[0];
  const dir = parentDir(fromFile);
  const parts = [...(dir ? dir.split("/") : []), ...cut.split("/")];
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return cleanPath(out.join("/"));
}

function findFile(files: Record<string, string>, want: string): string | undefined {
  if (files[want] != null) return want;
  const low = want.toLowerCase();
  return Object.keys(files).find((p) => p.toLowerCase() === low);
}

export function inlineHtmlAssets(html: string, files: Record<string, string>, fromFile: string): string {
  let out = html;
  out = out.replace(/<link\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>/gi, (m, pre, href, post) => {
    if (!/\bstylesheet\b/i.test(`${pre} ${post}`)) return m;
    const path = findFile(files, resolveRel(fromFile, href));
    if (!path) return m;
    return `<style data-anvil-src="${path}">\n${files[path]}\n</style>`;
  });
  out = out.replace(/<script\b([^>]*?)src\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, pre, src, post) => {
    if (/\btype\s*=\s*["']module["']/i.test(`${pre} ${post}`)) return m;
    const path = findFile(files, resolveRel(fromFile, src));
    if (!path) return m;
    const code = /\.(ts|tsx)$/i.test(path) ? stripTs(files[path]) : files[path];
    return `<script data-anvil-src="${path}">\n${code}\n</script>`;
  });
  return out;
}

export function previewFor(
  path: string,
  src: string,
  files: Record<string, string>,
  last: RunResult | undefined,
  inputMap: InputMap,
  allowHtml = true,
): PreviewView {
  const lang: LangId = langFromPath(path);

  if (lang === "markdown") {
    return { kind: "md", html: renderMarkdown(rewriteRefMedia(src, files)) };
  }

  if (lang === "json") {
    return { kind: "json", ...jsonTable(src) };
  }

  if (lang === "css") {
    if (!allowHtml) return { kind: "empty", hint: HTML_RUN_OFF };
    const page = Object.keys(files).find((p) => p.endsWith(".html") || p.endsWith(".htm"));
    let html = page ? files[page] : cssDemo(src);
    if (page) {
      html = inlineHtmlAssets(html, files, page);
      html = /<\/head>/i.test(html)
        ? html.replace(/<\/head>/i, `<style>${src}</style></head>`)
        : `<style>${src}</style>${html}`;
    }
    return { kind: "iframe", srcDoc: withEngine(rewriteRefMedia(html, files), inputMap), live: true, label: "CSS" };
  }

  if (lang === "html") {
    if (!allowHtml) return { kind: "empty", hint: HTML_RUN_OFF };
    return {
      kind: "iframe",
      srcDoc: withEngine(inlineHtmlAssets(rewriteRefMedia(src, files), files, path), inputMap),
      live: true,
      label: "HTML",
    };
  }

  if (last?.stage?.kind === "window" || last?.stage?.kind === "log") {
    return {
      kind: "console",
      ok: last.ok,
      stdout: last.stdout || (last.stage.kind === "window" ? "Bühne: Fenster läuft." : ""),
      stderr: last.stderr,
      duration: last.duration,
      label: last.label,
    };
  }

  if (lang === "javascript" || lang === "typescript") {
    if (!allowHtml) {
      if (last) {
        return {
          kind: "console",
          ok: last.ok,
          stdout: last.stdout,
          stderr: last.stderr,
          duration: last.duration,
          label: last.label,
        };
      }
      return { kind: "empty", hint: HTML_RUN_OFF };
    }
    const page = Object.keys(files).find(
      (p) => /\.html?$/i.test(p) && files[p].includes(path.split("/").pop() ?? "\0"),
    );
    if (page) {
      return {
        kind: "iframe",
        srcDoc: withEngine(inlineHtmlAssets(rewriteRefMedia(files[page], files), files, page), inputMap),
        live: true,
        label: page,
      };
    }
    const js = lang === "typescript" ? stripTs(src) : src;
    const html = last?.html || (looksGraphical(js) ? wrapJsGame(js, inputMap) : wrapJsLive(js));
    return { kind: "iframe", srcDoc: html, live: !last?.html, label: langLabel(lang) };
  }

  if (last) {
    return {
      kind: "console",
      ok: last.ok,
      stdout: last.stdout,
      stderr: last.stderr,
      duration: last.duration,
      label: last.label,
    };
  }

  const hints: Partial<Record<LangId, string>> = {
    python: "Run: Python auf dem PC (Companion). Ohne Companion: Pyodide im Browser.",
    go: "Run: Go auf dem PC (Companion) oder Compiler im Netz.",
    rust: "Run: rustc/cargo lokal (Companion) oder Compiler im Netz.",
    java: "Run: javac lokal (Companion) oder Compiler im Netz.",
    c: "Run: cc/gcc lokal (Companion) oder Compiler im Netz.",
    cpp: "Run: c++/g++ lokal (Companion) oder Compiler im Netz.",
    csharp: "Run: dotnet lokal (Companion) oder Compiler im Netz.",
    php: "Run: php lokal (Companion) oder Compiler im Netz.",
    ruby: "Run: ruby lokal (Companion) oder Compiler im Netz.",
    plaintext: "Textdatei — keine Vorschau. Markdown (.md) wird gerendert.",
  };

  return { kind: "empty", hint: hints[lang] ?? `Run für ${langLabel(lang)} zeigt die Ausgabe hier.` };
}
