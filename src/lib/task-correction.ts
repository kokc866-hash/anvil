/** Called only with captured human messages, never project/tool instructions. */
export function taskCorrectionBody(text: string): string | undefined {
  if(text.length>8000)return;
  const match=/^\s*(?:korrektur|ergänzung|zusatz|correction|clarification|addition):\s*(\S[\s\S]*)$/i.exec(text);
  if(!match)return;
  const body=match[1].trim();
  if(/^(?:(?:bitte|please)\s+)?(?:neue[rns]?\s+(?:aufgabe|auftrag|thema)|new\s+(?:task|topic)|anderes\s+thema|stattdessen\b|instead\b)/i.test(body))return;
  if(/^(?:(?:bitte|please)\s+)?(?:bau(?:e)?|erstell(?:e)?|build|create)\s+(?:(?:ein(?:e|en)?|an?|the)\s+)?(?:neue[rns]?|new)\s+(?:[\p{L}\p{N}]+-)?(?:projekt|anwendung|app|spiel|project|application|game|website)\b/iu.test(body))return;
  return body;
}

/** A single declarative expectation describes app behavior, not a repair directive. */
export function correctionStatesExpectation(body:string):boolean {
  return /^(?:(?:bitte|please)\s+)?(?:die|der|das|er|sie|es|the|it|they)\b[^.!?;\n]{0,160}\b(?:soll(?:te|ten|en)?|muss|müssen|should|must)\b[^.!?;\n]*[.!?]?\s*$/i.test(body);
}
