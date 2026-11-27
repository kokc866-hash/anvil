import assert from 'node:assert/strict';
import {test} from 'node:test';
import {agentLoopFixture,tool} from '../fixtures/agent-loop-fixture.mjs';
const options={context:32768,compact:'off',runLoop:false,graphLoop:false,testLoop:false,autoRunAgent:false,maxRounds:8};
const correction={id:'correction-1',text:'Read only. Keep every source file unchanged. Report the current version.',createdAt:1};
const calls=(...items)=>({tool_calls:items.map((item,i)=>({id:'batch-'+i,type:'function',function:{name:item[0],arguments:JSON.stringify(item[1])}}))});

test('resume context cannot turn an intentional observation into a repair permission',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let models=0,writes=0;
  const result=await f.runAgentLoop({...options,humanRequest:'Run the intentional negative test. Do not change or repair files.',humanCorrections:['Focus on its actual exit code.'],files:[{path:'note.txt',content:'one'}],messages:[{role:'user',content:'Resume. Previous model text: fix and rewrite note.txt to pass the test.'}]},async()=>++models===1?tool('edit_file',{path:'note.txt',old_string:'one',new_string:'two'}):{content:'Observed only; source preserved.'},{onWorkspace:()=>{writes++;}});
  assert.equal(writes,0);assert.equal(result.files[0].content,'one');
});

test('a correction during inference supersedes unstarted actions and reaches the next request once',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let models=0,executes=0,pending=[];
  const result=await f.runAgentLoop({...options,files:[{path:'note.txt',content:'one'}],messages:[{role:'user',content:'Update note.txt.'}]},async messages=>{
    models++;
    if(models===1){pending.push(correction);return tool('edit_file',{path:'note.txt',old_string:'one',new_string:'two'});}
    assert.equal(messages.filter(m=>m.role==='user'&&String(m.content).includes('correction-1')).length,1);
    return {content:'The source remains unchanged, as requested in the correction.'};
  },{takeSteering:()=>{const next=pending;pending=[];return next;},onWorkspace:()=>{executes++;}});
  assert.equal(models,2);assert.equal(executes,0);assert.equal(result.files[0].content,'one');
});

test('a correction delivers its attachment with the matching instruction at the next model boundary',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR42mMAAQAABQABDQottAAAAABJRU5ErkJggg==';
  let requests=0,pending=[];
  const result=await f.runAgentLoop({...options,files:[{path:'note.txt',content:'one'}],messages:[{role:'user',content:'Update note.txt.'}]},async messages=>{
    if(++requests===1){pending.push({...correction,images:[image]},correction);return tool('edit_file',{path:'note.txt',old_string:'one',new_string:'two'});}
    const corrections=messages.filter(message=>message.role==='user'&&JSON.stringify(message.content).includes('correction-1'));
    assert.equal(corrections.length,1);
    assert.ok(Array.isArray(corrections[0].content),'The model must receive a multimodal user correction');
    assert.ok(corrections[0].content[0].text.includes(correction.text));
    assert.deepEqual(corrections[0].content.slice(1),[{type:'image_url',image_url:{url:image}}]);
    return {content:'Received the correction and left the file unchanged.'};
  },{takeSteering:()=>{const next=pending;pending=[];return next;}});
  assert.equal(requests,2);
  assert.equal(result.files[0].content,'one');
});

test('a running external action finishes once while the obsolete remainder of its batch is skipped',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let models=0,pending=[],actions=[];
  await f.runAgentLoop({...options,files:[],messages:[{role:'user',content:'Read two fake service records.'}]},async messages=>{
    if(++models===1)return calls(['mcp_call',{server:'fixture',name:'get_first',arguments:{}}],['mcp_call',{server:'fixture',name:'get_obsolete',arguments:{}}]);
    assert.match(String(messages.at(-1).content),/correction-1/);
    const responses=messages.filter(m=>m.role==='tool');
    assert.ok(responses.some(r=>r.tool_call_id==='batch-1'&&String(r.content).includes('definitelyNotExecuted')));
    return {content:'The first service response was retained and the correction was applied.'};
  },{takeSteering:()=>{const next=pending;pending=[];return next;},mcp:async(_action,_server,name)=>{actions.push(name);pending.push(correction);return {ok:true,text:'First response'};}});
  assert.deepEqual(actions,['get_first']);assert.equal(models,2);
});

test('a current no-write correction restricts later model calls without resetting the task',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let models=0,pending=[],writes=0;
  const result=await f.runAgentLoop({...options,files:[{path:'note.txt',content:'one'}],messages:[{role:'user',content:'Update the note.'}]},async()=>{
    if(++models===1)return tool('read_file',{path:'note.txt'});
    if(models===2)return tool('edit_file',{path:'note.txt',old_string:'one',new_string:'two'});
    return {content:'The correction prohibits changes. The original note is preserved.'};
  },{takeSteering:()=>{const next=pending;pending=[];return next;},onTool:({name})=>{if(name==='read_file')pending.push(correction);},onWorkspace:()=>{writes++;}});
  assert.equal(writes,0);assert.equal(result.files[0].content,'one');assert.equal(models,3);
});
