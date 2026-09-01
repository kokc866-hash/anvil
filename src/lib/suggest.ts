import { grammarOf } from "@/lib/syntax";
import { langFromPath } from "@/lib/languages";
import { vscodeSnippets } from "@/lib/plugins/vscode";
import { profile } from "@/lib/learn";

export type Suggestion = {
  text: string;
  rest: string;
  kind: "kw" | "id" | "snip" | "path";
  insert: string;
};

const SNIPS: Record<string, Record<string, string>> = {
  python: {
    def: "def name():\n    pass",
    class: "class Name:\n    pass",
    if: "if :\n    ",
    for: "for x in :\n    ",
    while: "while :\n    ",
    try: "try:\n    \nexcept Exception as err:\n    ",
    with: "with open() as f:\n    ",
    import: "import ",
    from: "from  import ",
    async: "async def name():\n    ",
    print: "print()",
    return: "return ",
  },
  javascript: {
    function: "function name() {\n  \n}",
    const: "const  = ",
    let: "let  = ",
    if: "if () {\n  \n}",
    for: "for (const x of ) {\n  \n}",
    while: "while () {\n  \n}",
    class: "class Name {\n  \n}",
    import: "import  from \"\"",
    export: "export ",
    async: "async function name() {\n  \n}",
    try: "try {\n  \n} catch (err) {\n  \n}",
    return: "return ",
    console: "console.log()",
  },
  typescript: {},
  go: {
    func: "func name() {\n\t\n}",
    if: "if  {\n\t\n}",
    for: "for  {\n\t\n}",
    type: "type Name struct {\n\t\n}",
    package: "package main",
  },
  rust: {
    fn: "fn name() {\n    \n}",
    let: "let  = ",
    if: "if  {\n    \n}",
    match: "match  {\n    _ => {}\n}",
    impl: "impl  {\n    \n}",
    struct: "struct Name {\n    \n}",
  },
  java: {
    class: "class Name {\n    \n}",
    if: "if () {\n    \n}",
    for: "for (int i = 0; i < ; i++) {\n    \n}",
    public: "public ",
  },
  csharp: {
    class: "class Name {\n    \n}",
    if: "if () {\n    \n}",
    for: "for (int i = 0; i < ; i++) {\n    \n}",
    foreach: "foreach (var x in ) {\n    \n}",
    public: "public ",
  },
  php: {
    function: "function name() {\n    \n}",
    if: "if () {\n    \n}",
    foreach: "foreach ( as $x) {\n    \n}",
    class: "class Name {\n    \n}",
    echo: "echo ",
  },
  ruby: {
    def: "def name\n  \nend",
    if: "if \n  \nend",
    class: "class Name\n  \nend",
    do: "do |x|\n  \nend",
    puts: "puts ",
  },
  html: {
    div: "<div>\n  \n</div>",
    span: "<span></span>",
    script: "<script>\n  \n</script>",
    style: "<style>\n  \n</style>",
  },
};
SNIPS.typescript = { ...SNIPS.javascript };

function wordsOf(src: string): string[] {
  return src.match(/\b[A-Za-z_][\w]{1,48}\b/g) ?? [];
}

function bigrams(src: string): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  const ws = wordsOf(src);
  for (let i = 0; i < ws.length - 1; i++) {
    const a = ws[i];
    const b = ws[i + 1];
    let inner = map.get(a);
    if (!inner) {
      inner = new Map();
      map.set(a, inner);
    }
    inner.set(b, (inner.get(b) ?? 0) + 1);
  }
  return map;
}

export function prefixAt(lineToCursor: string): { prefix: string; prev: string } {
  const m = lineToCursor.match(/[A-Za-z_$#][\w$]*$/);
  const prefix = m?.[0] ?? "";
  const before = lineToCursor.slice(0, lineToCursor.length - prefix.length);
  const p = before.match(/[A-Za-z_][\w]*\s*$/);
  return { prefix, prev: p?.[0]?.trim() ?? "" };
}

export function suggest(opts: {
  source: string;
  prefix: string;
  prev: string;
  lang: string;
  files?: Record<string, string>;
  path?: string;
}): Suggestion[] {
  const prefix = opts.prefix;
  if (!prefix || prefix.length < 1) return [];
  const low = prefix.toLowerCase();
  const g = grammarOf(opts.lang);
  const pool = new Map<string, Suggestion>();
  const add = (text: string, kind: Suggestion["kind"], insert?: string, scoreBoost = 0) => {
    if (!text.toLowerCase().startsWith(low)) return;
    if (text === prefix) return;
    const cur = pool.get(text);
    const item: Suggestion = {
      text,
      rest: text.slice(prefix.length),
      kind,
      insert: insert ?? text,
    };
    if (!cur || scoreBoost > 0) pool.set(text, item);
    void scoreBoost;
  };

  for (const k of g?.keywords ?? []) add(k, "kw");
  for (const k of g?.builtins ?? []) add(k, "id");
  for (const k of g?.types ?? []) add(k, "id");
  const snips = { ...(SNIPS[opts.lang] ?? {}), ...vscodeSnippets(opts.lang) };
  for (const [k, body] of Object.entries(snips)) add(k, "snip", body);

  const ids = new Set<string>();
  for (const w of wordsOf(opts.source)) {
    if (w.length > 1) ids.add(w);
  }
  if (opts.files) {
    for (const [p, c] of Object.entries(opts.files)) {
      if (p === opts.path) continue;
      if (langFromPath(p) !== opts.lang && !/\.(py|js|ts|go|rs|cs|php|rb|java|c|cpp)$/.test(p)) continue;
      for (const w of wordsOf(c).slice(0, 400)) if (w.length > 2) ids.add(w);
    }
  }
  for (const w of ids) add(w, "id");

  if (opts.files) {
    for (const p of Object.keys(opts.files)) {
      const name = p.split("/").pop() ?? "";
      if (name.toLowerCase().startsWith(low)) add(name, "path", name);
    }
  }

  const bi = opts.prev ? bigrams(opts.source).get(opts.prev) : undefined;
  const scored = [...pool.values()].map((s) => {
    let n = 0;
    if (s.kind === "snip") n += 30;
    if (s.kind === "kw") n += 20;
    if (opts.lang && opts.lang === profile().topLang && s.kind === "snip") n += 18;
    if (s.text.toLowerCase() === low) n += 50;
    if (bi?.has(s.text)) n += 10 + (bi.get(s.text) ?? 0);
    n += Math.max(0, 12 - (s.text.length - prefix.length));
    return { s, n };
  });
  scored.sort((a, b) => b.n - a.n || a.s.text.localeCompare(b.s.text));
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const { s } of scored) {
    const key = s.insert;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 3) break;
  }
  return out;
}
