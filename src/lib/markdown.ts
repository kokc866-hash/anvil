import { esc, tokenize, tokensToHtml } from "./syntax";

export function renderMarkdown(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeLang = "";
  let code: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        out.push(
          `<pre class="syntax"><code>${tokensToHtml(tokenize(code.join("\n"), codeLang || "plaintext"))}</code></pre>`,
        );
        inCode = false;
        code = [];
        codeLang = "";
      } else {
        closeList();
        inCode = true;
        codeLang = line.slice(3).trim().split(/\s+/)[0] ?? "";
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const list = line.match(/^[\-*] (.+)$/);
    if (list) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(list[1])}</li>`);
      continue;
    }
    closeList();
    if (/^### /.test(line)) out.push(`<h3>${inline(line.slice(4))}</h3>`);
    else if (/^## /.test(line)) out.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (/^# /.test(line)) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (/^---+$/.test(line)) out.push("<hr/>");
    else if (!line.trim()) out.push("");
    else out.push(`<p>${inline(line)}</p>`);
  }
  if (inCode) {
    out.push(`<pre class="syntax"><code>${tokensToHtml(tokenize(code.join("\n"), codeLang || "plaintext"))}</code></pre>`);
  }
  closeList();
  return out.join("\n");
}

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_m, label: string, href: string) => {
      if (/[<>"']/.test(href) || !/^https?:\/\//i.test(href)) return label;
      const safe = href.replace(/&/g, "&" + "amp;");
      return `<a href="${safe}" target="_blank" rel="noreferrer noopener">${label}</a>`;
    });
}
