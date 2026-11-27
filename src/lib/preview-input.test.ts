import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlayInput, resolvePreviewKey, performPreviewInput, previewCheckNote, type PreviewEvent, type PreviewDriver } from './preview-input.ts';
import { DEFAULT_INPUT_MAP } from './input-map.ts';
import { AgentEvidence } from './agent-evidence.ts';
import { PlanProgress } from './plan-progress.ts';

test('input feedback distinguishes delivery, checked expectations and failure', () => {
  assert.match(previewCheckNote(true,0),/keine Ergebniserwartung geprüft/);
  assert.match(previewCheckNote(true,0),/observations/);
  assert.match(previewCheckNote(true,2),/Weitere Funktionen bleiben ungeprüft/);
  assert.match(previewCheckNote(false,2),/fehlgeschlagen/);
});

test('play preserves literal space and supports the reported application shortcuts', () => {
  const parsed=parsePlayInput({keys:[' ','s','u','r','Delete'],hold_ms:0});
  assert.equal(parsed.hold,0);
  assert.deepEqual(parsed.keys.map(k=>resolvePreviewKey(k,DEFAULT_INPUT_MAP).key),[' ','s','u','r','Delete']);
  assert.equal(resolvePreviewKey('left',{...DEFAULT_INPUT_MAP,left:{keys:['q'],pad:[]}}).key,'q');
  assert.equal(resolvePreviewKey('ArrowLeft',{...DEFAULT_INPUT_MAP,left:{keys:['q'],pad:[]}}).key,'ArrowLeft');
  for(const key of ['Backspace','Home','End','PageUp','PageDown','Tab','Escape','F12','KeyA','Digit2']) assert.ok(resolvePreviewKey(key).keyCode);
  assert.deepEqual(resolvePreviewKey('z',undefined,['ctrl','Shift']).modifiers,['Control','Shift']);
  assert.equal(resolvePreviewKey('s',undefined,['Shift']).key,'S');
  assert.deepEqual(resolvePreviewKey('S').modifiers,['Shift']);
});

test('play validates limits and unknown actions before execution', () => {
  for(const input of [
    {},{keys:[]},{keys:[null]},{keys:new Array(33).fill('a')},{keys:['a'],hold_ms:-1},{keys:['a'],hold_ms:Infinity},
    {actions:[{type:'click',x:-1,y:0}]},{actions:[{type:'click',x:1}]},{actions:[{type:'click',selector:'#b',x:2,y:2}]},
    {actions:[{type:'drag',selector:'#a'}]},{actions:[{type:'eval',text:'x'}]},{actions:[{type:'type',text:''}]},
    {actions:[{type:'click',selector:'#b',count:3}]},{actions:[{type:'key',key:'x',modifiers:['Bad']}]},
    {actions:[{type:'assert',selector:'#a'}]},{actions:[{type:'assert',selector:'#a',visible:'yes'}]},
    {actions:[{type:'click',selector:'#a',script:'not allowed'}]},{keys:new Array(12).fill('a'),hold_ms:1000},
  ]) assert.throws(()=>parsePlayInput(input));
  assert.throws(()=>resolvePreviewKey('UnknownKey'));
  assert.throws(()=>resolvePreviewKey('v',undefined,['Control']),/Zwischenablage/);
});

function driver() {
  const events:PreviewEvent[]=[], assertions:string[]=[];
  const api:PreviewDriver={current(){},target:async t=>({x:t.x??10,y:t.y??20}),event:async e=>{events.push(e);},assert:async a=>{assertions.push(a.selector!);}};
  return {events,assertions,api};
}

test('keys and mouse actions retain order; assertion results are counted separately',async()=>{
  const d=driver();
  const r=await performPreviewInput(parsePlayInput({keys:['Delete'],hold_ms:0,actions:[{type:'click',x:20,y:30},{type:'type',selector:'#field',text:'Test'},{type:'assert',selector:'#out',text:'Test'}]}),DEFAULT_INPUT_MAP,d.api);
  assert.deepEqual(d.events.map(e=>e.type),['keyDown','keyUp','mouseMove','mouseDown','mouseUp','type']);
  assert.deepEqual(d.assertions,['#out']); assert.deepEqual(r,{completed:4,total:4,assertions:1});
});

test('invalid trailing keys cannot partially execute an earlier valid action',async()=>{
  const d=driver();
  await assert.rejects(performPreviewInput(parsePlayInput({keys:['s','not-a-key']}),DEFAULT_INPUT_MAP,d.api));
  assert.equal(d.events.length,0);
});

test('an aborted held key releases once and stops later actions',async()=>{
  const d=driver(), abort=new AbortController();
  d.api.event=async e=>{d.events.push(e);if(e.type==='keyDown')abort.abort(new Error('fixture stop'));};
  await assert.rejects(performPreviewInput(parsePlayInput({keys:['s','r'],hold_ms:1000}),DEFAULT_INPUT_MAP,d.api,abort.signal),/fixture stop/);
  assert.deepEqual(d.events.map(e=>e.type),['keyDown','keyUp']);
});

test('an aborted drag releases its original button and skips following clicks',async()=>{
  const d=driver(), abort=new AbortController();
  d.api.event=async e=>{d.events.push(e);if(e.type==='mouseDown')abort.abort(new Error('fixture drag stop'));};
  await assert.rejects(performPreviewInput(parsePlayInput({actions:[{type:'drag',x:10,y:10,to_x:50,to_y:50},{type:'click',x:60,y:60}]}),undefined,d.api,abort.signal),/fixture drag stop/);
  assert.deepEqual(d.events.map(e=>e.type),['mouseMove','mouseDown','mouseUp']);
});

test('failed expectation stops the sequence and retains truthful partial progress',async()=>{
  const d=driver();d.api.assert=async()=>{throw new Error('wrong displayed value');};
  let caught:any;
  try {await performPreviewInput(parsePlayInput({keys:['s'],hold_ms:0,actions:[{type:'assert',selector:'#status',text:'Ready'},{type:'click',selector:'#delete'}]}),undefined,d.api);}catch(error){caught=error;}
  assert.match(caught.message,/wrong displayed/);assert.deepEqual(caught.inputProgress,{completed:1,total:3,assertions:0});
  assert.equal(d.events.some(e=>e.type==='mouseDown'),false);
});

test('only an isolated missing selector click yields evidence of an expected rejection', async () => {
  const d = driver();
  d.api.target = async () => { throw new Error('Selektor muss genau ein Element treffen (0 gefunden): #missing'); };
  const click = { type: 'click', selector: '#missing' };
  await assert.rejects(performPreviewInput(parsePlayInput({ actions: [click] }), undefined, d.api),
    { previewMissingTarget: '#missing', inputRejected: true });
  await assert.rejects(performPreviewInput(parsePlayInput({ actions: [click, { type: 'wait' }] }), undefined, d.api),
    error => !Object.hasOwn(error as object, 'previewMissingTarget'));
  d.api.target = async () => { throw new Error('Ziel ist verdeckt: #missing'); };
  await assert.rejects(performPreviewInput(parsePlayInput({ actions: [click] }), undefined, d.api),
    error => !Object.hasOwn(error as object, 'previewMissingTarget'));
  assert.equal(d.events.length, 0);
});

test('bounded expectation retries can observe delayed UI state without replaying input',async()=>{
  const d=driver();let attempts=0;d.api.assert=async()=>{if(++attempts<2)throw new Error('loading');};
  const r=await performPreviewInput(parsePlayInput({actions:[{type:'click',x:10,y:10},{type:'assert',selector:'#status',text:'Ready',timeout_ms:200}]}),undefined,d.api);
  assert.equal(r.assertions,1);assert.equal(attempts,2);assert.equal(d.events.filter(e=>e.type==='mouseDown').length,1);
});

test('mouse and DOM assertions become scoped evidence without pretending all program tests ran',()=>{
  const e=new AgentEvidence();e.record('run_file',{path:'index.html'},{ok:true,stage:{kind:'html'},state:{text:'Ready'}});
  e.record('play',{actions:[{type:'click',selector:'#start'},{type:'assert',selector:'#status',text:'Running'}]},{ok:true,observation:{text:'Running'},functionalChecks:true});
  assert.equal(e.interactionNeeded({'index.html':'<button>Start</button><script></script>'}),undefined);
  assert.match(e.status({'index.html':'<button>Start</button><script></script>'}).detail,/Vorschauerwartungen/);
  const restoredEvidence=new AgentEvidence();assert.equal(restoredEvidence.restore(e.snapshot()),true);
  assert.match(restoredEvidence.status({'index.html':'<button>Start</button><script></script>'}).detail,/Vorschauerwartungen/);
  const p=new PlanProgress();p.sync([{text:'Start-Schaltfläche prüfen',kind:'check',status:'todo'}]);
  const id=p.record('play',{actions:[{type:'assert',selector:'#status',text:'Running'}]},{ok:true,functionalChecks:true});
  assert.equal(p.set({updates:[{step:1,status:'ok',evidence:[id],reason:'Expected Running was observed.'}]}).ok,true);
  const snapshot=p.snapshot(), restored=new PlanProgress();assert.equal(restored.restore(snapshot),true);
  assert.equal(restored.plan[0].status,'ok');
  const failed=new PlanProgress();failed.sync([{text:'Start-Schaltfläche prüfen',kind:'check',status:'todo'}]);
  const bad=failed.record('play',{}, {ok:false,error:'assertion failed',functionalChecks:false});
  assert.ok(failed.set({updates:[{step:1,status:'ok',evidence:[bad],reason:'Failed expectation must remain open.'}]}).error);
});
