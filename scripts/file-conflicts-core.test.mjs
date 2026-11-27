import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {agentLoopFixture,tool} from '../fixtures/agent-loop-fixture.mjs';
import {AgentProjectRuntime} from '../electron/agent-project-runtime.mjs';

const CSS='body { background: #f5f5f5; }\nheader { color: black; }\n';
const USER=CSS.replace('#f5f5f5','#242323');
async function loopRuntime(t){
 const f=await agentLoopFixture(t);f.beginAgent();
 const root=resolve('artifacts/file-conflicts-2026-10-30/core');mkdirSync(root,{recursive:true});
 const project=mkdtempSync(join(root,'project-'));
 const files={'styles.css':CSS,'check.test.cjs':'/* independent execution boundary is a fixture */'};
 for(const [path,content]of Object.entries(files))writeFileSync(join(project,path),content);
 const runtime=new AgentProjectRuntime();runtime.begin({project,writeThrough:true,files,model:{}},'core-test');
 t.after(()=>runtime.close());
 const protection={},base={...files};
 const {WorkspaceConflictError}=await f.server.ssrLoadModule('/src/lib/workspace-conflict.ts');
 const action=async op=>{
  const out=await runtime.execute(op,{files:base,before:base[op.path]??null,fileProtections:protection,signal:new AbortController().signal,backupPath:join(project,'backups',op.path+'.json')});
  if(out.protectedFile)protection[op.path]=out.protectedFile;
  if(out.fileConflict)throw new WorkspaceConflictError(out.error,out.fileConflict);
  if(op.kind==='write')base[op.path]=op.content;
  if(op.kind==='read'&&Object.hasOwn(out,'content')){if(out.content===null)delete base[op.path];else base[op.path]=out.content;}
  return out;
 };
 return {...f,project,files,action};
}

test('the real agent loop receives a conflict, refreshes current CSS and keeps working on unprotected code',async t=>{
 const f=await loopRuntime(t);let round=0;const seen=[];
 const result=await f.runAgentLoop({files:Object.entries(f.files).map(([path,content])=>({path,content})),messages:[{role:'user',content:'Change header text color to white in styles.css, preserve my background choice. Save notes.txt and run check.test.cjs.'}],context:32768,compact:'off',maxRounds:10},async messages=>{
  round++;if(round===2)writeFileSync(join(f.project,'styles.css'),USER);
  if(round===1)return tool('read_file',{path:'styles.css'});
  if(round===2)return tool('write_file',{path:'styles.css',content:CSS.replace('black','white'),overwrite_reason:'Update the complete short synthetic CSS file.'});
  if(round===3){assert.match(messages.at(-1).content,/fileConflict/);return tool('read_file',{path:'styles.css'});}
  if(round===4){assert.match(messages.at(-1).content,/#242323/);assert.doesNotMatch(messages.at(-1).content,/#f5f5f5/);return tool('edit_file',{path:'styles.css',old_string:'color: black',new_string:'color: white'});}
  if(round===5)return tool('write_file',{path:'notes.txt',content:'Other work continues.'});
  if(round===6)return tool('run_file',{path:'check.test.cjs'});
  return {content:'The named files were saved. The test executor is simulated in this isolated integration test.'};
 },{refreshFile:path=>f.action({kind:'read',path}),onWorkspace:event=>f.action({...event,kind:event.op}),onTool:info=>seen.push(info),
  runFile:async(_path,files)=>{assert.equal(files['styles.css'],USER.replace('black','white'));return {ok:true,code:0,stdout:'# tests 1\n# pass 1\n# fail 0\n'};}});
 assert.ok(round>=7&&round<=10);
 assert.equal(readFileSync(join(f.project,'styles.css'),'utf8'),USER.replace('black','white'));
 assert.equal(readFileSync(join(f.project,'notes.txt'),'utf8'),'Other work continues.');
 assert.equal(seen.find(row=>row.name==='write_file'&&row.args.path==='styles.css').result.fileConflict.kind,'changed');
 assert.equal(seen.filter(row=>row.name==='read_file').at(-1).result.user_changes_protected,true);
 assert.equal(result.workflow.changed.includes('styles.css'),true);
});

test('refreshing an external edit invalidates input state but never records an agent implementation',async t=>{
 const f=await loopRuntime(t);writeFileSync(join(f.project,'styles.css'),USER);let calls=0;
 const result=await f.runAgentLoop({files:Object.entries(f.files).map(([path,content])=>({path,content})),messages:[{role:'user',content:'Read styles.css and explain its current background. Do not make changes.'}],context:32768,compact:'off',maxRounds:3},async()=>++calls===1?tool('read_file',{path:'styles.css'}):{content:'The current user background is #242323. No implementation was made.'},
 {refreshFile:path=>f.action({kind:'read',path})});
 assert.deepEqual(result.workflow.changed,[]);
 assert.equal(readFileSync(join(f.project,'styles.css'),'utf8'),USER);
});
