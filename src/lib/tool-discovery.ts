import type {ToolSession} from './tool-compat.ts';
import {capabilityPage} from './capability-search.ts';
import type {McpTool} from './mcp-parse.ts';

type SkillHint={id:string;name:string;when:string;file?:string};
type Sources={
  mcp?:(options:Record<string,unknown>)=>Promise<unknown>;
  skills?:()=>Promise<unknown>;
  services?:{id:string;name:string}[];
  signal?:AbortSignal;
};
type Result={ok:boolean;error?:string;selected?:string[];native:ReturnType<ToolSession['search']>;
  mcp?:Record<string,unknown>&{tools:McpTool[]};skills?:{items:SkillHint[];total:number;nextCursor?:string;error?:string};hint?:string};
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};

/** A single read-only gateway. Executors keep their original authorization checks. */
export async function discoverTools(session:ToolSession,names:string[],options:Record<string,unknown>={},sources:Sources={}):Promise<Result>{
  sources.signal?.throwIfAborted();
  const selected=session.select(names);
  const empty:ReturnType<ToolSession['search']>={available:[],total:0,nextCursor:undefined};
  if(selected.error)return {ok:false,error:selected.error,native:empty};
  const scope=String(options.scope||'all'),query=String(options.query||'').slice(0,4000),server=String(options.server||'');
  if(!['all','tools','mcp','skills'].includes(scope))return {ok:false,error:'Unbekannter Suchbereich.',native:empty};
  const pageOptions={query,limit:Number(options.limit)||6,cursor:typeof options.cursor==='string'?options.cursor:undefined};
  const native=scope==='tools'||scope==='all'?session.search(pageOptions):empty;
  const result:Result={ok:true,selected:selected.selected,native};
  const services=sources.services||[];
  if(scope==='all'&&!query.trim()&&!server){
    result.hint='Search with query and scope tools, mcp or skills. Exact native names may be loaded using names:[...]. No capability was executed.';
    return result;
  }
  const lower=query.toLowerCase();
  const matches=services.filter(service=>lower.includes(service.name.toLowerCase())||lower.includes(service.id.toLowerCase())||service.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).some(word=>word.length>=4&&lower.includes(word)));
  const target=server||(matches.length===1?matches[0].id:undefined);
  const namedService=server||matches.length>0;
  const wantsMcp=scope==='mcp'||scope==='all'&&(namedService||native.total===0||/mcp|freecad|openscad|blender|\bcad\b|github|notion|linear|studio/i.test(query));
  if(wantsMcp){
    if(!sources.mcp)result.mcp={tools:[],error:'MCP im aktuellen Auftrag nicht verfügbar.'};
    else try{
      const raw=record(await sources.mcp({...pageOptions,server:target,catalogSearch:true,...(options.refresh===true?{refresh:true}:{})}));
      sources.signal?.throwIfAborted();
      result.mcp={...raw,tools:Array.isArray(raw.tools)?raw.tools as McpTool[]:[]};
      const statuses=Array.isArray(raw.servers)?raw.servers.map(record):[];
      if(statuses.length&&statuses.every(status=>status.ready===false))result.mcp.error=statuses.map(status=>String(status.error||'MCP-Katalog nicht erreichbar.')).join('; ');
      session.selectAvailable(['mcp_list','mcp_call','mcp_read_output',...(Array.isArray(raw.resources)&&raw.resources.length?['mcp_read_resource']:[])]);
    }catch(error){sources.signal?.throwIfAborted();result.mcp={tools:[],error:error instanceof Error?error.message:String(error)};}
  }
  if(scope==='skills'||scope==='all'&&query.trim()){
    if(!sources.skills){if(scope==='skills')result.skills={items:[],total:0,error:'Skills im aktuellen Auftrag nicht verfügbar.'};}
    else try{
      const raw=await sources.skills();sources.signal?.throwIfAborted();
      if(record(raw).error)result.skills={items:[],total:0,error:String(record(raw).error)};
      else{
        const rows=(Array.isArray(raw)?raw:[]).map(value=>{
          const skill=record(value);return {id:String(skill.id||skill.name||''),name:String(skill.name||''),when:String(skill.when||skill.description||'').slice(0,600),...(typeof skill.file==='string'?{file:skill.file}:{})};
        }).filter(skill=>skill.id&&skill.name);
        const page=capabilityPage(rows,pageOptions,skill=>({id:skill.id,name:skill.name,description:skill.when,group:skill.file}));
        result.skills=page;
        if(page.items.length)session.selectAvailable(['skill_read','skill_list']);
      }
    }catch(error){sources.signal?.throwIfAborted();result.skills={items:[],total:0,error:error instanceof Error?error.message:String(error)};}
  }
  result.selected=session.select([]).selected;
  const error=scope==='mcp'?result.mcp?.error:scope==='skills'?result.skills?.error:undefined;
  if(error){result.ok=false;result.error=String(error);}
  result.hint='Loaded native schemas are available on the next request. MCP: mcp_call(server=serverId, name, arguments matching inputSchema); missing schemas: search scope=mcp. Skills: skill_read(name=id) before using the guide. Pass each nextCursor back with the same query and its specific scope. Discovery never executes actions.';
  return result;
}
