import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {previewInputFiles} from '../fixtures/preview-input-fixture.mjs';

const output=path.resolve('artifacts/preview-input-2026-10-30/browser');await mkdir(output,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0},cacheDir:'node_modules/.vite-preview-input',optimizeDeps:{noDiscovery:true,entries:[],include:['react','react-dom/client','zustand','zustand/middleware','ajv','ajv-formats','js-yaml']}});await server.listen();
const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
const checks=[],errors=[];let browser,exitCode=0;
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name);};
try{
  browser=await chromium.launch({executablePath:process.env.ANVIL_CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1600,height:1050}});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{if(window===window.top)localStorage.setItem('anvil-ide',JSON.stringify({state:{setupDone:true,autoUpdate:false,runInWindow:false,runPopout:false},version:0}));});
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/__preview_input')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Anvil Vorschautest</title><link rel="stylesheet" href="/src/styles.css"></head><body style="margin:0;background:#151515;color:#eee"><div id="root" style="height:98vh"></div></body></html>'});
    if(url.origin!==origin && !['data:','blob:'].includes(url.protocol))return route.abort();
    return route.continue();
  });
  await page.goto(origin+'/__preview_input',{waitUntil:'domcontentloaded'});
  await page.evaluate(async()=>{
    const refresh=(await import('/@react-refresh')).default;refresh.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    const {useIde}=await import('/src/store/ide.ts');await useIde.persist.rehydrate();window.__anvilIde=useIde;
    const {useBrain}=await import('/src/lib/brain/store.ts');useBrain.setState({on:false,autoLoad:false,autoUpdate:false,autonomy:'off'});
    const ReactMod=await import('/@id/react'),React=ReactMod.default||ReactMod;const client=await import('/@id/react-dom/client'),createRoot=client.createRoot||client.default?.createRoot;const {PreviewPane}=await import('/src/components/ide/preview-pane.tsx');
    createRoot(document.querySelector('#root')).render(React.createElement(PreviewPane));
  });console.log('QA preview component ready');
  await page.evaluate(files=>window.__anvilIde.setState({files,dirs:[],dirty:{},editBases:{},pendingDiffs:[],activePath:'index.html',runPath:'index.html',openPaths:['index.html'],previewOpen:true,runInWindow:false,runPopout:false,agentBusy:false,graphLoop:true,chat:[],agentJob:null}),previewInputFiles);
  const run=()=>page.evaluate(async()=>{const {runFile}=await import('/src/lib/run-client.ts');const s=window.__anvilIde.getState();return runFile('index.html',s.files);});
  const play=(actions=[],keys=[])=>page.evaluate(async({actions,keys})=>{const {playLoop}=await import('/src/lib/run-loop.ts');return playLoop(keys,0,undefined,actions);},{actions,keys});
  const guest=()=>page.frames().find(f=>f!==page.mainFrame()&&f.url()==='about:srcdoc');
  console.log('QA running artificial project');const firstRun=await Promise.race([run(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Preview test run timed out')),20000))]);assert.equal(firstRun.ok,true,firstRun.stderr);console.log('QA preview ready');await page.locator('iframe[title="Vorschau"]').waitFor();
  const loaded=await play([{type:'assert',selector:'#status',text:'Paused'}]);
  check('preview exposes usable selectors, values and viewport',loaded.ok && firstRun.observation?.elements.some(e=>e.selector==='#name'&&e.value==='Seed') && loaded.observation.elements.some(e=>e.selector==='#name' && e.value==='Seed'));
  const keys=await play([],['Space','s','u','r','Delete']);
  check('Space S U R Delete reach actual document listeners',keys.ok && await guest().evaluate(()=>[' ','s','u','r','Delete'].every(key=>window.fixture.keys.some(e=>e.key===key))&&!document.getElementById('item')));
  const click=await play([{type:'move',selector:'body'},{type:'click',selector:'#start'},{type:'assert',selector:'#status',text:'Paused'},{type:'click',selector:'#add',count:2},{type:'assert',selector:'#count',text:'2'}]);
  check('click and double-click change the app and satisfy expectations',click.ok && await guest().evaluate(()=>window.fixture.double===1));
  const text=await play([{type:'key',selector:'#name',key:'a',modifiers:['Control']},{type:'type',selector:'#name',text:'Grüße Test'},{type:'assert',selector:'#name',value:'Grüße Test'},
    {type:'key',key:'Backspace'},{type:'assert',selector:'#name',value:'Grüße Tes'},{type:'click',selector:'#agree'},{type:'assert',selector:'#agree',checked:true},{type:'key',key:'z',modifiers:['Control']}]);
  check('text selection, Unicode, delete, input/change, checkbox and modifiers work',text.ok && await guest().evaluate(()=>window.fixture.inputs>0&&window.fixture.changes>0&&window.fixture.ctrl===1));
  const moved=await play([{type:'move',selector:'#hover'},{type:'click',selector:'#drag',button:'right'}]);
  check('hover and context-menu handlers receive mouse input',moved.ok && await guest().evaluate(()=>window.fixture.hover>0&&window.fixture.right===1));
  const box=await guest().evaluate(()=>{const r=document.querySelector('#drag').getBoundingClientRect();return{x:r.x,y:r.y};});
  const drag=await play([{type:'drag',x:box.x+30,y:box.y+30,to_x:box.x+230,to_y:box.y+40,duration_ms:120},{type:'assert',selector:'#drag-result',text:'Released'}]);
  check('continuous drag reaches canvas and releases every button',drag.ok && await guest().evaluate(()=>window.fixture.moves>=5&&!window.fixture.dragging&&!window.fixtureControls.mouse.down));
  const scroll=await play([{type:'scroll',selector:'#scroll',delta_y:240},{type:'wait',ms:80}]);
  check('positive wheel delta scrolls down',scroll.ok && await guest().evaluate(()=>document.querySelector('#scroll').scrollTop>=100));
  const before=await guest().evaluate(()=>document.querySelector('#count').textContent);
  const wrong=await play([{type:'assert',selector:'#status',text:'IMPOSSIBLE'},{type:'click',selector:'#add'}]);
  check('a failed assertion stays failed and skips following mutations',!wrong.ok && wrong.input.completed===0 && await guest().evaluate(n=>document.querySelector('#count').textContent===n,before));
  for(const selector of ['#missing','button','#disabled','#hidden','#file','#file-label','#covered'])check('unsafe or ambiguous target rejected: '+selector,!(await play([{type:'click',selector}])).ok);
  check('out-of-preview coordinates are rejected',!(await play([{type:'click',x:16000,y:16000}])).ok);
  const after=await play([{type:'assert',selector:'#count',text:before}]);check('failed checks do not poison later valid observations',after.ok);
  const abort=await page.evaluate(async()=>{
    const {beginAgent,abortAgent}=await import('/src/lib/abort.ts');const {playLoop}=await import('/src/lib/run-loop.ts');
    beginAgent();window.__anvilIde.setState({agentBusy:true});const task=playLoop(['s','r'],1000);setTimeout(()=>abortAgent('preview QA abort'),120);
    const r=await task;window.__anvilIde.setState({agentBusy:false});beginAgent();return r;
  });
  check('Stop interrupts held input and releases keys',!abort.ok && await guest().evaluate(()=>window.fixture.held.length===0));
  const start=await play([{type:'click',selector:'#start'},{type:'assert',selector:'#status',text:'Running'}]);assert.equal(start.ok,true,start.error);
  await guest().evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(output,'desktop.png')});
  await page.setViewportSize({width:1000,height:800});await page.screenshot({path:path.join(output,'narrow.png')});
  check('no uncaught browser errors',errors.length===0);
  await writeFile(path.join(output,'result.json'),JSON.stringify({ok:true,checks,errors},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,output}));
}catch(error){exitCode=1;await writeFile(path.join(output,'result.json'),JSON.stringify({ok:false,error:error.stack,checks,errors},null,2));console.error(error);}
finally{await browser?.close();let timer;try{await Promise.race([server.close(),new Promise(resolve=>timer=setTimeout(resolve,3000))]);}finally{clearTimeout(timer);}}
// The dev config owns SSR helpers outside Vite's HTTP lifecycle. This finite QA
// process owns those helpers; it must not leave a watcher running after cleanup.
process.exit(exitCode);
