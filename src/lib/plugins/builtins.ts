import { downloadBlob, unzipFiles, zipFiles } from "@/lib/archive";
import { formatCode } from "@/lib/format";
import { fetchWeb } from "@/lib/web-fetch";
import { registerBuiltin, type PluginApi } from "./host";
import { useIde } from "@/store/ide";

registerBuiltin({
  id: "preview",
  name: "Vorschau",
  description: "Markdown, HTML und JSON neben dem Code anzeigen.",
  builtin: true,
  category: "core",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "preview.toggle",
      title: "Vorschau ein/aus",
      run: () => useIde.getState().setPreviewOpen(!useIde.getState().previewOpen),
    });
  },
});

registerBuiltin({
  id: "format",
  name: "Format",
  description: "Datei formatieren (Prettier im Browser).",
  builtin: true,
  category: "edit",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "format.doc",
      title: "Dokument formatieren",
      run: async () => {
        const path = api.active();
        if (!path) return;
        const cur = api.read(path);
        if (cur == null) return;
        try {
          const next = await formatCode(path, cur);
          api.write(path, next);
          api.notify("Formatiert");
        } catch (err) {
          api.notify(err instanceof Error ? err.message : "Format fehlgeschlagen");
        }
      },
    });
  },
});

registerBuiltin({
  id: "archive",
  name: "Export",
  description: "Projekt als ZIP laden und speichern.",
  builtin: true,
  category: "tools",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "archive.export",
      title: "Projekt als ZIP speichern",
      run: async () => {
        const blob = await zipFiles(api.files());
        downloadBlob(blob, "anvil-projekt.zip");
        api.notify("ZIP heruntergeladen");
      },
    });
    api.command({
      id: "archive.import",
      title: "ZIP oder Dateien importieren",
      run: () => pickFiles(api),
    });
  },
});

registerBuiltin({
  id: "todos",
  name: "Todos",
  description: "TODO und FIXME im Workspace finden.",
  builtin: true,
  category: "tools",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "todos.scan",
      title: "Todos scannen",
      run: () => {
        const hits: string[] = [];
        for (const [path, content] of Object.entries(api.files())) {
          content.split("\n").forEach((line, i) => {
            if (/\b(TODO|FIXME|HACK)\b/.test(line)) hits.push(`${path}:${i + 1} ${line.trim()}`);
          });
        }
        useIde.getState().revealOutput();
        api.output(hits.length ? hits.join("\n") : "Keine Todos.");
      },
    });
  },
});

registerBuiltin({
  id: "web",
  name: "Web",
  description: "Seite laden und als Datei ablegen. Agent kann URLs lesen.",
  builtin: true,
  category: "web",
  version: "1.0",
  activate: (api) => {
    api.command({
      id: "web.fetch",
      title: "URL als Datei holen",
      run: async () => {
        const url = window.prompt("URL");
        if (!url) return;
        const r = await fetchWeb({ data: { url } });
        const name = `web/${safeName(url)}.txt`;
        api.write(name, r.text);
        api.open(name);
        api.notify(r.ok ? `Geladen: ${name}` : "Laden fehlgeschlagen");
      },
    });
    api.command({
      id: "web.esm",
      title: "esm.sh Import einfügen",
      run: () => {
        const path = api.active();
        if (!path || !/\.(js|ts)$/.test(path)) {
          api.notify("Eine JS/TS-Datei öffnen");
          return;
        }
        const pkg = window.prompt("Paketname, z. B. lodash-es");
        if (!pkg) return;
        const line = `import {} from "https://esm.sh/${pkg.trim()}";\n`;
        api.write(path, line + (api.read(path) ?? ""));
      },
    });
  },
});

function safeName(url: string): string {
  try {
    return new URL(url).hostname.replace(/[^\w.-]+/g, "-");
  } catch {
    return "seite";
  }
}

function pickFiles(api: PluginApi) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ".zip,.txt,.md,.py,.js,.ts,.json,.go,.rs,.java,.c,.cpp,.cs,.php,.rb,.html,.css";
  input.onchange = () => {
    void (async () => {
      for (const file of [...(input.files ?? [])]) {
        if (file.name.endsWith(".zip")) {
          const files = await unzipFiles(await file.arrayBuffer());
          for (const [path, content] of Object.entries(files)) api.write(path, content);
          api.notify(`${Object.keys(files).length} Dateien aus ZIP`);
        } else {
          api.write(file.name, await file.text());
        }
      }
    })();
  };
  input.click();
}
