import { app } from 'electron';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentPreview } from '../electron/agent-preview.mjs';

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
