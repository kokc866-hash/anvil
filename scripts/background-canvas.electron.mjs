import { app } from 'electron';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentPreview } from '../electron/agent-preview.mjs';
import { previewInputFiles } from '../fixtures/preview-input-fixture.mjs';

const root = process.env.ANVIL_CANVAS_QA_ROOT;
mkdirSync(join(root, 'profile'), { recursive: true });
app.setPath('userData', join(root, 'profile'));
app.on('window-all-closed', () => {});
const outcomes = [];
app.whenReady().then(async () => {
 const runtimeUrl = pathToFileURL(join(root, 'agent-build', 'preview-runtime.mjs'));
 const { withEngine } = await import(runtimeUrl);
 const preview = new AgentPreview({ runtimeUrl });
 const signal = new AbortController().signal;
 const html = `<!doctype html><html><head><title>Canvas background QA</title><script>window.order=[typeof Anvil.run];</script><script src="./early.js"></script><link rel="stylesheet" href="./style.css"></head><body><h1>Canvas background QA</h1><p id="status">Waiting</p><script type="module" src="./game.mjs"></script></body></html>`;
 const files = {
  'world/index.html': html,
  'world/early.js': 'window.order.push("early:"+typeof Anvil.create);',
  'world/style.css': 'body{margin:24px;background:#132036;color:#fff;font:20px system-ui}canvas{border:2px solid #71e8be}',
  'world/settings.mjs': 'export const color="#71e8be";',
  'world/game.mjs': `import {color} from './settings.mjs';window.order.push('module:'+typeof Anvil.run);window.moves=0;window.game=Anvil.run({width:320,height:180,pixel:true,fit:'none',update(){if(this.input.left)window.moves++;},draw(){this.ctx.fillStyle=color;this.ctx.fillRect(30,30,90,70);}});document.getElementById('status').textContent='GAME_READY';`,
 };
 const until = async fn => { for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw new Error('Canvas condition timed out'); };
 const evaluate = script => preview.window.webContents.executeJavaScript(script);
 async function start(project = files, map) {
  const result = await preview.run('world/index.html', project, signal, true, map);
  await until(() => evaluate('window.game?.state === "running" || window.game?.state === "failed"'));
  return result;
 }
 try {
  await start();
  const loaded = await preview.see(true);
  assert.equal(loaded.ok,true,loaded.stderr);
  assert.match(loaded.stdout,/GAME_READY/);
  assert.equal(loaded.state.canvas.state,'running');
  assert.deepEqual(await evaluate('window.order'),['function','early:function','module:function']);
  assert.deepEqual(await evaluate('[typeof require,typeof process,typeof window.anvilNative]'),['undefined','undefined','undefined']);
  assert.match(loaded.image,/^data:image\/jpeg;base64,/);
  writeFileSync(join(root,'canvas-default.jpg'),Buffer.from(loaded.image.split(',')[1],'base64'));
  await preview.play(['left'],150,signal);
  assert.ok(await evaluate('window.moves>0'),'default arrow binding moves game');
  outcomes.push('bundled engine precedes classic and module scripts; relative imports, screenshot, default keys and sandbox verified');

  await evaluate(`window.testKeys=[];window.addEventListener('keydown',event=>window.testKeys.push(event.key));`);
  await preview.play(['Space','s','u','r','Delete'],20,signal);
  assert.deepEqual(await evaluate('window.testKeys'),[' ','s','u','r','Delete']);
  outcomes.push('application shortcuts include Space, S, U, R and Delete');

  await start({...files,'world/index.html':withEngine(withEngine(html))},{left:{keys:['q'],pad:[]}});
  assert.equal(await evaluate('document.querySelectorAll("script[data-anvil-engine]").length'),1);
  assert.equal(await evaluate('document.querySelectorAll("script[data-anvil-map]").length'),1);
  await preview.play(['a'],100,signal);
  assert.equal(await evaluate('window.moves'),0,'custom mapping replaces old default');
  await preview.play(['q'],150,signal);
  assert.ok(await evaluate('window.moves>0'),'custom binding reaches engine');
  await evaluate('window.moves=0');
  await preview.play(['left'],150,signal);
  assert.ok(await evaluate('window.moves>0'),'semantic play action follows configured binding');
  outcomes.push('repeated bootstrap injects once and custom input replaces prior map');

  await preview.run('index.html',previewInputFiles,signal,true);
  // The visible midpoint of the body can hit the file picker on smaller viewports.
  const clicked=await preview.play([],0,signal,[{type:'move',selector:'h1'},{type:'click',selector:'#start'},{type:'assert',selector:'#status',text:'Running'}]);
  assert.equal(clicked.ok,true,clicked.error);assert.equal(clicked.functionalChecks,true);assert.equal(clicked.input.assertions,1);
  assert.equal(clicked.input.completed,3);
  assert.ok(clicked.state.elements.find(e=>e.selector==='#start' && e.rect.width>0));
  assert.equal(clicked.input.mode,'native-preview');
  assert.equal(await evaluate('Object.isFrozen(__ANVIL_PREVIEW__) && Object.isFrozen(__ANVIL_PREVIEW__.input)'),true);
  outcomes.push('native preview click plus explicit DOM expectation and discoverable selectors');

  const typed=await preview.play([],0,signal,[{type:'key',selector:'#name',key:'a',modifiers:['Control']},{type:'type',selector:'#name',text:'Grüße Test'},{type:'assert',selector:'#name',value:'Grüße Test'},
    {type:'click',selector:'#agree'},{type:'assert',selector:'#agree',checked:true},{type:'key',key:'z',modifiers:['Control']}]);
  assert.equal(typed.ok,true,typed.error);assert.ok(await evaluate('fixture.inputs>0 && fixture.changes>0 && fixture.ctrl===1'));
  outcomes.push('explicit Unicode text, real input/change, checkbox and Control+Z reach the preview');

  const mouse=await preview.play([],0,signal,[{type:'click',selector:'#add',count:2},{type:'assert',selector:'#count',text:'2'},
    {type:'move',selector:'#hover'},{type:'click',selector:'#drag',button:'right'}]);
  assert.equal(mouse.ok,true,mouse.error);assert.ok(await evaluate('fixture.double===1 && fixture.hover>0 && fixture.right===1'));
  const rect=await evaluate('(()=>{const r=document.getElementById("drag").getBoundingClientRect();return {x:r.x,y:r.y};})()');
  const dragged=await preview.play([],0,signal,[{type:'drag',x:rect.x+30,y:rect.y+30,to_x:rect.x+260,to_y:rect.y+40,duration_ms:150},{type:'assert',selector:'#drag-result',text:'Released'}]);
  assert.equal(dragged.ok,true,dragged.error);assert.ok(await evaluate('fixture.moves>=5 && fixtureControls.mouse.down===false && fixture.dragging===false'));
  outcomes.push('double-click, hover, right-click and continuous pointer drag release correctly');

  const scrolled=await preview.play([],0,signal,[{type:'scroll',selector:'#scroll',delta_y:240},{type:'wait',ms:120}]);
  assert.equal(scrolled.ok,true,scrolled.error);
  const scrollState=await evaluate(`(()=>{const e=document.getElementById('scroll'),r=e.getBoundingClientRect();return {top:e.scrollTop,windowY:scrollY,viewport:[innerWidth,innerHeight],rect:[r.x,r.y,r.width,r.height]};})()`);
  assert.ok(scrollState.top>=100,JSON.stringify({...scrollState,focused:preview.window.isFocused(),zoom:preview.window.webContents.getZoomFactor()}));
  const before=await evaluate('document.getElementById("count").textContent');
  const wrong=await preview.play([],0,signal,[{type:'assert',selector:'#status',text:'IMPOSSIBLE'},{type:'click',selector:'#add'}]);
  assert.equal(wrong.ok,false);assert.equal(wrong.functionalChecks,false);assert.equal(wrong.input.completed,0);
  assert.match(wrong.error,/IMPOSSIBLE/);
  assert.match(wrong.error,/Running/);
  assert.equal(await evaluate('document.getElementById("count").textContent'),before);
  for (const selector of ['#missing','button','#disabled','#hidden','#file','#file-label','#covered']) {
    const blocked=await preview.play([],0,signal,[{type:'click',selector}]);assert.equal(blocked.ok,false,selector);
  }
  outcomes.push('scroll works; failed expectations and missing/ambiguous/disabled/file targets stop without later clicks');
  const deletion=await preview.play(['Delete'],0,signal,[{type:'assert',selector:'#item',count:0}]);
  assert.equal(deletion.ok,true,deletion.error);assert.equal(await evaluate('fixture.held.length'),0);
  const screenshot=await preview.see(true);writeFileSync(join(root,'preview-input.jpg'),Buffer.from(screenshot.image.split(',')[1],'base64'));
  outcomes.push('Delete performs its actual application action and the result is checked');

  const inFlight=preview.play(['s','r'],1000,signal).then(result=>({result}),error=>({error:String(error)}));
  await until(()=>evaluate('fixture.held.includes("s")'));
  await preview.run('index.html',previewInputFiles,signal,false);
  const replaced=await inFlight;
  assert.match(replaced.error,/ersetzt|beendet/);
  assert.deepEqual(await evaluate('fixture.keys'),[]);
  outcomes.push('replacing a preview during held input cannot deliver remaining keys to the new document');

  const observationFiles = {'index.html':'<!doctype html><html><body><button id="transport">Transport</button><output id="completed">0</output><p id="robot" role="status">R1 wartet</p><label><input id="enabled" type="checkbox" checked>Aktiv</label><input id="password" type="password" value="QA_PASSWORD_MUST_NOT_APPEAR"><div hidden role="status" id="private-state">Hidden value</div><div id="empty"></div><script>document.getElementById("transport").onclick=()=>{document.getElementById("completed").textContent="1";document.getElementById("robot").textContent="R1 am Ziel";};</script></body></html>'};
  observationFiles['index.html']=observationFiles['index.html'].replace('<output',Array.from({length:90},(_,i)=>`<p id="decoration-${i}">Label ${i}</p>`).join('')+'<output');
  const observed = await preview.run('index.html',observationFiles,signal,false);
  assert.equal(observed.state.observationsTruncated,true);
  assert.ok(observed.state.observations.length<=64);
  assert.ok(observed.state.elements.some(e=>e.selector==='#enabled' && e.checked===true));
  assert.ok(observed.state.observations.some(e=>e.selector==='#completed' && e.text==='0'));
  assert.ok(observed.state.observations.some(e=>e.selector==='#robot' && e.text==='R1 wartet'));
  assert.ok(!JSON.stringify(observed.state).includes('QA_PASSWORD_MUST_NOT_APPEAR'));
  assert.ok(!observed.state.observations.some(e=>e.selector==='#private-state'));
  assert.ok(!observed.state.observations.some(e=>e.selector==='#empty'));
  const transported = await preview.play([],0,signal,[{type:'click',selector:'#transport'},{type:'assert',selector:'#completed',text:'1'},{type:'assert',selector:'#robot',text:'R1 am Ziel'}]);
  assert.equal(transported.ok,true,transported.error);assert.equal(transported.functionalChecks,true);
  assert.ok(transported.state.observations.some(e=>e.selector==='#completed' && e.text==='1'));
  const unchecked = await preview.play([],0,signal,[{type:'click',selector:'#enabled'}]);
  assert.equal(unchecked.functionalChecks,false);assert.match(unchecked.note,/keine.*Ergebniserwartung/i);
  assert.ok(unchecked.state.elements.some(e=>e.selector==='#enabled' && e.checked===false));
  outcomes.push('discoverable status/output targets, actual checkbox state and meaningful expected/actual diagnostics support a real transport test without leaking password fields');

  await start({...files,'world/game.mjs':files['world/game.mjs'].replace('if(this.input.left)window.moves++;','throw new Error("CANVAS_UPDATE_FAILURE");')});
  await until(()=>evaluate('window.game.state === "failed"'));
  const failed=await preview.see(false);
  assert.equal(failed.ok,false);assert.match(failed.stderr,/CANVAS_UPDATE_FAILURE/);
  outcomes.push('internally caught canvas update failure reaches tool result');

  await start({...files,'world/early.js':'throw new Error("CLASSIC_SCRIPT_FAILURE")'});
  const scriptFailure=await preview.see(false);
  assert.equal(scriptFailure.ok,false);assert.match(scriptFailure.stderr,/CLASSIC_SCRIPT_FAILURE/);
  outcomes.push('project console errors cannot become successful preview');

  await start({...files,'world/index.html':html.replace('</head>','<script src="https://example.invalid/outside.js"></script></head>')});
  const blocked=await preview.see(false);
  assert.equal(blocked.ok,false);assert.match(blocked.stderr,/blockiert|Content Security Policy|Content-Security-Policy/i);
  outcomes.push('external resources remain blocked');
  writeFileSync(join(root,'result.json'),JSON.stringify({ok:true,outcomes},null,2));
  preview.close();app.exit(0);
 } catch(error) {
  writeFileSync(join(root,'result.json'),JSON.stringify({ok:false,error:error.stack,outcomes},null,2));
  preview.close();app.exit(1);
 }
});
