import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {fork} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {isAbsolute,join,relative,resolve} from 'node:path';
import {AgentJobHost} from '../electron/agent-job-host.mjs';
import {AgentKnowledge} from '../electron/agent-knowledge.mjs';
import {buildAgentRuntime} from './build-agent-runtime.mjs';

const markers={
  memory:'WORKER_PRIVATE_MEMORY_CONTENT',
  bundledBody:'WORKER_BUNDLED_SKILL_BODY',
  bundledReference:'WORKER_REQUESTED_BUNDLED_REFERENCE',
  projectBody:'WORKER_PROJECT_SKILL_BODY',
  projectReference:'WORKER_REQUESTED_PROJECT_REFERENCE',
  unrequested:'WORKER_UNREQUESTED_REFERENCE_CONTENT',
};

async function until(predicate,label) {
  const deadline=Date.now()+6000;
  while(Date.now()<deadline) {
    if(predicate())return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw Error(`Timed out waiting for ${label}`);
}

test('real skill worker preserves loaded metadata and discloses only requested references with memory disabled',{timeout:30000},async t=>{
  const artifacts=resolve('artifacts');
  mkdirSync(artifacts,{recursive:true});
  const root=mkdtempSync(join(artifacts,'skill-worker-'));
  const build=join(root,'runtime');
  const children=[],hosts=[],scenarios=new Map();
  const api=createServer(async(req,res)=>{
    let scenario;
    try {
      let body='';for await(const chunk of req)body+=chunk;
      const payload=JSON.parse(body);
      scenario=scenarios.get(payload.model);
      assert.ok(scenario,'Only artificial test models may use this server');
      assert.equal(req.method,'POST');
      assert.equal(req.url,'/v1/chat/completions');
      scenario.payloads.push(payload);
      const call=scenario.calls[scenario.payloads.length-1];
      if(call)assert.ok(payload.tools?.some(tool=>tool.function.name===call.name),`${call.name} must be offered to the model`);
      const delta=call?{tool_calls:[{index:0,id:`skill-call-${scenario.payloads.length}`,function:{name:call.name,arguments:JSON.stringify(call.args)}}]}:{content:'Die angeforderten Skill-Referenzen wurden gelesen.'};
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      res.end('data: '+JSON.stringify({choices:[{delta,finish_reason:call?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');
    } catch(error) {
      scenario?.errors.push(error);
      res.writeHead(500,{'Content-Type':'application/json'});
      res.end(JSON.stringify({error:{message:String(error.message)}}));
    }
  });
  t.after(async()=>{
    for(const host of hosts)await host.close();
    for(const {child} of children)if(child.exitCode===null&&!child.killed)child.kill();
    await Promise.all(children.map(({closed})=>closed));
    api.closeAllConnections();await new Promise(resolve=>api.close(resolve));
    const within=relative(artifacts,root);
    assert.ok(within&&!within.startsWith('..')&&!isAbsolute(within),'Cleanup must stay inside the isolated artifacts directory');
    rmSync(root,{recursive:true,force:true});
  });
  // Keep this build separate from agent-build and any running user application.
  await buildAgentRuntime(build);
  await new Promise((resolve,reject)=>{api.once('error',reject);api.listen(0,'127.0.0.1',resolve);});

  for(const execution of [false,true])await t.test(`execution=${execution}`,async()=>{
    const name=execution?'skill-execution-fixture':'skill-draft-fixture';
    const workspace=`v2:path:${root.replaceAll('\\','/').toLowerCase()}`;
    const bundled={id:'worker-bundled-skill',name:'worker-bundled-skill',description:'Artificial reference reading instructions',body:`1. Read the explicitly requested reference.\n${markers.bundledBody}`,scope:'user',builtin:true,baseDirectory:'skills/anvil/worker-bundled-skill',resources:['references/requested.md','references/unrequested.md'],resourceContents:{'references/requested.md':markers.bundledReference,'references/unrequested.md':markers.unrequested}};
    const projectDirectory='.anvil/skills/worker-project-skill';
    const project={id:'worker-project-skill',name:'worker-project-skill',description:'Artificial project reference instructions',body:`1. Read the project reference.\n${markers.projectBody}`,scope:'project',ws:workspace,file:`${projectDirectory}/SKILL.md`,baseDirectory:projectDirectory,resources:[`${projectDirectory}/references/requested.md`]};
    const files={'notes.txt':'Artificial fixture only.',[project.file]:`---\nname: ${project.name}\ndescription: ${project.description}\n---\n${project.body}`,[`${projectDirectory}/references/requested.md`]:markers.projectReference};
    const calls=[
      {name:'skill_list',args:{}},
      {name:'skill_read',args:{name:bundled.id}},
      {name:'skill_read',args:{name:bundled.id,resource:'references/requested.md'}},
      {name:'skill_read',args:{name:project.id}},
      {name:'skill_read',args:{name:project.id,resource:'references/requested.md'}},
      ...(execution?[{name:'skill_run',args:{name:bundled.id}},{name:'skill_outcome',args:{kind:'ok'}}]:[]),
    ];
    const scenario={calls,payloads:[],errors:[]};scenarios.set(name,scenario);
    const operations=[],storagePath=join(root,`${name}-knowledge.json`),snapshotPath=join(root,`${name}-job.json`);
    const knowledge=execution?new AgentKnowledge({storagePath}):undefined;
    const runtime=knowledge?{
      begin(request,id){knowledge.begin(request,id);},
      knowledgeEvents(){return knowledge.events();},
      finish(){},close(){knowledge.close();},
      async execute(op,context){
        assert.equal(op.kind,'knowledge','This fixture must never execute project programs or services');
        operations.push(op);
        const result=await knowledge.execute(op,context);
        assert.deepEqual(result.workspaceWrites||[],[],'Applying this read-only skill may update internal usage, never project files');
        return result;
      },
    }:undefined;
    let stderr='';
    const host=new AgentJobHost({snapshotPath,runtime,launch:()=>{
      const child=fork(join(build,'worker.mjs'),[],{stdio:['ignore','ignore','pipe','ipc']});
      child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-8000);});
      const closed=new Promise(resolve=>child.once('close',resolve));
      children.push({child,closed});return child;
    }});hosts.push(host);
    const initial=host.start({
      project:root,execution,files,locale:'de',skillSelection:[],
      knowledge:{enabled:true,memoryEnabled:false,skillsEnabled:true,skillBodies:true,workspace,memories:[{id:'private-memory',text:markers.memory,scope:'user'}],skills:[bundled,project]},
      messages:[{role:'user',content:execution
        ? 'Lies die beiden benannten Test-Skills und jeweils nur references/requested.md. Wende anschließend worker-bundled-skill an und aktualisiere dessen interne Nutzungsbewertung mit dem tatsächlichen Ergebnis. Die Projektdateien sollen unverändert bleiben.'
        : 'Lies die beiden benannten Test-Skills und jeweils nur references/requested.md. Keine Projektänderungen.'}],
      maxRounds:12,autoContinue:false,automation:{autoRunAgent:false},
      model:{provider:'custom',baseUrl:`http://127.0.0.1:${api.address().port}/v1`,model:name,context:32768,thinking:'off',maxOut:1000,hardStopMin:1},
    });
    assert.deepEqual(initial.state.skillSelection,[],'No skill has been selected or loaded before the model starts');
    await until(()=>!host.busy(),`${name} to finish`);
    assert.deepEqual(scenario.errors,[]);
    assert.equal(host.state.status,'done',`${host.state.error}\n${stderr}`);
    assert.equal(scenario.payloads.length,calls.length+1,'Every tool result must reach a subsequent real model request');
    assert.deepEqual(host.state.steps.map(step=>[step.name,step.status]),calls.map(call=>[call.name,'ok']));
    assert.deepEqual(operations.map(op=>op.action),execution?['skills','read','read','read','read','run','outcome']:[]);
    assert.deepEqual(host.state.drafts,{},'Reading and applying this skill must leave project files unchanged');

    for(const payload of scenario.payloads) {
      assert.ok(!payload.tools?.some(tool=>tool.function.name.startsWith('memory_')),'Memory tools stay disabled in both lanes');
      const wire=JSON.stringify(payload);
      for(const privateText of [markers.memory,markers.unrequested,'knowledgeEvents','workspaceWrites'])assert.ok(!wire.includes(privateText),`${privateText} must not be visible to the model`);
    }
    for(const [marker,firstTurn] of [[markers.bundledBody,2],[markers.bundledReference,3],[markers.projectBody,4],[markers.projectReference,5]]) {
      for(const payload of scenario.payloads.slice(0,firstTurn))assert.ok(!JSON.stringify(payload.messages).includes(marker),`${marker} must stay hidden before explicit reading`);
      assert.ok(scenario.payloads[firstTurn].messages.some(message=>message.role==='tool'&&JSON.stringify(message.content).includes(marker)),`${marker} must appear in the requested tool response`);
    }
    if(execution) {
      // Private event data really contains the unused reference: absence on the
      // HTTP side therefore verifies the production model boundary, not a stub.
      assert.equal(knowledge.events().length,2);
      assert.ok(JSON.stringify(knowledge.events()).includes(markers.unrequested));
      assert.equal(knowledge.events().at(-1).after.uses,1,'The explicitly requested skill application is recorded once');
      const reports=knowledge.events().at(-1).after.feedback;
      assert.equal(reports.length,1,'The explicitly requested agent report is recorded once');
      assert.equal(reports[0].kind,'ok');assert.equal(reports[0].source,'agent');assert.ok(reports[0].jobId&&reports[0].version);
    }

    const final=host.snapshot().state;
    assert.deepEqual(final.skillSelection.map(skill=>({id:skill.id,name:skill.name,explicit:skill.explicit})),[bundled,project].map(skill=>({id:skill.id,name:skill.name,explicit:true})));
    assert.ok(final.skillSelection.every(skill=>skill.reason.includes('skill_read')),'The status records the tool that actually loaded each skill');
    assert.equal(final.skillSelection.length,2,'Reading a reference or running an already loaded skill must not duplicate status entries');
    await host.close();
    const persisted=JSON.parse(readFileSync(snapshotPath,'utf8'));
    assert.deepEqual(persisted.skillSelection,final.skillSelection);
    const reopenedKnowledge=execution?new AgentKnowledge({storagePath}):undefined;
    const reopened=new AgentJobHost({snapshotPath,runtime:reopenedKnowledge?{knowledgeEvents:()=>reopenedKnowledge.events(),close:()=>reopenedKnowledge.close()}:undefined,launch:()=>{assert.fail('Reopening a completed job must not replay the worker or model requests');}});hosts.push(reopened);
    const restored=reopened.snapshot().state;
    assert.equal(restored.status,'done');
    assert.deepEqual(restored.skillSelection,final.skillSelection,'Loaded skill metadata survives app-process restart');
    assert.deepEqual(restored.knowledgeEvents,final.knowledgeEvents,'Private durable events remain available for recovery');
    await reopened.close();
  });
});
