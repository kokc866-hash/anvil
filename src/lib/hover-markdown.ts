/** Keep source text literal even when it contains Markdown or backticks. */
export function hoverCode(text: string, language = ""): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}
