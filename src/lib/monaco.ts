import { prefixAt, suggest } from "./suggest";
import { findDefinition, hoverFor, wordAt } from "./lsp";

const VS = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs";

export type MonacoEditor = {
  getValue: () => string;
  setValue: (v: string) => void;
  getSelection: () => { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null;
  getModel: () => {
    getOffsetAt: (p: { lineNumber: number; column: number }) => number;
    getPositionAt?: (offset: number) => { lineNumber: number; column: number };
    getValueInRange: (r: object) => string;
    uri: { path: string };
  } | null;
  getPosition: () => { lineNumber: number; column: number } | null;
  setPosition: (p: { lineNumber: number; column: number }) => void;
  setSelection?: (r: object) => void;
  revealPositionInCenter?: (p: { lineNumber: number; column: number }) => void;
  executeEdits: (source: string, edits: Array<{ range: object; text: string }>) => boolean;
  trigger?: (source: string, handler: string, payload?: unknown) => void;
  getAction?: (id: string) => { run: () => void | Promise<void> } | null;
  deltaDecorations: (old: string[], next: object[]) => string[];
  revealLineInCenter?: (line: number) => void;
  onMouseDown: (cb: (e: {
    target: { type: number; position?: { lineNumber: number; column: number } };
    event?: { ctrlKey?: boolean; metaKey?: boolean };
  }) => void) => { dispose: () => void };
  addAction: (a: {
    id: string;
    label: string;
    keybindings?: number[];
    contextMenuGroupId?: string;
    contextMenuOrder?: number;
    run: () => void;
  }) => void;
  onDidChangeModelContent: (cb: () => void) => { dispose: () => void };
  onDidChangeCursorPosition: (cb: (e: { position: { lineNumber: number; column: number } }) => void) => { dispose: () => void };
  updateOptions: (o: Record<string, unknown>) => void;
  setModel: (m: unknown) => void;
  focus: () => void;
  dispose: () => void;
  layout: () => void;
};

export type MonacoNS = {
  KeyMod: { CtrlCmd: number; Shift: number; Alt: number };
  KeyCode: Record<string, number>;
  Uri: { parse: (s: string) => unknown };
  editor: {
    create: (el: HTMLElement, opts: Record<string, unknown>) => MonacoEditor;
    getModel: (uri: unknown) => unknown;
    createModel: (value: string, lang: string, uri: unknown) => unknown;
    setModelLanguage: (model: unknown, lang: string) => void;
    defineTheme: (name: string, theme: Record<string, unknown>) => void;
    setTheme: (name: string) => void;
    setModelMarkers?: (model: unknown, owner: string, markers: object[]) => void;
    getModels?: () => unknown[];
  };
  languages?: {
    registerCompletionItemProvider: (
      lang: string,
      provider: {
        triggerCharacters?: string[];
        provideCompletionItems: (model: { getValue: () => string; getValueInRange: (r: object) => string }, position: { lineNumber: number; column: number }) => {
          suggestions: Array<Record<string, unknown>>;
        };
      },
    ) => { dispose: () => void };
    registerHoverProvider: (
      lang: string,
      provider: {
        provideHover: (
          model: { getValue: () => string; getOffsetAt: (p: { lineNumber: number; column: number }) => number; uri: { path: string } },
          position: { lineNumber: number; column: number },
        ) => { contents: { value: string }[] } | null;
      },
    ) => { dispose: () => void };
    registerDefinitionProvider: (
      lang: string,
      provider: {
        provideDefinition: (
          model: { getValue: () => string; getOffsetAt: (p: { lineNumber: number; column: number }) => number; uri: { path: string } },
          position: { lineNumber: number; column: number },
        ) => { uri: unknown; range: object } | null;
      },
    ) => { dispose: () => void };
    registerCodeActionProvider?: (
      lang: string,
      provider: {
        provideCodeActions: (
          model: { uri: { path: string } },
          range: { startLineNumber: number; endLineNumber: number },
          context: { markers?: { startLineNumber: number; message: string }[] },
        ) => {
          actions: Array<{
            title: string;
            kind: string;
            isPreferred?: boolean;
            command?: { id: string; title: string; arguments?: unknown[] };
          }>;
          dispose: () => void;
        };
      },
    ) => { dispose: () => void };
  };
  MarkerSeverity?: { Error: number; Warning: number; Info: number };
};

let cached: Promise<MonacoNS> | null = null;

export function loadMonaco(): Promise<MonacoNS> {
  if (cached) return cached;
  cached = new Promise((resolve, reject) => {
    const w = window as unknown as {
      require?: { config: (o: { paths: { vs: string } }) => void; (deps: string[], cb: () => void): void };
      monaco?: MonacoNS;
    };
    if (w.monaco) {
      resolve(w.monaco);
      return;
    }
    const boot = () => {
      if (!w.require) {
        reject(new Error("Monaco-Loader fehlt."));
        return;
      }
      w.require.config({ paths: { vs: VS } });
      w.require(["vs/editor/editor.main"], () => {
        if (!w.monaco) reject(new Error("Monaco nicht geladen."));
        else resolve(w.monaco);
      });
    };
    if (w.require) {
      boot();
      return;
    }
    const s = document.createElement("script");
    s.src = `${VS}/loader.js`;
    s.async = true;
    s.onload = () => boot();
    s.onerror = () => reject(new Error("Monaco CDN nicht erreichbar."));
    document.head.appendChild(s);
  });
  return cached;
}

export function monacoLang(id: string): string {
  const map: Record<string, string> = {
    python: "python",
    javascript: "javascript",
    typescript: "typescript",
    go: "go",
    rust: "rust",
    java: "java",
    c: "c",
    cpp: "cpp",
    csharp: "csharp",
    php: "php",
    ruby: "ruby",
    html: "html",
    css: "css",
    markdown: "markdown",
    json: "json",
  };
  return map[id] ?? "plaintext";
}

export function defineAnvilThemes(monaco: MonacoNS, theme: "dark" | "light") {
  monaco.editor.defineTheme("anvil-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6e6e76", fontStyle: "italic" },
      { token: "string", foreground: "a8b4c4" },
      { token: "keyword", foreground: "c5c9d4", fontStyle: "bold" },
      { token: "number", foreground: "b8c0b0" },
    ],
    colors: {
      "editor.background": "#0a0a0b",
      "editor.foreground": "#ececec",
      "editorLineNumber.foreground": "#6e6e76",
      "editor.lineHighlightBackground": "#121214",
      "editorCursor.foreground": "#ececec",
      "editor.selectionBackground": "#2a2a30",
      "editorIndentGuide.background": "#1c1c20",
      "editorIndentGuide.activeBackground": "#3a3a42",
      "editorBracketMatch.background": "#2a2a30",
      "editorBracketMatch.border": "#6e6e76",
      "editorWidget.background": "#121214",
      "editorWidget.border": "#2a2a30",
    },
  });
  monaco.editor.defineTheme("anvil-light", {
    base: "vs",
    inherit: true,
    rules: [{ token: "comment", foreground: "8a8a92", fontStyle: "italic" }],
    colors: {
      "editor.background": "#f3f2ee",
      "editor.foreground": "#1c1c1f",
      "editorLineNumber.foreground": "#8a8a92",
      "editor.lineHighlightBackground": "#eceae4",
      "editor.selectionBackground": "#d4d2ca",
    },
  });
  monaco.editor.setTheme(theme === "light" ? "anvil-light" : "anvil-dark");
}

let completionsWired = false;

export function wireCompletions(monaco: MonacoNS) {
  if (completionsWired || !monaco.languages) return;
  completionsWired = true;
  const langs = ["python", "javascript", "typescript", "go", "rust", "java", "c", "cpp", "csharp", "php", "ruby", "html", "css", "markdown", "json", "plaintext"];
  for (const lang of langs) {
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: [".", "_"],
      provideCompletionItems(model, position) {
        const line = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const { prefix, prev } = prefixAt(line);
        const items = suggest({
          source: model.getValue(),
          prefix,
          prev,
          lang,
        });
        return {
          suggestions: items.map((s, i) => ({
            label: s.text,
            kind: s.kind === "kw" ? 17 : s.kind === "snip" ? 27 : 9,
            insertText: s.insert,
            detail: s.kind === "snip" ? "Snippet" : s.kind === "kw" ? "Keyword" : "Symbol",
            sortText: String(i).padStart(3, "0"),
            range: {
              startLineNumber: position.lineNumber,
              startColumn: position.column - prefix.length,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            },
          })),
        };
      },
    });
  }
}

let navWired = false;

export function wireNav(monaco: MonacoNS) {
  if (navWired || !monaco.languages?.registerHoverProvider) return;
  navWired = true;
  const langs = ["python", "javascript", "typescript", "go", "rust", "java", "c", "cpp", "csharp", "php", "ruby", "json", "plaintext"];
  const filesOf = () => {
    try {
      const { useIde } = requireStore();
      return useIde.getState().files as Record<string, string>;
    } catch {
      return {};
    }
  };
  for (const lang of langs) {
    monaco.languages.registerHoverProvider(lang, {
      provideHover(model, position) {
        const path = String(model.uri.path || "").replace(/^\//, "");
        const md = hoverFor(filesOf(), path, model.getValue(), model.getOffsetAt(position));
        return md ? { contents: [{ value: md }] } : null;
      },
    });
    monaco.languages.registerDefinitionProvider(lang, {
      provideDefinition(model, position) {
        const src = model.getValue();
        const w = wordAt(src, model.getOffsetAt(position));
        const defs = findDefinition(filesOf(), w, String(model.uri.path || "").replace(/^\//, ""));
        if (!defs.length) return null;
        const d = defs[0];
        return {
          uri: monaco.Uri.parse(`file:///${d.path}`),
          range: {
            startLineNumber: d.line,
            startColumn: 1,
            endLineNumber: d.line,
            endColumn: 120,
          },
        };
      },
    });
  }
  wireFix(monaco);
}

function requireStore(): { useIde: { getState: () => { files: Record<string, string> } } } {
  return { useIde: { getState: () => ({ files: (window as unknown as { __anvilFiles?: Record<string, string> }).__anvilFiles ?? {} }) } };
}

let fixWired = false;

function wireFix(monaco: MonacoNS) {
  if (fixWired || !monaco.languages?.registerCodeActionProvider) return;
  fixWired = true;
  const langs = ["python", "javascript", "typescript", "go", "rust", "java", "c", "cpp", "csharp", "php", "ruby", "html", "json", "plaintext"];
  for (const lang of langs) {
    monaco.languages.registerCodeActionProvider(lang, {
      provideCodeActions(model, range, context) {
        const path = String(model.uri.path || "").replace(/^\//, "");
        const markers = context.markers ?? [];
        const line = range.startLineNumber;
        const has = markers.some((m) => m.startLineNumber >= range.startLineNumber && m.startLineNumber <= range.endLineNumber);
        if (!has && !markers.length) return { actions: [], dispose() {} };
        return {
          actions: [
            {
              title: "Mit Agent beheben",
              kind: "quickfix",
              isPreferred: true,
              command: { id: "anvil.fix-agent", title: "Mit Agent beheben", arguments: [path, line] },
            },
          ],
          dispose() {},
        };
      },
    });
  }
}

export function editorChrome(s: {
  fontSize: number;
  tabSize: number;
  insertSpaces: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  editorMinimap?: boolean;
  editorSticky?: boolean;
  editorGuides?: boolean;
  editorWheelZoom?: boolean;
}): Record<string, unknown> {
  const guides = s.editorGuides !== false;
  return {
    automaticLayout: true,
    fontSize: s.fontSize,
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
    fontLigatures: true,
    tabSize: s.tabSize,
    insertSpaces: s.insertSpaces,
    wordWrap: s.wordWrap ? "on" : "off",
    lineNumbers: s.lineNumbers ? "on" : "off",
    minimap: { enabled: Boolean(s.editorMinimap), maxColumn: 80, scale: 1 },
    stickyScroll: { enabled: s.editorSticky !== false },
    guides: { indentation: guides, bracketPairs: guides, highlightActiveIndentation: true },
    bracketPairColorization: { enabled: guides },
    matchBrackets: "always",
    mouseWheelZoom: s.editorWheelZoom !== false,
    folding: true,
    foldingHighlight: true,
    showFoldingControls: "mouseover",
    renderWhitespace: "selection",
    renderLineHighlight: "all",
    smoothScrolling: true,
    cursorSmoothCaretAnimation: "on",
    cursorBlinking: "smooth",
    occurrencesHighlight: "singleFile",
    selectionHighlight: true,
    links: true,
    colorDecorators: true,
    autoClosingBrackets: "languageDefined",
    autoClosingQuotes: "languageDefined",
    autoSurround: "languageDefined",
    formatOnPaste: true,
    dragAndDrop: true,
    emptySelectionClipboard: true,
    multiCursorModifier: "alt",
    wrappingStrategy: "advanced",
    padding: { top: 10, bottom: 28 },
    scrollBeyondLastLine: false,
    glyphMargin: true,
    lightbulb: { enabled: true },
    contextmenu: true,
    quickSuggestions: { other: true, comments: false, strings: false },
    suggestOnTriggerCharacters: true,
    tabCompletion: "on",
    wordBasedSuggestions: "currentDocument",
    snippetSuggestions: "inline",
  };
}
