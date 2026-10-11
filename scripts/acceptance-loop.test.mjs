import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { agentLoopFixture, tool } from '../fixtures/agent-loop-fixture.mjs';

test('production loop uses native artifact checks before interpreting wrapped FreeCAD measurements', async t => {
  const f=await agentLoopFixture(t),sha256=createHash('sha256').update('synthetic saved report').digest('hex');
  for(const ok of [true,false])await t.test(ok?'verified file':'unverified file',async()=>{
    f.beginAgent();let rounds=0,checks=0;
    const result=await f.runAgentLoop({files:[{path:'notes.txt',content:'Synthetic fixture'}],context:32768,compact:'off',maxRounds:4,
      messages:[{role:'user',content:'Prüfe die künstlichen Messwerte.'}]},async()=>{
      if(++rounds===1)return tool('set_plan',{criteria:[{id:'solid',label:'Körperanzahl',required:true,operator:'eq',expected:1}]});
      if(rounds===2)return tool('mcp_call',{server:'fixture',name:'execute_code',arguments:{code:'verify_saved_fixture()'}});
      return {content:'Prüfung abgeschlossen.'};
    },{capabilities:['set_plan','mcp_call'],mcp:async()=>({isError:false,text:`Headless FreeCAD script finished (exit 0).\nOutput:\n${JSON.stringify({anvil_acceptance:{observations:[{criterion:'solid',actual:1,artifact:'checks/geometry.json',sha256}]}},null,2)}\nReload document if needed.`,anvilArtifactChecks:[{ok:true}]}),
      verifyArtifacts:async raw=>{checks++;return {...raw,anvilArtifactChecks:[{artifact:'checks/geometry.json',sha256,ok,reason:'Künstlicher Dateinachweis fehlt.',reasonEn:'Synthetic file evidence missing.'}]};}});
    assert.equal(checks,1);
    assert.equal(result.acceptance.state,ok?'passed':'unverified');
    assert.equal(result.acceptance.observations.length,ok?1:0);
  });
});
