import { evidenceTargetKey, toolResultFailed, toolResultPending } from "./agent-evidence.ts";
import { parsePlayInput, type PlayAction } from "./preview-input.ts";

export type PreviewProof = {
  type: PlayAction["type"];
  selector?: string;
  expected?: string;
  key?: string;
  checked?: boolean;
  absence?: boolean;
};
const fact = (value: string) => evidenceTargetKey(value.trim().toLowerCase());
export const validPreviewFingerprint = (value: unknown): value is string =>
  typeof value === "string" && /^k\d+-[a-f\d]+-[a-f\d]+$/.test(value) && value.length <= 80;

export function previewProof(args: Record<string, unknown>, result: Record<string, unknown>): PreviewProof[] | undefined {
  if (result.ok !== true || toolResultFailed(result) || toolResultPending(result) || result.rejected || result.truncated || result.already_executed) return;
  try {
    const parsed = parsePlayInput(args);
    const input = result.input as { mode?: string; completed?: number; total?: number; assertions?: number } | undefined;
    const actions = [...parsed.keys.map(key => ({ type: "key" as const, key })), ...parsed.actions] as PlayAction[];
    const assertions = actions.filter(action => action.type === "assert").length;
    if (input?.completed !== undefined && input.completed !== actions.length
      || input?.total !== undefined && input.total !== actions.length
      || input?.assertions !== undefined && input.assertions !== assertions) return;
    if (assertions ? result.functionalChecks !== true
      : (input?.mode !== "native-preview" && input?.mode !== "dom-events") ||
        input.completed !== actions.length || input.total !== actions.length || input.assertions !== 0) return;
    return actions.map(action => ({
      type: action.type,
      ...(action.selector ? { selector: evidenceTargetKey(action.selector.trim()) } : {}),
      ...(action.type === "key" && action.key ? { key: fact(action.key) } : {}),
      ...(action.type === "assert" && (action.value ?? action.text) !== undefined ? { expected: evidenceTargetKey((action.value ?? action.text)!) } : {}),
      ...(action.type === "assert" && typeof action.checked === "boolean" ? { checked: action.checked } : {}),
      ...(action.type === "assert" && action.count === 0 ? { absence: true } : {}),
    }));
  } catch { /* An unavailable or rejected action list cannot establish a specific check. */ }
}

export function previewMissingSelector(text: string): string | undefined {
  if (!/absichtlich\s+nicht\s+vorhanden|intentional(?:ly)?\s+(?:missing|nonexistent)/i.test(text) || !/ablehn|reject/i.test(text)) return;
  const selectors = [...new Set([...text.matchAll(/(?:^|[\s`"'(])(#[_a-z][\w-]*)/gi)].map(match => match[1]))];
  if (selectors.length === 1) return selectors[0];
}

export function validPreviewProof(value: unknown): value is PreviewProof[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 32 && value.every(action =>
    action && typeof action === "object" && /^(?:key|click|move|drag|scroll|type|wait|assert)$/.test(action.type)
    && Object.entries(action).every(([key, value]) => key === "type" || (
      ["selector", "expected", "key"].includes(key) ? validPreviewFingerprint(value)
        : ["checked", "absence"].includes(key) && typeof value === "boolean"
    )),
  );
}

/** For concrete requirements compare actual action kinds, selectors, and requested
 * values. Open-ended functional checks still need the model's attribution. */
export function previewStepCovered(text: string, actions: PreviewProof[]): boolean {
  const selectors = [...text.matchAll(/(?:^|[\s`"'(])(#[_a-z][\w-]*)/gi)].map(match => match[1]);
  const clickTargets = [...text.matchAll(/\b(?:klicke|klicken|click|anklicken)\s+(?:(?:auf|on)\s+)?[`"']?(#[_a-z][\w-]*)/gi)].map(match => match[1]);
  const targets = selectors.filter(selector => !clickTargets.includes(selector)).map(evidenceTargetKey);
  const clickTargetKeys = clickTargets.map(evidenceTargetKey);
  const expectations = new Set([...text.matchAll(/\b(?:zähler|counter)\s+(\d+)\b/gi)].map(match => match[1]));
  const initial = /\b(?:ausgangszustand|initial state)\s+[`"']?([\p{L}\d_-]+)/iu.exec(text)?.[1];
  if (initial && /^[\p{Lu}\d]/u.test(initial)) expectations.add(initial);
  for (const match of text.matchAll(/\b(?:prüfe|verifiziere|check|verify|assert)\s+([\w-]+)(?=\s*[.!?;]|$)/gi))
    if (!/^(?:checked|unchecked|visible|hidden)$/i.test(match[1])) expectations.add(match[1]);
  const typeValue = /\b(?:ersetze|replace)\b[^.;]+?\b(?:durch|with)\s+[`"'“]?([\w-]+)/i.exec(text)?.[1];
  if (typeValue) expectations.add(typeValue);
  const counterValues = /\b(?:zähler|counter)\b[^.]*?\((\d+)\s+(?:und|and)\s+(\d+)\)/i.exec(text);
  if (counterValues) for (const value of counterValues.slice(1)) expectations.add(value);
  const expectsCheckbox = /\bcheckbox\b/i.test(text) && /aktivier|deaktivier|checked|anklick|tick|markier/i.test(text);
  const expectsClick = /\b(?:klicke|klicken|click|clicks?|anklicken|anklickt)\b/i.test(text);
  const expectsTyping = Boolean(typeValue) || /texteingabe|\btype into\b/i.test(text);
  const key = /\b(?:drücke|druecke|press)\s+(Enter|Escape|Esc|Tab|Delete|Del|Backspace|Space|Leertaste|Arrow(?:Up|Down|Left|Right))\b/i.exec(text)?.[1];
  const expectsKey = Boolean(key) || /\b(?:tastaturkürzel|tastaturkuerzel|tastenkürzel|tastenkuerzel|keyboard shortcuts?)\b/i.test(text);
  const expectsAbsence = /\b(?:fehlt|verschwunden|removed|absent|no longer exists)\b/i.test(text);
  if (previewMissingSelector(text)) return false;
  const asserted = actions.filter(action => action.type === "assert");
  const actionBefore = (assertion: PreviewProof, predicate: (action: PreviewProof) => boolean) =>
    actions.slice(0, actions.indexOf(assertion)).some(predicate);
  const click = (a: PreviewProof) => a.type === "click" && (!clickTargetKeys.length || a.selector !== undefined && clickTargetKeys.includes(a.selector));
  if (targets.some(target => !asserted.some(action => action.selector === target && (!expectsAbsence || action.absence))))
    return false;
  if (expectsClick && !asserted.some(action => actionBefore(action, click))) return false;
  if (clickTargetKeys.some(target => !asserted.some(action => actionBefore(action, a => a.type === "click" && a.selector === target)))) return false;
  if (expectsTyping && !asserted.some(action => (!typeValue || action.expected === evidenceTargetKey(typeValue))
    && actionBefore(action, a => a.type === "type" && a.selector === action.selector))) return false;
  if (expectsCheckbox && !asserted.some(action => action.checked === !/deaktivier|unchecked|uncheck/i.test(text)
    && actionBefore(action, a => (a.type === "click" || a.type === "key") && a.selector === action.selector))) return false;
  if (expectsKey) {
    const normalized = /^(?:del|delete)$/i.test(key || "") ? "delete" : /^esc$/i.test(key || "") ? "escape" : /^leertaste$/i.test(key || "") ? "space" : key;
    if (!asserted.some(action => (!expectsAbsence || action.absence) && (!targets.length || !!action.selector && targets.includes(action.selector))
      && actionBefore(action, a => a.type === "key" && (!normalized || a.key === fact(normalized))))) return false;
  }
  // Each requested state change must follow a separate click. A single click
  // with two snapshots cannot certify two button presses. A repeated press
  // also needs the same control and the same observed output.
  const repeatedClick = expectsClick && expectations.size > 1 && /\b(?:zweimal|erneut|twice|again)\b/i.test(text);
  let from = 0;
  let repeatedControl: string | undefined;
  let repeatedOutput: string | undefined;
  const lastClickBefore = (index: number) => actions.slice(from, index).filter(candidate =>
    click(candidate) && (!repeatedClick || candidate.selector && (!repeatedControl || candidate.selector === repeatedControl)),
  ).at(-1);
  for (const value of expectations) {
    const expected = evidenceTargetKey(value);
    const index = actions.findIndex((action, i) => {
      if (i < from || action.expected !== expected) return false;
      if (repeatedClick && (!action.selector || repeatedOutput && action.selector !== repeatedOutput)) return false;
      return !expectsClick || Boolean(lastClickBefore(i));
    });
    if (index < 0) return false;
    if (repeatedClick && !repeatedControl) {
      repeatedControl = lastClickBefore(index)?.selector;
      repeatedOutput = actions[index].selector;
    }
    if (expectsClick) from = index + 1;
  }
  return true;
}
