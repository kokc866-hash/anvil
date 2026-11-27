/** Local source protection, never an access grant or an automatic merge.
 * Ranges use UTF-16 offsets into the exact content, including BOM/CRLF.
 * A single bounding splice deliberately refuses broad ambiguous rewrites.
 * The caller can request smaller edits; no user change is guessed away.
 */
export const MAX_PROTECTED_CONTENT_BYTES = 2 * 1024 * 1024;
export const MAX_PROTECTED_RANGES = 256;
const opaqueContent = text => typeof text === 'string'
  && (text.includes('\0') || /^\s*data:(?:image\/|application\/octet-stream\b)/i.test(text));
const validContent = value => value === null || typeof value === 'string'
  && value.length <= MAX_PROTECTED_CONTENT_BYTES
  && Buffer.byteLength(value, 'utf8') <= MAX_PROTECTED_CONTENT_BYTES;

export function validFileProtection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).some(key => !['version','content','ranges','opaque'].includes(key))) return false;
  if (value.version !== 1 || !validContent(value.content)
    || value.opaque !== undefined && typeof value.opaque !== 'boolean'
    || !Array.isArray(value.ranges) || !value.ranges.length || value.ranges.length > MAX_PROTECTED_RANGES) return false;
  const length = value.content?.length || 0;
  let previousEnd = -1;
  for (const range of value.ranges) {
    if (!Array.isArray(range) || range.length !== 2
      || !range.every(Number.isSafeInteger) || range[0] < 0 || range[1] < range[0]
      || range[1] > length || range[0] <= previousEnd) return false;
    previousEnd = range[1];
  }
  return value.content !== null || value.ranges.length === 1
    && value.ranges[0][0] === 0 && value.ranges[0][1] === 0;
}

const copy = p => ({version:1, content:p.content, ranges:p.ranges.map(([a,b])=>[a,b]),
  ...(p.opaque !== undefined ? {opaque:p.opaque} : {})});
function assertContent(value) {
  if (!validContent(value)) throw new Error('Dateiinhalt für den Konfliktschutz ist ungültig oder größer als 2 MiB. Änderung bleibt gesperrt.');
}
function assertProtection(value) {
  if (!validFileProtection(value)) throw new Error('Gesicherter Dateikonfliktschutz ist ungültig. Änderung bleibt gesperrt.');
}

/** Linear memory/time: one conservative edit between two complete snapshots. */
function splice(before, after) {
  let start=0, suffix=0;
  const length=Math.min(before.length,after.length);
  while (start<length && before.charCodeAt(start)===after.charCodeAt(start)) start++;
  while (suffix<length-start
    && before.charCodeAt(before.length-1-suffix)===after.charCodeAt(after.length-1-suffix)) suffix++;
  const end=before.length-suffix, newEnd=after.length-suffix;
  return {start,end,newEnd,delta:newEnd-end};
}
const boundary = (text, at) => at===0 || text[at-1]==='\n';

function affectedLine(before, after, change) {
  const {start,end,newEnd}=change;
  // A removed whole line is absent. Its location remains protected, rather
  // than granting permission to silently insert that removed line again.
  if (start===newEnd && boundary(before,start)
    && (end===before.length || boundary(before,end))) return [start,start];
  const from=start===0?0:after.lastIndexOf('\n',start-1)+1;
  // A replacement ending mid-old-line can split it: include its surviving
  // suffix even when the inserted text itself happens to end with a newline.
  let to;
  if (newEnd>start && after[newEnd-1]==='\n' && boundary(before,end)) to=newEnd;
  else {
    const newline=after.indexOf('\n',newEnd);
    to=newline<0?after.length:newline+1;
  }
  return [from,to];
}

function transform([from,to], change) {
  if (to<=change.start) return [from,to];
  if (from>=change.end) return [from+change.delta,to+change.delta];
  return [from<change.start?from:change.start, to>change.end?to+change.delta:change.newEnd];
}
function canonical(ranges) {
  const result=[];
  for (const [from,to] of ranges.sort(([a,b],[c,d])=>a-c||b-d)) {
    const last=result.at(-1);
    if (last && from<=last[1]) last[1]=Math.max(last[1],to);
    else result.push([from,to]);
  }
  // Fragmentation must not discard protection or create an unbounded snapshot.
  // Collapse to a wider protected range; narrow edits outside it still work.
  return result.length>MAX_PROTECTED_RANGES?[[result[0][0],result.at(-1)[1]]]:result;
}

/** Observe an actual external snapshot. A reread retains existing restrictions. */
export function observeFileChange(previous, expected, current) {
  assertContent(expected); assertContent(current);
  if (previous !== undefined) assertProtection(previous);
  const before=previous===undefined?expected:previous.content;
  if (before===current) return previous===undefined?undefined:copy(previous);
  if (current===null) return {version:1,content:null,ranges:[[0,0]]};
  if (before===null || opaqueContent(before) || opaqueContent(current) || previous?.opaque)
    return {version:1,content:current,ranges:[[0,current.length]],
      ...(opaqueContent(before)||opaqueContent(current)||previous?.opaque?{opaque:true}:{})};
  const change=splice(before,current);
  const ranges=canonical([...(previous?.ranges||[]).map(range=>transform(range,change)),affectedLine(before,current,change)]);
  return {version:1,content:current,ranges};
}

function touches(range, change, before) {
  const [from,to]=range;
  if (from===to) return change.start<=from && change.end>=from;
  if (change.start===change.end) return change.start>=from && (change.start<to
    || change.start===to && before[to-1]!=='\n');
  return change.start<to && change.end>from;
}

/** Validate only. Never silently overwrite, partially apply or invent a merge. */
export function checkProtectedWrite(protection, before, after) {
  if (!validContent(before) || !validContent(after)) return {ok:false,error:'Dateiinhalt für den Konfliktschutz ist ungültig oder größer als 2 MiB. Änderung bleibt gesperrt.'};
  if (protection===undefined) return {ok:true};
  if (!validFileProtection(protection)) return {ok:false,error:'Gesicherter Dateikonfliktschutz ist ungültig. Änderung bleibt gesperrt.'};
  if (protection.content!==before) return {ok:false,error:'Dateistand wurde erneut geändert. Mit read_file den aktuellen Stand nachladen; Nutzeränderungen bleiben geschützt.'};
  if (before===after) return {ok:true,protection:copy(protection)};
  if (before===null || after===null || protection.opaque || opaqueContent(before) || opaqueContent(after))
    return {ok:false,error:'Eine inzwischen erstellte, gelöschte oder binäre Datei bleibt geschützt. Diese Änderung kann nicht automatisch übernommen werden.'};
  const change=splice(before,after);
  if (protection.ranges.some(range=>touches(range,change,before))) return {ok:false,
    error:'Diese Änderung würde inzwischen bearbeitete Textzeilen überschreiben. Aktuellen Stand mit read_file prüfen und nur unberührte Bereiche mit edit_file bearbeiten.'};
  return {ok:true,protection:{version:1,content:after,ranges:canonical(protection.ranges.map(range=>transform(range,change))),
    ...(protection.opaque!==undefined?{opaque:protection.opaque}:{})}};
}
