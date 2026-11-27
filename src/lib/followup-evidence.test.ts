import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PlanProgress} from './plan-progress.ts';
import {AgentWorkflow} from './agent-workflow.ts';
import {planFromTool} from './plan.ts';
import {packToolContent} from './agent-read.ts';
import {PreviewTestGuidance} from './preview-test-guidance.ts';

test('observing a preview cannot complete a functional case whose wording omits play',()=>{
  for(const [name,args] of [['see_run',{}],['run_file',{path:'index.html'}]] as const){
    const progress=new PlanProgress();progress.sync([{text:'Roboter müssen sich bewegen und den Transport abschließen',kind:'check',status:'todo'}]);
    const evidence=progress.record(name,args,{ok:true,image:'preview',stage:{kind:'html'}});
    assert.ok(progress.set({updates:[{step:1,status:'ok',evidence:[evidence],reason:'Only looked at the preview.'}]}).error,name);
    assert.equal(progress.plan[0].status,'todo');
  }
});

test('an unclassified user checklist cannot briefly claim function success from a picture or delivered input',()=>{
  const plan=[{text:'Roboterbewegung und ausgeführten Transport prüfen',status:'todo' as const}];
  for(const [name,args,result] of [
    ['see_run',{}, {ok:true,image:'preview'}],
    ['run_file',{path:'index.html'}, {ok:true,stage:{kind:'html'}}],
    ['play',{actions:[{type:'click',selector:'#start'}]}, {ok:true,functionalChecks:false}],
  ] as const)assert.notEqual(planFromTool(name,plan,false,args,result)?.[0]?.status,'ok',name);
});

test('both foreground and background preview envelopes retain the pending check in model output',()=>{
  const testing={state:'observed-only',tools:['play'],nextCheck:'Transport abschließen'};
  const observation={elements:[],viewport:{width:500,height:400}};
  for(const result of [{ok:true,stage:{kind:'html'},state:observation},{ok:true,graphical:true,observation}]){
    const packed=packToolContent('run_file',{...result,testing});
    assert.match(packed,/Next preview check \(not performed\)/);
    assert.match(packed,/Transport abschließen/);
  }
});

test('DOM repetition compares real foreground observations rather than empty run log fields',()=>{
  const guide=new PreviewTestGuidance();
  const observation={text:'Transportprüfung Start Wartet 0',viewport:{width:946,height:298},elements:[{selector:'#start',text:'Start'}],observations:[{selector:'#done',text:'0'}]};
  guide.observe({ok:true,stage:{kind:'html'},observation,stdout:'Ausgabe bereit.',stderr:''},[],['play']);
  const next=guide.observe({ok:true,state:'ready',observation},[],['play']);
  assert.equal(next.unchanged,1);assert.match(next.guidance,/unverändert/);
  const changed=guide.observe({ok:true,state:'ready',observation:{...observation,observations:[{selector:'#done',text:'1'}]}},[],['play']);
  assert.equal(changed.unchanged,0);
});

test('a genuine preview assertion supports the focused function case while a layout-only observation remains possible',()=>{
  const progress=new PlanProgress();progress.sync([{text:'Roboter bewegen sich',kind:'check',status:'todo'}]);
  const proof=progress.record('play',{actions:[{type:'assert',selector:'#completed',text:'1'}]},{ok:true,functionalChecks:true});
  assert.equal(progress.set({updates:[{step:1,status:'ok',evidence:[proof],reason:'Requested completed state confirmed.'}]}).ok,true);
  const visual=new PlanProgress();visual.sync([{text:'Layout anhand des Vorschau-Bildes prüfen',kind:'check',status:'todo'}]);
  const image=visual.record('see_run',{}, {ok:true,image:'actual screenshot'});
  assert.equal(visual.set({updates:[{step:1,status:'ok',evidence:[image],reason:'Only the requested visual layout was reviewed.'}]}).ok,true);
});

test('workflow observations describe loading and viewing instead of an apparent full function test',async()=>{
  const workflow=new AgentWorkflow({'index.html':'<p>Ready</p>'},{runLoop:false,graphLoop:false,loopTries:1},['see_run']);
  const begun=await workflow.begin('see_run',{});
  workflow.finish(begun.id,'see_run',{}, {ok:true,stage:{kind:'html'},image:'preview',functionalChecks:false});
  const node=workflow.snapshot().nodes.find(node=>node.name==='see_run');
  assert.match(node!.reason,/keine Funktionsprüfung|Funktionen.*nicht/i);
});
