/** Preview input is scoped to the browser surface, not an OS or engine input API. */
export function previewObservationRequest(text:string):boolean {
  const visual=/\b(?:layout|darstellung|ansicht|bild|aufnahme|screenshot|visual|appearance|rendering|ladefehler|konsolenfehler|loading|load errors?)\b/i.test(text);
  const behavior=/\b(?:funktion\w*|function\w*|bedien\w*|klick\w*|click\w*|tast\w*|keyboard|maus|mouse|bewe\w*|mov\w*|transport\w*|auftrag\w*|orders?|speicher\w*|persist\w*|pause|resume|einzelschritt|state|zustand\w*|änder\w*)\b/i.test(text);
  return visual&&!behavior;
}

export function previewObservationEvidence(text:string,image:boolean):boolean {
  return previewObservationRequest(text)&&(image||/\b(?:ladefehler|konsolenfehler|loading|load errors?)\b/i.test(text));
}

export function previewInteractionRequest(text: string): boolean {
  const preview = /\b(?:html|browser(?:anwendung(?:en)?|applikation(?:en)?)?|canvas|preview|web-?(?:app|anwendung|seite)(?:en|s)?|website(?:s)?)\b|vorschau/i.test(text);
  if (!preview && /\b(?:godot|unity|unreal|freecad|openscad|blender)\b/i.test(text)) return false;
  const explicit = /(?<![\w./\\-])play(?![\w/\\-]|\.[a-z0-9])/i.test(text);
  const staticOnly = /\b(?:nur|ausschließlich|only|just)\s+(?:(?:die|den|das|the)\s+)?(?:syntax|typecheck|typprüfung|lint|unit[- ]?tests?)\b/i.test(text);
  return explicit || preview && !staticOnly && /\b(?:test\w*|prüf\w*|check\w*|verif\w*|click|clicks|drag|scroll|keyboard|mouse|shortcuts?|interact\w*|klick\w*|maus|tastatur\w*|tasten\w*|bedien\w*|interaktiv\w*)\b/i.test(text);
}
