import { runRemote } from "./run-server";
import { langFromPath, type LangId } from "./languages";
import type { DebugFrame } from "@/store/ide";

export type TraceEvent = {
  path: string;
  line: number;
  fn: string;
  locals: Record<string, string>;
};

const MARK = "__ANVIL__";

const SKIP =
  /^(else\b|catch\b|finally\b|case\b|default\b|package\s|import\s|using\s|#include|typedef\b|public:|private:|protected:)/;

export function canDebug(path: string): boolean {
  const lang = langFromPath(path);
  return (
    lang === "python" ||
    lang === "javascript" ||
    lang === "typescript" ||
    lang === "go" ||
    lang === "rust" ||
    lang === "java" ||
    lang === "c" ||
    lang === "cpp" ||
    lang === "csharp" ||
    lang === "php" ||
    lang === "ruby"
  );
}

function skipLine(t: string): boolean {
  if (!t || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("#")) return true;
  if (t === "{" || t === "}" || t === "};" || t === ")" || t === "];") return true;
  if (SKIP.test(t)) return true;
  if (t === "end" || t.startsWith("<?")) return true;
  if (/^(fn |func |def |class |struct |enum |trait |impl |template |namespace )/.test(t)) return true;
  if (/^(public |private |protected |static ).*\{$/.test(t)) return true;
  return false;
}

function decls(lang: LangId, line: string): string[] {
  const out: string[] = [];
  if (lang === "go") {
    const m = line.match(/^\s*([\w,\s]+)\s*(?::=|=)[^=]/);
    if (m && !/^(if|for|switch|return|range)\b/.test(m[1].trim())) {
      for (const p of m[1].split(",")) {
        const n = p.trim();
        if (/^[A-Za-z_]\w*$/.test(n) && n !== "_") out.push(n);
      }
    }
  } else if (lang === "rust") {
    const m = line.match(/^\s*let\s+(?:mut\s+)?(\w+)/);
    if (m) out.push(m[1]);
  } else if (lang === "java") {
    const m = line.match(
      /^\s*(?:(?:public|private|protected|final|static)\s+)*(?:int|long|short|byte|float|double|boolean|char|var|String|[\w.]+)\s+(\w+)\s*[=;]/,
    );
    if (m) out.push(m[1]);
  } else if (lang === "c" || lang === "cpp") {
    const m = line.match(
      /^\s*(?:(?:const|static|unsigned|signed|long|short)\s+)*(?:int|char|float|double|bool|auto|size_t|[\w:]+)\s+(\w+)\s*[=;]/,
    );
    if (m) out.push(m[1]);
  }
  return out;
}

function probe(lang: LangId, n: number, path: string, names: string[], withLocals: boolean): string {
  const loc = withLocals ? names.slice(-12) : [];
  if (lang === "go") {
    const map = loc.map((id) => `"${id}": fmt.Sprint(${id})`).join(", ");
    return `__anvilDbg(${n}, ${JSON.stringify(path)}, map[string]string{${map}})`;
  }
  if (lang === "rust") {
    const pairs = loc.map((id) => `("${id}", format!("{:?}", ${id}))`).join(", ");
    return `__anvil_dbg(${n}, ${JSON.stringify(path)}, &[${pairs}]);`;
  }
  if (lang === "java") {
    const body = loc.length
      ? `"{"+${loc.map((id) => `"\\"${id}\\":\\""+String.valueOf(${id})+"\\""`).join(' + "," + ')}+"}"`
      : `"{}"`;
    return `__anvilDbg(${n}, ${JSON.stringify(path)}, ${body});`;
  }
  if (lang === "cpp") {
    const inner = loc.length
      ? loc.map((id) => `"\\"${id}\\":\\"" << (${id}) << "\\""`).join(" << ',' << ")
      : `""`;
    return `{ std::ostringstream __anvil_s; __anvil_s << "{\\"line\\":${n},\\"path\\":${JSON.stringify(path)},\\"locals\\":{" << ${inner} << "}}"; std::cerr << "${MARK}" << __anvil_s.str() << std::endl; }`;
  }
  if (lang === "c") {
    const fmt = loc.map((id) => `\\"${id}\\":\\"%d\\"`).join(",");
    const args = loc.map((id) => `(int)(${id})`).join(", ");
    return `fprintf(stderr, "${MARK}{\\"line\\":%d,\\"path\\":\\"%s\\",\\"locals\\":{${fmt}}}\\n", ${n}, ${JSON.stringify(path)}${args ? `, ${args}` : ""});`;
  }
  if (lang === "csharp") {
    return `System.Console.Error.WriteLine("${MARK}{\\"line\\":${n},\\"path\\":${JSON.stringify(path)},\\"locals\\":{}}");`;
  }
  if (lang === "php") {
    return `fwrite(STDERR, ${JSON.stringify(`${MARK}{"line":${n},"path":${JSON.stringify(path)},"locals":{}}\n`)});`;
  }
  if (lang === "ruby") {
    return `warn(${JSON.stringify(`${MARK}{"line":${n},"path":${JSON.stringify(path)},"locals":{}}`)});`;
  }
  return `__anvil_dbg(${n}, ${JSON.stringify(path)});`;
}

function helper(lang: LangId, src: string): { name: string; content: string } | null {
  if (lang === "go") {
    const pkg = src.match(/^package\s+(\w+)/m)?.[1] ?? "main";
    return {
      name: "anvil_dbg.go",
      content: `package ${pkg}
import (
	"encoding/json"
	"fmt"
	"os"
)
func __anvilDbg(line int, path string, locals map[string]string) {
	b, _ := json.Marshal(map[string]any{"line": line, "path": path, "fn": "", "locals": locals})
	fmt.Fprintln(os.Stderr, "${MARK}"+string(b))
}
`,
    };
  }
  return null;
}

function rustHelper(): string {
  return `fn __anvil_dbg(line: i32, path: &str, locals: &[(&str, String)]) {
    let mut s = String::from("{");
    for (i, (k, v)) in locals.iter().enumerate() {
        if i > 0 { s.push(','); }
        let ev = v.replace('\\\\', "\\\\\\\\").replace('"', "\\\\\\"").replace('\\n', " ");
        s.push('"');
        s.push_str(k);
        s.push_str("\\":\\"");
        s.push_str(&ev);
        s.push('"');
    }
    s.push('}');
    eprintln!("${MARK}{{\\"line\\":{},\\"path\\":\\"{}\\",\\"locals\\":{}}}", line, path, s);
}
`;
}

function javaHelper(): string {
  return `static void __anvilDbg(int line, String path, String locals) {
    System.err.println("${MARK}{\\"line\\":"+line+",\\"path\\":\\""+path+"\\",\\"fn\\":\\"\\",\\"locals\\":"+locals+"}");
}
`;
}

function cHelper(): string {
  return `static void __anvil_dbg(int line, const char *path) {
  fprintf(stderr, "${MARK}{\\"line\\":%d,\\"path\\":\\"%s\\",\\"locals\\":{}}\\n", line, path);
}
`;
}

function injectHelper(lang: LangId, src: string): string {
  if (lang === "rust") {
    const i = src.search(/\nfn |\npub fn /);
    if (i < 0) return `${rustHelper()}\n${src}`;
    return `${src.slice(0, i + 1)}${rustHelper()}${src.slice(i + 1)}`;
  }
  if (lang === "java") {
    const m = src.match(/class\s+\w+\s*\{/);
    if (!m || m.index == null) return src;
    const at = m.index + m[0].length;
    return src.slice(0, at) + "\n" + javaHelper() + src.slice(at);
  }
  if (lang === "c") {
    if (!src.includes("stdio.h")) src = `#include <stdio.h>\n${src}`;
    return src.replace(/(int\s+main\s*\()/, `${cHelper()}\n$1`);
  }
  if (lang === "cpp") {
    let next = src;
    if (!src.includes("<iostream>")) next = `#include <iostream>\n${next}`;
    if (!src.includes("<sstream>")) next = `#include <sstream>\n${next}`;
    return next;
  }
  return src;
}

export function instrumentRemote(lang: LangId, path: string, src: string, withLocals: boolean): string {
  const names: string[] = [];
  const lines = src.split("\n");
  const out: string[] = [];
  let hold = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (/^(import |use |using )/.test(t) && t.includes("(")) hold = true;
    if (hold) {
      out.push(line);
      if (t === ")" || t.endsWith(");") || t.endsWith("}")) hold = false;
      continue;
    }
    if (lang === "go") {
      const fn = t.match(/^func\s+(?:\([^)]*\)\s*)?(\w+)?\s*\(([^)]*)\)/);
      if (fn) {
        names.length = 0;
        for (const part of (fn[2] ?? "").split(",")) {
          const id = part.trim().split(/\s+/)[0];
          if (id && /^[A-Za-z_]\w*$/.test(id)) names.push(id);
        }
      }
    }
    if (skipLine(t)) {
      out.push(line);
      continue;
    }
    const n = i + 1;
    const indent = line.match(/^\s*/)?.[0] ?? "";
    out.push(`${indent}${probe(lang, n, path, names, withLocals)}`);
    out.push(line);
    for (const d of decls(lang, line)) {
      if (!names.includes(d)) names.push(d);
    }
  }
  return injectHelper(lang, out.join("\n"));
}

export function parseTrace(stdout: string, stderr: string): {
  events: TraceEvent[];
  stdout: string;
  stderr: string;
} {
  const events: TraceEvent[] = [];
  let out = "";
  let err = "";
  const eat = (chunk: string, isErr: boolean) => {
    for (const line of chunk.split("\n")) {
      const i = line.indexOf(MARK);
      if (i >= 0) {
        try {
          const j = JSON.parse(line.slice(i + MARK.length)) as {
            line?: number;
            path?: string;
            fn?: string;
            locals?: Record<string, string>;
          };
          events.push({
            path: j.path || "",
            line: Number(j.line ?? 0),
            fn: j.fn || "<module>",
            locals: j.locals ?? {},
          });
        } catch {
          if (isErr) err += `${line}\n`;
          else out += `${line}\n`;
        }
      } else if (isErr) err += line ? `${line}\n` : "";
      else out += line ? `${line}\n` : "";
    }
  };
  eat(stdout, false);
  eat(stderr, true);
  return { events, stdout: out.trim(), stderr: err.trim() };
}

export async function collectRemoteTrace(
  path: string,
  files: Record<string, string>,
  withLocals = true,
): Promise<{ events: TraceEvent[]; stdout: string; stderr: string }> {
  const lang = langFromPath(path);
  const src = files[path] ?? "";
  const instrumented = instrumentRemote(lang, path, src, withLocals);
  const extra = helper(lang, src);
  const pack = extra
    ? [
        { path, content: instrumented },
        ...Object.entries(files)
          .filter(([p]) => p !== path)
          .map(([p, content]) => ({ path: p, content })),
        { path: extra.name, content: extra.content },
      ]
    : [
        { path, content: instrumented },
        ...Object.entries(files)
          .filter(([p]) => p !== path)
          .map(([p, content]) => ({ path: p, content })),
      ];
  const remote = await runRemote({
    data: {
      lang,
      entry: path,
      files: pack.filter((f) => f.content.length < 80_000),
    },
  });
  const parsed = parseTrace(remote.stdout, remote.stderr);
  if (!parsed.events.length && remote.stderr && withLocals) {
    return collectRemoteTrace(path, files, false);
  }
  if (!parsed.events.length && remote.stderr) {
    return { events: [], stdout: parsed.stdout, stderr: parsed.stderr || remote.stderr };
  }
  return parsed;
}

export function stackOf(ev: TraceEvent): DebugFrame[] {
  return [{ path: ev.path, line: ev.line, fn: ev.fn || "<module>" }];
}
