/** Provider-independent, read-only catalog selection. Selection never grants access. */
export type Capability = { id: string; name: string; description?: string; group?: string };
const stop = new Set('the a an to of in and or for with please this that tool tools mit und oder die der das ein eine einen einem einer im in von fur bitte prufe prufen check inspect use using'.split(' '));
const groups = [
  ['cad','freecad','openscad','geometr','bohr','hole','solid','shape','sketch','skizz','step','stl','bauteil'],
  ['blender','mesh','meshes','material','sculpt','render','modellier'],
  ['git','github','repository','repositories','commit','branch','issue','pull'],
  ['engine','godot','unity','unreal','scene','szene','gdscript'],
  ['test','tests','testen','prufung','pytest','assert','unittest','funktionstest'],
  ['skill','skills','anleitung','guide','workflow'],
  ['file','files','datei','dateien','read','lesen','lies','write','schreib','edit','bearbeit'],
];
const normalize = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
/** Shared lexical families for discovery and task-skill routing; no rights are granted. */
export function capabilityTerms(query: string) {
  const words=[...new Set(normalize(query.slice(0,4000)).split(/[^\p{L}\p{N}]+/u).filter(word=>word.length>1&&!stop.has(word)))];
  const expanded=new Set(words);
  for(const group of groups)if(words.some(word=>group.some(term=>word===term||term.length>=4&&word.startsWith(term))))for(const word of group)expanded.add(word);
  return {words,expanded:[...expanded]};
}
export function capabilityHasTopic(query: string, topic: 'cad' | 'blender' | 'git' | 'engine' | 'test' | 'skill' | 'file') {
  const group=groups.find(row=>row[0]===topic);
  return Boolean(group&&capabilityTerms(query).words.some(word=>group.some(term=>word===term||term.length>=4&&word.startsWith(term))));
}
export function rankCapabilities<T>(rows: T[], query: string, describe: (row:T)=>Capability = row=>row as Capability): T[] {
  const {words,expanded}=capabilityTerms(query);
  if(!words.length)return [];
  return rows.map((row,index)=>{
    const item=describe(row),name=normalize(item.name),group=normalize(item.group||''),description=normalize(item.description||'');
    const score=expanded.reduce((sum,word)=>sum+(name.includes(word)?4:0)+(group.includes(word)?5:0)+(description.includes(word)?1:0),0)
      +words.reduce((sum,word)=>sum+(name===word?12:0)+(group===word?12:0),0);
    return {row,index,score};
  }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).map(item=>item.row);
}
function signature(text:string) {
  let a=2166136261,b=5381;
  for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}
  return `${(a>>>0).toString(36)}-${(b>>>0).toString(36)}`;
}
export function capabilityPage<T>(rows:T[],options:{query?:string;limit?:number;cursor?:string}={},describe:(row:T)=>Capability=row=>row as Capability) {
  const query=String(options.query||'').slice(0,4000),ordered=query.trim()?rankCapabilities(rows,query,describe):rows;
  const key=signature(normalize(query)+'\n'+JSON.stringify(rows)),limit=Math.min(12,Math.max(1,Math.floor(Number(options.limit)||6)));
  let offset=0;
  if(options.cursor){
    const [stamp,raw,...extra]=String(options.cursor).split(':');
    if(stamp!==key||extra.length||!/^\d+$/.test(raw||'')||!Number.isSafeInteger(Number(raw))||Number(raw)>ordered.length)throw Error('Katalog oder Suche geändert; Cursor ungültig. Ohne Cursor erneut suchen.');
    offset=Number(raw);
  }
  const items=ordered.slice(offset,offset+limit);
  return {items,total:ordered.length,nextCursor:offset+items.length<ordered.length?`${key}:${offset+items.length}`:undefined};
}
type McpCandidate={name:string;server:string;serverId?:string;description?:string;inputSchema?:unknown};
export function mcpDiscoveryPrelude<T extends McpCandidate>(tools:T[],query:string) {
  const normalized=normalize(query);
  const named=tools.some(tool=>tool.server.length>=4&&normalized.includes(normalize(tool.server)));
  if(!named&&!/\bmcp\b|freecad|openscad|blender|\bcad\b|geometr|bohr|\bsolid\b|github|notion|linear|studio/.test(normalized))return {names:[],text:''};
  const selected=rankCapabilities(tools,query,tool=>({id:`${tool.serverId||tool.server}:${tool.name}`,name:tool.name,group:tool.server,description:tool.description})).slice(0,3);
  const rows:Record<string,unknown>[]=[];
  let characters=0;
  for(const tool of selected){
    const row={server:tool.serverId||tool.server,name:tool.name,description:(tool.description||'').slice(0,200),inputSchema:tool.inputSchema};
    const size=JSON.stringify(row).length;
    if(size+characters<=4800){rows.push(row);characters+=size;}
    else rows.push({server:row.server,name:row.name,description:row.description,schemaDeferred:true});
  }
  return {names:selected.map(tool=>tool.name),text:rows.length?`Passende zwischengespeicherte MCP-Werkzeuge (Hinweise, keine zusätzlichen Rechte):\n${JSON.stringify(rows)}\nFehlende oder geänderte Schemata mit select_tools(scope="mcp", query, server) nachladen; vor einem Aufruf keine Parameter raten.`:''};
}

type CatalogMessage={role?:unknown;content?:unknown;tool_calls?:unknown;tool_call_id?:unknown};
/** Keep canonical history intact, retaining the newest complete catalog per tool. */
export function compactCatalogHistory<T extends CatalogMessage>(messages:T[]):T[] {
  const calls=new Map<string,string>(),latest=new Map<string,number>();
  const catalog=new Set(['select_tools','mcp_list','skill_list']);
  for(const [index,message]of messages.entries()){
    if(Array.isArray(message.tool_calls))for(const call of message.tool_calls)if(catalog.has(call?.function?.name))calls.set(call.id,call.function.name);
    if(message.role==='tool'&&calls.has(String(message.tool_call_id)))latest.set(calls.get(String(message.tool_call_id))!,index);
  }
  return messages.map((message,index)=>{
    const name=calls.get(String(message.tool_call_id));
    if(!name||message.role!=='tool'||latest.get(name)===index||typeof message.content!=='string'||message.content.length<800)return message;
    const start=message.content.indexOf('{');
    try{
      const value=JSON.parse(message.content.slice(start));
      if(value.error||value.ok===false||value.mcp?.error||value.skills?.error)return message;
      const entries=[value.tools,value.available,value.native?.available,value.mcp?.tools,value.skills?.items,Array.isArray(value.skills)?value.skills:undefined].flatMap(rows=>Array.isArray(rows)?rows:[]);
      const prefix=message.content.slice(0,start);
      return {...message,content:prefix+JSON.stringify({catalogSummary:true,names:entries.slice(0,12).map((item:{name?:string;id?:string})=>item.name||item.id),total:value.total,output_id:value.output_id,outputId:value.outputId,
        note:'Earlier catalog snapshot summarized. Use select_tools to search current capabilities; do not repeat an executed action to retrieve its output.'})};
    }catch{return message;}
  });
}
