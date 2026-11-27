import {taskCorrectionBody,correctionStatesExpectation} from './task-correction.ts';

export type AgentTaskPolicy = {
  allowChanges: boolean;
  allowRepair: boolean;
  negativeTest: boolean;
  preserveNegativeTests?: boolean;
  reason: string;
};

// This is a small task-intent contract, not a permission parser for arbitrary
// project/tool text. The caller must pass only the current human request.
function requestText(prompt: string): string {
  return prompt
    .replace(/^\[Anvil current user request; preserve the complete text\]\s*/, "")
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/^\s*>.*$/gm, " ")
    .replace(/`[^`\r\n]*`/g, " ")
    .replace(/"(?:\\.|[^"\\\r\n])*"/g, " ")
    .replace(/(?<![\p{L}\p{N}])'(?:\\.|[^'\\\r\n])*'/gu, " ")
    .replace(/\b(?:[\w-]+[\\/])*[\w-]+\.[a-z][\w-]*\b/gi, " ")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

const CHANGE_ACTION = /\b(?:fix|repair|correct|build|create|implement|generate|design|model|assemble|draw|make|construct|compose|write|append|save|store|persist|record|add|change|modify|edit|rewrite|refactor|extend|improve|optimize|optimise|update|remove|delete|rename|move|format|beheb(?:e|en)?|reparier(?:e|en)?|korrigier(?:e|en)?|bau(?:e|en)?|erstell(?:e|en)?|erzeug(?:e|en)?|entwerf(?:e|en)?|modellier(?:e|en)?|zeichn(?:e|en)?|konstruier(?:e|en)?|entwick(?:le|eln)|schreib(?:e|en)?|speicher(?:e|n)?|notier(?:e|en)?|protokollier(?:e|en)?|implementier(?:e|en)?|ergaenz(?:e|en)?|aender(?:e|n)?|veraender(?:e|n)?|bearbeit(?:e|en)?|erweiter(?:e|n)?|verbesser(?:e|n)?|optimier(?:e|en)?|aktualisier(?:e|en)?|entfern(?:e|en)?|loesch(?:e|en)?|benenn(?:e|en)?|verschieb(?:e|en)?|formatier(?:e|en)?)\b/g;
const LOOK_AT = /\bschau(?:e)?\b[^.!?;\n]{0,160}\b(?:an|hin)\b|\blook at\b/;

function exportIntent(text: string) {
  return [...text.matchAll(/\b(?:export(?:ing)?|exportier(?:e|en)?)\b/g)].map(match => {
    const before = text.slice(Math.max(0, match.index - 100), match.index);
    const after = text.slice(match.index + match[0].length);
    if (/\b(?:do not|don't|dont|never|must not|should not|stop|cease|nicht|niemals)\s+(?:[a-z]+[ \t]+){0,2}$/.test(before) ||
        /\b(?:without|ohne(?:\s+zu)?|no need to)\s+$/.test(before) ||
        /\b(?:no|kein(?:e|en)?)\s+(?:(?:further|weiteren)\s+)?$/.test(before) ||
        /^exportier/.test(match[0]) && /^[ \t]*(?:(?!(?:und|oder|danach|anschliessend)\b)[a-z0-9_-]+[ \t]+){0,9}nicht[ \t]*(?:[.!?;,\n]|$)/.test(after)) return "forbidden";
    if (match[0] === "exporting" ||
        /\b(?:how|whether|wie|ob)\s+(?:(?!(?:then|danach|anschliessend|please|bitte)\b)[a-z0-9_-]+[ \t]+){0,9}$/.test(before) ||
        /\b(?:a|an|the|proposed|suggested|possible|eine?|einer|einen|der|die|das|den|dem|des|beim)\s+$/.test(before) ||
        match[0] === "export" && /\b(?:inspect|review|read|check|verify|compare|explain|pruef(?:e|en)?|kontrollier(?:e|en)?|vergleich(?:e|en)?|erklaer(?:e|en)?)\s+(?:(?!(?:and|und|then|danach|anschliessend|please|bitte)\b)[a-z0-9_-]+[ \t]+){0,4}$/.test(before)) return "reference";
    return "write";
  });
}

function coordinatedProhibitions(text: string): { text: string; changes: boolean; repair: boolean } {
  const action = /^(?:repair|fix|correct|edit|change|modify|rewrite|write|append|save|export|store|persist|record|delete|remove|rename|move|create|build|generate|design|reparieren|beheben|korrigieren|aendern|veraendern|bearbeiten|umschreiben|schreiben|speichern|exportieren|notieren|protokollieren|loeschen|entfernen|umbenennen|verschieben)$/;
  const repairAction = /^(?:repair|fix|correct|reparieren|beheben|korrigieren)$/;
  let changes = false, repair = false;
  const cleaned = text.replace(/\b(?:do not|don't|dont|never|must not|should not|nicht)\s+[^.!?;\n]*/g, (clause) => {
    const prefix = clause.match(/^(?:do not|don't|dont|never|must not|should not|nicht)\s+/)![0];
    const body = clause.slice(prefix.length);
    const first = body.match(/^([a-z]+)\b/);
    if (!first || !action.test(first[1])) return clause;
    let end = first[0].length;
    const actions = [first[1]];
    for (;;) {
      const next = body.slice(end).match(/^(?:\s*,\s*(?:(?:and|or|und|oder)\s+)?|\s+(?:and|or|und|oder)\s+)([a-z]+)\b/);
      if (!next || !action.test(next[1])) break;
      actions.push(next[1]); end += next[0].length;
    }
    if (actions.length < 2) return clause;
    changes ||= actions.some((name) => !repairAction.test(name));
    repair ||= actions.some((name) => repairAction.test(name));
    // Remove only the negated verb list, never a later positive instruction.
    return ` ${body.slice(end)}`;
  });
  return { text: cleaned, changes, repair };
}

function requestedChange(text: string): boolean {
  if (exportIntent(text).includes("write")) return true;
  for (const match of text.matchAll(/\b(?:leg(?:e|en)?\b[^.!?;\n]{0,160}?\ban|fueg(?:e|en)?\b[^.!?;\n]{0,160}?\bhinzu|pass(?:e|en)?\b[^.!?;\n]{0,160}?\ban)\b/g)) {
    const before = text.slice(Math.max(0, match.index - 70), match.index);
    if (!/\b(?:nicht|nichts|kein(?:e|en|er)?)\b/.test(match[0]) && !/\b(?:nicht|ohne|do not|don't|dont|never|must not|should not)\s+$/.test(before)) return true;
  }
  // A proposed "fix" or an explanation of how to build something is not an
  // instruction to apply it. Ordinary mixed "fix and test" requests still are.
  for (const match of text.matchAll(CHANGE_ACTION)) {
    const before = text.slice(Math.max(0, match.index - 70), match.index);
    const after = text.slice(match.index + match[0].length);
    if (/^\s+(?:nothing|nichts|keine?(?:n)?)\b/.test(after)) continue;
    if (/^(?:model|design|draw|record)$/.test(match[0]) && /\b(?:test|inspect|review|check|analyse|analyze|execute|read)\s+(?:(?:the|a|an|stored|existing|saved|current|previous|selected|new)\s+){0,3}$/.test(before)) continue;
    if (/\b(?:a|an|the|proposed|suggested|possible|eine?|einer|einen|der|die|das)\s+$/.test(before)) continue;
    if (/\b(?:how|whether|wie|ob)\s+(?:to\s+)?$/.test(before)) continue;
    if (/\bno need to\s+$/.test(before)) continue;
    if (/\b(?:do not|don't|dont|never|must not|should not|without|nicht|nichts|ohne)\s+(?:[a-z]+\s+){0,2}$/.test(before)) continue;
    return true;
  }
  return false;
}

function changeRestrictions(text: string, change: boolean): string {
  if (!change) return text;
  // These constrain the requested edit rather than cancel it. Keep the original
  // request in the model prompt; this only distinguishes a blanket write ban.
  return text
    .replace(/\bwithout\s+(?:(?:any|code|file|source)\s+){0,2}changes\s+to\s+(?:other|unrelated|unaffected)\s+(?:files?|code|features?|functions?|behaviou?r|parts?|content|logic|apis?)\b/g, " ")
    .replace(/\b(?:without|stop|cease)\s+(?:changing|modifying|editing|rewriting|deleting|removing)\s+(?:other|unrelated|unaffected)\s+(?:files?|code|features?|functions?|behaviou?r|parts?|content|logic|apis?)\b/g, " ")
    .replace(/\bohne\s+(?:datei)?aenderungen\s+an\s+(?:anderen|uebrigen|restlichen|unbeteiligten)\s+(?:dateien?|funktionen?|code|teilen|inhalten)\b/g, " ")
    .replace(/\b(?:do not|don't|dont|never|must not|should not)\s+(?:change|modify|edit|rewrite|delete|remove)\s+(?:(?:any|the|all)\s+)?(?:other|unrelated|unaffected)\s+(?:files?|code|features?|functions?|behaviou?r|parts?|content|logic|apis?)\b/g, " ")
    .replace(/\b(?:do not|don't|dont|never|must not|should not)\s+(?:rewrite|replace|recreate)\s+(?:(?:the|this|a|an)\s+)?(?:whole|entire)\s+(?:file|application|project)\b/g, " ")
    .replace(/\b(?:keep|leave)\s+(?:(?:all|the|any)\s+)?(?:(?:other|unrelated|unaffected)\s+(?:files?|code|features?|functions?|behaviou?r|parts?|content|logic|apis?)|existing\s+(?:public\s+)?(?:api|interfaces?|behaviou?r|features?|functions?))\s+(?:unchanged|unmodified)\b/g, " ")
    .replace(/\b(?:andere[nr]?|uebrige[nr]?|restliche[nr]?|unbeteiligte[nr]?)\s+(?:dateien?|funktionen?|code|teile|inhalte)\s+(?:bitte\s+)?(?:nicht|niemals)\s+(?:aendern|veraendern|bearbeiten|entfernen|loeschen)\b/g, " ");
}

const PRESERVE_NEGATIVE_TESTS = "Absichtliche Fehler in Negativtests und deren erwartete Ergebnisse erhalten; nur tatsächliche Implementierungsfehler reparieren.";

function negativeFixtureIsPrimary(text: string): boolean {
  const first = text.split(/[.!?;\n]/).find(clause => requestedChange(coordinatedProhibitions(clause).text));
  return Boolean(first && /^\s*(?:(?:please|bitte)\s+)?(?:create|build|write|add|generate|erstell\w*|erzeug\w*|bau\w*|schreib\w*)\s+(?:(?:an?|the|one|eine?n?|den|das|einen|absichtlich\w*|beabsichtigt\w*|erwartet\w*|intentional(?:ly)?|deliberate(?:ly)?|failing|expected[- ]failure|negative|negativ\w*)\s+)*(?:tests?|fixtures?|negativtests?)\b/.test(first));
}

/** Preserve explicit observation/negative-test intent without restricting tools used to observe it. */
function classifyTaskPolicy(prompt: string, observeOnly = false) {
  const text = requestText(prompt);
  const change = requestedChange(coordinatedProhibitions(text).text);
  const negativeCases =
    /\bnegative(?:[ -]input)?\s+(?:tests?|cases?)\b/.test(text) ||
    /\b(?:intentional|deliberate|expected)\s+(?:negative\s+(?:test|case)|test\s+(?:failure|error))\b/.test(text) ||
    /\b(?:test|failure|error)\s+(?:(?:is|are|was|will be)\s+)?(?:expected|intentional|deliberate)\b/.test(text) ||
    /\btest\b[^.;\n]{0,60}\bexpected to fail\b/.test(text) ||
    /\b(?:intentionally|deliberately)\s+(?:failing\s+test|fails?|errors?)\b/.test(text) ||
    /\bexpected[- ]failure\s+(?:test|case|fixture)\b/.test(text) ||
    /\bnegativtest\w*\b/.test(text) ||
    /\b(?:absichtlich|beabsichtigt|erwartet)\w*\s+(?:negativ\w*\s+(?:test|fall)\w*|fehl(?:schlag|geschlag)\w*(?:\s+test\w*)?|(?:test\w*\s+)?fehler\w*)\b/.test(text) ||
    /\b(?:fehler|fehlschlag|test)\w*\s+(?:ist|sind|wird)\s+(?:absichtlich|beabsichtigt|erwartet)\b/.test(text);
  const negativeTest = negativeCases && (!change || negativeFixtureIsPrimary(text));
  // A mixed implementation request can protect test expectations without
  // banning repairs to the implementation. Only explicitly scoped objects are
  // masked here; blanket "do not change files" remains authoritative.
  const permissionText = negativeCases && !negativeTest ? text
    .replace(/\b(?:do not|don't|dont|never)\s+(?:change|modify|alter|rewrite|repair|fix|correct)\s+(?:(?:the|these|any|existing)\s+){0,3}(?:(?:expected|intentional|deliberate)\s+(?:test\s+)?(?:results?|outcomes?|failures?|errors?)|negative\s+(?:test\s+)?(?:cases?|fixtures?|assertions?)|test\s+expectations)\b[^.!?;\n]*/g, " ") : text;
  const prohibitions = coordinatedProhibitions(permissionText);
  const restrictions = changeRestrictions(permissionText, change);
  const exports = exportIntent(restrictions);
  const noChanges = prohibitions.changes || !change && exports.includes("forbidden") ||
    /\bwithout\s+(?:(?:any|code|file|source)\s+){0,2}changes\b/.test(restrictions) ||
    /\b(?:stop|cease|without)\s+(?:(?:all|further)\s+)?(?:changing|modifying|editing|rewriting|writing|saving|deleting|removing)\b/.test(restrictions) ||
    /\bno\s+(?:more|further)\s+(?:changes|modifications|edits|writes)\b/.test(restrictions) ||
    /\b(?:leg(?:e|en)?|fueg(?:e|en)?|pass(?:e|en)?)\s+(?:nichts|kein(?:e|en)?\s+(?:dateien?|code|inhalte?))\b[^.!?;\n]{0,120}\b(?:an|hinzu)\b/.test(restrictions) ||
    /\b(?:do not|don't|dont|never|must not|should not|without)\s+(?:[a-z]+\s+){0,2}(?:change|modify|edit|rewrite|write|append|save|store|persist|record|delete|remove|rename|move|reformat|implement|add|create|build|generate|design|model|assemble|draw|make|construct|compose)\b/.test(restrictions) ||
    /\b(?:do not|don't|dont|never|must not|should not)\s+make\s+(?:(?:any|code|file|source)\s+){0,2}changes\b/.test(restrictions) ||
    /\b(?:leave|keep)\s+[^.;\n]{0,60}\b(?:unchanged|unmodified)\b/.test(restrictions) ||
    /\b(?:(?:keine?|ohne)\s+(?:(?:weitere\w*|zusaetzliche\w*)\s+)?(?:datei)?aenderungen|nichts\s+(?:aendern|veraendern|bearbeiten|schreiben|speichern|notieren|protokollieren|loeschen)|(?:aender\w*|veraender\w*|bearbeit\w*|schreib\w*|speicher\w*|notier\w*|protokollier\w*|loesch\w*)\s+nichts)\b/.test(restrictions) ||
    /\bkein(?:e|en)?\s+(?:(?:code|dateien?|quellcode|inhalt\w*)\s+)(?:aendern|veraendern|bearbeiten|schreiben|loeschen)\b/.test(restrictions) ||
    /\b(?:nicht(?:\s+mehr)?|ohne)\s+(?:zu\s+)?(?:aendern|veraendern|bearbeiten|schreiben|speichern|notieren|protokollieren|loeschen|umbenennen|verschieben|formatieren)\b/.test(restrictions);
  const noRepair = noChanges || prohibitions.repair ||
    /\b(?:do not|don't|dont|never|must not|should not|without)\s+(?:[a-z]+\s+){0,2}(?:repair|fix|correct)\b/.test(permissionText) ||
    /\b(?:nicht|nichts|ohne)\s+(?:zu\s+)?(?:reparieren|beheben|korrigieren)\b/.test(permissionText) ||
    /\b(?:reparier\w*|beheb\w*|korrigier\w*)\s+nichts\b/.test(permissionText) ||
    /\b(?:repair|fix|correct)\s+nothing\b/.test(permissionText) ||
    /\bkeine?\s+(?:automatisch\w*\s+)?(?:reparatur\w*|fehlerbehebung\w*)\b/.test(permissionText);
  const repairsExcluded = noRepair || /\b(?:no\s+(?:automatic\s+)?(?:repairs?|fixes|corrections)|no need to\s+(?:repair|fix|correct))\b/.test(permissionText);
  const observationText = text.replace(/\bkein(?:e|en)?\s+(?:run|test(?:lauf)?|ausfuehrung)\s+(?:noetig|erforderlich|notwendig)\b|\bno\s+(?:run|test)\s+(?:needed|required|necessary)\b/g, " ");
  const observation = exports.includes("reference") || LOOK_AT.test(observationText) || /\b(?:run|execute|test|inspect|review|read|analyse|analyze|diagnose|explain|describe|report|check|recheck|verify|observe|show|tell|summarize|answer|respond|(?:be)?antwort(?:e|en)?|lies|lese|lesen|beschreib(?:e|en)?|pruef(?:e|en)?|test(?:e|en)?|analysier(?:e|en)?|diagnostizier(?:e|en)?|erklaer(?:e|en)?|bericht(?:e|en)?|beobacht(?:e|en)?|ausfuehren|fuehr(?:e|en)?\b[^.;\n]{0,160}\baus|anschauen|finde heraus|schau(?:e)? nach)\b/.test(observationText);
  const correction=taskCorrectionBody(prompt);
  const unboundCorrection=correction!==undefined&&(!change||correctionStatesExpectation(correction));
  const allowChanges = !observeOnly && !noChanges && !unboundCorrection && (change || (!observation && !negativeTest && !repairsExcluded));
  const allowRepair = allowChanges && !repairsExcluded && !negativeTest;
  const reason = observeOnly
    ? "Dieser Auftrag läuft im Beobachtungsmodus. Nur prüfen und berichten; nichts ändern oder reparieren."
    : noChanges
      ? "Der aktuelle Auftrag untersagt Änderungen. Ausführen, prüfen und das tatsächliche Ergebnis berichten; nichts reparieren."
      : negativeTest
        ? "Der Fehler gehört zum beauftragten Negativtest. Tatsächliches Ergebnis berichten; den absichtlichen Fehler nicht automatisch reparieren."
        : !allowChanges
          ? "Der aktuelle Auftrag verlangt eine Prüfung oder Diagnose. Beobachten, ausführen und berichten; keine unbeauftragte Reparatur."
          : repairsExcluded
            ? "Beauftragte Änderungen sind erlaubt. Bestehende Fehler nur berichten; ihre Reparatur ist ausdrücklich ausgeschlossen."
            : "Beauftragte Änderungen und dafür nötige Reparaturen sind erlaubt.";
  return {policy:{ allowChanges, allowRepair, negativeTest, ...(negativeCases ? { preserveNegativeTests: true } : {}), reason: negativeCases && !negativeTest ? `${reason} ${PRESERVE_NEGATIVE_TESTS}` : reason },change,repairsExcluded,observation};
}

export function agentTaskPolicy(prompt: string, observeOnly = false): AgentTaskPolicy {
  return classifyTaskPolicy(prompt,observeOnly).policy;
}

/** A short clarification does not silently revoke an earlier preservation request. */
export function steeredTaskPolicy(previous:AgentTaskPolicy,prompt:string,observeOnly=false):AgentTaskPolicy{
  const body=taskCorrectionBody(prompt),classified=classifyTaskPolicy(body??prompt,observeOnly);
  const next=classified.policy,text=requestText(body??prompt);
  // Additional verification is part of the current assignment. Only retain
  // existing permissions when the review neither restricts nor replaces it.
  const additionalCheck = classified.observation && /\b(?:noch[ -]?mal(?:s)?|noch einmal|erneut|auch|zusaetzlich|ausserdem|anschliessend|danach|again|also|additionally|afterwards|recheck)\b/.test(text);
  const limitedCheck = /\b(?:nur|ausschliesslich|only|just|lesend|lesemodus|schreibgeschuetzt|read[ -]only|stattdessen|instead|nicht mehr|no longer)\b/.test(text);
  if (previous.allowChanges && !next.allowChanges && !observeOnly && additionalCheck && !limitedCheck && !classified.repairsExcluded && !next.preserveNegativeTests) {
    return { ...previous };
  }
  const observationOnly=/^(?:(?:(?:und|auch|zusaetzlich|and|also|additionally)\s+)?(?:bitte|please)\s+)?(?:nur|ausschliesslich|only|just)\b/.test(text)
    || /^(?:(?:bitte|please)\s+)?(?:pruef\w*|test\w*|check\w*|recheck|verify|inspect\w*|review\w*|beobacht\w*|observe\w*|lies|read|execute|run)\b/.test(text) || LOOK_AT.test(text);
  if(body!==undefined&&!observeOnly&&(!classified.change||correctionStatesExpectation(body))&&!classified.repairsExcluded&&!next.negativeTest&&!observationOnly&&!limitedCheck)return {...previous};
  const explicitlyChanges=classified.change;
  const explicitlyRepairs=/\b(?:now\s+(?:repair|fix|correct)|(?:repair|fix|correct)\b[^.!?\n]{0,50}\bnow|jetzt\s+(?:reparier\w*|beheb\w*|korrigier\w*)|(?:reparier\w*|beheb\w*|korrigier\w*)\b[^.!?\n]{0,50}\bjetzt)\b/.test(text);
  const negativeTest=next.negativeTest||previous.negativeTest&&!explicitlyRepairs;
  const allowChanges=next.allowChanges&&(explicitlyChanges||previous.allowChanges);
  const allowRepair=next.allowRepair&&!negativeTest&&(explicitlyChanges||previous.allowRepair);
  const preserveNegativeTests=next.preserveNegativeTests||!explicitlyRepairs&&(previous.preserveNegativeTests||previous.negativeTest);
  let reason=allowChanges===next.allowChanges&&allowRepair===next.allowRepair&&negativeTest===next.negativeTest?next.reason:`${previous.reason} The clarification does not revoke this earlier restriction. ${next.reason}`;
  if(preserveNegativeTests&&!negativeTest&&!reason.includes(PRESERVE_NEGATIVE_TESTS))reason+=` ${PRESERVE_NEGATIVE_TESTS}`;
  return {...next,allowChanges,allowRepair,negativeTest,...(preserveNegativeTests?{preserveNegativeTests:true}:{}),reason};
}

