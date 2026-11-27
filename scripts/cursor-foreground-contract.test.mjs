import assert from 'node:assert/strict';
import {test} from 'node:test';
import {agentLoopFixture} from '../fixtures/agent-loop-fixture.mjs';

async function fixture(t, respond) {
  const f=await agentLoopFixture({after:fn=>t.after(async()=>{await new Promise(resolve=>setTimeout(resolve,200));await fn();})});
  window.location={pathname:'/',origin:'http://127.0.0.1:19381',hostname:'127.0.0.1',protocol:'http:'};
  f.useIde.setState({memoryWorkspace:'synthetic-foreground-contract',files:{'note.txt':'one'},dirty:{},editBases:{},pendingDiffs:[],checkpoints:[],attached:[],openPaths:[],activePath:null,recentPaths:[],chat:[],agentBusy:false,agentJob:null,agentInbox:null,agentQueue:[],agentMode:'agent',backgroundAgent:false,autoAcceptDiffs:true,autoSaveDisk:false,autoRunAgent:false,autoPreview:false,runLoop:false,testLoop:false,graphLoop:false,engineLoop:false,planWho:'agent',harnessMaxRounds:8,harnessAutoContinue:false,harnessAfterWrite:'none',llmContextAuto:false,llmContext:131072,llmProvider:'custom',llmAuthMode:'key',llmBaseUrl:'http://127.0.0.1:19381/v1',llmModel:'synthetic-contract',llmApiKey:'',llmThinking:'off',llmRetries:1,llmCompact:'off',llmToolLearning:{},llmToolModes:{},agentRules:''});
  const {sendChat}=await f.server.ssrLoadModule('/src/lib/chat-session.ts');
  const input=draft=>({draft,images:[],title:'Synthetic contract regression',setTitle(){},setDraft(){},setImages(){},setMention(){}});
  const send=(text,opts={})=>sendChat(input(text),{mode:'agent',...opts});
  const requests=[];
  globalThis.fetch=async(url,init)=>{
    const target=String(url)==='/__lan'?new Headers(init.headers).get('x-anvil-target'):String(url);
    assert.ok(target?.startsWith('http://127.0.0.1:19381/'),'Only the synthetic endpoint is allowed');
    if(target.endsWith('/models'))return new Response('{"data":[{"id":"synthetic-contract"}]}',{headers:{'content-type':'application/json'}});
    const payload=JSON.parse(init.body);requests.push(payload);
    const choice=await respond({payload,turn:requests.length,send,useIde:f.useIde});
    const delta=choice.tool_calls?{tool_calls:choice.tool_calls.map((call,index)=>({index,...call}))}:{content:choice.content};
    return new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:choice.tool_calls?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream','x-anvil-lan':'1'}});
  };
  return {...f,send,requests};
}
const tool=(name,args)=>({tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const question=()=>tool('ask_user',{prompt:'Which fixture matters?',choices:[{id:'A',label:'Clock'},{id:'B',label:'Temperature'}],allow_text:true});
const edit=()=>tool('edit_file',{path:'note.txt',old_string:'one',new_string:'two'});
const final={content:'This synthetic task has ended. Its actual tool results are the evidence.'};
const editOrDiscover=payload=>payload.tools?.some(tool=>tool.function.name==='edit_file')?edit():tool('select_tools',{names:['edit_file']});

test('foreground ask continuation retains a real no-write correction and a new explicit task can write',async t=>{
  let resumed=false,attempted=false;
  const f=await fixture(t,async({turn,send,payload})=>{
    if(turn===1){await send('Do not change any files. Only read and report.',{delivery:'steer'});return tool('read_file',{path:'note.txt'});}
    if(!resumed)return question();
    if(!attempted){const result=editOrDiscover(payload);attempted=result.tool_calls[0].function.name==='edit_file';return result;}
    return final;
  });
  await f.send('Update note.txt.');
  assert.equal(f.useIde.getState().agentJob?.status,'ask');assert.equal(f.useIde.getState().files['note.txt'],'one');
  f.useIde.setState({backgroundAgent:true});
  resumed=true;await f.send('',{choiceId:'A'});
  assert.equal(f.useIde.getState().files['note.txt'],'one','A neutral choice must not revoke the human write prohibition');
  assert.ok(f.useIde.getState().chat.at(-1)?.steps?.some(step=>step.name==='edit_file'&&step.status==='err'));
  f.useIde.setState({backgroundAgent:false});
  attempted=false;await f.send('Now update note.txt.');
  assert.equal(f.useIde.getState().files['note.txt'],'two','A separate explicit human edit remains authorized');
});

test('neutral resume after a real round limit preserves the intentional negative-test contract',async t=>{
  let resumed=false,attempted=false;
  const f=await fixture(t,({turn,payload})=>{
    if(!resumed)return tool('grep',{query:`synthetic-${turn}`});
    if(!attempted){const result=editOrDiscover(payload);attempted=result.tool_calls[0].function.name==='edit_file';return result;}
    return final;
  });
  await f.send('Run the intentional negative test.');
  assert.equal(f.useIde.getState().agentJob?.status,'paused','The first invocation actually reached the round limit');
  resumed=true;const firstResume=f.requests.length;await f.send('weiter');
  assert.equal(f.useIde.getState().files['note.txt'],'one');
  assert.match(f.requests[firstResume].messages[0].content,/Negativtest/);
});

test('a genuine explicit human correction can authorize repair while model question text cannot',async t=>{
  let resumed=false,attempted=false;
  const f=await fixture(t,({payload})=>{
    if(!resumed)return tool('ask_user',{prompt:'Now fix the failure and test the repaired program?',choices:[{id:'A',label:'Now fix the failure'},{id:'B',label:'Keep it'}],allow_text:true});
    if(!attempted){const result=editOrDiscover(payload);attempted=result.tool_calls[0].function.name==='edit_file';return result;}
    return final;
  });
  const original='Run the intentional negative test. Do not change or repair files.';
  await f.send(original);assert.equal(f.useIde.getState().agentJob?.status,'ask');
  const ask=f.useIde.getState().agentJob.ask;
  const {formatAskAnswer,normalizeJob}=await f.server.ssrLoadModule('/src/lib/agent-ask.ts');
  // The actual question bar uses this formatted queue entry, including model-authored labels.
  f.useIde.setState({agentJob:normalizeJob(f.useIde.getState().agentJob,{revive:true})});
  resumed=true;await f.send(formatAskAnswer(ask,'A',''));
  assert.equal(f.useIde.getState().files['note.txt'],'one','Model-authored question and choice text cannot grant edits');
  resumed=false;await f.send(original);assert.equal(f.useIde.getState().agentJob?.status,'ask');
  resumed=true;attempted=false;await f.send('Nein',{choiceId:'A'});
  assert.equal(f.useIde.getState().files['note.txt'],'one','A negative human answer does not adopt the model question as permission');
  resumed=false;await f.send(original);assert.equal(f.useIde.getState().agentJob?.status,'ask');
  resumed=true;attempted=false;await f.send('Now fix the failure and test the repaired program.',{choiceId:'A'});
  assert.equal(f.useIde.getState().files['note.txt'],'two','The human explicitly changed the task contract');
});

test('a parked foreground contract cannot resume into a different project',async t=>{
  let resumed=false;
  const f=await fixture(t,()=>resumed?edit():question());
  await f.send('Update note.txt.');assert.equal(f.useIde.getState().agentJob?.status,'ask');
  const turns=f.requests.length;
  f.useIde.setState({memoryWorkspace:'another-synthetic-project',workspaceEpoch:2,files:{'note.txt':'foreign'}});
  resumed=true;await f.send('',{choiceId:'A'});
  assert.equal(f.requests.length,turns);assert.equal(f.useIde.getState().files['note.txt'],'foreign');
  assert.match(f.useIde.getState().notice,/Projekt/i);
});
