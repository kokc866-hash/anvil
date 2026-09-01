import {
  registerGrammar,
  scanCss,
  scanHtml,
  scanJson,
  scanMarkdown,
  type Grammar,
} from "./engine";

const JS = [
  "async", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "default", "delete", "do", "else", "export", "extends", "false",
  "finally", "for", "function", "if", "import", "in", "instanceof", "let",
  "new", "null", "of", "return", "static", "super", "switch", "this", "throw",
  "true", "try", "typeof", "undefined", "var", "void", "while", "with", "yield",
  "from", "as", "of", "type", "interface", "implements", "enum", "readonly",
  "public", "private", "protected", "abstract", "declare", "namespace", "module",
  "infer", "keyof", "satisfies", "override",
];

const C_FAM = [
  "auto", "bool", "break", "case", "catch", "char", "class", "const", "continue",
  "default", "delete", "do", "double", "else", "enum", "extern", "false", "float",
  "for", "goto", "if", "inline", "int", "long", "namespace", "new", "nullptr",
  "private", "public", "protected", "return", "short", "signed", "sizeof",
  "static", "struct", "switch", "template", "this", "throw", "true", "try",
  "typedef", "typename", "union", "unsigned", "using", "virtual", "void",
  "volatile", "while", "include", "define", "ifdef", "ifndef", "endif",
];

function g(partial: Grammar) {
  registerGrammar(partial);
}

g({
  id: "python",
  aliases: ["py"],
  lineComment: "#",
  keywords: [
    "and", "as", "assert", "async", "await", "break", "class", "continue", "def",
    "del", "elif", "else", "except", "False", "finally", "for", "from", "global",
    "if", "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass",
    "raise", "return", "True", "try", "while", "with", "yield", "match", "case",
  ],
  builtins: ["print", "len", "range", "str", "int", "float", "list", "dict", "set", "open", "super"],
  types: ["str", "int", "float", "bool", "list", "dict", "None"],
});

g({
  id: "javascript",
  aliases: ["js", "jsx", "mjs", "cjs"],
  lineComment: "//",
  blockComment: ["/*", "*/"],
  hex: true,
  keywords: JS,
  builtins: ["console", "window", "document", "Math", "JSON", "Promise", "Array", "Object", "Map", "Set"],
});

g({
  id: "typescript",
  aliases: ["ts", "tsx"],
  lineComment: "//",
  blockComment: ["/*", "*/"],
  hex: true,
  keywords: JS,
  types: ["string", "number", "boolean", "any", "unknown", "never", "void", "Record", "Partial", "Promise"],
  builtins: ["console", "Math", "JSON", "Promise", "Array", "Object"],
});

g({
  id: "go",
  aliases: ["golang"],
  lineComment: "//",
  blockComment: ["/*", "*/"],
  keywords: [
    "break", "case", "chan", "const", "continue", "default", "defer", "else",
    "fallthrough", "for", "func", "go", "goto", "if", "import", "interface",
    "map", "package", "range", "return", "select", "struct", "switch", "type", "var",
  ],
  builtins: ["fmt", "len", "cap", "make", "append", "panic", "nil", "true", "false"],
});

g({
  id: "rust",
  aliases: ["rs"],
  lineComment: "//",
  blockComment: ["/*", "*/"],
  keywords: [
    "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else",
    "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop",
    "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self",
    "static", "struct", "super", "trait", "true", "type", "unsafe", "use",
    "where", "while",
  ],
  types: ["i32", "i64", "u32", "u64", "f32", "f64", "bool", "str", "String", "Vec", "Option", "Result"],
});

g({
  id: "java",
  lineComment: "//",
  blockComment: ["/*", "*/"],
  keywords: [
    "abstract", "assert", "boolean", "break", "byte", "case", "catch", "class",
    "const", "continue", "default", "do", "double", "else", "enum", "extends",
    "false", "final", "finally", "float", "for", "if", "implements", "import",
    "instanceof", "int", "interface", "long", "native", "new", "null", "package",
    "private", "protected", "public", "return", "short", "static", "strictfp",
    "super", "switch", "synchronized", "this", "throw", "throws", "transient",
    "true", "try", "void", "volatile", "while", "record", "var", "yield",
  ],
});

g({
  id: "cpp",
  aliases: ["c++", "cc", "hpp"],
  lineComment: "//",
  blockComment: ["/*", "*/"],
  hex: true,
  keywords: C_FAM,
  types: ["string", "vector", "map", "optional", "int32_t", "size_t"],
});

g({
  id: "c",
  aliases: ["h"],
  lineComment: "//",
  blockComment: ["/*", "*/"],
  hex: true,
  keywords: C_FAM,
});

g({
  id: "csharp",
  aliases: ["cs", "c#"],
  lineComment: "//",
  blockComment: ["/*", "*/"],
  keywords: [
    "abstract", "as", "async", "await", "base", "bool", "break", "byte", "case",
    "catch", "char", "checked", "class", "const", "continue", "decimal", "default",
    "delegate", "do", "double", "else", "enum", "event", "explicit", "extern",
    "false", "finally", "fixed", "float", "for", "foreach", "goto", "if",
    "implicit", "in", "int", "interface", "internal", "is", "lock", "long",
    "namespace", "new", "null", "object", "operator", "out", "override", "params",
    "private", "protected", "public", "readonly", "ref", "return", "sbyte",
    "sealed", "short", "sizeof", "stackalloc", "static", "string", "struct",
    "switch", "this", "throw", "true", "try", "typeof", "uint", "ulong",
    "unchecked", "unsafe", "ushort", "using", "virtual", "void", "volatile",
    "while", "var", "record", "required", "init", "nameof", "when",
  ],
  types: ["string", "int", "bool", "object", "List", "Task", "IEnumerable"],
});

g({
  id: "php",
  lineComment: "//",
  blockComment: ["/*", "*/"],
  keywords: [
    "abstract", "and", "array", "as", "break", "callable", "case", "catch",
    "class", "clone", "const", "continue", "declare", "default", "do", "echo",
    "else", "elseif", "empty", "enddeclare", "endfor", "endforeach", "endif",
    "endswitch", "endwhile", "extends", "final", "finally", "fn", "for",
    "foreach", "function", "global", "goto", "if", "implements", "include",
    "include_once", "instanceof", "insteadof", "interface", "isset", "list",
    "match", "namespace", "new", "or", "print", "private", "protected", "public",
    "require", "require_once", "return", "static", "switch", "throw", "trait",
    "try", "unset", "use", "var", "while", "xor", "yield", "true", "false", "null",
  ],
  builtins: ["echo", "print", "strlen", "count", "array_map", "json_encode"],
});

g({
  id: "ruby",
  aliases: ["rb"],
  lineComment: "#",
  keywords: [
    "alias", "and", "begin", "break", "case", "class", "def", "defined?", "do",
    "else", "elsif", "end", "ensure", "false", "for", "if", "in", "module",
    "next", "nil", "not", "or", "redo", "rescue", "retry", "return", "self",
    "super", "then", "true", "undef", "unless", "until", "when", "while", "yield",
  ],
  builtins: ["puts", "print", "p", "require", "attr_accessor", "raise"],
});

g({ id: "html", aliases: ["htm", "svg", "xml"], keywords: [], scan: scanHtml });
g({ id: "css", aliases: ["scss"], keywords: [], scan: scanCss });
g({ id: "json", aliases: ["jsonc"], keywords: ["true", "false", "null"], scan: scanJson });
g({ id: "markdown", aliases: ["md"], keywords: [], scan: scanMarkdown });

g({
  id: "yaml",
  aliases: ["yml"],
  lineComment: "#",
  keywords: ["true", "false", "null", "yes", "no"],
});

g({
  id: "toml",
  lineComment: "#",
  keywords: ["true", "false"],
});

g({
  id: "sql",
  lineComment: "--",
  blockComment: ["/*", "*/"],
  ignoreCase: true,
  keywords: [
    "select", "from", "where", "insert", "into", "update", "delete", "create",
    "table", "index", "join", "left", "right", "inner", "on", "and", "or", "not",
    "null", "as", "order", "by", "group", "having", "limit", "values", "set",
    "primary", "key", "foreign", "references", "drop", "alter", "unique",
  ],
});

g({
  id: "bash",
  aliases: ["sh", "shell", "zsh"],
  lineComment: "#",
  ignoreCase: true,
  keywords: [
    "if", "then", "else", "fi", "for", "in", "do", "done", "while", "case",
    "esac", "function", "return", "exit", "export", "local", "echo", "cd",
    "source", "true", "false",
  ],
});

g({
  id: "plaintext",
  aliases: ["txt", "text"],
  keywords: [],
});
