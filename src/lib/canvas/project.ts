import type * as TypeScript from "typescript";
import { omitSecrets } from "../ref.ts";

const ROOT = "https://anvil-project.invalid/";
let compiler: Promise<typeof TypeScript> | undefined;
const ts = () => (compiler ||= import("typescript").then((m) => m.default || m));
const dataUrl = (type: string, text: string) =>
  `data:${type};charset=utf-8,${encodeURIComponent(text)}`;
const quote = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
export const jsonScript = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export async function transpileScript(code: string, path = "main.ts"): Promise<string> {
  const compiler = await ts();
  const result = compiler.transpileModule(code, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      target: compiler.ScriptTarget.ES2022,
      module: compiler.ModuleKind.ESNext,
      jsx: compiler.JsxEmit.ReactJSX,
      isolatedModules: true,
      sourceMap: false,
      inlineSourceMap: false,
    },
  });
  const errors =
    result.diagnostics?.filter((d) => d.category === compiler.DiagnosticCategory.Error) || [];
  if (errors.length)
    throw new Error(
      `${path}: ${errors.map((d) => compiler.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n")}`,
    );
  return result.outputText;
}

function decodeAttribute(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (m, name: string) => {
    if (name[0] !== "#")
      return (
        ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" } as Record<string, string>)[
          name.toLowerCase()
        ] || m
      );
    const n = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\ufffd";
  });
}
function attributes(source: string) {
  const result = new Map<string, string>();
  for (const m of source.matchAll(/([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
    result.set(m[1].toLowerCase(), decodeAttribute(m[2] ?? m[3] ?? m[4] ?? ""));
  return result;
}
function attrs(values: Map<string, string>) {
  return [...values].map(([k, v]) => ` ${k}="${quote(v)}"`).join("");
}

/** Resolve the actual script URL, rather than matching filenames in arbitrary HTML text. */
export function projectHtmlEntry(path: string, files: Record<string, string>, module = false) {
  const wanted = path.replace(/\\/g, "/").toLowerCase();
  const pages = Object.keys(files).filter((p) => /\.html?$/i.test(p));
  const direct = pages.find((page) =>
    [...files[page].matchAll(/<script\b([^>]*)>/gi)].some((match) => {
      const src = attributes(match[1]).get("src");
      return src && resolvePath(page, src).toLowerCase() === wanted;
    }),
  );
  return (
    direct ||
    (module
      ? pages.find((p) => /^index\.html?$/i.test(p)) ||
        pages.find((p) => /(?:^|\/)index\.html?$/i.test(p))
      : undefined)
  );
}
function resolvePath(from: string, rel: string) {
  if (/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(rel)) return "";
  try {
    const url = new URL(rel, ROOT + from);
    return url.origin === new URL(ROOT).origin ? decodeURIComponent(url.pathname.slice(1)) : "";
  } catch {
    return "";
  }
}
function mime(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  return (
    (
      {
        svg: "image/svg+xml",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        avif: "image/avif",
        ico: "image/x-icon",
        json: "application/json",
        txt: "text/plain",
        css: "text/css",
        woff: "font/woff",
        woff2: "font/woff2",
        mp3: "audio/mpeg",
        wav: "audio/wav",
        mp4: "video/mp4",
      } as Record<string, string>
    )[ext || ""] || "text/plain"
  );
}

/** One project representation for inline preview, popout, and agent Run. */
export async function prepareHtmlProject(
  html: string,
  files: Record<string, string>,
  entry: string,
): Promise<string> {
  files = omitSecrets(files);
  const keys = new Map(Object.keys(files).map((p) => [p.toLowerCase(), p]));
  const find = (path: string) => keys.get(path.toLowerCase());
  const imported = new Map<string, string>();
  const imports: Record<string, string> = {};
  const loading = new Set<string>();
  const assetCache = new Map<string, string>();
  function asset(rel: string, from: string): string {
    const path = find(resolvePath(from, rel));
    if (!path) return rel;
    if (assetCache.has(path)) {
      const cached = assetCache.get(path)!;
      if (!cached) throw new Error("Zyklischer CSS-Import: " + path);
      return cached;
    }
    const content = files[path];
    const stored = content.match(/^\[image[^\n]*\]\s*(data:[\s\S]+)$/i)?.[1] || content;
    if (/^data:[\w/+.-]+[;,]/i.test(stored)) return stored;
    if (/\.(png|jpe?g|gif|webp|woff2?|mp3|wav|mp4)$/i.test(path))
      throw new Error("Binärdatei ist nicht als Bild-/Datendatei verfügbar: " + path);
    assetCache.set(path, "");
    const result = dataUrl(mime(path), /\.css$/i.test(path) ? css(content, path) : content);
    assetCache.set(path, result);
    return result;
  }
  function css(source: string, from: string): string {
    return source
      .replace(
        /url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)/gi,
        (_m, a, b, c) => `url(${JSON.stringify(asset((a ?? b ?? c).trim(), from))})`,
      )
      .replace(
        /@import\s+(['"])([^'"]+)\1/gi,
        (_m, _q, rel) => `@import ${JSON.stringify(asset(rel, from))}`,
      );
  }
  async function moduleSource(source: string, path: string) {
    const compiler = await ts();
    const code = /\.[cm]?tsx?$/i.test(path) ? await transpileScript(source, path) : source;
    const tree = compiler.createSourceFile(
      path,
      code,
      compiler.ScriptTarget.Latest,
      true,
      compiler.ScriptKind.JS,
    );
    const replacements: { start: number; end: number; value: string }[] = [];
    const dependencies: string[] = [];
    function visit(node: TypeScript.Node) {
      let literal: TypeScript.StringLiteralLike | undefined;
      if (
        (compiler.isImportDeclaration(node) || compiler.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        compiler.isStringLiteralLike(node.moduleSpecifier)
      )
        literal = node.moduleSpecifier;
      if (
        compiler.isCallExpression(node) &&
        node.expression.kind === compiler.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        compiler.isStringLiteralLike(node.arguments[0])
      )
        literal = node.arguments[0];
      if (literal) {
        let specifier = literal.text;
        if (specifier.startsWith(".") || specifier.startsWith("/")) {
          const wanted = resolvePath(path, specifier);
          const local =
            find(wanted) ||
            find(wanted.replace(/\.js$/i, ".ts")) ||
            find(wanted + ".js") ||
            find(wanted + ".ts") ||
            find(wanted + "/index.js");
          if (!local) throw new Error(`${path}: Modul nicht gefunden: ${specifier}`);
          dependencies.push(local);
          specifier = ROOT + local;
          replacements.push({
            start: literal.getStart(tree),
            end: literal.getEnd(),
            value: JSON.stringify(specifier),
          });
        }
      }
      compiler.forEachChild(node, visit);
    }
    visit(tree);
    let result = code;
    for (const r of replacements.sort((a, b) => b.start - a.start))
      result = result.slice(0, r.start) + r.value + result.slice(r.end);
    for (const dep of dependencies) await moduleFile(dep);
    return result + "\n//# sourceURL=anvil-project/" + path.replace(/[\r\n]/g, "");
  }
  async function moduleFile(path: string): Promise<void> {
    if (imported.has(path) || loading.has(path)) return;
    loading.add(path);
    const code = await moduleSource(files[path], path);
    const url = dataUrl("text/javascript", code);
    imported.set(path, url);
    imports[ROOT + path] = url;
    loading.delete(path);
  }
  // Preserve user policies. An incompatible sandbox preview fails explicitly instead of silently bypassing CSP.
  for (const m of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const a = attributes(m[1]);
    if (a.get("http-equiv")?.toLowerCase() === "content-security-policy") {
      const policy = a.get("content") || "";
      const directives = new Map(
        policy.split(";").map((d) => {
          const [name, ...v] = d.trim().split(/\s+/);
          return [name, v] as const;
        }),
      );
      const scripts =
        directives.get("script-src-elem") ||
        directives.get("script-src") ||
        directives.get("default-src");
      if (scripts && (!scripts.includes("'unsafe-inline'") || !scripts.includes("data:")))
        throw new Error(
          "Die Content-Security-Policy dieses Dokuments blockiert die instrumentierte Vorschau (Inline-/data:-Skripte). Die Originalrichtlinie bleibt erhalten. Für diese Seite einen regulären Webserver verwenden.",
        );
    }
  }
  const scriptMatches = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const replacements: { start: number; end: number; value: string }[] = [];
  for (const match of scriptMatches) {
    const a = attributes(match[1]),
      src = a.get("src"),
      type = a.get("type")?.toLowerCase();
    if (type === "importmap") {
      try {
        Object.assign(imports, JSON.parse(match[2]).imports || {});
      } catch {
        throw new Error("Ungültige Import-Map in " + entry);
      }
      replacements.push({ start: match.index!, end: match.index! + match[0].length, value: "" });
      continue;
    }
    if (
      type &&
      !["module", "text/javascript", "application/javascript", "text/typescript"].includes(type)
    )
      continue;
    let code = match[2],
      path = entry;
    if (src) {
      const local = find(resolvePath(entry, src));
      if (!local) continue;
      path = local;
      code = files[path];
      a.set("data-anvil-src", path);
    }
    if (type === "module") {
      if (src) {
        await moduleFile(path);
        a.set("src", imported.get(path)!);
      } else {
        code = await moduleSource(code, entry);
        a.set("src", dataUrl("text/javascript", code));
      }
    } else if (src || type === "text/typescript") {
      if (/\.[cm]?tsx?$/i.test(path) || type === "text/typescript")
        code = await transpileScript(code, path);
      a.delete("integrity");
      if (type === "text/typescript") a.set("type", "text/javascript");
      a.set(
        "src",
        dataUrl(
          "text/javascript",
          code + "\n//# sourceURL=anvil-project/" + path.replace(/[\r\n]/g, ""),
        ),
      );
    } else {
      continue;
    }
    replacements.push({
      start: match.index!,
      end: match.index! + match[0].length,
      value: `<script${attrs(a)}></script>`,
    });
  }
  for (const r of replacements.sort((a, b) => b.start - a.start))
    html = html.slice(0, r.start) + r.value + html.slice(r.end);
  html = html
    .split(/(<script\b[^>]*>[\s\S]*?<\/script\s*>)/gi)
    .map((part) => {
      if (/^<script\b/i.test(part)) return part;
      part = part.replace(
        /<(link|img|source|audio|video|input)\b([^>]*)>/gi,
        (match, name, raw) => {
          const a = attributes(raw),
            from = entry;
          for (const attribute of name.toLowerCase() === "link" ? ["href"] : ["src", "poster"])
            if (a.has(attribute)) a.set(attribute, asset(a.get(attribute)!, from));
          if (a.has("srcset") && !a.get("srcset")!.includes("data:"))
            a.set(
              "srcset",
              a
                .get("srcset")!
                .split(",")
                .map((item) => {
                  const [src, ...rest] = item.trim().split(/\s+/);
                  return [asset(src, from), ...rest].join(" ");
                })
                .join(", "),
            );
          return `<${name}${attrs(a)}>`;
        },
      );
      part = part.replace(
        /<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
        (_m, a, code) => `<style${a}>${css(code, entry)}</style>`,
      );
      return part;
    })
    .join("");
  const virtualFiles: Record<string, { type: string; body: string }> = {};
  for (const [path, body] of Object.entries(files)) {
    if (/(^|\/)\.(?:env|anvil)(?:\.|\/|$)/i.test(path) || /^ref\/private\//i.test(path)) continue;
    virtualFiles[path] = {
      type: mime(path),
      body: body.match(/^\[image[^\n]*\]\s*(data:[\s\S]+)$/i)?.[1] || body,
    };
  }
  const bootstrap =
    `<script data-anvil-project>(${installProjectFetch.toString()})(window,${jsonScript(virtualFiles)},${jsonScript(entry)});</script>` +
    (Object.keys(imports).length
      ? `<script type="importmap">${jsonScript({ imports })}</script>`
      : "");
  // Engine injection happens later, before this bootstrap and every user script.
  return /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, (m) => m + bootstrap)
    : bootstrap + html;
}

function installProjectFetch(
  win: Window & typeof globalThis,
  files: Record<string, { type: string; body: string }>,
  entry: string,
) {
  const original = win.fetch.bind(win);
  (win as unknown as { __ANVIL_ASSET__: (path: string) => string }).__ANVIL_ASSET__ = (rel) => {
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(rel)) return rel;
    const path = decodeURIComponent(
      new win.URL(rel, "https://anvil-project.invalid/" + entry).pathname.slice(1),
    );
    const file = files[path];
    if (!file) return rel;
    if (file.body.startsWith("data:")) return file.body;
    return `data:${file.type};charset=utf-8,${encodeURIComponent(file.body)}`;
  };
  win.fetch = async (input, init) => {
    const value =
      typeof input === "string" ? input : input instanceof win.URL ? input.href : input.url;
    if (!/^(?:[a-z][\w+.-]*:|\/\/)/i.test(value)) {
      const path = decodeURIComponent(
        new win.URL(value, "https://anvil-project.invalid/" + entry).pathname.slice(1),
      );
      const file = files[path];
      if (file) {
        if (init?.signal?.aborted) throw new win.DOMException("Abgebrochen", "AbortError");
        if (
          (init?.method || (input instanceof win.Request ? input.method : "GET")).toUpperCase() !==
          "GET"
        )
          return new win.Response("Projektdateien sind schreibgeschützt.", { status: 405 });
        if (file.body.startsWith("data:")) return original(file.body, init);
        return new win.Response(file.body, { headers: { "Content-Type": file.type } });
      }
      return new win.Response("Projektdatei nicht gefunden: " + path, { status: 404 });
    }
    return original(input, init);
  };
}
