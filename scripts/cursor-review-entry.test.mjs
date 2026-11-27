import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentLoopFixture } from '../fixtures/agent-loop-fixture.mjs';

test('existing Git review entry queues a bound read-only review without a formatting task or new dialog', async t => {
  const f = await agentLoopFixture(t);
  const { askGit } = await f.server.ssrLoadModule('/src/lib/fix-agent.ts');
  const { useTaskReviews } = await f.server.ssrLoadModule('/src/lib/task-review-store.ts');
  await useTaskReviews.persist.rehydrate();
  f.useIde.setState({workspaceCwd:'',memoryWorkspace:'review-entry',workspaceEpoch:1,files:{'main.ts':'export const n = 2;'},dirty:{'main.ts':true,'unchanged.ts':false},editBases:{'main.ts':'export const n = 1;'},checkpoints:[],agentInbox:null,agentQueue:[]});
  assert.equal(await askGit(),true);
  const queued=f.useIde.getState().agentInbox;
  assert.equal(queued.mode,'ask');assert.match(queued.text,/^\[anvil-review:/);assert.doesNotMatch(queued.text,/format_file/);
  const request=useTaskReviews.getState().requests.find(r=>r.project==='review-entry');
  assert.ok(request);assert.deepEqual(request.files.map(file=>file.path),['main.ts']);assert.match(request.basisLabel,/Ausgangsinhalte/);
  assert.equal(f.useIde.getState().files['main.ts'],'export const n = 2;');
  f.useIde.setState({dirty:{'.env':true},agentInbox:null});assert.equal(await askGit(),false);
  assert.equal(f.useIde.getState().agentInbox,null);assert.match(f.useIde.getState().notice,/ausgeschlossen/);
});

test('a partial edit baseline never presents another dirty file as newly added, and a switched project receives no queued review', async t => {
  const f=await agentLoopFixture(t),{askGit}=await f.server.ssrLoadModule('/src/lib/fix-agent.ts');
  const {useTaskReviews}=await f.server.ssrLoadModule('/src/lib/task-review-store.ts');await useTaskReviews.persist.rehydrate();
  f.useIde.setState({workspaceCwd:'',memoryWorkspace:'review-unknown',workspaceEpoch:1,files:{'known.ts':'2','unknown.ts':'changed'},dirty:{'known.ts':true,'unknown.ts':true},editBases:{'known.ts':'1'},checkpoints:[],agentInbox:null,agentQueue:[]});
  assert.equal(await askGit(),true);
  const request=useTaskReviews.getState().requests.find(r=>r.project==='review-unknown');
  assert.ok(request);assert.equal(request.files.length,2);assert.ok(request.files.every(file=>file.change==='unknown'));assert.match(request.basisLabel,/fehlt/);
  f.useIde.setState({agentInbox:null,agentQueue:[]});const pending=askGit();
  f.useIde.setState({memoryWorkspace:'different',workspaceEpoch:2});
  assert.equal(await pending,false);assert.equal(f.useIde.getState().agentInbox,null);
});

test('Git review includes saved working-tree changes when the editor has no unsaved flag', async t => {
  const f=await agentLoopFixture(t),{askGit}=await f.server.ssrLoadModule('/src/lib/fix-agent.ts');
  const {useTaskReviews}=await f.server.ssrLoadModule('/src/lib/task-review-store.ts');await useTaskReviews.persist.rehydrate();
  const cwd='I:/synthetic-disk-review';
  f.useIde.setState({workspaceCwd:cwd,workspaceEpoch:1,files:{'disk.ts':'changed and saved'},dirty:{},editBases:{},checkpoints:[],agentInbox:null,agentQueue:[]});
  globalThis.fetch=async(url,init)=>{assert.equal(String(url),'http://127.0.0.1:7845/v1/git');assert.deepEqual(JSON.parse(init.body),{action:'status',cwd});return new Response(JSON.stringify({ok:true,repo:true,files:[{path:'disk.ts',kind:'M'}]}),{headers:{'content-type':'application/json'}});};
  assert.equal(await askGit(),true);
  const request=useTaskReviews.getState().requests.find(r=>r.project===cwd);
  assert.ok(request);assert.deepEqual(request.files.map(file=>file.path),['disk.ts']);assert.equal(request.files[0].change,'unknown');
  assert.equal(f.useIde.getState().agentInbox.mode,'ask');assert.equal(f.useIde.getState().files['disk.ts'],'changed and saved');
});
