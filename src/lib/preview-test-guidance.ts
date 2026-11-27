import type {PlanStep} from '@/store/ide';
import {loopObservation} from './agent-loop-progress.ts';

/** Only native preview results can offer this capability, never an MCP payload. */
export function isNativeHtmlResult(name:string,result:Record<string,unknown>):boolean {
  if(!/^(run_file|see_run|play)$/.test(name)||result.ok!==true)return false;
  const stage=result.stage as {kind?:unknown}|undefined;
  const observed=result.observation as {elements?:unknown;viewport?:unknown}|undefined;
  return stage?.kind==='html'||Boolean(observed&&Array.isArray(observed.elements)&&observed.viewport);
}

export const isNativeHtmlObservation=(name:string,result:Record<string,unknown>)=>name!=='play'&&isNativeHtmlResult(name,result);

/** Guidance is evidence-neutral: no input, assertion, permission or completion. */
export class PreviewTestGuidance {
  private previous='';
  private unchanged=0;
  reset(){this.previous='';this.unchanged=0;}
  observe(result:Record<string,unknown>,plan:readonly PlanStep[],tools:string[]){
    // A run's empty log fields and a capture's missing log fields are not DOM changes.
    const {text,elements,observations}=loopObservation(result) as {text?:unknown;elements?:unknown;observations?:unknown};
    const key=JSON.stringify({text,elements,observations});
    this.unchanged=key===this.previous?this.unchanged+1:0;this.previous=key;
    const pending=plan.find(step=>step.kind==='check'&&step.status!=='ok');
    return {state:'observed-only',tools:[...tools],unchanged:this.unchanged,
      ...(pending?{nextCheck:pending.text.slice(0,1000)}:{}),
      guidance:tools.includes('play')
        ? `${this.unchanged?'Die gemeldeten DOM-/Statuswerte sind unverändert. Weiteres Anschauen bestätigt die Funktion nicht. ':''}Für den offenen Prüfschritt das erwartete Ergebnis vor der Eingabe festlegen. play bedient die aktuelle Vorschau; elements nennt die Bedienelemente, observations die Ergebnisanzeigen. Vergleiche den Folgezustand mit actions/type:"assert". Keine automatische Reparatur aus einer Beobachtung ableiten.`
        : 'Beobachtung bestätigt keine Funktion. Für diese Oberfläche ist kein freigegebenes play vorbereitet; nur tatsächlich verfügbare Prüfwege verwenden und fehlende Bedienprüfungen offen berichten.'};
  }
}
