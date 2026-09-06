export function parseBlocks(text: string) {
  return text.split(/(```[\s\S]*?```)/g).map((part) => {
    if (!part.startsWith("```")) return { code: false as const, text: part };
    const m = part.match(/^```([^\n]*)\n?([\s\S]*?)\n?```$/);
    const meta = (m?.[1] ?? "").trim();
    const body = m?.[2] ?? "";
    const path = meta.includes(".") && !meta.includes(" ") ? meta : "";
    return { code: true as const, text: body, path, lang: meta };
  });
}
