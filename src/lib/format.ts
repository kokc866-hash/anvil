import { langFromPath } from "./languages";

export async function formatCode(path: string, code: string): Promise<string> {
  const lang = langFromPath(path);
  if (lang === "json") {
    try {
      return `${JSON.stringify(JSON.parse(code), null, 2)}\n`;
    } catch {
      return code;
    }
  }
  if (lang === "go" || lang === "rust" || lang === "c" || lang === "cpp") {
    try {
      const { companionFormat, companionPing } = await import("./companion");
      const ping = await companionPing();
      if (ping.ok) {
        const r = await companionFormat({ path, content: code });
        if (r.ok && r.via && r.via !== "none") return r.content;
      }
    } catch {
      /* Companion aus */
    }
  }
  try {
    const prettier = (await import(/* @vite-ignore */ "https://esm.sh/prettier@3.4.2/standalone")) as {
      format: (s: string, o: Record<string, unknown>) => Promise<string>;
    };
    const plugins: unknown[] = [];
    if (lang === "javascript" || lang === "typescript") {
      plugins.push(
        await import(/* @vite-ignore */ "https://esm.sh/prettier@3.4.2/plugins/babel"),
        await import(/* @vite-ignore */ "https://esm.sh/prettier@3.4.2/plugins/estree"),
        await import(/* @vite-ignore */ "https://esm.sh/prettier@3.4.2/plugins/typescript"),
      );
    } else if (lang === "html" || lang === "markdown") {
      plugins.push(await import(/* @vite-ignore */ "https://esm.sh/prettier@3.4.2/plugins/html"));
      if (lang === "markdown") {
        plugins.push(await import(/* @vite-ignore */ "https://esm.sh/prettier@3.4.2/plugins/markdown"));
      }
    }
    if (!plugins.length) return trimLines(code);
    const parser =
      lang === "typescript" ? "typescript" : lang === "html" ? "html" : lang === "markdown" ? "markdown" : "babel";
    return await prettier.format(code, { parser, plugins, tabWidth: 2 });
  } catch {
    return trimLines(code);
  }
}

function trimLines(code: string): string {
  return `${code
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}
