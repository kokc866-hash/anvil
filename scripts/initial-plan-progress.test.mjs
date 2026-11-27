import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'vite';
import path from 'node:path';

test('initial checklist progress stays coupled to actual evidence and survives resume',async()=>{
 const server=await createServer({configFile:false,root:process.cwd(),resolve:{alias:{'@':path.resolve('src')}},server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'});
 try{
  const {PlanProgress}=await server.ssrLoadModule('/src/lib/plan-progress.ts');
  const {initialAgentPlan}=await server.ssrLoadModule('/src/lib/plan.ts');
  const progress=new PlanProgress();
  progress.sync(initialAgentPlan('Verbessere das Spiel und ergänze ein Ziel.',undefined,'agent'));
  progress.setInputStamp('a'.repeat(64));
  const read=progress.record('read_file',{path:'game.cjs'},{ok:true});
  const edit=progress.record('edit_file',{path:'game.cjs'},{ok:true},true);
  assert.equal(progress.set({updates:[{step:1,status:'ok',reason:'Existing source read.',evidence:[read]},{step:2,status:'ok',reason:'Requested source edit acknowledged.',evidence:[edit]}]}).ok,true);
  const failed=progress.record('shell',{command:'node --test game.test.cjs'},{ok:false,code:1});
  assert.ok(progress.set({updates:[{step:3,status:'ok',reason:'Tests passed.',evidence:[failed]}]}).error,'a failed function test cannot complete the check');
  const passed=progress.record('shell',{command:'node --test game.test.cjs'},{ok:true,code:0});
  assert.equal(progress.set({updates:[{step:3,status:'ok',reason:'Targeted function tests passed.',evidence:[passed]}]}).ok,true);
  const restored=new PlanProgress();assert.equal(restored.restore(progress.snapshot()),true);
  assert.deepEqual(initialAgentPlan('weiter',restored.plan,'agent').map(step=>step.status),['ok','ok','ok'],'resume preserves acknowledged completion');
  restored.setInputStamp('b'.repeat(64));
  assert.deepEqual(restored.plan.map(step=>step.status),['ok','ok','todo'],'changed execution inputs reopen only the obsolete check');
  const snapshot=restored.snapshot();const reopened=new PlanProgress();assert.equal(reopened.restore(snapshot),true);
  assert.deepEqual(reopened.plan.map(step=>step.status),['ok','ok','todo'],'restart must not invent fresh evidence');
 }finally{await server.close();}
});
