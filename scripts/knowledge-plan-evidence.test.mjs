import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createServer } from 'vite';

test('knowledge checklist evidence reflects actual actions without replaying successful work',async t=>{
  const server=await createServer({configFile:false,root:process.cwd(),resolve:{alias:{'@':path.resolve('src')}},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
  try{
    const {PlanProgress}=await server.ssrLoadModule('/src/lib/plan-progress.ts');
    const {planFromTool}=await server.ssrLoadModule('/src/lib/plan.ts');
    const steps=[
      ['memory_add','Erinnerung speichern (memory_add)'],
      ['memory_forget','Erinnerung löschen (memory_forget)'],
      ['skill_write','Skill erstellen (skill_write)'],
      ['skill_patch','Skill ändern (skill_patch)'],
      ['skill_run','Skill verwenden (skill_run)'],
      ['skill_outcome','Skill-Ergebnis dokumentieren (skill_outcome)'],
    ];
    const plan=(text,kind='service')=>{const p=new PlanProgress();p.sync([{text,kind,status:'todo'}]);return p;};
    const update=(p,evidence)=>p.set({updates:[{step:1,status:'ok',evidence,reason:'Only the referenced successful tool results establish this action.'}]});
    for(const [name,text]of steps)await t.test(`${name} supports its typed service step before and after unrelated edits`,()=>{
      for(const changed of [false,true]){
        const p=plan(text);const id=p.record(name,{name:'fixture',id:'fact-fixture'},{ok:true});
        if(changed)p.record('write_file',{path:'README.md'},{ok:true},true);
        const result=update(p,[id]);assert.equal(result.ok,true,result.error);assert.equal(p.plan[0].status,'ok');
      }
      assert.equal(planFromTool(name,[{text,kind:'service',status:'todo'}],false,{}, {ok:true})[0].status,'ok');
    });
    for(const name of ['skill_write','skill_patch'])await t.test(`${name} also supports an explicitly classified skill edit`,()=>{
      const p=plan(`Skill bearbeiten (${name})`,'edit');const id=p.record(name,{name:'fixture'},{ok:true});
      assert.equal(update(p,[id]).ok,true);
    });
    await t.test('natural-language knowledge steps match their concrete operation without requiring tool jargon',()=>{
      for(const [name,text]of steps){
        const p=plan(text.replace(/ \(.+\)$/,''));const id=p.record(name,{name:'fixture'},{ok:true});
        assert.equal(update(p,[id]).ok,true,text);
      }
      for(const [name,text]of [['memory_list','Gedächtnis lesen'],['skill_list','Skills auflisten'],['skill_read','Skill lesen']]){
        const p=plan(text,'read');const id=p.record(name,{name:'fixture'},{ok:true});assert.equal(update(p,[id]).ok,true,text);
      }
      const outcome=plan('Skill bewerten');const ref=outcome.record('skill_outcome',{kind:'ok'},{ok:true});assert.equal(update(outcome,[ref]).ok,true);
    });
    for(const name of ['memory_list','skill_list','skill_read'])await t.test(`${name} supports its own read step but not mutations`,()=>{
      const p=plan(`Gespeichertes Wissen lesen (${name})`,'read');const id=p.record(name,{name:'fixture'},{ok:true});
      assert.equal(update(p,[id]).ok,true);
      for(const [,text]of steps){const mutation=plan(text);const ref=mutation.record(name,{name:'fixture'},{ok:true});assert.ok(update(mutation,[ref]).error);}
      const wrongKind=plan(`Gespeichertes Wissen lesen (${name})`);const ref=wrongKind.record(name,{name:'fixture'},{ok:true});
      assert.ok(update(wrongKind,[ref]).error,'read evidence cannot certify a service action');
    });
    await t.test('wrong knowledge families, operations and external service actions cannot close each other',()=>{
      for(const [name,text]of steps)for(const [other]of steps){
        if(name===other)continue;
        const p=plan(text);const id=p.record(other,{name:'fixture'},{ok:true});assert.ok(update(p,[id]).error,`${other} cannot certify ${name}`);
      }
      for(const name of steps.map(([name])=>name)){
        const p=plan('Notion-Seite erstellen');const id=p.record(name,{}, {ok:true});assert.ok(update(p,[id]).error);
        const knowledge=plan('Erinnerung speichern (memory_add)');const ref=knowledge.record('mcp_call',{name:'notion-create-page'},{ok:true});assert.ok(update(knowledge,[ref]).error);
      }
      for(const kind of ['service','edit'])for(const tool of ['write_file','edit_file','mcp_call']){
        const p=plan('Skill erstellen',kind);const id=p.record(tool,{path:'README.md',name:'notion-create-page'},{ok:true});assert.ok(update(p,[id]).error,`${tool} cannot certify a knowledge ${kind}`);
      }
    });
    await t.test('failed, pending, still-running and contradicted knowledge results remain unconfirmed',()=>{
      for(const result of [{ok:false},{ok:true,error:'not saved'},{isError:true},{ok:true,pending:true},{ok:true,running:true}]){
        const p=plan('Skill erstellen (skill_write)');const id=p.record('skill_write',{name:'fixture'},result);assert.ok(update(p,[id]).error,JSON.stringify(result));
      }
      const p=plan('Skill erstellen (skill_write)');const id=p.record('skill_write',{name:'fixture'},{ok:true});
      p.record('skill_write',{name:'fixture'},{ok:false,error:'newer rejected action'});assert.ok(update(p,[id]).error);
    });
    await t.test('activating a skill never proves a project run or completed verification',()=>{
      for(const kind of ['run','check']){
        const p=plan('Skill verwenden (skill_run)',kind);const id=p.record('skill_run',{name:'fixture'},{ok:true});assert.ok(update(p,[id]).error);
      }
    });
    await t.test('original compound memory/skill step requires all five named operations and survives README edits',()=>{
      const text='memory_add, skill_write/patch/run/outcome';const p=plan(text);const refs=[];
      for(const name of ['memory_add','skill_write','skill_patch','skill_run','skill_outcome']){
        refs.push(p.record(name,{name:'fixture'},{ok:true}));
        if(refs.length<5)assert.ok(update(p,refs).error,`Only ${refs.length} of five actions cannot complete the compound step`);
        assert.equal(planFromTool(name,[{text,kind:'service',status:'todo'}],false,{}, {ok:true})[0].status,'todo','a single auto-progress event cannot complete the compound step');
      }
      p.record('write_file',{path:'README.md'},{ok:true},true);
      const result=update(p,refs);assert.equal(result.ok,true,result.error);
    });
    await t.test('a compound step cannot replace a missing named action with duplicate or unrelated evidence',()=>{
      const p=plan('memory_add, skill_write/patch/run/outcome');
      const refs=['memory_add','skill_write','skill_patch','skill_run'].map(name=>p.record(name,{name:'fixture'},{ok:true}));
      const unrelated=p.record('git_status',{}, {ok:true});
      assert.ok(update(p,[...refs,refs[0],unrelated]).error);
    });
    await t.test('service mismatch errors do not misleadingly blame a stale run, while actual checks stay revision-bound',()=>{
      const p=plan('Erinnerung speichern (memory_add)');const id=p.record('skill_read',{name:'fixture'},{ok:true});
      p.record('write_file',{path:'README.md'},{ok:true},true);
      const mismatch=update(p,[id]);assert.ok(mismatch.error);assert.doesNotMatch(mismatch.error,/predates|stale|latest change/i);
      const check=plan('Tests ausführen','check');const checked=check.record('shell',{command:'npm test'},{ok:true});
      check.record('write_file',{path:'README.md'},{ok:true},true);assert.ok(update(check,[checked]).error);
      const service=plan('Notion-Seite erstellen');const created=service.record('mcp_call',{name:'notion-create-page'},{ok:true});
      service.record('write_file',{path:'README.md'},{ok:true},true);assert.equal(update(service,[created]).ok,true);
    });
    await t.test('agent loop reconciles mixed knowledge actions after a file edit without repeating mutations',async()=>{
      const {runAgentLoop}=await server.ssrLoadModule('/src/lib/agent-core.ts');
      const {beginAgent}=await server.ssrLoadModule('/src/lib/agent-abort.ts');beginAgent();
      const compound='memory_add, skill_write/patch/run/outcome';
      const actions=[['memory_add',{kind:'project',text:'Use the fixture.'}],['skill_write',{name:'fixture',when:'Synthetic test',body:'Inspect the file.'}],['skill_patch',{name:'fixture',body:'Inspect and report.'}],['skill_run',{name:'fixture'}],['skill_outcome',{kind:'ok'}]];
      const refs=[];let round=0;const learned=[],written=[];
      const call=(name,args)=>({content:'',tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
      const result=await runAgentLoop({messages:[{role:'user',content:'Speichere Wissen, pflege den Skill und dokumentiere das Ergebnis.'}],files:[],runLoop:false,afterWrite:'none',maxRounds:14},async messages=>{
        for(const message of messages)if(message.role==='tool'){
          try{const output=JSON.parse(message.content);if(output.plan_evidence_id&&!refs.includes(output.plan_evidence_id))refs.push(output.plan_evidence_id);}catch{}
        }
        let next;
        if(++round===1)next=call('set_plan',{steps:[compound,'README.md erstellen','Ergebnis berichten'],kinds:['service','edit','report']});
        else if(round<=6){const [name,args]=actions[round-2];next=call(name,args);}
        else if(round===7)next=call('write_file',{path:'README.md',content:'Synthetic fixture completed.\n'});
        else if(round===8)next=call('set_plan',{updates:[{step:1,status:'ok',evidence:refs.slice(0,5),reason:'All five knowledge operations succeeded.'},{step:2,status:'ok',evidence:[refs[5]],reason:'README saved.'}]});
        else next={content:'Wissen und Skill gespeichert; README erstellt.'};
        return {...next,toolContract:{transport:'native',names:['set_plan','write_file',...actions.map(([name])=>name)]}};
      },{learn:async action=>{learned.push(action);return {ok:true};},onWorkspace:async event=>written.push(event)});
      assert.equal(round,9,'successful evidence reconciliation needs no repeated work or recovery round');
      assert.equal(learned.length,5);assert.equal(written.length,1);assert.equal(result.plan[0].status,'ok');assert.equal(result.plan[1].status,'ok');
      assert.equal(result.files.find(file=>file.path==='README.md').content,'Synthetic fixture completed.\n');
    });
  }finally{await server.close();}
});
