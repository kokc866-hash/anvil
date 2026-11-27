import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ToolSession} from './tool-compat.ts';
import {AGENT_TOOLS} from './agent-tools.ts';
import {discoverTools} from './tool-discovery.ts';

test('standard starts small and keeps checklist, questions and discovery through later selections',()=>{
 const session=new ToolSession('standard','Explain README.md');
 const first=session.tools(AGENT_TOOLS),names=first.map(tool=>tool.function.name);
 for(const name of ['select_tools','set_plan','ask_user','read_file','edit_file'])assert.ok(names.includes(name));
 assert.ok(!names.includes('debug_start'));assert.ok(JSON.stringify(first).length<JSON.stringify(AGENT_TOOLS).length*0.6);
 session.select(['debug_start','debug_step']);session.select(['mcp_call']);
 const next=session.tools(AGENT_TOOLS).map(tool=>tool.function.name);
 for(const name of ['debug_start','debug_step','mcp_call','select_tools','set_plan','ask_user'])assert.ok(next.includes(name),name);
 const tests=new ToolSession('standard','Repariere die Addition und prüfe positive sowie negative Operanden mit den vorhandenen Funktionstests.');
 assert.ok(tests.tools(AGENT_TOOLS).some(tool=>tool.function.name==='shell'),'German function-test requests automatically include their actual test runner');
});
test('search loads a missing allowed native family without executing it',async()=>{
 const session=new ToolSession('standard','Read README.md');session.tools(AGENT_TOOLS);
 const result=await discoverTools(session,[],{query:'debug breakpoint',scope:'tools'},{});
 assert.equal(result.ok,true);assert.ok(result.native.available.some(tool=>tool.name==='debug_breakpoint'));
 assert.ok(session.tools(AGENT_TOOLS).some(tool=>tool.function.name==='debug_breakpoint'));
 const readOnly=AGENT_TOOLS.filter(tool=>['read_file','select_tools','set_plan','ask_user'].includes(tool.function.name));
 session.tools(readOnly);
 const denied=await discoverTools(session,['write_file'],{},{});assert.ok(denied.error);
 assert.ok(!session.tools(readOnly).some(tool=>tool.function.name==='write_file'));
});
test('one discovery entry returns MCP schemas and metadata for imported plugin skills only on demand',async()=>{
 const session=new ToolSession('standard','FreeCAD');session.tools(AGENT_TOOLS);
 let calls=0;
 const result=await discoverTools(session,[],{query:'FreeCAD Geometrie',scope:'all'},{
  services:[{id:'cad',name:'FreeCAD Fixture'},{id:'unrelated',name:'Other unrelated service'}],
  mcp:async args=>{calls++;assert.equal(args.query,'FreeCAD Geometrie');assert.equal(args.server,'cad','A uniquely named service narrows network discovery automatically');return {tools:[{serverId:'cad',name:'shape_check',inputSchema:{type:'object',properties:{document:{type:'string'}},required:['document']}}]};},
  skills:async()=>[{id:'package-cad/geometry',name:'FreeCAD geometry',when:'Validate CAD shapes',file:'.anvil/skills/package-cad/geometry/SKILL.md',body:'DO_NOT_INJECT_GUIDE_BODY'},...Array.from({length:40},(_,i)=>({id:String(i),name:'unrelated '+i,when:'unrelated astronomy'}))],
 });
 assert.equal(calls,1);assert.equal(result.mcp!.tools.length,1);assert.deepEqual(result.mcp!.tools[0].inputSchema?.required,['document']);
 assert.equal(result.skills!.items.length,1);assert.match(result.skills!.items[0].file!,/package-cad/);
 assert.ok(!JSON.stringify(result).includes('DO_NOT_INJECT_GUIDE_BODY'));
 const offered=session.tools(AGENT_TOOLS).map(tool=>tool.function.name);assert.ok(offered.includes('mcp_call'));assert.ok(offered.includes('skill_read'));
});
test('explicit MCP or skill search never claims unavailable connections or bypasses a denied provider',async()=>{
 const session=new ToolSession('standard','task');session.tools(AGENT_TOOLS);
 const empty=await discoverTools(session,[],{scope:'mcp',query:'CAD'},{});assert.equal(empty.ok,false);assert.match(JSON.stringify(empty),/nicht verfügbar|unavailable/);
 const denied=await discoverTools(session,[],{scope:'skills',query:'CAD'},{skills:async()=>({error:'Skills aus'})});
 assert.match(JSON.stringify(denied),/Skills aus/);
 const offline=await discoverTools(session,[],{scope:'mcp',query:'CAD',refresh:true},{mcp:async args=>{assert.equal(args.refresh,true);return {tools:[],servers:[{id:'cad',ready:false,error:'Fixture offline'}]};}});
 assert.equal(offline.ok,false);assert.equal(offline.error,'Fixture offline');
});
test('cancellation during catalog lookup cannot activate a late result',async()=>{
 const session=new ToolSession('standard','Read README');session.tools(AGENT_TOOLS);
 const controller=new AbortController();let release!:(value:unknown)=>void;
 const pending=discoverTools(session,[],{scope:'mcp',query:'CAD'},{signal:controller.signal,mcp:()=>new Promise(resolve=>{release=resolve;})});
 controller.abort(Error('Stopped lookup'));release({tools:[{name:'execute_code'}]});
 await assert.rejects(pending,/Stopped lookup/);
 assert.ok(!session.tools(AGENT_TOOLS).some(tool=>tool.function.name==='mcp_call'));
});
