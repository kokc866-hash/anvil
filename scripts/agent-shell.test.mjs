import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,mkdtempSync,existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createServer} from 'vite';
import {AgentCommands} from '../electron/agent-commands.mjs';

test('foreground Node test routing runs plain assertions and async node:test sources through real isolated processes',async t=>{
 mkdirSync('artifacts/agent-flow-2026-10-18',{recursive:true});
 const root=mkdtempSync(resolve('artifacts/agent-flow-2026-10-18/node-foreground-'));
 const commands=new AgentCommands();commands.begin({project:root});
 const calls=[],previous=globalThis.__anvilNodeTestRun;
 globalThis.__anvilNodeTestRun=async(entry,files,options)=>{
  calls.push({entry,files,options});
  return commands.execute({kind:'shell',command:'node '+JSON.stringify(entry)},{signal:new AbortController().signal,files});
 };
 const server=await createServer({configFile:false,root:process.cwd(),resolve:{alias:{'@':resolve('src')}},plugins:[{
  name:'node-test-editor-boundary',enforce:'pre',
  resolveId(id){if(id==='@/store/ide'||/\/src\/store\/ide(?:\.ts)?$/.test(id.replaceAll('\\','/')))return '\0node-test-store';if(/(?:^|\/)run-client(?:\.ts)?$/.test(id))return '\0node-test-run';},
  load(id){
   if(id==='\0node-test-run')return 'export const runFile=(...args)=>globalThis.__anvilNodeTestRun(...args);';
   if(id==='\0node-test-store')return `let state={files:{},workspaceEpoch:1,testsRunning:false,testResults:{},output:[],setTestsRunning(value){state.testsRunning=value;},pushOutput(value){state.output.push(value);},mergeTestResults(hits){for(const hit of hits)state.testResults[hit.path+':'+hit.name]=hit;}};export const useIde={getState:()=>state,setState:next=>{state={...state,...next};}};`;
  },
 }],optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
 t.after(async()=>{await server.close();if(previous===undefined)delete globalThis.__anvilNodeTestRun;else globalThis.__anvilNodeTestRun=previous;});
 const {useIde}=await server.ssrLoadModule('\0node-test-store');
 const {runAgentShell}=await server.ssrLoadModule('/src/lib/agent-shell.ts');
 const {testFilesOf}=await server.ssrLoadModule('/src/lib/run-tests.ts');
 const files={
  'adder.cjs':'exports.add=(a,b)=>a+b;',
  'tests/plain.test.cjs':'const assert=require("node:assert/strict"),{add}=require("../adder.cjs");assert.equal(add(2,3),5);assert.equal(add(-2,3),1);console.log("PLAIN_ASSERTIONS_CONFIRMED");',
  'tests/async.test.mjs':'import {test} from "node:test";import assert from "node:assert/strict";import adder from "../adder.cjs";test("async addition",async()=>{await new Promise(resolve=>setTimeout(resolve,5));assert.equal(adder.add(2,3),5);console.log("ASYNC_NODE_TEST_CONFIRMED");});',
  '__anvil_node_test_0.mjs':'throw Error("EXISTING_RUNNER_NAME_MUST_BE_PRESERVED");',
 };
 useIde.setState({files});
 assert.deepEqual(testFilesOf(files),['tests/async.test.mjs','tests/plain.test.cjs']);
 const before=JSON.stringify(files);
 const passed=await runAgentShell('node --test tests/plain.test.cjs',files);
 assert.equal(passed.ok,true,passed.stdout+'\n'+passed.stderr);assert.match(passed.stdout,/PLAIN_ASSERTIONS_CONFIRMED/);
 assert.equal(calls.length,1);assert.equal(calls[0].entry,'__anvil_node_test_1.mjs');assert.equal(calls[0].options.asTest,true);
 assert.equal(calls[0].files['tests/plain.test.cjs'],files['tests/plain.test.cjs']);
 assert.equal(calls[0].files['__anvil_node_test_0.mjs'],files['__anvil_node_test_0.mjs']);assert.equal(JSON.stringify(files),before);
 assert.ok(Object.values(useIde.getState().testResults).some(hit=>hit.path==='tests/plain.test.cjs'&&hit.ok&&!hit.skip));
 const incorrect={...files,'adder.cjs':'exports.add=(a,b)=>a-b;'};useIde.setState({files:incorrect});
 const failed=await runAgentShell('node --test tests/plain.test.cjs',incorrect);
 assert.equal(failed.ok,false);assert.match(failed.stdout,/ERR_ASSERTION|AssertionError/);assert.equal(incorrect['tests/plain.test.cjs'],files['tests/plain.test.cjs']);
 const guarded={...incorrect,'tests/guarded.test.cjs':'if(require.main===module){const assert=require("node:assert/strict"),{add}=require("../adder.cjs");assert.equal(add(2,3),5,"MAIN_ENTRY_ASSERTION_MUST_RUN");}'};
 useIde.setState({files:guarded});const mainGuard=await runAgentShell('node --test tests/guarded.test.cjs',guarded);
 assert.equal(mainGuard.ok,false,'Node --test must execute the real CJS entry guard, not import it into a passing parent test');
 assert.match(mainGuard.stdout,/MAIN_ENTRY_ASSERTION_MUST_RUN/);
 useIde.setState({files});const asynchronous=await runAgentShell('node --test tests/async.test.mjs',files);
 assert.equal(asynchronous.ok,true,asynchronous.stdout+'\n'+asynchronous.stderr);assert.match(asynchronous.stdout,/ASYNC_NODE_TEST_CONFIRMED/);
 assert.equal(calls.at(-1).files['tests/async.test.mjs'],files['tests/async.test.mjs'],'Existing async modules stay unmodified and execute with the real Node file runner');
 assert.doesNotMatch(calls.at(-1).files[calls.at(-1).entry], /await import\(/);
 // An agent draft can differ from the editor; execute that explicit snapshot,
 // and never attribute its proof to an unrelated live editor file map.
 useIde.setState({files,testResults:{}});const snapshotFailure=await runAgentShell('node --test tests/plain.test.cjs',incorrect);
 assert.equal(snapshotFailure.ok,false);assert.equal(calls.at(-1).files['adder.cjs'],incorrect['adder.cjs']);
 assert.deepEqual(useIde.getState().testResults,{});
 const npmSnapshot={'adder.cjs':incorrect['adder.cjs'],'tests/async.test.mjs':files['tests/async.test.mjs']};
 const npmFailure=await runAgentShell('npm test',npmSnapshot);
 assert.equal(npmFailure.ok,false);assert.match(npmFailure.stdout,/ERR_ASSERTION|AssertionError/);
 assert.equal(calls.at(-1).files['adder.cjs'],incorrect['adder.cjs'],'Existing agent test routes also use the confirmed snapshot');
 assert.deepEqual(useIde.getState().testResults,{});
 useIde.setState({files:{...files,'.env':'LOCAL_SECRET_NOT_SENT','.anvil/session.md':'Documentation-only update'},testResults:{}});
 const withPrivateEditorFiles=await runAgentShell('node --test tests/plain.test.cjs',files);
 assert.equal(withPrivateEditorFiles.ok,true,withPrivateEditorFiles.stderr);
 assert.equal(calls.at(-1).files['.env'],undefined,'Private editor files never enter the acknowledged test snapshot');
 useIde.setState({files:incorrect,testResults:{}});
 const olderGood=await runAgentShell('node --test tests/plain.test.cjs',files);
 assert.equal(olderGood.ok,false,'A good old snapshot cannot silently certify the different bad editor stand');
 assert.match(olderGood.stdout,/PLAIN_ASSERTIONS_CONFIRMED/);assert.match(olderGood.stderr,/Editor.*andere Inhalte.*nicht bestätigt/);
 assert.equal(calls.at(-1).files['adder.cjs'],files['adder.cjs']);assert.deepEqual(useIde.getState().testResults,{});
 useIde.setState({files,testResults:{}});
 const runBoundary=globalThis.__anvilNodeTestRun;
 globalThis.__anvilNodeTestRun=async(...args)=>{const result=await runBoundary(...args);useIde.setState({files:incorrect});return result;};
 const changedDuring=await runAgentShell('node --test tests/plain.test.cjs',files);
 assert.equal(changedDuring.ok,false);assert.match(changedDuring.stderr,/Editor während der Tests geändert/);
 assert.deepEqual(useIde.getState().testResults,{});globalThis.__anvilNodeTestRun=runBoundary;
 // The trusted runner starts a Node child; stopping the existing owner must
 // terminate that entire process tree, including the actual test file worker.
 const pidFile=join(root,'owned-node-test.pid');
 const waiting={'wait.test.cjs':`require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`};
 useIde.setState({files:waiting,testResults:{}});const controller=new AbortController();
 globalThis.__anvilNodeTestRun=async(entry,snapshot,options)=>{calls.push({entry,files:snapshot,options});return commands.execute({kind:'shell',command:'node '+JSON.stringify(entry)},{signal:controller.signal,files:snapshot});};
 const pending=runAgentShell('node --test wait.test.cjs',waiting);
 for(let i=0;i<500&&!existsSync(pidFile);i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.ok(existsSync(pidFile),'Owned Node file-test process started');const testPid=Number(readFileSync(pidFile,'utf8'));
 controller.abort();const stopped=await pending;assert.equal(stopped.ok,false);
 let childGone=false;for(let i=0;i<300&&!childGone;i++){try{process.kill(testPid,0);await new Promise(resolve=>setTimeout(resolve,10));}catch{childGone=true;}}
 assert.equal(childGone,true,'Cancellation removes the owned test child, not only its wrapper');
 globalThis.__anvilNodeTestRun=runBoundary;useIde.setState({files});
 const count=calls.length;
 for(const command of ['node --test','node --test tests/plain.test.cjs missing.test.cjs','node --test ../outside.test.cjs','node --test /outside.test.cjs','node --test --import setup.mjs tests/plain.test.cjs','node --test -e "process.exit(0)"']){
  const blocked=await runAgentShell(command,files);assert.equal(blocked.ok,false,command);
 }
 assert.equal(calls.length,count,'Invalid Node test requests cannot fall back to discovery or run a partial known subset');
});
