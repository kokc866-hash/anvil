import type { PlanStep } from "@/store/ide";
import { previewInteractionRequest } from "./preview-task.ts";
import { workspaceResultName } from "../../scripts/workspace-results.mjs";

type Args = Record<string, unknown>;
const fileToken = /(?:[\p{L}\p{N}_@.-]+[/\\])*[\p{L}\p{N}_@.-]+\.[\p{L}][\p{L}\p{N}_+-]{0,15}/gu;
const runtimeNames = new Set(["node.js", "next.js", "vue.js"]);
const normalized = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");

/** Literal file names, not arbitrary prose keywords or URLs. Quoted paths may contain spaces. */
export function planFileTargets(text: string): string[] {
  const targets: string[] = [];
  const add = (value: string) => {
    const target = normalized(value);
    if (!target.split("/").some(part => part === "..") && !targets.includes(target)) targets.push(target);
  };
  const unquoted = text.replace(/https?:\/\/[^\s<>]+/gi, " ").replace(/`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'/g, (whole, a, b, c) => {
    const value = a || b || c;
    if (/\.[\p{L}][\p{L}\p{N}_+-]{0,15}$/u.test(value) && !/https?:\/\//i.test(value)) { add(value); return " "; }
    return whole;
  });
  for (const match of unquoted.matchAll(fileToken)) if (!runtimeNames.has(match[0].toLowerCase())) add(match[0]);
  return targets;
}

export function planTargetMatches(expected: string, actual: string): boolean {
  const path = normalized(actual), target = normalized(expected);
  if (path.split("/").some(part => part === "..")) return false;
  return target.includes("/") ? target === path : path === target || path.endsWith("/" + target);
}

export function planOperationPaths(args: Args): string[] {
  return [args.path, args.from, args.to].filter((value): value is string => typeof value === "string").map(normalized)
    .concat(typeof args.command === "string" ? planFileTargets(args.command) : []);
}

function actionText(text: string): string {
  let result = text;
  for (const target of planFileTargets(text)) result = result.replaceAll(target, " ").replaceAll(target.replaceAll("/", "\\"), " ");
  return result.normalize("NFKC").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
}

/** Multiple explicit actions need multiple corresponding receipts; writing tests is not running them. */
export function planRequiredKinds(step: PlanStep): NonNullable<PlanStep["kind"]>[] {
  const kinds = new Set<NonNullable<PlanStep["kind"]>>(step.kind ? [step.kind] : []);
  const text = actionText(step.text);
  if (/\b(?:write|edit|modify|append|rewrite|schreib\w*|aender\w*|bearbeit\w*|ergaenz\w*)\b/.test(text)) kinds.add("edit");
  if (/\b(?:read|inspect|lies|lese|lesen)\b/.test(text)) kinds.add("read");
  const tests = /\b(?:tests?|testen|pruef\w*|check|verify|validate)\b/.test(text);
  const execute = /\b(?:run|execute|launch|start\w*|oeffn\w*|ausfuehr\w*)\b/.test(text)
    || step.kind === 'report' && /\bdurchfuehr\w*\b/.test(text);
  // A report can describe Prüfpunkte/Prüfergebnisse without requesting another
  // execution. Explicit verbs and "Prüfung starten/durchführen" still require it.
  const checkAction = step.kind === 'report'
    ? /\b(?:testen|pruef(?:e|en|t|st)?|check|verify|validate)\b/.test(text)
    : /\b(?:testen|pruef\w*|check|verify|validate)\b/.test(text);
  if (step.kind !== "read" && checkAction || tests && execute) kinds.add("check");
  if (execute && !tests && step.kind !== "check") kinds.add("run");
  return [...kinds];
}

export function isResponseOnlyStep(step: PlanStep): boolean {
  const summary = step.kind === "report" || (!step.kind && /^(ergebnis(?:se)?|result(?:s)?|antwort|answer)\s+(zusammenfassen|berichten|mitteilen|summari[sz]e|report|geben|liefern)\b/i.test(step.text));
  return summary && !planFileTargets(step.text).length && !previewInteractionRequest(step.text)
    && planRequiredKinds({ ...step, kind: "report" }).length === 1;
}

/** Acknowledging an opaque implementation is the agent's explicit job. Auto-progress is only mechanical. */
export function automaticFileStep(step: PlanStep): boolean {
  const targets = planFileTargets(step.text);
  if (targets.length !== 1) return false;
  const remainder = actionText(step.text).replace(/[`'"()[\],.:;!?&+/-]/g, " ");
  const words = remainder.match(/[\p{L}\p{N}_]+/gu) || [];
  return words.length > 0 && words.every(word => /^(?:the|a|an|file|datei|die|der|das|bitte|please|write|create|edit|save|append|delete|remove|rename|move|format|to|from|in|schreib\w*|erstell\w*|erzeug\w*|speicher\w*|aender\w*|bearbeit\w*|loesch\w*|entfern\w*|umbenenn\w*|benenn\w*|verschieb\w*|formatier\w*|nach|von|zu|um)$/i.test(word));
}

/** File receipt types matter too: formatting or deleting is not implementing. */
export function nativeFileActionMatches(text: string, name: string): boolean {
  const action = actionText(text);
  const deletion = /\b(?:delete|remove|loesch\w*|entfern\w*)\b/.test(action);
  const rename = /\b(?:rename|move|umbenenn\w*|benenn\w*|verschieb\w*)\b/.test(action);
  const format = /\b(?:format|formatier\w*)\b/.test(action);
  const folder = /\b(?:folder|directory|ordner|verzeichnis)\b/.test(action);
  if (name === "delete_file") return deletion;
  if (name === "rename") return rename;
  if (name === "format_file") return format;
  if (name === "mkdir") return folder;
  if (/^(write_file|edit_file|append_file)$/.test(name)) return !deletion && !rename && !format;
  return true;
}

export const workspaceFileOperation = (name: string) => /^(read_file|verify_file|write_file|edit_file|append_file|delete_file|rename|mkdir|format_file|run_file|open_preview|shell)$/.test(name);

function fileClauses(text: string): string[] {
  const targets = planFileTargets(text);
  let masked = text;
  const substitutions = targets.map((target, i) => ({ target, token: `\uE000${i}\uE001` })).sort((a, b) => b.target.length - a.target.length);
  for (const { target, token } of substitutions) masked = masked.replaceAll(target, token).replaceAll(target.replaceAll("/", "\\"), token);
  const clauses = masked.split(/\s*(?:[.;!?](?=\s|$)|(?:,|\b(?:and|und|then|dann)\b)\s+(?=(?:(?:and|und)\s+)?(?:write|read|create|edit|modify|delete|remove|rename|move|format|run|execute|test|check|verify|document|halte|dokumentier\w*|schreib\w*|lese\w*|lies|erstell\w*|aender\w*|loesch\w*|entfern\w*|umbenenn\w*|benenn\w*|verschieb\w*|formatier\w*|test\w*|pruef\w*|prüf\w*)\b(?!\.)))\s*/i);
  return clauses.map(part => {
    for (const { target, token } of substitutions) {
      for (const quote of ['"', "'", "`"]) part = part.replaceAll(quote + token + quote, token);
      part = part.replaceAll(token, `\`${target}\``);
    }
    return part;
  });
}

const fileCheck = /\b(?:pruef(?:e|en|t|st)?|check|verify|validate|testen)\b/;
const physicalFile = /\b(?:dateien|files|pfad|paths?|size|groesse|dimensions?|abmessungen|aufloesung|resolution|on disk|auf (?:der )?platte|exists?|existier\w*|vorhanden|sha-?256|pruefsumme|checksum)\b/;
const activePath = /\b(?:aktiven?|active|open|geoeffneten?)\s+(?:pfad|path|datei|file|scene|szene)\b/;
const sizePair = /\b([1-9]\d{0,9})\s*[x×]\s*([1-9]\d{0,9})\b/i;

/** Match explicit saved-asset checks, including a later "check the generated files" clause. */
export function planDiskRequirements(step: PlanStep): { path: string; width?: number; height?: number }[] {
  const clauses = fileClauses(step.text);
  const assets = [...new Set(planFileTargets(step.text).filter(target => workspaceResultName(target) && !/\.(?:md|txt|log|json|html?)$/i.test(target)))];
  const requirements = new Map<string, { path: string; width?: number; height?: number }>();
  for (const clause of clauses) {
    const action = actionText(clause);
    if (!fileCheck.test(action) || activePath.test(action)) continue;
    const named = planFileTargets(clause).filter(target => assets.includes(target));
    const metadata = physicalFile.test(action) || sizePair.test(action);
    const plainCheck = /^\s*(?:pruef(?:e|en)|check|verify|validate)\s*(?:(?:die|das|den|the)\s+)?(?:datei|file)?\s*[`"'\s]*$/.test(action);
    const checked = named.length ? metadata || plainCheck ? named : [] : metadata ? assets : [];
    for (const path of checked) {
      // Keep sizes scoped to the named image (or the shared render clause).
      const size = /\.png$/i.test(path) ? [clause, ...clauses.filter(part => planFileTargets(part).includes(path))]
        .map(part => sizePair.exec(actionText(part))).find(Boolean) : undefined;
      requirements.set(path, { path, ...(size ? { width: Number(size[1]), height: Number(size[2]) } : {}) });
    }
  }
  return [...requirements.values()];
}

function reportFileAction(text: string): boolean {
  return /\b(?:halte\b.*\bfest|dokumentier\w*|document)\b/.test(text);
}

/** Keep different literal file actions separate, e.g. read A and write B. */
export function planFileRequirements(step: PlanStep): { targets: string[]; action: "read" | "write" | "delete" | "rename" | "format" }[] {
  const checkedAssets = new Set(planDiskRequirements(step).map(requirement => requirement.path));
  return fileClauses(step.text).flatMap(part => {
    const files = planFileTargets(part);
    if (!files.length) return [];
    const text = actionText(part);
    const action = /\b(?:delete|remove|loesch\w*|entfern\w*)\b/.test(text) ? "delete" as const
      : /\b(?:rename|move|umbenenn\w*|benenn\w*|verschieb\w*)\b/.test(text) ? "rename" as const
      : /\b(?:format|formatier\w*)\b/.test(text) ? "format" as const
      : reportFileAction(text) || /\b(?:write|create|edit|modify|append|implement\w*|schreib\w*|erstell\w*|erzeug\w*|speicher\w*|aender\w*|bearbeit\w*|implementier\w*)\b/.test(text) ? "write" as const
      : /\b(?:read|inspect|lies|lese|lesen)\b/.test(text) ? "read" as const
      : step.kind === "edit" || step.kind === "report" ? "write" as const : undefined;
    const targets = files.filter(path => !(checkedAssets.has(path)
      && (action === "read" || action === "write" && /\b(?:speicher\w*|save|export\w*|render\w*)\b/.test(text))));
    return action && targets.length ? [{ targets, action }] : [];
  });
}

export function planFileReceiptMatches(action: ReturnType<typeof planFileRequirements>[number]["action"], name: string): boolean {
  return action === "write" ? /^(write_file|edit_file|append_file)$/.test(name)
    : action === "read" ? name === "read_file"
    : action === "delete" ? name === "delete_file"
    : action === "rename" ? name === "rename" : name === "format_file";
}
