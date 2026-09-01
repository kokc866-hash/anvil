export type TokenKind =
  | "kw"
  | "type"
  | "fn"
  | "string"
  | "comment"
  | "num"
  | "op"
  | "punct"
  | "attr"
  | "tag"
  | "macro"
  | "text";

export type SyntaxToken = { text: string; kind: TokenKind };

export type Grammar = {
  id: string;
  aliases?: string[];
  keywords: string[];
  types?: string[];
  builtins?: string[];
  lineComment?: string;
  blockComment?: [string, string];
  hex?: boolean;
  ignoreCase?: boolean;
  scan?: (src: string) => SyntaxToken[];
};

const grammars = new Map<string, Grammar>();
const alias = new Map<string, string>();

export function registerGrammar(g: Grammar) {
  grammars.set(g.id, g);
  alias.set(g.id, g.id);
  for (const a of g.aliases ?? []) alias.set(a.toLowerCase(), g.id);
}

export function grammarOf(lang: string): Grammar | undefined {
  const id = alias.get(lang.toLowerCase()) ?? lang.toLowerCase();
  return grammars.get(id);
}

export function listGrammars(): Grammar[] {
  return [...grammars.values()];
}

export function tokenize(code: string, lang = "plaintext"): SyntaxToken[] {
  if (!code) return [];
  if (code.length > 200_000) return [{ text: code, kind: "text" }];
  const g = grammarOf(lang);
  if (!g) return [{ text: code, kind: "text" }];
  if (g.scan) return g.scan(code);
  return scanGeneric(code, g);
}

export function tokensToHtml(tokens: SyntaxToken[]): string {
  return tokens.map((t) => `<span class="tok-${t.kind}">${esc(t.text)}</span>`).join("");
}

export function esc(s: string): string {
  const amp = "&" + "amp;";
  const lt = "&" + "lt;";
  const gt = "&" + "gt;";
  const quot = "&" + "quot;";
  return s
    .replace(/&/g, amp)
    .replace(/</g, lt)
    .replace(/>/g, gt)
    .replace(/"/g, quot)
    .replace(/'/g, "&#39;");
}

export function clsOf(kind: TokenKind): string {
  return `tok-${kind}`;
}

function scanGeneric(src: string, g: Grammar): SyntaxToken[] {
  const kw = new Set(g.keywords);
  const types = new Set(g.types ?? []);
  const builtins = new Set(g.builtins ?? []);
  const out: SyntaxToken[] = [];
  let i = 0;
  const n = src.length;
  const line = g.lineComment;
  const block = g.blockComment;

  const push = (text: string, kind: TokenKind) => {
    if (text) out.push({ text, kind });
  };

  while (i < n) {
    const ch = src[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      let j = i + 1;
      while (j < n && " \t\n\r".includes(src[j])) j++;
      push(src.slice(i, j), "text");
      i = j;
      continue;
    }

    if (block && src.startsWith(block[0], i)) {
      const end = src.indexOf(block[1], i + block[0].length);
      const j = end < 0 ? n : end + block[1].length;
      push(src.slice(i, j), "comment");
      i = j;
      continue;
    }

    if (line && src.startsWith(line, i)) {
      let j = i + line.length;
      while (j < n && src[j] !== "\n") j++;
      push(src.slice(i, j), "comment");
      i = j;
      continue;
    }

    if (ch === "#" && /c|cpp/.test(g.id)) {
      let j = i + 1;
      while (j < n && src[j] !== "\n") j++;
      push(src.slice(i, j), "macro");
      i = j;
      continue;
    }

    if (ch === "@") {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j])) j++;
      push(src.slice(i, j), "attr");
      i = j;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\" && q !== "'") {
          j += 2;
          continue;
        }
        if (src[j] === q) {
          j++;
          break;
        }
        if (src[j] === "\n" && q !== "`" && g.id !== "python") break;
        j++;
      }
      push(src.slice(i, j), "string");
      i = j;
      continue;
    }

    if (g.id === "python" && (src.startsWith('"""', i) || src.startsWith("'''", i))) {
      const q = src.slice(i, i + 3);
      const end = src.indexOf(q, i + 3);
      const j = end < 0 ? n : end + 3;
      push(src.slice(i, j), "string");
      i = j;
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      let j = i + 1;
      if (g.hex && ch === "0" && (src[j] === "x" || src[j] === "X")) {
        j++;
        while (j < n && /[0-9a-fA-F_]/.test(src[j])) j++;
      } else {
        while (j < n && /[0-9_]/.test(src[j])) j++;
        if (src[j] === ".") {
          j++;
          while (j < n && /[0-9_]/.test(src[j])) j++;
        }
        if (src[j] === "e" || src[j] === "E") {
          j++;
          if (src[j] === "+" || src[j] === "-") j++;
          while (j < n && /[0-9]/.test(src[j])) j++;
        }
      }
      push(src.slice(i, j), "num");
      i = j;
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j++;
      const w = src.slice(i, j);
      let k: TokenKind = "text";
      if (kw.has(w) || (g.ignoreCase && kw.has(w.toLowerCase()))) k = "kw";
      else if (types.has(w) || /^[A-Z][A-Za-z0-9_]+$/.test(w)) k = "type";
      else if (builtins.has(w)) k = "fn";
      else {
        let p = j;
        while (p < n && (src[p] === " " || src[p] === "\t")) p++;
        if (src[p] === "(") k = "fn";
      }
      push(w, k);
      i = j;
      continue;
    }

    let j = i + 1;
    while (j < n && /[()[\]{}.,:;+\-*/%=<>!&|^~?\\]/.test(src[j]) && src[j] !== "\n") j++;
    const op = src.slice(i, j);
    push(op, /[()[\]{},.;]/.test(op) ? "punct" : "op");
    i = j;
  }
  return out.length ? out : [{ text: src, kind: "text" }];
}

export function scanHtml(src: string): SyntaxToken[] {
  const out: SyntaxToken[] = [];
  let i = 0;
  const n = src.length;
  const push = (t: string, k: TokenKind) => t && out.push({ text: t, kind: k });
  while (i < n) {
    if (src.startsWith("<!--", i)) {
      const e = src.indexOf("-->", i + 4);
      const j = e < 0 ? n : e + 3;
      push(src.slice(i, j), "comment");
      i = j;
      continue;
    }
    if (src[i] === "<") {
      const end = src.indexOf(">", i);
      const j = end < 0 ? n : end + 1;
      const tag = src.slice(i, j);
      const m = tag.match(/^(<\/?)([A-Za-z][\w:-]*)([\s\S]*)(>)$/);
      if (m) {
        push(m[1], "punct");
        push(m[2], "tag");
        scanAttrs(m[3], out);
        push(m[4], "punct");
      } else push(tag, "tag");
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < n && src[j] !== "<") j++;
    push(src.slice(i, j), "text");
    i = j;
  }
  return out;
}

function scanAttrs(s: string, out: SyntaxToken[]) {
  const re = /(\s+)|([A-Za-z_:][\w:.-]*)|(=)|("[^"]*"|'[^']*')|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1]) out.push({ text: m[1], kind: "text" });
    else if (m[2]) out.push({ text: m[2], kind: "attr" });
    else if (m[3]) out.push({ text: m[3], kind: "op" });
    else if (m[4]) out.push({ text: m[4], kind: "string" });
    else if (m[5]) out.push({ text: m[5], kind: "text" });
  }
}

export function scanJson(src: string): SyntaxToken[] {
  const out: SyntaxToken[] = [];
  let i = 0;
  const n = src.length;
  const push = (t: string, k: TokenKind) => t && out.push({ text: t, kind: k });
  while (i < n) {
    const ch = src[i];
    if (" \t\n\r".includes(ch)) {
      let j = i + 1;
      while (j < n && " \t\n\r".includes(src[j])) j++;
      push(src.slice(i, j), "text");
      i = j;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') {
        if (src[j] === "\\") j += 2;
        else j++;
      }
      if (j < n) j++;
      const str = src.slice(i, j);
      let p = j;
      while (p < n && " \t\n\r".includes(src[p])) p++;
      push(str, src[p] === ":" ? "attr" : "string");
      i = j;
      continue;
    }
    if (/[0-9-]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[0-9.eE+-]/.test(src[j])) j++;
      push(src.slice(i, j), "num");
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z]/.test(src[j])) j++;
      const w = src.slice(i, j);
      push(w, w === "true" || w === "false" || w === "null" ? "kw" : "text");
      i = j;
      continue;
    }
    push(ch, /[{}[\],:]/.test(ch) ? "punct" : "op");
    i++;
  }
  return out;
}

export function scanCss(src: string): SyntaxToken[] {
  const out: SyntaxToken[] = [];
  let i = 0;
  const n = src.length;
  const push = (t: string, k: TokenKind) => t && out.push({ text: t, kind: k });
  while (i < n) {
    if (src.startsWith("/*", i)) {
      const e = src.indexOf("*/", i + 2);
      const j = e < 0 ? n : e + 2;
      push(src.slice(i, j), "comment");
      i = j;
      continue;
    }
    const ch = src[i];
    if (" \t\n\r".includes(ch)) {
      push(ch, "text");
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const q = ch;
      let j = i + 1;
      while (j < n && src[j] !== q) j++;
      push(src.slice(i, j + 1), "string");
      i = j + 1;
      continue;
    }
    if (ch === "#" || (ch >= "0" && ch <= "9")) {
      let j = i + 1;
      while (j < n && /[\w.%#]/.test(src[j])) j++;
      push(src.slice(i, j), "num");
      i = j;
      continue;
    }
    if (/[A-Za-z_-]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[\w-]/.test(src[j])) j++;
      const w = src.slice(i, j);
      let p = j;
      while (p < n && " \t".includes(src[p])) p++;
      push(w, src[p] === ":" ? "attr" : src[p] === "(" ? "fn" : /^(and|or|not|from|to|important)$/.test(w) ? "kw" : "tag");
      i = j;
      continue;
    }
    push(ch, /[{}:;,]/.test(ch) ? "punct" : "op");
    i++;
  }
  return out;
}

export function scanMarkdown(src: string): SyntaxToken[] {
  const out: SyntaxToken[] = [];
  for (const line of src.split(/(\n)/)) {
    if (line === "\n") {
      out.push({ text: line, kind: "text" });
      continue;
    }
    if (/^#{1,6} /.test(line)) {
      out.push({ text: line, kind: "kw" });
      continue;
    }
    if (/^```/.test(line) || /^---+$/.test(line)) {
      out.push({ text: line, kind: "punct" });
      continue;
    }
    if (/^[\-*+] /.test(line) || /^\d+\. /.test(line)) {
      const sp = line.indexOf(" ");
      out.push({ text: line.slice(0, sp + 1), kind: "op" });
      out.push({ text: line.slice(sp + 1), kind: "text" });
      continue;
    }
    out.push({ text: line, kind: "text" });
  }
  return out;
}
