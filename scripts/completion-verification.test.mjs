import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLoopFixture, tool } from '../fixtures/agent-loop-fixture.mjs';

const options = { context:32768,compact:'off',runLoop:false,graphLoop:false,testLoop:false,autoRunAgent:false,maxRounds:12,locale:'de' };
const files=[
 {path:'index.html',content:'<h1>Planner</h1><button>Create</button>'},
 {path:'tests/model.test.js',content:'/* artificial test source */'},
 {path:'tests/browser.test.mjs',content:'/* artificial browser test source */'},
];
test('real agent-loop recovery reports newly executed named tests before reused interaction evidence',async t=>{
 const f=await agentLoopFixture(t);
 f.beginAgent();let oldCalls=0;
 const prior=await f.runAgentLoop({...options,files,messages:[{role:'user',content:'Load index.html and observe one key press. Do not change files.'}]},async()=>{
  if(++oldCalls===1)return tool('run_file',{path:'index.html'});
  if(oldCalls===2)return tool('play',{keys:['right']});
  return {content:'The old preview and key press were observed.'};
 },{runFile:async()=>({ok:true,stage:{kind:'html'},state:{text:'Planner'}}),play:async()=>({ok:true,state:{text:'Planner after input'}})});
 assert.equal(prior.ok,true);assert.equal(prior.verification.scope,'interaction');
 f.beginAgent();let currentCalls=0,plays=0;
 const current=await f.runAgentLoop({...options,workflow:prior.workflow,files,messages:[{role:'user',content:'Run the existing model and browser tests again. Do not change files.'}]},async()=>{
  if(++currentCalls===1)return tool('run_file',{path:'tests/model.test.js'});
  if(currentCalls===2)return tool('run_file',{path:'tests/browser.test.mjs'});
  if(currentCalls===3)return tool('run_file',{path:'index.html'});
  return {content:'The existing model and browser test scripts were executed again.'};
 },{runFile:async path=>path.endsWith('.html')?{ok:true,stage:{kind:'html'},state:{text:'Planner'}}:
  {ok:true,code:0,stdout:path.includes('browser')?'PASS - Create\nPASS - Reload\n# tests 1\n# pass 1\n# fail 0\n':'# tests 28\n# pass 28\n# fail 0\n'},
  play:async()=>{plays++;return{ok:true,state:{text:'Unexpected new play'}};}});
 assert.equal(current.ok,true,current.error);
 assert.equal(currentCalls,4,'a recovered successful test run does not need another model repair cycle');
 assert.equal(plays,0,'old interaction evidence is not replayed');
 assert.match(current.verification.detail,/Aktuell geprüft:.*tests\/model\.test\.js.*28/);
 assert.match(current.verification.detail,/tests\/browser\.test\.mjs.*1\/1/);
 assert.match(current.verification.detail,/2 gemeldete Einzelprüfungen/);
 assert.match(current.verification.detail,/Übernommene Nachweise.*Vorschaueingabe/);
 assert.match(current.reply,/tests\/model\.test\.js.*28/);
 assert.ok(current.verification.detail.indexOf('model.test.js')<current.verification.detail.indexOf('Vorschaueingabe'));
});

test('fresh failed tests remain failed for an explicit negative-test request',async t=>{
 const f=await agentLoopFixture(t);f.beginAgent();let calls=0;
 const result=await f.runAgentLoop({...options,files:[{path:'negative.test.js',content:'/* expected failure */'}],messages:[{role:'user',content:'Run negative.test.js once. This is an intentional negative test. Do not change or repair files. Report the actual exit code.'}]},async()=>{
  if(++calls===1)return tool('run_file',{path:'negative.test.js'});
  return{content:'The requested negative test failed. No repair was performed.'};
 },{runFile:async()=>({ok:false,code:1,stdout:'# tests 2\n# pass 1\n# fail 1\n',stderr:'Expected negative assertion failed'})});
 assert.equal(result.verification.state,'failed');
 assert.equal(result.verification.observedFailure,true,JSON.stringify({verification:result.verification,tools:result.tools,evidence:result.workflow.verificationEvidence}));
 assert.match(result.reply,/Fehler beobachtet/);
 assert.equal(calls,2);
});

