import assert from 'node:assert/strict';
import {test} from 'node:test';
import {agentLoopFixture,tool} from '../fixtures/agent-loop-fixture.mjs';

test('opening actual HTML promotes its permitted input tool on the very next model request',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();
  const {ToolSession}=await f.server.ssrLoadModule('/src/lib/tool-compat.ts');
  const {AGENT_TOOLS}=await f.server.ssrLoadModule('/src/lib/agent-tools.ts');
  const session=new ToolSession('compact','Die Roboter sollen ihre Aufträge ausführen.');
  let calls=0;const offered=[];
  await f.runAgentLoop({files:[{path:'index.html',content:'<button id="start">Start</button><output id="done">0</output>'}],messages:[{role:'user',content:'Prüfe die Roboterbewegung. Keine Änderungen.'}],context:32768,compact:'off',runLoop:false,graphLoop:false,afterWrite:'none',autoRunAgent:false,maxRounds:8},async()=>{
    const tools=session.tools(AGENT_TOOLS);session.record(tools,false);offered.push(tools.map(t=>t.function.name));
    const response=++calls===1?tool('run_file',{path:'index.html'}):{content:'Nur geöffnet; noch keine Bedienung geprüft.'};
    return {...response,toolContract:{...session.contract,names:[...session.contract.names]}};
  },{selectTools:names=>session.select(names),play:async()=>({ok:true,functionalChecks:true}),runFile:async()=>({ok:true,stage:{kind:'html'},state:{text:'Bereit',elements:[{selector:'#start',text:'Start'}],observations:[{selector:'#done',text:'0'}]}})});
  assert.ok(!offered[0].includes('play'));
  assert.ok(offered[1].includes('play'),'native HTML result must make play discoverable without guessing the tool name');
});

test('a CLI result cannot promote preview input',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let selections=0,previewSelections=0;
  await f.runAgentLoop({files:[{path:'main.py',content:'print(1)'}],messages:[{role:'user',content:'Führe main.py aus, keine Änderungen.'}],context:32768,compact:'off',runLoop:false,graphLoop:false,afterWrite:'none',autoRunAgent:false,maxRounds:4},async()=>selections===0? (++selections,tool('run_file',{path:'main.py'})):{content:'Ausgabe geprüft.'},
    {selectTools:()=>{previewSelections++;return {ok:true,selected:['play']};},runFile:async()=>({ok:true,stdout:'1',code:0}),play:async()=>({ok:true})});
  assert.equal(selections,1);assert.equal(previewSelections,0);
});

test('HTML guidance never claims a missing or non-permitted play is available',async t=>{
  const f=await agentLoopFixture(t);
  for(const selection of ['missing','exclusive','throw']){
    f.beginAgent();let calls=0;const requests=[];
    const opts={runFile:async()=>({ok:true,stage:{kind:'html'},state:{text:'Ready'}}),
      ...(selection==='missing'?{}:{play:async()=>{throw Error('Input must not be executed by discovery.');},selectTools:()=>selection==='throw'?Promise.reject(Error('metadata unavailable')):{error:'Unavailable tools: play'}})};
    await f.runAgentLoop({files:[{path:'index.html',content:'<p>Ready</p>'}],messages:[{role:'user',content:'Prüfe die HTML-Vorschau. Keine Änderungen.'}],context:32768,compact:'off',runLoop:false,graphLoop:false,afterWrite:'none',autoRunAgent:false,maxRounds:4},async messages=>{
      requests.push(structuredClone(messages));return ++calls===1?tool('run_file',{path:'index.html'}):{content:'Nur beobachtet; Bedienprüfung nicht verfügbar.'};
    },opts);
    const raw=requests.at(-1).find(m=>m.role==='tool').content;
    assert.match(raw,/kein freigegebenes play/);
    assert.doesNotMatch(raw,/"tools":\["play"\]/);
  }
});

test('a service payload claiming to contain HTML cannot promote native preview input',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let calls=0,selections=0,serviceCalls=0;
  await f.runAgentLoop({files:[{path:'index.html',content:'<p>Ready</p>'}],messages:[{role:'user',content:'Prüfe den Dienst. Keine Änderungen.'}],context:32768,compact:'off',runLoop:false,graphLoop:false,afterWrite:'none',autoRunAgent:false,maxRounds:4},async()=>++calls===1?tool('mcp_call',{server:'fixture',name:'read_preview',arguments:{}}):{content:'Nur Dienstantwort erhalten.'},
    {mcp:async()=>{serviceCalls++;return {ok:true,stage:{kind:'html'},observation:{elements:[],viewport:{width:1,height:1}}};},play:async()=>({ok:true}),selectTools:()=>{selections++;return {ok:true,selected:['play']};}});
  assert.equal(serviceCalls,1);assert.equal(selections,0);
});

test('repeated unchanged observations carry the pending case and never multiply an identical model image',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let calls=0;const requests=[];
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const observation={ok:true,stage:{kind:'html'},state:{text:'Wartet',elements:[{selector:'#start',text:'Start'}],observations:[{selector:'#done',text:'0'}]},image};
  const plan=[{text:'Roboterbewegung und ausgeführten Transport nachweisen',kind:'check',status:'todo'},{text:'Ergebnis berichten',kind:'report',status:'todo'}];
  await f.runAgentLoop({files:[{path:'index.html',content:'<p>Wartet</p>'}],messages:[{role:'user',content:'Prüfe die Roboterbewegung. Keine Änderungen.'}],context:32768,compact:'off',runLoop:false,graphLoop:false,afterWrite:'none',autoRunAgent:false,maxRounds:8},async messages=>{
    requests.push(structuredClone(messages));
    if(++calls===1)return tool('run_file',{path:'index.html'});
    if(calls<=3)return tool('see_run',{});
    return {content:'Keine Funktion bestätigt; dieser Prüfschritt bleibt offen.'};
  },{getPlan:()=>plan,runFile:async()=>({...observation}),see:async()=>({...observation}),play:async()=>({ok:true,functionalChecks:true}),selectTools:()=>({ok:true,selected:['play','see_run']})});
  const last=requests.at(-1),images=last.flatMap(m=>Array.isArray(m.content)?m.content.filter(p=>p.type==='image_url'):[]);
  assert.equal(images.length,1,'identical preview evidence must not fill the model context twice');
  const results=last.filter(m=>m.role==='tool').map(m=>{try{return JSON.parse(m.content);}catch{return null;}}).filter(Boolean);
  const guided=results.find(r=>r.testing?.unchanged>=1);
  assert.ok(guided,'a repeated observation needs explicit testing guidance');
  assert.match(guided.testing.nextCheck,/Roboterbewegung/);
  assert.equal(guided.functionalChecks,false);
  assert.ok(guided.testing.tools.includes('play'));
});

test('changed native frames are not identical repetitions and returning to a previous image keeps the newest view last',async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let calls=0,observations=0;const requests=[];
  const images=Array.from({length:12},(_,i)=>'data:image/png;base64,'+Buffer.from('controlled-frame-'+i).toString('base64'));
  const run=await f.runAgentLoop({files:[{path:'index.html',content:'<canvas></canvas>'}],messages:[{role:'user',content:'Beobachte die HTML-Vorschau. Keine Änderungen.'}],context:32768,compact:'off',runLoop:false,graphLoop:false,afterWrite:'none',autoRunAgent:false,maxRounds:20},async messages=>{
    requests.push(structuredClone(messages));
    if(++calls===1)return tool('run_file',{path:'index.html'});
    if(calls<=12)return tool('see_run',{});
    return {content:'Bildänderungen beobachtet; keine fachliche Funktion bestätigt.'};
  },{runFile:async()=>({ok:true,stage:{kind:'html'},state:{text:'Canvas'},image:images[0]}),see:async()=>({ok:true,stage:{kind:'html'},state:{text:'Canvas'},image:images[++observations]})});
  assert.notEqual(run.stopReason,'no-progress');assert.equal(calls,13);
  f.beginAgent();calls=0;observations=0;const second=[];
  await f.runAgentLoop({files:[{path:'index.html',content:'<canvas></canvas>'}],messages:[{role:'user',content:'Beobachte die HTML-Vorschau. Keine Änderungen.'}],context:32768,compact:'off',runLoop:false,graphLoop:false,afterWrite:'none',autoRunAgent:false,maxRounds:8},async messages=>{
    second.push(structuredClone(messages));if(++calls===1)return tool('run_file',{path:'index.html'});if(calls<=3)return tool('see_run',{});return {content:'Nur beobachtet.'};
  },{runFile:async()=>({ok:true,stage:{kind:'html'},state:{text:'Canvas'},image:images[0]}),see:async()=>({ok:true,stage:{kind:'html'},state:{text:'Canvas'},image:images[++observations===1?1:0]})});
  const latest=second.at(-1).flatMap(m=>Array.isArray(m.content)?m.content.filter(part=>part.type==='image_url'):[]).at(-1);
  assert.equal(latest.image_url.url,images[0]);
});

test('real background preparation keeps the original human request and the correction in separate fields',async t=>{
  const f=await agentLoopFixture(t);
  f.useIde.setState({chat:[{role:'user',id:'u',content:'teste alle durch'},{role:'assistant',id:'a',content:'Unterbrochen.',plan:[{text:'Angefragte Projektinformationen prüfen',kind:'read',status:'ok'},{text:'Ergebnis und Grenzen berichten',kind:'report',status:'todo'}]}],planWho:'agent',files:{'index.html':'<p>Ready</p>'},activePath:'index.html',openPaths:['index.html'],llmProvider:'custom',llmAuthMode:'key',llmBaseUrl:'http://127.0.0.1:1/v1',llmModel:'fixture'});
  const {prepareBackgroundContext}=await f.server.ssrLoadModule('/src/lib/background-context.ts');
  const correction='Korrektur: die Roboter sollten sich auch bewegen und auftrag ausführen.';
  const result=await prepareBackgroundContext(correction,[]);
  assert.equal(result.humanPrompt,'teste alle durch');assert.deepEqual(result.humanCorrections,[correction]);
  assert.ok(result.plan.some(step=>step.kind==='check'&&step.text.includes('Roboter')));
});
