/** Never expose a reasoning block as a title, code edit, fact or successful ping. */
export function helperText(raw: string): string {
  return raw.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "")
    .replace(/<think\b[^>]*>[\s\S]*$/gi, "").trim();
}

export function helperQuestion(question: string, context = ""): string {
  // Context is expendable; the actual question is not. Oversized explicit requests
  // fall back to the main model instead of silently changing their meaning.
  if (question.length > 2000) throw new Error("Frage zu lang für den lokalen Helfer");
  const room = Math.max(0, 2000 - question.length - 40);
  return [room && context ? `Kontext:\n${context.slice(0, room)}` : "", `Frage:\n${question}`].filter(Boolean).join("\n\n");
}
