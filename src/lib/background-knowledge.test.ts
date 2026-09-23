import assert from 'node:assert/strict';
import {test} from 'node:test';
import path from 'node:path';
import {createServer} from 'vite';
import {knowledgeVersion} from '../../electron/agent-knowledge-state.mjs';

test('renderer knowledge reconciliation persists event IDs and preserves concurrent edits and other projects',async t=>{
 const server=await createServer({configFile:false,root:process.cwd(),resolve:{alias:{'@':path.resolve('src')}},ssr:{external:['react','react-dom','zustand','js-yaml']},optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});t.after(()=>server.close());
 const {useIde}=await server.ssrLoadModule('/src/store/ide.ts');
 const {useLearn,LEARN_DEFAULTS}=await server.ssrLoadModule('/src/lib/learn.ts');
 const {applyBackgroundKnowledge}=await server.ssrLoadModule('/src/lib/background-knowledge.ts');
 const warnings=console.warn;console.warn=(...args:unknown[])=>{if(!String(args[0]).startsWith('[zustand persist middleware]'))warnings(...args);};t.after(()=>{console.warn=warnings;});
 useIde.setState({workspaceCwd:'I:/knowledge-qa',workspaceEpoch:1,files:{},dirty:{}});
 useLearn.setState({on:true,prefs:{...LEARN_DEFAULTS},facts:[],skills:[],forgotten:[],forgottenFacts:[],backgroundKnowledgeEvents:[]});
 const fact={id:'fact-one',kind:'user',scope:'user',text:'Concise answers',conf:.85,hits:1,at:1};
 const event={id:'event-one',jobId:'job',project:'I:/knowledge-qa',workspace:'v2:path:i:/knowledge-qa',collection:'facts',recordId:fact.id,before:null,beforeVersion:null,after:fact,action:'add',at:1};
 assert.equal(applyBackgroundKnowledge([event]).applied,1);assert.equal(useLearn.getState().facts.length,1);
 assert.equal(applyBackgroundKnowledge([event]).applied,0);assert.equal(useLearn.getState().facts[0].hits,1);
 // Persisted applied ids protect removal against redelivery after reload.
 const saved=JSON.parse(JSON.stringify({facts:useLearn.getState().facts,backgroundKnowledgeEvents:useLearn.getState().backgroundKnowledgeEvents}));
 useLearn.setState({...saved,facts:[]});assert.equal(applyBackgroundKnowledge([event]).applied,0);assert.equal(useLearn.getState().facts.length,0);
 const newer={...event,id:'event-two',before:fact,beforeVersion:knowledgeVersion(fact),after:{...fact,text:'Agent changed text'}};
 useLearn.setState({facts:[{...fact,text:'User changed text'}]});assert.deepEqual(applyBackgroundKnowledge([newer]).conflicts,['fact-one']);assert.equal(useLearn.getState().facts[0].text,'User changed text');
 const foreign={...event,id:'foreign-event',recordId:'foreign',after:{...fact,id:'foreign',scope:'project',ws:'v2:path:i:/other'},workspace:'v2:path:i:/other'};
 assert.equal(applyBackgroundKnowledge([foreign]).applied,0);assert.ok(!useLearn.getState().backgroundKnowledgeEvents.includes('foreign-event'));
 useIde.setState({workspaceCwd:'I:/other'});assert.equal(applyBackgroundKnowledge([foreign]).applied,1);
});
