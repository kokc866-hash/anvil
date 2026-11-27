import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JobResourceGate} from '../electron/resource-gate.mjs';
import {withForegroundResource,releaseForegroundResource} from '../src/lib/external-resource.ts';
test('foreground body never runs while another job owns an external resource',async()=>{
  const previous=globalThis.window,gate=new JobResourceGate();
  globalThis.window={anvilNative:{agentJob:async(action,payload)=>action==='resource-acquire'?gate.acquire('foreground:fixture:renderer',payload.key):gate.release(payload.leaseId,'foreground:fixture:renderer')}};
  try{
    const background=gate.acquire('background:fixture','external');let called=0;
    await assert.rejects(withForegroundResource(async()=>{called++;}),/bereits/);assert.equal(called,0);gate.release(background.leaseId,background.owner);
    let finish=()=>{};
    const pending=withForegroundResource(()=>new Promise(resolve=>{finish=resolve;}));
    await new Promise(resolve=>setTimeout(resolve,0));assert.throws(()=>gate.acquire('background:other','external'),/bereits/);
    finish({running:false});await pending;assert.equal(gate.held(),false);
    await withForegroundResource(async()=>({running:true}),()=> 'artificial-engine');
    assert.throws(()=>gate.acquire('background:other','external'),/bereits/);
    await withForegroundResource(async()=>({ok:true}));assert.equal(gate.held(),true,'nested status must not release the engine session');
    await releaseForegroundResource('artificial-engine');assert.equal(gate.held(),false);
  }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
