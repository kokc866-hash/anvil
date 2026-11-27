import assert from 'node:assert/strict';
import {test} from 'node:test';
import {capabilityPage,rankCapabilities,mcpDiscoveryPrelude,compactCatalogHistory} from './capability-search.ts';

const rows=[
 {id:'cad',name:'execute_code',description:'Run Python code',group:'FreeCAD'},
 {id:'git',name:'list_issues',description:'Search repository issues',group:'GitHub'},
 {id:'scene',name:'scene_objects',description:'Inspect objects and meshes',group:'Blender'},
];
test('task search finds multilingual capabilities without a complete phrase match',()=>{
 assert.equal(rankCapabilities(rows,'Prüfe die Geometrie und Bohrungen')[0]?.id,'cad');
 assert.equal(rankCapabilities(rows,'inspect a CAD solid')[0]?.id,'cad');
 assert.equal(rankCapabilities(rows,'Suche GitHub issues')[0]?.id,'git');
 assert.equal(rankCapabilities(rows,'Blender mesh objects')[0]?.id,'scene');
 assert.deepEqual(rankCapabilities(rows,'unrelated astronomy'),[]);
});
test('bounded catalog pages bind cursors to the current catalog and query',()=>{
 const all=Array.from({length:21},(_,i)=>({id:String(i),name:`CAD tool ${i}`,group:'FreeCAD'}));
 const first=capabilityPage(all,{query:'CAD',limit:4});
 assert.equal(first.items.length,4);assert.equal(first.total,21);assert.ok(first.nextCursor);
 const second=capabilityPage(all,{query:'CAD',limit:4,cursor:first.nextCursor});
 assert.ok(second.items.every(row=>!first.items.includes(row)));
 assert.throws(()=>capabilityPage(all,{query:'Blender',cursor:first.nextCursor}),/Cursor/);
 assert.throws(()=>capabilityPage([...all,{id:'new',name:'CAD tool new'}],{query:'CAD',cursor:first.nextCursor}),/Cursor/);
 assert.throws(()=>capabilityPage(all,{query:'CAD',cursor:'garbage'}),/Cursor/);
});
test('automatic MCP preselection is relevant, bounded and never slices a schema',()=>{
 const tools=rows.map(row=>({name:row.name,description:row.description,server:row.group,serverId:row.id,inputSchema:{type:'object',properties:{code:{type:'string'}},required:['code']}}));
 const selected=mcpDiscoveryPrelude(tools,'Prüfe FreeCAD Geometrie');
 assert.ok(selected.text.includes('execute_code'));assert.ok(selected.text.includes('inputSchema'));assert.ok(!selected.text.includes('list_issues'));
 assert.deepEqual(mcpDiscoveryPrelude(tools,'Schreibe README.md').names,[]);
 const huge=mcpDiscoveryPrelude([{...tools[0],inputSchema:{...tools[0].inputSchema,description:'private schema '.repeat(10000)}}],'FreeCAD');
 assert.ok(huge.text.length<6000);assert.match(huge.text,/Schema.*nachladen|schemaDeferred/);assert.ok(!huge.text.includes('private schema'));
});
test('old catalog messages compact without mutating history or dropping calls, actions or skill instructions',()=>{
 const history=Array.from({length:4},(_,i)=>[
  {role:'assistant',tool_calls:[{id:`c${i}`,function:{name:'mcp_list',arguments:'{}'}}]},
  {role:'tool',tool_call_id:`c${i}`,content:JSON.stringify({tools:[{name:'tool'+i,inputSchema:{description:'large '.repeat(3000)}}],output_id:'stored-'+i})},
 ]).flat();
 history.push({role:'assistant',tool_calls:[{id:'action',function:{name:'mcp_call',arguments:'{}'}}]},
 {role:'tool',tool_call_id:'action',content:'DO_NOT_REPEAT_ACTUAL_RESULT'},
 {role:'assistant',tool_calls:[{id:'guide',function:{name:'skill_read',arguments:'{}'}}]},
 {role:'tool',tool_call_id:'guide',content:'KEEP_CURRENT_SKILL_INSTRUCTIONS'});
 const before=JSON.stringify(history),out=compactCatalogHistory(history);
 assert.equal(JSON.stringify(history),before);assert.equal(out.length,history.length);
 assert.ok(JSON.stringify(out).length<before.length*0.65);assert.match(JSON.stringify(out),/stored-0/);
 assert.match(JSON.stringify(out),/DO_NOT_REPEAT_ACTUAL_RESULT/);assert.match(JSON.stringify(out),/KEEP_CURRENT_SKILL_INSTRUCTIONS/);
 assert.match(out[7].content!,/large large/);
 const discovery=[{role:'assistant',tool_calls:[{id:'d1',function:{name:'select_tools'}}]},
  {role:'tool',tool_call_id:'d1',content:JSON.stringify({ok:true,native:{available:[{name:'debug_step'}]},mcp:{tools:[{name:'check_geometry',inputSchema:{description:'x'.repeat(1000)}}]},skills:{items:[{id:'guide',name:'cad-guide'}]}})},
  {role:'assistant',tool_calls:[{id:'d2',function:{name:'select_tools'}}]},
  {role:'tool',tool_call_id:'d2',content:'{"ok":true}'}];
 const shortened=compactCatalogHistory(discovery);assert.match(shortened[1].content!,/debug_step/);assert.match(shortened[1].content!,/check_geometry/);assert.match(shortened[1].content!,/cad-guide/);
 discovery[1].content=JSON.stringify({ok:true,mcp:{error:'Fixture offline',detail:'x'.repeat(1000)}});
 assert.equal(compactCatalogHistory(discovery)[1].content,discovery[1].content,'Partial discovery failures stay visible');
});
