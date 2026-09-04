import { langFromPath } from "@/lib/languages";
import { grammarOf, listGrammars, tokenize } from "@/lib/syntax";
import { fetchWeb, readWebPage } from "@/lib/web-fetch";
import { fetchPublic } from "@/lib/net-guard";
import { registerBuiltin } from "./host";
import { useIde } from "@/store/ide";
import { vscodeLineComment } from "./vscode";
import { lintFile, lintWorkspace } from "./lint";
import { parseHttpFile } from "./http-parse";

registerBuiltin({
  id: "snippets",
  name: "Snippets",
  description: "Häufige Codevorlagen nach Sprache einfügen.",
  builtin: true,
  category: "edit",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "snippets.insert",
      title: "Snippet einfügen",
      run: () => {
        const path = api.active();
        if (!path) return;
        const lang = langFromPath(path);
        const map: Record<string, string> = {
          javascript: "export function name() {\n  \n}\n",
          typescript: "export function name(): void {\n  \n}\n",
          python: "def name():\n    pass\n",
          html: "<div class=\"\">\n  \n</div>\n",
          go: "func name() {\n\t\n}\n",
          rust: "fn name() {\n    \n}\n",
          java: "public class Name {\n    \n}\n",
          csharp: "class Name {\n    \n}\n",
          php: "function name() {\n    \n}\n",
          ruby: "def name\n  \nend\n",
          markdown: "## Titel\n\n",
        };
        const snip = map[lang] ?? "// \n";
        api.insert(snip);
        api.notify("Snippet");
      },
    });
  },
});

registerBuiltin({
  id: "comment",
  name: "Kommentare",
  description: "Zeilen der Datei ein-/auskommentieren.",
  builtin: true,
  category: "edit",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "comment.toggle",
      title: "Kommentare umschalten",
      run: () => {
        const path = api.active();
        if (!path) return;
        const lang = langFromPath(path);
        const mark = grammarOf(lang)?.lineComment ?? vscodeLineComment(lang) ?? (lang === "html" ? null : "//");
        const cur = api.read(path) ?? "";
        if (!mark) {
          api.notify("HTML: <!-- --> manuell");
          return;
        }
        const { from, to } = api.range();
        const lines = cur.split("\n");
        const a = Math.max(0, from - 1);
        const b = Math.min(lines.length - 1, to - 1);
        const slice = lines.slice(a, b + 1);
        const all = slice.filter((l) => l.trim()).every((l) => l.trimStart().startsWith(mark));
        const next = slice.map((l) => {
          if (!l.trim()) return l;
          if (all) return l.replace(new RegExp(`^(\\s*)${mark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s?`), "$1");
          return l.replace(/^(\s*)/, `$1${mark} `);
        });
        api.write(path, [...lines.slice(0, a), ...next, ...lines.slice(b + 1)].join("\n"));
      },
    });
  },
});

registerBuiltin({
  id: "transform",
  name: "Transform",
  description: "Zeilen sortieren, unique, Groß/Klein, trimmen.",
  builtin: true,
  category: "edit",
  version: "1.1",
  activate: (api) => {
    const apply = (fn: (lines: string[]) => string[]) => {
      const path = api.active();
      if (!path) return;
      api.write(path, fn((api.read(path) ?? "").split("\n")).join("\n"));
    };
    api.command({
      id: "transform.sort",
      title: "Zeilen sortieren",
      run: () => apply((l) => [...l].sort((a, b) => a.localeCompare(b))),
    });
    api.command({
      id: "transform.unique",
      title: "Doppelte Zeilen entfernen",
      run: () =>
        apply((l) => {
          const seen = new Set<string>();
          return l.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
        }),
    });
    api.command({
      id: "transform.trim",
      title: "Leerzeichen am Zeilenende",
      run: () => apply((l) => l.map((x) => x.replace(/\s+$/, ""))),
    });
    api.command({
      id: "transform.upper",
      title: "Alles GROSS",
      run: () => apply((l) => l.map((x) => x.toUpperCase())),
    });
    api.command({
      id: "transform.lower",
      title: "Alles klein",
      run: () => apply((l) => l.map((x) => x.toLowerCase())),
    });
  },
});

registerBuiltin({
  id: "json",
  name: "JSON",
  description: "JSON pretty/minify und TypeScript-Typ ableiten.",
  builtin: true,
  category: "tools",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "json.pretty",
      title: "JSON formatieren",
      run: () => {
        const path = api.active();
        if (!path) return;
        try {
          api.write(path, `${JSON.stringify(JSON.parse(api.read(path) ?? ""), null, 2)}\n`);
          api.notify("JSON formatiert");
        } catch (err) {
          api.notify(err instanceof Error ? err.message : "Kein JSON");
        }
      },
    });
    api.command({
      id: "json.minify",
      title: "JSON minify",
      run: () => {
        const path = api.active();
        if (!path) return;
        try {
          api.write(path, JSON.stringify(JSON.parse(api.read(path) ?? "")));
        } catch (err) {
          api.notify(err instanceof Error ? err.message : "Kein JSON");
        }
      },
    });
    api.command({
      id: "json.types",
      title: "JSON → TypeScript",
      run: () => {
        const path = api.active();
        if (!path) return;
        try {
          const data = JSON.parse(api.read(path) ?? "");
          const out = `types/${(path.split("/").pop() ?? "data").replace(/\.json$/i, "")}.ts`;
          api.write(out, inferTs("Root", data));
          api.open(out);
        } catch (err) {
          api.notify(err instanceof Error ? err.message : "Kein JSON");
        }
      },
    });
  },
});

registerBuiltin({
  id: "http",
  name: "HTTP Client",
  description: ".http Datei oder URL ausführen und Antwort speichern.",
  builtin: true,
  category: "web",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "http.run",
      title: "HTTP-Request ausführen",
      run: async () => {
        const path = api.active();
        const cur = path ? api.read(path) ?? "" : "";
        const parsed = path && /\.http$/i.test(path) ? parseHttpFile(cur) : [];
        const req =
          parsed[0] ||
          (() => {
            const url = cur.match(/https?:\/\/\S+/)?.[0] || (typeof window !== "undefined" ? window.prompt("URL") : null);
            return url ? { method: "GET", url, headers: {} as Record<string, string>, body: "" } : null;
          })();
        if (!req) return;
        const r = await runHttp(req);
        const out = `web/${safeHost(req.url)}.txt`;
        api.write(out, `${req.method} ${req.url}\n\n${r.text}`);
        api.open(out);
        api.notify(r.ok ? `HTTP ${out}` : "Request fehlgeschlagen");
      },
    });
  },
});

registerBuiltin({
  id: "lint",
  name: "Lint",
  description: "Klammern, JSON und gemischte Einrückung prüfen.",
  builtin: true,
  category: "tools",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "lint.file",
      title: "Datei prüfen",
      run: () => {
        const path = api.active();
        if (!path) return;
        const hits = lintFile(path, api.read(path) ?? "");
        useIde.getState().revealOutput();
        api.output(hits.length ? hits.map((h) => `${h.path}:${h.line} ${h.text}`).join("\n") : "Keine Probleme.", hits.length === 0);
        api.problems(hits);
        api.status(hits.length ? `${hits.length} Probleme` : "Lint ok");
      },
    });
    api.command({
      id: "lint.workspace",
      title: "Workspace prüfen",
      run: () => {
        const hits = lintWorkspace(api.files());
        useIde.getState().revealOutput();
        api.output(hits.length ? hits.map((h) => `${h.path}:${h.line} ${h.text}`).join("\n") : "Workspace sauber.", hits.length === 0);
        api.problems(hits);
      },
    });
  },
});

registerBuiltin({
  id: "stats",
  name: "Statistik",
  description: "Zeilen, Wörter, Zeichen der Datei und des Workspace.",
  builtin: true,
  category: "tools",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "stats.file",
      title: "Datei zählen",
      run: () => {
        const path = api.active();
        if (!path) return;
        api.notify(countText(api.read(path) ?? ""));
        api.status(countText(api.read(path) ?? ""));
      },
    });
    api.command({
      id: "stats.ws",
      title: "Workspace zählen",
      run: () => {
        let n = 0;
        let lines = 0;
        for (const c of Object.values(api.files())) {
          n += c.length;
          lines += c.split("\n").length;
        }
        const msg = `${Object.keys(api.files()).length} Dateien · ${lines} Zeilen · ${n} Zeichen`;
        api.notify(msg);
        api.status(msg);
      },
    });
  },
});

registerBuiltin({
  id: "debug",
  name: "Debug",
  description: "Breakpoints, Step, Locals. F5 / F9 / F10. JS/TS/Python live, Go/Rust/Java/C/C++ Trace.",
  builtin: true,
  category: "core",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "debug.start",
      title: "Debug starten",
      run: () => {
        window.dispatchEvent(new Event("anvil-debug"));
      },
    });
    api.command({
      id: "debug.step",
      title: "Debug Step",
      run: () => {
        window.dispatchEvent(new Event("anvil-debug-step"));
      },
    });
    api.command({
      id: "debug.stop",
      title: "Debug stoppen",
      run: () => {
        window.dispatchEvent(new Event("anvil-debug-stop"));
      },
    });
  },
});

registerBuiltin({
  id: "cases",
  name: "Cases",
  description: "Wort an der Schreibmarke: camelCase, snake_case, kebab-case.",
  builtin: true,
  category: "edit",
  version: "1.0",
  activate: (api) => {
    const swap = (mode: "camel" | "snake" | "kebab") => {
      const path = api.active();
      if (!path) return;
      const src = api.read(path) ?? "";
      const { line, col } = api.cursor();
      const rows = src.split("\n");
      const row = rows[Math.max(0, line - 1)] ?? "";
      const i = Math.max(0, col - 1);
      const left = row.slice(0, i).search(/[A-Za-z0-9_]+$/);
      const start = left < 0 ? i : left;
      const m = row.slice(start).match(/^[A-Za-z0-9_-]+/);
      if (!m) return api.notify("Kein Wort");
      const w = m[0];
      const parts = w.split(/[-_]/).flatMap((p) => p.split(/(?=[A-Z])/)).filter(Boolean).map((p) => p.toLowerCase());
      const next =
        mode === "snake" ? parts.join("_") :
        mode === "kebab" ? parts.join("-") :
        parts.map((p, idx) => (idx ? p[0].toUpperCase() + p.slice(1) : p)).join("");
      rows[Math.max(0, line - 1)] = row.slice(0, start) + next + row.slice(start + w.length);
      api.write(path, rows.join("\n"));
    };
    api.command({ id: "case.camel", title: "camelCase", run: () => swap("camel") });
    api.command({ id: "case.snake", title: "snake_case", run: () => swap("snake") });
    api.command({ id: "case.kebab", title: "kebab-case", run: () => swap("kebab") });
  },
});

registerBuiltin({
  id: "ask-file",
  name: "Agent-Datei",
  description: "Offene Datei an den Agenten schicken (erklären / refactorn).",
  builtin: true,
  category: "tools",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "agent.refactor",
      title: "Datei refactoren lassen",
      run: () => {
        const path = api.active();
        if (!path) return;
        api.agent("Refactore " + path + ". Behalte Verhalten, mach den Code klarer. Nutze edit_file.");
      },
    });
  },
});

registerBuiltin({
  id: "learn",
  name: "Gedächtnis",
  description: "Lernt Nutzung, schreibt Skills, nutzt sie wieder.",
  builtin: true,
  category: "core",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "learn.open",
      title: "Gedächtnis öffnen",
      run: () => useIde.getState().setSidebar("learn"),
    });
  },
});

registerBuiltin({
  id: "brain",
  name: "Helfer",
  description: "Lokales Mini-Modell laden. Kein Agent — nur Kurzbefehle.",
  builtin: true,
  category: "core",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "brain.load",
      title: "Helfer laden",
      run: () => {
        void import("@/lib/brain").then((b) => b.loadBrain(true));
      },
    });
    api.command({
      id: "brain.unload",
      title: "Helfer entladen",
      run: () => {
        void import("@/lib/brain").then((b) => b.unloadBrain());
      },
    });
    api.command({
      id: "brain.auto",
      title: "Helfer-Autonomie umschalten",
      run: () => {
        void import("@/lib/brain").then((b) => {
          const cur = b.useBrain.getState().autonomy;
          const next = cur === "off" ? "quiet" : cur === "quiet" ? "on" : "off";
          b.useBrain.getState().setAutonomy(next);
          useIde.getState().setNotice(`Helfer: ${next === "on" ? "autonom" : next === "quiet" ? "still" : "aus"}`);
        });
      },
    });
    api.command({
      id: "brain.doc",
      title: "Docstring vom Helfer",
      run: () => {
        const s = useIde.getState();
        const path = s.activePath;
        if (!path) return;
        void import("@/lib/brain").then(async (b) => {
          const lang = path.split(".").pop() ?? "";
          const doc = await b.brainDocstring(lang, s.files[path] ?? "");
          if (!doc) return;
          s.setContent(path, `${doc}\n${s.files[path] ?? ""}`);
        });
      },
    });
    api.command({
      id: "brain.explain",
      title: "Letzten Fehler erklären",
      run: () => {
        const last = [...useIde.getState().output].reverse().find((r) => !r.ok);
        if (!last) return;
        useIde.getState().revealOutput();
        void import("@/lib/brain").then((b) =>
          b.brainExplainError(last.stderr || last.stdout, last.label).then((t) => useIde.getState().setNotice(t)),
        );
      },
    });
    api.command({
      id: "brain.break",
      title: "Breakpoint aus Fehler",
      run: () => {
        const last = [...useIde.getState().output].reverse().find((r) => !r.ok);
        if (!last) return;
        void import("@/lib/brain").then(async (b) => {
          const hit = await b.brainBreakpoint(last.stderr || last.stdout);
          if (!hit) return;
          const path = hit.path in useIde.getState().files ? hit.path : useIde.getState().activePath;
          if (!path) return;
          useIde.getState().toggleBreakpoint(path, hit.line);
          useIde.getState().openFile(path);
        });
      },
    });
  },
});

registerBuiltin({
  id: "syntax",
  name: "Syntax",
  description: "Highlighting-Engine: Grammatiken und Token-Dump.",
  builtin: true,
  category: "core",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "syntax.grammars",
      title: "Grammatiken listen",
      run: () => {
        const names = listGrammars().map((g) => g.id).join(", ");
        api.notify(`${listGrammars().length} Grammatiken`);
        api.status(names);
        useIde.getState().revealOutput();
        api.output(names);
      },
    });
    api.command({
      id: "syntax.dump",
      title: "Tokens der Datei",
      run: () => {
        const path = api.active();
        if (!path) return;
        const toks = tokenize(api.read(path) ?? "", langFromPath(path));
        const lines = toks
          .filter((t) => t.kind !== "text" || t.text.trim())
          .slice(0, 80)
          .map((t) => `${t.kind.padEnd(8)} ${JSON.stringify(t.text).slice(0, 60)}`);
        useIde.getState().revealOutput();
        api.output(lines.join("\n") || "Keine Tokens");
        api.status(`${toks.length} Tokens`);
      },
    });
  },
});

async function runHttp(req: { method: string; url: string; headers: Record<string, string>; body: string }) {
  if (req.method === "GET" || req.method === "HEAD") {
    try {
      return await fetchWeb({ data: { url: req.url } });
    } catch {
      return readWebPage(req.url);
    }
  }
  const res = await fetchPublic(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body || undefined,
  });
  const text = (await res.text()).slice(0, 20_000);
  return { ok: res.ok, text: res.ok ? text : `HTTP ${res.status}: ${text.slice(0, 400)}` };
}

function inferTs(name: string, value: unknown, depth = 0): string {
  if (depth > 4) return `export type ${name} = unknown;\n`;
  if (Array.isArray(value)) {
    const inner = value.length ? inferShape("Item", value[0], depth + 1) : "unknown";
    return `export type ${name} = ${inner}[];\n`;
  }
  if (value && typeof value === "object") {
    const fields = Object.entries(value as Record<string, unknown>)
      .slice(0, 24)
      .map(([k, v]) => `  ${safeKey(k)}: ${inferShape(k, v, depth + 1)};`)
      .join("\n");
    return `export type ${name} = {\n${fields}\n};\n`;
  }
  return `export type ${name} = ${inferShape("T", value, depth)};\n`;
}

function inferShape(name: string, value: unknown, depth: number): string {
  if (value == null) return "null";
  if (Array.isArray(value)) return value.length ? `${inferShape(name, value[0], depth + 1)}[]` : "unknown[]";
  if (typeof value === "object") return depth > 3 ? "Record<string, unknown>" : `{ ${Object.keys(value as object).slice(0, 8).map((k) => `${safeKey(k)}: unknown`).join("; ")} }`;
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

function safeKey(k: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : JSON.stringify(k);
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/[^\w.-]+/g, "-");
  } catch {
    return "request";
  }
}

function countText(s: string): string {
  const lines = s.split("\n").length;
  const words = s.trim() ? s.trim().split(/\s+/).length : 0;
  return `${lines} Zeilen · ${words} Wörter · ${s.length} Zeichen`;
}
