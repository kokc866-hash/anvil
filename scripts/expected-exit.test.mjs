import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyExpectedExit} from '../electron/expected-exit.mjs';

test('exit expectations require actual normal process completion',()=>{
 const failure={ok:false,code:1,stdout:'',stderr:'negative'};
 assert.equal(verifyExpectedExit(failure).ok,false);
 assert.equal(verifyExpectedExit(failure,1).ok,true);
 assert.equal(verifyExpectedExit(failure,0).ok,false);
 for(const extra of [{aborted:true},{timedOut:true},{running:true},{signal:'SIGTERM'},{error:'spawn failed'},{isError:true},{code:null},{code:undefined}]){
  assert.equal(verifyExpectedExit({...failure,...extra},1).ok,false,JSON.stringify(extra));
 }
 for(const value of [-1,256,1.5,'1',null,NaN])assert.equal(verifyExpectedExit(failure,value).ok,false);
});
