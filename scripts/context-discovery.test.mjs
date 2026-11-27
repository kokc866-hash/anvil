import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {agentLoopFixture} from '../fixtures/agent-loop-fixture.mjs';

test('real imported plugin skills stay discoverable without injecting their bodies; request contexts shrink',async t=>{
  const f=await agentLoopFixture(t),load=file=>f.server.ssrLoadModule('/src/lib/'+file+'.ts');
  const learn=await load('learn'),{ToolSession}=await load('tool-compat'),{discoverTools}=await load('tool-discovery');
  const {inspectAgentPlugin}=await load('agent-plugin-package'),registry=await load('agent-plugin-registry');
  const {surfacePrompt}=await load('surface'),{mcpCatalogText}=await load('mcp-parse'),{AGENT_TOOLS}=await load('agent-tools');
  const {estimateTokens}=await load('tokens');
  const body='PLUGIN_GUIDE_BODY_ONLY_ON_DEMAND\n'+('Inspect the artificial CAD geometry and report actual measurements.\n'.repeat(60));
  const pack=inspectAgentPlugin({'.codex-plugin/plugin.json':'{"name":"cad-context-fixture"}',
    'skills/geometry/SKILL.md':`---\nname: fixture-geometry\ndescription: FreeCAD CAD geometry validation for this artificial project.\n---\n${body}`,
    'skills/geometry/references/requested.md':'PLUGIN_REQUESTED_REFERENCE',
    'skills/geometry/references/unrequested.md':'PLUGIN_UNREQUESTED_REFERENCE',
  });
  const files=registry.agentPluginInstallFiles(pack,'artificial-fixture',{}),recordPath=registry.pluginRecord(pack.id);
  files[recordPath]=JSON.stringify({...JSON.parse(files[recordPath]),enabled:true});
  f.useIde.setState({files,workspaceMemoryId:'capability-fixture',workspaceCwd:'',mcpServers:[]});
  learn.useLearn.setState({on:false,prefs:{...learn.useLearn.getState().prefs,skills:true,skillBodies:true,skillAuto:true}});
  learn.hydrateLearnFromFiles(files,Object.keys(files));
  const skill=learn.visibleSkills().find(skill=>skill.file?.startsWith(registry.pluginRoot(pack.id)+'/'));
  assert.ok(skill,'The actual validated plugin import exposes its skill');
  const automatic=learn.learnPrompt('Use fixture-geometry to validate FreeCAD geometry.');
  assert.ok(learn.useLearn.getState().skillSelection.some(row=>row.id===skill.id));
  assert.doesNotMatch(automatic,/PLUGIN_GUIDE_BODY_ONLY_ON_DEMAND|PLUGIN_UNREQUESTED_REFERENCE/);
  assert.deepEqual(learn.useLearn.getState().activeSkills,[],'Preselection is not a claimed guide read');
  const session=new ToolSession('standard','Inspect CAD');session.tools(AGENT_TOOLS);
  const discovery=await discoverTools(session,[],{scope:'skills',query:'fixture geometry'},{skills:()=>learn.agentLearn('skills',{})});
  assert.ok(discovery.skills.items.some(row=>row.id===skill.id));
  assert.doesNotMatch(JSON.stringify(discovery),/PLUGIN_GUIDE_BODY_ONLY_ON_DEMAND|PLUGIN_UNREQUESTED_REFERENCE/);
  const guide=await learn.agentLearn('read',{name:skill.id});assert.match(guide.body,/PLUGIN_GUIDE_BODY_ONLY_ON_DEMAND/);
  assert.ok(!JSON.stringify(guide).includes('PLUGIN_UNREQUESTED_REFERENCE'));
  const requested=await learn.agentLearn('read',{name:skill.id,resource:'references/requested.md'});
  assert.equal(requested.content,'PLUGIN_REQUESTED_REFERENCE');

  const tools=Array.from({length:120},(_,i)=>({server:i<20?'FreeCAD Fixture':`Fixture service ${Math.floor(i/20)}`,serverId:'service-'+Math.floor(i/20),
    name:`fixture_${i}_geometry_reader`,description:`Read artificial CAD geometry record ${i}, return its exact dimensions and validation status.`,
    inputSchema:{type:'object',properties:{document:{type:'string'},object:{type:'string'},precision:{type:'integer',minimum:1,maximum:12}},required:['document','object'],additionalProperties:false}}));
  const snapshot={id:'anvil',mode:'bridge',label:'Anvil',ready:true,tools,resources:[],context:{},servers:Array.from({length:6},(_,i)=>({id:'service-'+i,name:i===0?'FreeCAD Fixture':`Fixture service ${i}`,ready:true}))};
  const benchmark=[];
  for(const task of ['Explain README.md.','Use fixture-geometry to inspect FreeCAD Fixture geometry.','Write and run the local JavaScript function tests.']){
    const memory=learn.learnPrompt(task),selected=learn.useLearn.getState().skillSelection;
    const oldBodies=selected.map(row=>learn.visibleSkills().find(skill=>skill.id===row.id)?.body||'').join('\n');
    const before={messages:[{role:'system',content:mcpCatalogText(tools)+'\n'+oldBodies},{role:'user',content:task}],tools:AGENT_TOOLS.filter(tool=>tool.function.name!=='select_tools')};
    const current=new ToolSession('standard',task,task.includes('fixture-geometry')?['skill_read']:[]);
    const after={messages:[{role:'system',content:surfacePrompt(snapshot,task)+'\n'+memory},{role:'user',content:task}],tools:current.tools(AGENT_TOOLS)};
    current.prepare(after);
    const oldJson=JSON.stringify(before),newJson=JSON.stringify(after),oldBytes=Buffer.byteLength(oldJson),newBytes=Buffer.byteLength(newJson);
    assert.ok(newBytes<oldBytes*0.6,'The same catalog/task must use at least 40% fewer context bytes');
    assert.ok(!newJson.includes('PLUGIN_GUIDE_BODY_ONLY_ON_DEMAND'));
    benchmark.push({task,toolsBefore:before.tools.length,toolsAfter:after.tools.length,bytesBefore:oldBytes,bytesAfter:newBytes,
      estimatedTokensBefore:estimateTokens(oldJson),estimatedTokensAfter:estimateTokens(newJson),savedPercent:Math.round((1-newBytes/oldBytes)*10000)/100,
      measurement:'Actual serialized request context bytes; token numbers use Anvil estimate (4 chars/token), not model-reported usage.'});
  }
  mkdirSync('artifacts/context-discovery-2026-10-18',{recursive:true});
  writeFileSync('artifacts/context-discovery-2026-10-18/context-benchmark.json',JSON.stringify({realModelInference:false,corpus:{mcpTools:120,services:6,pluginSkillBodyCharacters:body.length},scenarios:benchmark},null,2)+'\n');
  const disabled={...files,[recordPath]:JSON.stringify({...JSON.parse(files[recordPath]),enabled:false})};
  f.useIde.setState({files:disabled});learn.hydrateLearnFromFiles(disabled,Object.keys(disabled));
  assert.ok(!learn.visibleSkills().some(row=>row.id===skill.id),'Disabled plugin skills cannot be discovered');
  assert.ok((await learn.agentLearn('read',{name:skill.id})).error);
  const catalog=await discoverTools(session,[],{scope:'skills',query:'fixture geometry'},{skills:()=>learn.agentLearn('skills',{})});
  assert.ok(!catalog.skills.items.some(row=>row.id===skill.id));
});
