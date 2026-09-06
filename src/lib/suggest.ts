import { grammarOf } from "@/lib/syntax";
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

type Tokens = { source: string; words: string[]; pairs: Map<string, Map<string, number>> };
const tokenCache = new Map<string, Tokens>();
function tokens(key: string, source: string, limit = 12000): Tokens {
  const cached = tokenCache.get(key);
  if (cached?.source === source) return cached;
  const words: string[] = [], pairs = new Map<string, Map<string, number>>();
  const re = /\b[A-Za-z_][\w]{1,48}\b/g;
  let m: RegExpExecArray | null;
  // Limit extraction itself, rather than slicing the result of a full-file scan.
  while (words.length < limit && (m = re.exec(source))) {
    const prev = words.at(-1), word = m[0];
    if (prev) { const row = pairs.get(prev) ?? new Map<string, number>(); row.set(word, (row.get(word) ?? 0) + 1); pairs.set(prev, row); }
    words.push(word);
  }
  const result = { source, words: [...new Set(words)], pairs };
  tokenCache.set(key, result);
  if (tokenCache.size > 2501) tokenCache.delete(tokenCache.keys().next().value!);
  return result;
}
let projectSource: Record<string, string> | undefined;
let projectWords: string[] = [];
function workspaceWords(files: Record<string, string>): string[] {
  if (files === projectSource) return projectWords;
  const words = new Set<string>();
  for (const [p, c] of Object.entries(files)) {
    if (!/\.(py|js|ts|tsx|jsx|go|rs|cs|php|rb|java|c|cpp)$/.test(p)) continue;
    for (const w of tokens(p, c, 400).words) if (w.length > 2) words.add(w);
  }
  for (const p of tokenCache.keys()) if (p !== "@active" && !(p in files)) tokenCache.delete(p);
  projectSource = files; projectWords = [...words];
  return projectWords;
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

  const current = tokens("@active", opts.source);
  for (const w of current.words) add(w, "id");
  if (opts.files) for (const w of workspaceWords(opts.files)) add(w, "id");

  if (opts.files) {
    for (const p of Object.keys(opts.files)) {
      const name = p.split("/").pop() ?? "";
      if (name.toLowerCase().startsWith(low)) add(name, "path", name);
    }
  }

  const bi = opts.prev ? current.pairs.get(opts.prev) : undefined;
  const learned = profile();
  const scored = [...pool.values()].map((s) => {
    let n = 0;
    if (s.kind === "snip") n += 30;
    if (s.kind === "kw") n += 20;
    if (opts.lang && opts.lang === learned.topLang && s.kind === "snip") n += 18;
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
