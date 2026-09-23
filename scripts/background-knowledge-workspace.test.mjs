import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createServer } from 'vite';

// Load the real agent core without the application's server/build configuration.
test('background skill and formatter results respect acknowledged workspace changes',async t=>{
  const server=await createServer({configFile:false,root:process.cwd(),resolve:{alias:{'@':path.resolve('src')}},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
  try{
    const {runAgentLoop}=await server.ssrLoadModule('/src/lib/agent-core.ts');
    const {beginAgent}=await server.ssrLoadModule('/src/lib/agent-abort.ts');
    const data={messages:[{role:'user',content:'Prüfe das Beispiel und speichere die angeforderte Änderung.'}],files:[{path:'main.js',content:'const number=1;'}],runLoop:false,afterWrite:'none',maxRounds:8};
    const call=(name,args)=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
    const scripted=rounds=>async()=>({content:'Der Vorgang ist beendet.',toolContract:{transport:'native',names:['run_file','skill_write','format_file','read_file']},tool_calls:rounds.shift()||[]});

    await t.test('a partially acknowledged skill write invalidates a previously passing run',async()=>{
      beginAgent();
      const firstPath='.anvil/skills/example.md',secondPath='plugins/skills/example.js';
      const acknowledged=[],attempted=[],outcomes=[];
      const result=await runAgentLoop(data,scripted([
        [call('run_file',{path:'main.js'})],
        [call('skill_write',{name:'example',when:'For the regression test',body:'Read then test the current file.',kind:'plugin'})],
      ]),{
        runFile:async()=>({ok:true,stdout:'Fixture passed',stderr:''}),
        learn:async action=>{
          assert.equal(action,'write');
          return {ok:true,workspaceWrites:[
            {path:firstPath,before:null,content:'# Example\nRead then test the current file.\n'},
            {path:secondPath,before:null,content:'function activate() {}\n'},
          ]};
        },
        onWorkspace:async event=>{
          attempted.push(event.path);
          if(event.path===secondPath)throw Error('Plugin-Datei wurde zwischenzeitlich geändert.');
          acknowledged.push(event);
        },
        onTool:info=>outcomes.push(info),
      });
      assert.deepEqual(attempted,[firstPath,secondPath]);
      assert.deepEqual(acknowledged.map(event=>event.path),[firstPath]);
      assert.equal(outcomes.find(info=>info.name==='run_file').result.ok,true,'a successful execution preceded the partial change');
      assert.match(outcomes.find(info=>info.name==='skill_write').result.error,/zwischenzeitlich geändert/);
      assert.equal(result.files.find(file=>file.path===firstPath).content,acknowledged[0].content);
      assert.equal(result.files.some(file=>file.path===secondPath),false,'a rejected second write is not adopted');
      assert.equal(result.verification.state,'stale','the earlier run cannot certify the acknowledged first change');
      assert.match(result.reply,/Noch nicht bestätigt/,'the final response must disclose stale verification');
    });

    await t.test('a rejected formatter acknowledgement never changes the core file map',async()=>{
      beginAgent();let saveAttempts=0,formatCalls=0;const outcomes=[];
      const result=await runAgentLoop(data,scripted([
        [call('format_file',{path:'main.js'})],
        [call('read_file',{path:'main.js'})],
      ]),{
        formatFile:async(file,content)=>{
          formatCalls++;assert.equal(file,'main.js');assert.equal(content,'const number=1;');
          return 'const number = 1;\n';
        },
        onWorkspace:async event=>{
          saveAttempts++;assert.equal(event.path,'main.js');assert.equal(event.content,'const number = 1;\n');
          throw Error('Formatierte Datei konnte nicht gesichert werden.');
        },
        onTool:info=>outcomes.push(info),
      });
      assert.equal(formatCalls,1);assert.equal(saveAttempts,1);
      assert.match(outcomes.find(info=>info.name==='format_file').result.error,/nicht gesichert/);
      assert.equal(result.files.find(file=>file.path==='main.js').content,'const number=1;');
      const read=outcomes.find(info=>info.name==='read_file');
      assert.ok(read,'the following read uses the still-current acknowledged file');
      assert.match(JSON.stringify(read.result),/const number=1;/);
      assert.doesNotMatch(JSON.stringify(read.result),/const number = 1;/);
    });
  }finally{await server.close();}
});
