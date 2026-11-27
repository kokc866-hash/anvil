import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLoopFixture, tool } from '../fixtures/agent-loop-fixture.mjs';

const options = { context:32768, compact:'off', runLoop:false, graphLoop:false, testLoop:false, autoRunAgent:false, maxRounds:16 };

test('service-only results do not invent untested file changes; real unrun edits retain their limit',async t=>{
 const f=await agentLoopFixture(t);
 for(const editing of [false,true]){
  f.beginAgent();let rounds=0;
  const result=await f.runAgentLoop({...options,files:[{path:'main.cjs',content:'console.log(1);'}],messages:[{role:'user',content:editing?'Update main.cjs to print 2.':'Read the artificial dimensions using the CAD MCP service. No file changes.'}]},async()=>{
   if(++rounds===1)return editing?tool('edit_file',{path:'main.cjs',old_string:'(1)',new_string:'(2)'}):tool('mcp_call',{server:'fixture',name:'get_dimensions',arguments:{}});
   return {content:editing?'The requested source update is prepared.':'Artificial dimensions read. No CAD engine or project file was changed.'};
  },{mcp:async()=>({ok:true,dimensions:[20,30,40]})});
  assert.equal(result.ok,true);assert.equal(result.verification.state,'none');
  assert.deepEqual(result.tools,[editing?'edit_file':'mcp_call'],'No repeated action or fabricated execution');
  if(!editing)assert.equal(rounds,2,'A successful read-only service query needs no execution or repair loop');
  assert.equal(Boolean(result.verification.limitations?.length),editing);
  if(!editing)assert.doesNotMatch(result.reply,/gespeicherten Änderungen|Prüfumfang:/);
 }
});

test('an intentional failed program is reported without an unsolicited repair instruction or file change', async t => {
  const f = await agentLoopFixture(t); f.beginAgent();
  let models=0, executions=0, writes=0;
  const result = await f.runAgentLoop({...options, messages:[{role:'user',content:'Run negative.js once. This is an intentional negative test. Do not change or repair files. Report the actual exit code.'}],
    files:[{path:'negative.js',content:'process.exit(7);'}]}, async messages => {
    models++;
    if(models===1) return tool('run_file',{path:'negative.js'});
    assert.doesNotMatch(String(messages.at(-1).content), /Behebe die belegte Ursache|patch.*run_file|Now write_file/i);
    return {content:'The expected negative program returned exit code 7. Its source was preserved.'};
  }, {runFile:async()=>{executions++;return {ok:false,code:7,stderr:'EXPECTED_NEGATIVE_CASE'};},onWorkspace:async()=>{writes++;}});
  assert.equal(models,2,'a diagnostic result must not cause an unsolicited repair round');
  assert.equal(executions,1); assert.equal(writes,0);
  assert.equal(result.files[0].content,'process.exit(7);');
  assert.notEqual(result.verification.state,'passed','actual failed execution must stay honestly labelled');
  assert.equal(result.verification.observedFailure,true);
  assert.equal(result.ok,true,'observing the intentional failure completes the observation task');
  assert.doesNotMatch(result.reply,/Nicht abgeschlossen/);
});

test('a model cannot rewrite the intentional failure despite the explicit preservation instruction', async t => {
  const f = await agentLoopFixture(t); f.beginAgent(); let models=0,writes=0,executions=0;
  const result = await f.runAgentLoop({...options,messages:[{role:'user',content:'Prüfe negative.js als absichtlichen Fehlerfall. Nur ausführen und berichten, nichts ändern oder reparieren.'}],files:[{path:'negative.js',content:'process.exit(7);'}]},async messages=>{
    if(++models===1)return tool('edit_file',{path:'negative.js',old_string:'exit(7)',new_string:'exit(0)'});
    if(models===2){assert.match(String(messages.at(-1).content),/Auftrag|nicht.*[Ää]nder|not.*chang|preserv/i);return tool('run_file',{path:'negative.js'});}
    return {content:'Exitcode 7 beobachtet; keine Reparatur vorgenommen.'};
  },{runFile:async()=>{executions++;return {ok:false,code:7,stderr:'EXPECTED_NEGATIVE_CASE'};},onWorkspace:async()=>{writes++;}});
  assert.equal(writes,0);assert.equal(executions,1);assert.equal(result.files[0].content,'process.exit(7);');
});

test('repeating an unchanged failed preview reuses its error instead of relaunching it', async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let models=0,executions=0;
  await f.runAgentLoop({...options,messages:[{role:'user',content:'Fix the Canvas drawing callback in index.html.'}],files:[{path:'index.html',content:'<canvas></canvas><script>Anvil.run({draw(){this.missing()}})</script>'}]},async()=>{
    if(++models<=3)return tool('run_file',{path:'index.html'});
    return {content:'The unchanged preview still has the original callback error; no success is claimed.'};
  },{runFile:async()=>{executions++;return {ok:false,stage:{kind:'html'},stderr:"TypeError: this.missing is not a function"};}});
  assert.equal(executions,1,'unchanged deterministic failure must not launch three identical previews');
});

test('a repeated failure across revisions requires inspection before another blind patch',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let models=0,writes=0;
  const result=await f.runAgentLoop({...options,messages:[{role:'user',content:'Repair the Canvas callback in index.html; preserve the existing game.'}],files:[{path:'index.html',content:'<canvas></canvas><script>Anvil.run({draw(){/*a*/}})</script>'}]},async messages=>{
    switch(++models){
      case 1:case 3:return tool('run_file',{path:'index.html'});
      case 2:return tool('edit_file',{path:'index.html',old_string:'/*a*/',new_string:'/*b*/'});
      case 4:return tool('edit_file',{path:'index.html',old_string:'/*b*/',new_string:'/*c*/'});
      case 5:assert.equal(writes,1,'another blind patch was not applied');assert.match(String(messages.at(-1).content),/prüf|inspect|Schnittstelle|Fehler/i);return tool('read_file',{path:'index.html'});
      case 6:return tool('edit_file',{path:'index.html',old_string:'/*b*/',new_string:'/*fixed*/'});
      case 7:return tool('run_file',{path:'index.html'});
      default:return {content:'Callback fixed; the HTML preview rendered. Gameplay is not fully tested.'};
    }
  },{onWorkspace:async()=>{writes++;},runFile:async(_path,files)=>files['index.html'].includes('fixed')?{ok:true,stage:{kind:'html'}}:{ok:false,stage:{kind:'html'},stderr:"TypeError: Cannot read properties of undefined (reading 'ctx')"}});
  assert.equal(writes,2);assert.match(result.files[0].content,/fixed/);
});

test('changed interactive HTML receives a fitting interaction check before the final answer',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let models=0,plays=0;
  const result=await f.runAgentLoop({...options,messages:[{role:'user',content:'Implement the jump behaviour and test the Canvas game.'}],files:[{path:'index.html',content:'<canvas></canvas><script>Anvil.run({update(){/*old*/},draw(){}})</script>'}]},async messages=>{
    switch(++models){
      case 1:return tool('edit_file',{path:'index.html',old_string:'/*old*/',new_string:'/*jump*/'});
      case 2:return tool('run_file',{path:'index.html'});
      case 3:return {content:'The complete game is finished and works.'};
      case 4:assert.match(String(messages.at(-1).content),/play|Interaktion|interaction/i);return tool('play',{keys:['space'],hold:100});
      default:return {content:'The preview loaded and the jump input was sent. Full gameplay remains unverified.'};
    }
  },{runFile:async()=>({ok:true,stage:{kind:'html'},state:{canvas:{state:'running'}}}),play:async()=>{plays++;return {ok:true,state:{canvas:{state:'running'}},stdout:'Jump input delivered; new frame observed.'};}});
  assert.equal(plays,1);assert.match(result.reply,/vollständig|fully|gameplay|Interaktion/i);
});

test('a real targeted shell function test does not force an unrelated run_file round',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let models=0,tests=0;
  const result=await f.runAgentLoop({...options,messages:[{role:'user',content:'Fix the addition function and test positive and negative operands.'}],files:[{path:'adder.cjs',content:'exports.add=(a,b)=>a-b;'}]},async()=>{
    if(++models===1)return tool('edit_file',{path:'adder.cjs',old_string:'a-b',new_string:'a+b'});
    if(models===2)return tool('shell',{command:'node --test adder.test.cjs'});
    return {content:'Addition changed; the positive and negative operand tests passed.'};
  },{shell:async()=>{tests++;return {ok:true,code:0,stdout:'2 tests passed',stderr:''};}});
  assert.equal(models,3);assert.equal(tests,1);assert.equal(result.ok,true);assert.equal(result.verification.scope,'tests');
});

test('an observation-only CAD task cannot turn into a code-based MCP repair',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let models=0,serviceCalls=0;
  const result=await f.runAgentLoop({...options,messages:[{role:'user',content:'Observe the intentional negative test in FreeCAD. Do not repair, edit or change anything.'}],files:[]},async messages=>{
    if(++models===1)return tool('mcp_call',{server:'cad',name:'execute_code',arguments:{code:'repair_intentionally_invalid_shape()'}});
    if(models===2){assert.match(String(messages.at(-1).content),/Auftrag|[Ää]nder|[Rr]epar/i);return tool('mcp_call',{server:'cad',name:'get_document_info',arguments:{}});}
    return {content:'The document was inspected without repairing its deliberate shape error.'};
  },{mcp:async(_action,_server,name)=>{serviceCalls++;assert.equal(name,'get_document_info');return {ok:true,text:'Document info read.'};}});
  assert.equal(serviceCalls,1);assert.match(result.reply,/inspected/);
});

test('a resumed legacy task with no checklist publishes a new visible plan',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let first=0;
  const {planStart,planFromTool}=await f.server.ssrLoadModule('/src/lib/plan.ts');
  const {toolResultFailed}=await f.server.ssrLoadModule('/src/lib/agent-evidence.ts');
  const old=await f.runAgentLoop({...options,messages:[{role:'user',content:'Read note.txt and report it.'}],files:[{path:'note.txt',content:'note'}]},async()=>++first===1?tool('read_file',{path:'note.txt'}):{content:'The note was read.'});
  assert.deepEqual(old.plan,[]);
  f.beginAgent();let visible=[],events=0,models=0,reads=0;
  const resumed=await f.runAgentLoop({...options,workflow:old.workflow,messages:[{role:'user',content:'Read note.txt and report its current contents.'}],files:old.files},async()=>{
    if(++models===1){
      assert.equal(events,1,'legacy checklist must be published before the first resumed model request');
      assert.ok(visible.length>=2);assert.ok(visible.every(step=>step.status==='todo'),'a fresh checklist must not invent completed work');
      return tool('read_file',{path:'note.txt'});
    }
    assert.equal(visible[0].status,'ok','the actual read result reached the runtime-owned visible plan before the next model request');
    return {content:'The current note was read.'};
  },{
    getPlan:()=>visible,
    onToolStart:info=>{
      assert.ok(visible.length>=2,'the UI plan exists before its first tool starts');
      visible=planStart(info.name,visible,info.args)||visible;
      if(info.name==='read_file')assert.equal(visible[0].status,'run');
    },
    // Match the real worker/foreground owner: set_plan publishes a new list;
    // ordinary tool results advance that owner's list using the shared adapter.
    onTool:info=>{
      if(info.result?.plan){visible=info.result.plan;events++;}
      else visible=planFromTool(info.name,visible,Boolean(info.result&&toolResultFailed(info.result)),info.args,info.result)||visible;
      if(info.name==='read_file'){reads++;assert.equal(visible[0].status,'ok');}
    },
  });
  assert.equal(events,1);assert.equal(reads,1);assert.equal(models,2,'resume must not create a checklist reconciliation loop');
  assert.ok(resumed.plan.length>=2);assert.equal(resumed.plan[0].status,'ok');assert.ok(resumed.plan.every(step=>step.status==='ok'));
});
