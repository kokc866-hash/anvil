/**
 * Machine evaluation of reported measurements, separate from tool/lifecycle success.
 * A measurement is evidence of what its checker reported, not proof that the checker
 * or the model is independent. Keep the producing call and artifact hash reviewable.
 * @typedef {{id:string,label:string,required:boolean,operator:'eq'|'lte'|'gte',expected:number|boolean|string,tolerance?:number,unit?:string}} AcceptanceCriterion
 * @typedef {{criterion:string,actual:number|boolean|string,artifact:string,sha256:string,evidence:string,tool:string,stamp:string,revision:number,executionOk:boolean}} AcceptanceObservation
 * @typedef {{reason:string,criteria:AcceptanceCriterion[],applied:false}} AcceptanceChange
 * @typedef {{criterion:string,reason:string,reasonEn:string,evidence:string,stamp:string,revision:number}} AcceptanceIssue
 * @typedef {{version:1,locked:boolean,revision:number,inputStamp:string,criteria:AcceptanceCriterion[],observations:AcceptanceObservation[],changes:AcceptanceChange[],incompleteHistory:boolean,issues?:AcceptanceIssue[]}} AcceptanceSnapshot
 * @typedef {'unverified'|'partial'|'passed'|'failed'|'stale'} AcceptanceState
 * @typedef {{criterion:AcceptanceCriterion,state:AcceptanceState,observation?:AcceptanceObservation,reason?:string,reasonEn?:string}} AcceptanceCheck
 * @typedef {AcceptanceSnapshot & {state:AcceptanceState,detail:string,checks:AcceptanceCheck[]}} AcceptanceResult
 */

/** @param {unknown} value @param {number} limit */
const text = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
/** @param {unknown} value */
const scalar = value => typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || text(value, 500);
/** @param {any} value */
const validCriterion = value => value && text(value.id, 80) && /^[\w.-]+$/.test(value.id) && text(value.label, 500)
  && typeof value.required === 'boolean' && ['eq','lte','gte'].includes(value.operator) && scalar(value.expected)
  && (value.operator === 'eq' || typeof value.expected === 'number')
  && (value.tolerance === undefined || typeof value.expected === 'number' && value.operator === 'eq' && Number.isFinite(value.tolerance) && value.tolerance >= 0)
  && (value.unit === undefined || text(value.unit, 40));
/** @param {unknown} value @returns {AcceptanceCriterion[] | undefined} */
function criteriaOf(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) return;
  const rows = value.map(row => row && typeof row === 'object' ? {...row, required:row.required ?? true} : row);
  if (!rows.every(validCriterion) || new Set(rows.map(row => row.id)).size !== rows.length || !rows.some(row=>row.required)) return;
  return rows.map(({id,label,required,operator,expected,tolerance,unit})=>({id,label,required,operator,expected,...(tolerance===undefined?{}:{tolerance}),...(unit===undefined?{}:{unit})}));
}

/** Validate before replacing any durable state. Derived verdict fields are ignored. @param {unknown} value @returns {value is AcceptanceSnapshot} */
export function validAcceptanceSnapshot(value) {
  const v = /** @type {any} */ (value);
  if (!v || v.version !== 1 || typeof v.locked !== 'boolean' || !Number.isSafeInteger(v.revision) || v.revision < 0
    || typeof v.inputStamp !== 'string' || v.inputStamp.length > 256 || typeof v.incompleteHistory !== 'boolean'
    || !Array.isArray(v.criteria) || v.criteria.length > 64 || v.criteria.length && !criteriaOf(v.criteria)
    || !Array.isArray(v.observations) || v.observations.length > 1024 || !Array.isArray(v.changes) || v.changes.length > 32) return false;
  if (!v.changes.every(/** @param {any} c */ c=>c?.applied===false && text(c.reason,1000) && criteriaOf(c.criteria))) return false;
  if(v.issues!==undefined&&(!Array.isArray(v.issues)||v.issues.length>64||!v.issues.every(/** @param {any} issue */ issue=>issue&&v.criteria.some(/** @param {AcceptanceCriterion} c */ c=>c.id===issue.criterion)&&text(issue.reason,1000)&&text(issue.reasonEn,1000)&&/^e\d+$/.test(issue.evidence)&&typeof issue.stamp==='string'&&issue.stamp.length<=256&&Number.isSafeInteger(issue.revision)&&issue.revision>=0&&issue.revision<=v.revision)))return false;
  try{if(JSON.stringify({version:v.version,locked:v.locked,revision:v.revision,inputStamp:v.inputStamp,criteria:v.criteria,observations:v.observations,changes:v.changes,incompleteHistory:v.incompleteHistory,issues:v.issues}).length>512*1024)return false;}catch{return false;}
  return v.observations.every(/** @param {any} o */ o=>o && v.criteria.some(/** @param {AcceptanceCriterion} c */ c=>c.id===o.criterion)
    && scalar(o.actual) && text(o.artifact,512) && /^[a-f0-9]{64}$/.test(o.sha256) && /^e\d+$/.test(o.evidence)
    && text(o.tool,100) && typeof o.stamp==='string' && o.stamp.length<=256 && Number.isSafeInteger(o.revision) && o.revision>=0 && o.revision<=v.revision && typeof o.executionOk==='boolean');
}

/** Parse complete JSON blocks beginning on a log line; never salvage nested JSON from a broken outer block. @param {string} value */
function logJson(value) {
  const values=[];let incomplete=false,offset=0,attempts=0;
  while(offset<value.length&&attempts<64){
    const lineEnd=value.indexOf('\n',offset),end=lineEnd<0?value.length:lineEnd;
    let start=offset;while(start<end&&/[\t \r]/.test(value[start]))start++;
    if(value[start]!=='{'&&value[start]!=='['){offset=end+1;continue;}
    attempts++;let depth=0,quoted=false,escaped=false,stop=start;
    for(;stop<value.length;stop++){
      const ch=value[stop];
      if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
      if(ch==='"')quoted=true;
      else if(ch==='{'||ch==='[')depth++;
      else if(ch==='}'||ch===']'){if(--depth===0){stop++;break;}}
    }
    const candidate=value.slice(start,stop);
    try{values.push(JSON.parse(candidate));}catch{if(candidate.includes('"anvil_acceptance"'))incomplete=true;}
    const next=value.indexOf('\n',stop);offset=next<0?value.length:next+1;
  }
  if(attempts>=64&&value.slice(offset).includes('"anvil_acceptance"'))incomplete=true;
  return {values,incomplete};
}

/** Only explicit complete measurement envelopes are interpreted. No pass/fail prose certifies work. @param {unknown} result @returns {{rows:unknown[],incomplete:boolean}} */
export function acceptanceMeasurements(result) {
  /** @type {{value:any,depth:number}[]} */ const queue=[{value:result,depth:0}];
  /** @type {unknown[]} */ const found=[];let incomplete=false;
  for(let i=0;i<queue.length&&i<256;i++){
    const {value,depth}=queue[i];
    if(!value||depth>4)continue;
    if(typeof value==='string'){
      if(value.length>1024*1024)continue;
      try{queue.push({value:JSON.parse(value),depth:depth+1});}catch{
        const parsed=logJson(value);incomplete ||= parsed.incomplete;
        for(const block of parsed.values)queue.push({value:block,depth:depth+1});
      }
    }else if(typeof value==='object'){
      if(Array.isArray(value.anvil_acceptance?.observations))found.push(...value.anvil_acceptance.observations);
      for(const key of ['structuredContent','stdout','text','output','result','data'])if(value[key]!==undefined)queue.push({value:value[key],depth:depth+1});
      if(Array.isArray(value.content))for(const block of value.content.slice(0,64))if(block?.type==='text')queue.push({value:block.text,depth:depth+1});
    }
  }
  return {rows:found.slice(0,128),incomplete:incomplete||found.length>128};
}

/** @param {string} name */
export const acceptanceLocksTool=name=>/^(run_file|shell|engine_run|mcp_call|write_file|edit_file|append_file|delete_file|rename|mkdir|format_file|git_clone)$/.test(name);

export class TaskAcceptance {
  /** @type {AcceptanceSnapshot} */
  state = {version:1,locked:false,revision:0,inputStamp:'',criteria:[],observations:[],changes:[],incompleteHistory:false};
  /** @param {unknown} value */
  restore(value) {
    if (!validAcceptanceSnapshot(value)) return false;
    const {version,locked,revision,inputStamp,criteria,observations,changes,incompleteHistory,issues} = value;
    this.state = structuredClone({version,locked,revision,inputStamp,criteria,observations,changes,incompleteHistory,...(issues?{issues}:{})});
    return true;
  }
  snapshot() { return structuredClone(this.state); }
  /** @param {string} stamp */
  setInputStamp(stamp) { this.state.inputStamp=stamp; }
  lock() { this.state.locked=true; }
  uncertain() { this.lock();this.state.incompleteHistory=true; }
  invalidate() { this.state.revision++; }
  bound() {
    while(JSON.stringify(this.state).length>512*1024){
      this.state.incompleteHistory=true;
      if(this.state.issues?.length)this.state.issues.shift();
      else if(this.state.observations.length)this.state.observations=this.state.observations.slice(Math.ceil(this.state.observations.length/2));
      else if(this.state.changes.length)this.state.changes.shift();
      else break;
    }
  }
  /** @param {unknown} value @param {unknown} reason @returns {{ok?:boolean,error?:string}} */
  define(value, reason) {
    const criteria=criteriaOf(value);
    if (!criteria) return {error:'Abnahmekriterien benötigen eindeutige IDs, Sollwerte, Operatoren und mindestens eine Pflichtprüfung (maximal 64).'};
    if (JSON.stringify(criteria)===JSON.stringify(this.state.criteria)) return {ok:true};
    if (this.state.criteria.length) {
      if (!text(reason,1000)) return {error:'Abnahmekriterien bleiben fest. Änderungsvorschläge benötigen criteria_change_reason; Grenzwerte werden nicht nachträglich gelockert.'};
      this.state.changes.push({reason:String(reason),criteria,applied:false});
      if(this.state.changes.length>32){this.state.changes.shift();this.state.incompleteHistory=true;}
      this.bound();
      return {error:'Änderungsvorschlag protokolliert, aber nicht angewendet. Die ursprünglichen Pflichtprüfungen und Grenzwerte bleiben für diesen Auftrag verbindlich.'};
    }
    if (this.state.locked) return {error:'Abnahmekriterien müssen vor der ersten Änderung oder Ausführung feststehen. Nachträglich definierte Kriterien können diesen Auftrag nicht bestehen lassen.'};
    this.state.criteria=criteria;
    return {ok:true};
  }
  /** @param {string} name @param {unknown} raw @param {string} evidence @param {{failed:boolean,pending:boolean,changed:boolean}} status */
  record(name,raw,evidence,status) {
    const executes=/^(run_file|shell|engine_run|mcp_call)$/.test(name);
    if (acceptanceLocksTool(name)) this.lock();
    const parsed=executes&&!status.pending?acceptanceMeasurements(raw):{rows:[],incomplete:false};
    const rawRecord=/** @type {any} */(raw);
    const artifactChecks=rawRecord&&typeof rawRecord==='object'&&Array.isArray(rawRecord.anvilArtifactChecks)?rawRecord.anvilArtifactChecks:undefined;
    if(parsed.incomplete){this.uncertain();return;}
    const rows=parsed.rows;
    /** @type {AcceptanceObservation[]} */ const accepted=[];
    /** @type {AcceptanceIssue[]} */ const issues=[];
    for (const value of rows) {
      const row=/** @type {any} */(value);
      if (!row || !this.state.criteria.some(c=>c.id===row.criterion)) continue;
      const placeholder=typeof row.sha256==='string'&&/^([a-f0-9])\1{63}$/.test(row.sha256);
      if(!scalar(row.actual)||!text(row.artifact,512)||!/^[a-f0-9]{64}$/.test(row.sha256)||placeholder){
        issues.push({criterion:row.criterion,evidence,stamp:this.state.inputStamp,revision:this.state.revision,
          reason:placeholder?'Die Prüfsumme ist ein Platzhalter. Eine echte SHA-256-Prüfsumme der gespeicherten Datei ausgeben.':'Messwert, Artefakt oder SHA-256-Prüfsumme fehlt oder ist ungültig.',
          reasonEn:placeholder?'The digest is a placeholder. Emit the real SHA-256 digest of the saved file.':'The measurement, artifact or SHA-256 digest is missing or invalid.'});continue;
      }
      if(artifactChecks){
        const check=artifactChecks.find(/** @param {any} check */ check=>check.artifact===row.artifact&&check.sha256===row.sha256);
        if(check?.ok!==true){issues.push({criterion:row.criterion,evidence,stamp:this.state.inputStamp,revision:this.state.revision,
          reason:text(check?.reason,1000)?check.reason:'Datei und Prüfsumme des Messnachweises sind nicht bestätigt.',
          reasonEn:text(check?.reasonEn,1000)?check.reasonEn:'The evidence file and digest have not been verified.'});continue;}
      }
      accepted.push({criterion:row.criterion,actual:row.actual,artifact:row.artifact,sha256:row.sha256,evidence,tool:name,stamp:this.state.inputStamp,revision:this.state.revision,executionOk:!status.failed});
    }
    // MCP adapters can expose one envelope as both text and structured content.
    // Equal copies are one observation; conflicting values in one call stay unverified.
    const rejected=new Set(issues.map(issue=>issue.criterion));
    if(accepted.some(row=>rejected.has(row.criterion)))this.uncertain();
    const unique=[...new Map(accepted.filter(row=>!rejected.has(row.criterion)).map(row=>[JSON.stringify([row.criterion,row.actual,row.artifact,row.sha256]),row])).values()];
    if(new Set(unique.map(row=>row.criterion)).size!==unique.length){this.uncertain();return;}
    // Opaque external calls can mutate CAD outside the file map. Conservatively
    // invalidate previous measurements unless this is a completed checker result.
    if(status.changed || executes&&!unique.length) this.invalidate();
    for(const row of unique)row.revision=this.state.revision;
    if(this.state.issues?.length&&unique.length){const resolved=new Set(unique.map(row=>row.criterion));this.state.issues=this.state.issues.filter(issue=>!resolved.has(issue.criterion));}
    this.state.observations.push(...unique);
    if(issues.length){for(const issue of issues)issue.revision=this.state.revision;this.state.issues=[...(this.state.issues||[]),...issues].slice(-64);}
    if(this.state.observations.length>1024){this.state.observations=this.state.observations.slice(-1024);this.state.incompleteHistory=true;}
    this.bound();
  }
  /** @param {{verification?:{state:string},open?:boolean}} [context] @returns {AcceptanceResult} */
  result(context={}) {
    const saved=this.snapshot();
    /** @type {AcceptanceCheck[]} */ const checks=saved.criteria.map(criterion=>{
      const observation=[...saved.observations].reverse().find(o=>o.criterion===criterion.id);
      /** @type {AcceptanceState} */ let state='unverified';let reason,reasonEn;
      const issue=[...(this.state.issues||[])].reverse().find(issue=>issue.criterion===criterion.id&&issue.revision===saved.revision&&issue.stamp===saved.inputStamp);
      if(issue){reason=issue.reason;reasonEn=issue.reasonEn;}
      if(observation){
        const a=observation.actual,b=criterion.expected;
        const matches=typeof a===typeof b&&(typeof a==='number'&&typeof b==='number'
          ? criterion.operator==='eq'?Math.abs(a-b)<=(criterion.tolerance??0):criterion.operator==='lte'?a<=b:a>=b : a===b);
        state=observation.stamp!==saved.inputStamp||observation.revision!==saved.revision?'stale':!observation.executionOk||!matches?'failed':'passed';
        if(typeof a!==typeof b){
          const de=/** @type {Record<string,string>} */({string:'Text',number:'Zahl',boolean:'Wahrheitswert'});
          reason=`Datentyp stimmt nicht überein: Soll ist ${de[typeof b]||typeof b}, Ist ist ${de[typeof a]||typeof a}. Die verbindlichen Sollwerte bleiben unverändert.`;
          reasonEn=`Value type mismatch: expected ${typeof b}, received ${typeof a}. Binding expected values remain unchanged.`;
        }else if(state==='passed'&&!issue){reason=undefined;reasonEn=undefined;}
        if(/^([a-f0-9])\1{63}$/.test(observation.sha256)){state='unverified';reason='Die gespeicherte Prüfsumme ist ein Platzhalter. Ein neuer Messnachweis mit echter Datei-Prüfsumme ist nötig.';reasonEn='The saved digest is a placeholder. A new measurement with the real file digest is required.';}
      }
      if(issue)state='unverified';
      return {criterion,state,...(observation?{observation}:{}),...(reason?{reason,reasonEn}:{})};
    });
    const required=checks.filter(c=>c.criterion.required);
    /** @type {AcceptanceState} */ let state='unverified';
    if(required.some(c=>c.state==='failed'))state='failed';
    else if(saved.incompleteHistory||required.some(c=>c.state==='stale'))state='stale';
    else if(required.length&&required.every(c=>c.state==='passed'))state=checks.some(c=>c.state==='failed')?'partial':'passed';
    else if(checks.some(c=>c.state==='passed'))state='partial';
    if(context.verification?.state==='failed')state='failed';
    else if(state==='passed'&&(context.verification?.state==='stale'||context.open))state='partial';
    const labels={unverified:'Nicht nachgewiesen',partial:'Teilweise bestätigt',passed:'Bestanden',failed:'Nicht bestanden',stale:'Erneute Prüfung nötig'};
    const detail=required.length?`${required.filter(c=>c.state==='passed').length}/${required.length} Pflichtprüfungen für den dokumentierten Prüfstand bestanden.`:'Keine vor Arbeitsbeginn festgelegten Abnahmekriterien mit Messnachweisen.';
    return {...saved,state,detail:`${labels[state]}. ${detail}`,checks};
  }
}

/** Recompute instead of trusting a serialized state:"passed". @param {unknown} value @param {{verification?:{state:string},open?:boolean}} [context] */
export function acceptanceResult(value,context={}) {
  const acceptance=new TaskAcceptance();
  if(value!==undefined&&!acceptance.restore(value)){acceptance.state.locked=true;acceptance.state.incompleteHistory=true;}
  return acceptance.result(context);
}

/** @param {unknown} workflow @returns {unknown} */
export function workflowAcceptance(workflow) {
  const saved=/** @type {any} */(workflow);
  if(typeof saved?.planProgress!=='string')return;
  try{return JSON.parse(saved.planProgress).acceptance;}catch{return null;}
}

/** @param {string} reply @param {AcceptanceResult} result @param {string} [locale] */
export function acceptanceReply(reply,result,locale='de') {
  const labels={unverified:'Unverified',partial:'Partially confirmed',passed:'Passed',failed:'Failed',stale:'Recheck required'};
  const prefix=locale==='en'?`Task acceptance: ${labels[result.state]}.`:`Gesamtabnahme: ${result.detail}`;
  return reply.startsWith(prefix)?reply:`${prefix}\n\n${reply}`;
}
