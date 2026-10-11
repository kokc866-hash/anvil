const statuses = new Set(['ready','running','passed','failed','waiting','disabled','stale']);
const operationStatuses = new Set(['started','confirmed','failed','unclear']);
const phases = new Set(['plan','act','observe','patch','see','engine','done','abort']);
/** @param {unknown} value @param {number} limit */
const text = (value, limit) => typeof value === 'string' && value.length <= limit;
/** @param {unknown} value */
const stamp = value => typeof value === 'string' && /^(?:[a-f0-9]{64})?$/.test(value);
/** @param {unknown} value */
const count = value => Number.isSafeInteger(value) && Number(value) >= 0;
/** @param {any} value @param {string[]} keys */
const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
/** @param {any} op */
const validResolution=op=>op.resolution===undefined||fields(op.resolution,['outcome','note','at'])&&['confirmed','not-executed'].includes(op.resolution.outcome)&&text(op.resolution.note,1000)&&op.resolution.note.trim().length>=12&&count(op.resolution.at)&&op.resolution.at>=op.at&&op.status===(op.resolution.outcome==='confirmed'?'confirmed':'failed');
/** @param {any} op */
const validRecovery=op=>op.recovery===undefined||fields(op.recovery,['mode','at'])&&op.recovery.mode==='skip'&&count(op.recovery.at)&&op.recovery.at>=op.at&&op.external===true&&op.status==='unclear'&&op.resolution===undefined;
/** @param {any} value */
export function validWorkflowHarness(value) {
  const budget = /** @param {any} b */ b => fields(b, ['rounds','tools','runs','sees','patches']) && ['rounds','tools','runs','sees','patches'].every(key => count(b[key]));
  const observation = /** @param {any} o */ o => fields(o,['kind','name','ok','path','image','graphical']) && ['write','edit','run','engine','see','play','test','read','mcp','other'].includes(o.kind) && text(o.name,100) && typeof o.ok==='boolean' && (o.path===undefined||text(o.path,512)) && ['image','graphical'].every(key=>o[key]===undefined||typeof o[key]==='boolean');
  return fields(value,['phase','budget','used','reason','history','last','autoContinueRounds','repairPending','repairBatchOpen']) && phases.has(value.phase) && budget(value.budget) && budget(value.used) && text(value.reason,500) && Array.isArray(value.history) && value.history.length<=20 && value.history.every(observation) && (value.last===undefined||observation(value.last)) && ['autoContinueRounds','repairPending','repairBatchOpen'].every(key=>value[key]===undefined||typeof value[key]==='boolean');
}
/** @param {any} value */
export function validWorkflowSnapshot(value) {
  if (!fields(value,['schema','id','inputStamp','definitionStamp','phase','nodes','operations','changed','planProgress','verificationEvidence','harness']) || value.schema !== 1 || !text(value.id,100) || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) || !phases.has(value.phase)
      || !stamp(value.inputStamp) || !stamp(value.definitionStamp) || !Array.isArray(value.nodes) || value.nodes.length>256
      || !Array.isArray(value.operations) || value.operations.length>2048 || !Array.isArray(value.changed) || value.changed.length>256) return false;
  if (value.planProgress!==undefined&&!text(value.planProgress,1024*1024) || value.verificationEvidence!==undefined&&!text(value.verificationEvidence,1024*1024)) return false;
  if (value.harness!==undefined&&!validWorkflowHarness(value.harness)) return false;
  if (!value.changed.every(/** @param {unknown} path */ path=>text(path,512)) || !value.nodes.every(/** @param {any} node */ node=>fields(node,['id','name','label','status','reason','automatic','path','action','inputStamp','fingerprint'])&&text(node.id,256)&&text(node.name,100)&&text(node.label,160)&&statuses.has(node.status)&&text(node.reason,500)&&typeof node.automatic==='boolean'&&(node.path===undefined||text(node.path,512))&&(node.action===undefined||text(node.action,100))&&(node.inputStamp===undefined||stamp(node.inputStamp))&&(node.fingerprint===undefined||stamp(node.fingerprint)))) return false;
  if (!value.operations.every(/** @param {any} op */ op=>fields(op,['id','name','fingerprint','effectFingerprint','inputStamp','status','target','external','nodeId','at','resolution','recovery'])&&text(op.id,160)&&text(op.name,100)&&stamp(op.fingerprint)&&op.fingerprint.length===64&&(op.effectFingerprint===undefined||stamp(op.effectFingerprint)&&op.effectFingerprint.length===64)&&stamp(op.inputStamp)&&operationStatuses.has(op.status)&&text(op.target,256)&&typeof op.external==='boolean'&&(op.nodeId===undefined||text(op.nodeId,256))&&count(op.at)&&validResolution(op)&&validRecovery(op))) return false;
  if (new Set(value.nodes.map(/** @param {any} node */node=>node.id)).size!==value.nodes.length || new Set(value.operations.map(/** @param {any} op */op=>op.id)).size!==value.operations.length) return false;
  try { return JSON.stringify(value).length<=2*1024*1024; } catch { return false; }
}

/** Preserve ambiguous effects after the worker or app has stopped. @param {any} value */
export function interruptWorkflow(value) {
  if (!validWorkflowSnapshot(value)) return undefined;
  const saved = structuredClone(value);
  for (const op of saved.operations) if (op.status==='started') op.status='unclear';
  for (const node of saved.nodes) if (node.status==='running') { node.status='waiting';node.reason='Abschluss nach Unterbrechung noch unbestätigt.'; }
  saved.phase='abort';
  return saved;
}
