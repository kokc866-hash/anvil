import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentLoopFixture, tool } from '../fixtures/agent-loop-fixture.mjs';

test('a repeated read/preview input cycle is stopped promptly with the actual cause', async t => {
  const f = await agentLoopFixture(t); f.beginAgent(); let calls = 0;
  const result = await f.runAgentLoop({ files: [{path:'note.txt',content:'unchanged'}], context:32768, compact:'off',
    messages:[{role:'user',content:'Prüfe mit play in der HTML-Vorschau, ändere keine Dateien.'}],
    autoContinueRounds:true, maxRounds:48, runLoop:false, graphLoop:false, afterWrite:'none', autoRunAgent:false }, async () => {
      calls++; return tool('read_file',{path:'note.txt'});
    });
  assert.equal(result.ok,false);
  assert.equal(result.stopReason,'no-progress');
  assert.ok(calls <= 12, `unchanged reads repeated ${calls} times`);
  assert.match(result.error, /Wiederholung|repeated/i);
});

test('varying Blender code cannot prolong a read-only MCP rejection loop', async t => {
  const f = await agentLoopFixture(t);
  f.beginAgent();
  const prompt = 'Prüfe die Blender-Szene aus mehreren Blickwinkeln. Nur lesen, nichts ändern.';
  const rejected = [];
  let requests = 0, dispatched = 0;
  const result = await f.runAgentLoop({ files: [], messages: [{ role: 'user', content: prompt }],
    humanRequest: prompt, context: 32768, compact: 'off', autoContinueRounds: true, maxRounds: 48, autoRunAgent: false },
  async () => tool('mcp_call', { server: 'mcp:blender-local', name: 'execute_blender_code', arguments: { code: `print(${++requests})` } }),
  { mcp: async () => { dispatched++; return { ok: true }; }, onTool: info => rejected.push(info.result) });
  assert.equal(dispatched, 0);
  assert.equal(result.stopReason, 'no-progress');
  assert.ok(requests <= 8, `${requests} rejected attempts`);
  assert.ok(rejected.every(reply => reply.definitelyNotExecuted === true && reply.suggestedTools.includes('mcp_list')));
});

test('the actual read / reload / click loop repeats no more than four times', async t => {
  const f=await agentLoopFixture(t); f.beginAgent(); let calls=0;
  const file={'index.html':'<button id="start">Start</button>', 'note.txt':'same source'};
  const sequence=[['read_file',{path:'note.txt'}],['run_file',{path:'index.html'}],['play',{actions:[{type:'click',selector:'#start'}]}]];
  const result=await f.runAgentLoop({files:Object.entries(file).map(([path,content])=>({path,content})),messages:[{role:'user',content:'Prüfe mit play in der HTML-Vorschau. Keine Änderungen.'}],
    context:32768,compact:'off',autoContinueRounds:true,maxRounds:48,autoRunAgent:false,runLoop:false,graphLoop:false,afterWrite:'none'},async()=>{
      const [name,args]=sequence[calls++%3];return tool(name,args);
    },{runFile:async()=>({ok:true,stage:{kind:'html'},state:{text:'Ready'}}),play:async()=>({ok:true,state:{text:'Ready'},functionalChecks:false})});
  assert.equal(result.stopReason,'no-progress'); assert.ok(calls<=15,`${calls} repeated actions`);
  assert.match(result.error,/Wiederholung/); assert.doesNotMatch(result.reply,/alles erfolgreich/i);
});

test('fresh application states continue beyond the ordinary round window', async t => {
  const f=await agentLoopFixture(t);f.beginAgent();let calls=0,observations=0;
  const result=await f.runAgentLoop({files:[{path:'index.html',content:'<p>State</p>'}],messages:[{role:'user',content:'Beobachte die HTML-Vorschau mit play, keine Änderungen.'}],
    context:32768,compact:'off',autoContinueRounds:true,maxRounds:8,autoRunAgent:false,runLoop:false,graphLoop:false,afterWrite:'none'},async()=>{
      if(++calls===1)return tool('run_file',{path:'index.html'});
      if(calls<=30)return tool('play',{actions:[{type:'click',selector:'#step'}]});
      return {content:'Unterschiedliche Zustände beobachtet; keine vollständige Funktion bestätigt.'};
    },{runFile:async()=>({ok:true,stage:{kind:'html'},state:{text:'Ready'}}),play:async()=>({ok:true,state:{text:`Fortschritt ${++observations}`},functionalChecks:false})});
  assert.equal(result.stopReason,undefined);assert.ok(calls>=31);assert.equal(observations,29);
});

test('withheld checklist updates cannot execute and fresh preview work restores the tool in native, text and CLI modes', async t => {
  const f = await agentLoopFixture(t);
  const { AGENT_TOOLS } = await f.server.ssrLoadModule('/src/lib/agent-tools.ts');
  const { ToolSession } = await f.server.ssrLoadModule('/src/lib/tool-compat.ts');
  const { parseCliChoice } = await f.server.ssrLoadModule('/src/lib/cli-protocol.ts');
  const prompt = 'Prüfe mit play, ob Ready in der HTML-Vorschau angezeigt wird. Keine Dateien ändern.';
  for (const mode of ['standard', 'text', 'cli']) {
    f.beginAgent();
    let visible = [{ text: 'Prüfe die Anzeige Ready mit play.', kind: 'check', status: 'todo' }];
    let requests = 0;
    const pauses = [], results = [];
    const session = new ToolSession(mode === 'cli' ? 'standard' : mode, prompt);
    const result = await f.runAgentLoop({
      files: [{ path: 'index.html', content: '<p>Ready</p>' }], messages: [{ role: 'user', content: prompt }],
      compact: 'off', context: 32768, autoContinueRounds: true, maxRounds: 8, runLoop: false, afterWrite: 'none',
    }, async messages => {
      requests++;
      const offered = session.tools(AGENT_TOOLS);
      const names = offered.map(entry => entry.function.name);
      session.record(offered, mode === 'text');
      assert.equal(names.includes('set_plan'), ![5, 6].includes(requests));
      assert.ok(names.includes('play'));
      let choice;
      if (requests === 1) choice = tool('run_file', { path: 'index.html' });
      else if (requests <= 5) {
        if (requests === 5) {
          assert.match(JSON.stringify(messages), /To-do-Statusänderungen sind.*ausgesetzt/);
          assert.ok(session.select(['set_plan']).error);
          assert.ok(!session.search({ query: 'set_plan' }).available.some(entry => entry.name === 'set_plan'));
        }
        choice = tool('set_plan', { updates: [{ step: 1, status: 'ok', reason: 'Invented proof', evidence: ['missing'] }] });
      } else if (requests === 6) {
        assert.equal(visible[0].status, 'todo');
        const rejected = JSON.parse(String(messages.at(-1).content));
        assert.equal(rejected.definitelyNotExecuted, true);
        choice = tool('play', { actions: [{ type: 'assert', selector: 'body', text: 'Ready' }] });
      } else if (requests === 7) {
        choice = tool('set_plan', { updates: [{ step: 1, status: 'ok', reason: 'Ready was actually asserted.', evidence: ['e2'] }] });
      } else choice = { content: 'Ready wurde in der Vorschau bestätigt.' };
      if (mode === 'text' && choice.tool_calls) {
        const c = choice.tool_calls[0].function;
        choice = { content: JSON.stringify({ name: c.name, arguments: JSON.parse(c.arguments) }) };
      }
      if (mode === 'cli') {
        const tool_calls = (choice.tool_calls || []).map(call => call.function);
        return parseCliChoice(JSON.stringify({ content: choice.content, tool_calls }), names, session.planUpdatesArePaused);
      }
      return { ...choice, toolContract: session.contract };
    }, {
      runFile: async () => ({ ok: true, stage: { kind: 'html', path: 'index.html' }, state: { text: 'Ready' } }),
      play: async (_keys, _hold, actions) => {
        assert.deepEqual(actions, [{ type: 'assert', selector: 'body', text: 'Ready' }]);
        return { ok: true, previewPath: 'index.html', functionalChecks: true, input: { assertions: 1 }, state: { text: 'Ready' } };
      },
      getPlan: () => visible,
      canReplacePlan: () => false,
      pausePlanUpdates: paused => { pauses.push(paused); session.pausePlanUpdates(paused); },
      onTool: ({ name, result }) => { results.push([name, result]); if (result?.plan) visible = result.plan; },
    });
    assert.equal(requests, 8);
    assert.deepEqual(pauses, [true, false]);
    assert.equal(results.filter(([name, row]) => name === 'set_plan' && row.definitelyNotExecuted).length, 1);
    assert.equal(result.ok, true, result.reply);
    assert.equal(result.plan[0].status, 'ok');
  }
});

test('background preparation carries the resolved read-only retest into the native human contract', async t => {
  const f=await agentLoopFixture(t);
  const {initialAgentPlan}=await f.server.ssrLoadModule('/src/lib/plan.ts');
  const original='Prüfe Start und Pause mit play. Keine Dateien ändern.';
  f.useIde.setState({chat:[{role:'user',id:'q',content:original},{role:'assistant',id:'a',content:'Geprüft.',plan:initialAgentPlan(original).map(s=>({...s,status:'ok',completedBy:'agent'}))}],planWho:'agent',files:{'index.html':'<p>State</p>'},activePath:'index.html',openPaths:['index.html'],llmProvider:'custom',llmAuthMode:'key',llmBaseUrl:'http://127.0.0.1:1/v1',llmModel:'fixture'});
  const {prepareBackgroundContext}=await f.server.ssrLoadModule('/src/lib/background-context.ts');
  const context=await prepareBackgroundContext('noch einmal',[]);
  assert.equal(context.humanPrompt,original);assert.ok(context.messages.at(-1).content.includes(original));
  assert.ok(context.plan.every(s=>s.status==='todo'));assert.ok(context.plan.some(s=>s.kind==='check'));
});

test('a forbidden edit cannot poison a subsequently completed read-only test', async t=>{
  const f=await agentLoopFixture(t);f.beginAgent();let calls=0;
  const result=await f.runAgentLoop({files:[{path:'note.txt',content:'original'}],context:32768,compact:'off',
    messages:[{role:'user',content:'Lies note.txt und berichte. Keine Dateien ändern.'}],runLoop:false,graphLoop:false,afterWrite:'none',autoRunAgent:false,maxRounds:8},async()=>{
      if(++calls===1)return tool('edit_file',{path:'note.txt',old_string:'original',new_string:'forbidden'});
      if(calls===2)return tool('read_file',{path:'note.txt'});
      return {content:'Originalinhalt gelesen; keine Datei geändert.'};
    });
  assert.equal(result.files.find(file=>file.path==='note.txt').content,'original');
  assert.equal(result.ok,true,result.reply);assert.notEqual(result.verification?.state,'failed');
});
