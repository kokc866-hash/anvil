import { AGENT_TOOL_NAMES } from "./agent-tools.ts";

/** Only discard an interrupted, recognized tool envelope at a line boundary.
 * Ordinary prose, user-facing JSON and complete code examples remain intact. */
export function stoppedAssistantContent(content: string, reason = "Gestoppt"): string {
  let body = content.trim();
  const starts = /(^|\n)(?:```(?:json)?\s*\n)?\s*\{\s*"(?:action|name)"\s*:\s*"([a-z_][a-z0-9_]*)"/g;
  for (const match of body.matchAll(starts)) {
    if (!AGENT_TOOL_NAMES.has(match[2])) continue;
    const tail = body.slice(match.index! + match[1].length).replace(/^```(?:json)?\s*\n/, "").trim();
    if (unclosedObject(tail)) {
      body = body.slice(0, match.index).trim();
      break;
    }
  }
  const note = reason.trim() || "Gestoppt";
  if (body === note || body.endsWith(`\n${note}`)) return body;
  return body ? `${body}\n\n${note}` : note;
}

function unclosedObject(text: string): boolean {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return false;
  }
  return depth > 0;
}

export function finishedHarness(
  harness: string | undefined,
  plan: readonly { status: string }[] | undefined,
  stopped = false,
  locale: "de" | "en" = "de",
): string | undefined {
  const open = plan?.filter((step) => step.status !== "ok").length || 0;
  if (!harness && !open && !stopped) return harness;
  const label = stopped ? (locale === "en" ? "Stopped" : "Stop") : open
    ? locale === "en" ? `Ended · ${open} step${open === 1 ? "" : "s"} remaining` : `Beendet · ${open} Schritt${open === 1 ? "" : "e"} offen`
    : locale === "en" ? "Done" : "Fertig";
  // Keep the useful run/tool counters, not an earlier completion assertion.
  const counters = (harness || "").split(" · ").filter((part) => /^(Run|See|Tools) \d/.test(part));
  return [label, ...counters].join(" · ");
}
