import { app, nativeImage } from 'electron';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentPreview } from '../electron/agent-preview.mjs';

const root = process.env.ANVIL_PREVIEW_QA_ROOT;
if (!root) throw Error('ANVIL_PREVIEW_QA_ROOT missing');
mkdirSync(join(root, 'profile'), { recursive: true });
app.setPath('userData', join(root, 'profile'));
app.on('window-all-closed', () => {});
const outcomes = [];
app.whenReady().then(async () => {
 const runtimeUrl = pathToFileURL(join(root, 'preview-runtime.mjs'));
 const preview = new AgentPreview({ runtimeUrl, show: false });
 const signal = new AbortController().signal;
 const html = '<!doctype html><html><head><title>Readiness QA</title><style>body{margin:0;background:#c00000;color:white;font:28px system-ui}</style><script>window.trace=[];document.addEventListener("load",e=>trace.push(e.target.tagName+":load"),true);window.addEventListener("load",()=>trace.push("window:load"));</script></head><body><h1 id="data">SHELL</h1><script type="module">await new Promise(resolve=>setTimeout(resolve,350));document.body.style.background="#00a000";document.querySelector("#data").textContent="DATA_READY";trace.push("module:complete");</script></body></html>';
 try {
   let result = await preview.run('index.html', { 'index.html': html }, signal, false);
   assert.equal(result.ok, true, result.stderr || result.error);
   writeFileSync(join(root, 'first-result.json'), JSON.stringify(result, null, 2));
   writeFileSync(join(root, 'script-order.json'), JSON.stringify(await preview.window.webContents.executeJavaScript('window.trace'), null, 2));
   assert.match(result.stdout, /DATA_READY/, 'first tool result must contain delayed module data');
   result = await preview.see(true);
   assert.match(result.image || '', /^data:image\/jpeg;base64,/);
   const image = nativeImage.createFromDataURL(result.image), { width, height } = image.getSize();
   const pixel = image.toBitmap().subarray(((Math.floor(height * 0.7) * width) + Math.floor(width * 0.7)) * 4);
   assert.ok(pixel[1] > pixel[2] + 40, 'captured compositor frame must match green ready DOM, not initial red shell');
   writeFileSync(join(root, 'delayed-ready.jpg'), Buffer.from(result.image.split(',')[1], 'base64'));
   outcomes.push('first background result waits for delayed module DOM and captures its actual painted frame');
   const delayedAt = Date.now();
   const delayedThreeSeconds = await preview.run('index.html', { 'index.html': html.replace('resolve,350', 'resolve,3000') }, signal, true);
   assert.equal(delayedThreeSeconds.ok, true, delayedThreeSeconds.stderr);
   assert.match(delayedThreeSeconds.stdout, /DATA_READY/);
   assert.ok(Date.now() - delayedAt >= 2900 && Date.now() - delayedAt < 6500);
   writeFileSync(join(root, 'delayed-3s-ready.jpg'), Buffer.from(delayedThreeSeconds.image.split(',')[1], 'base64'));
   outcomes.push('initial module work lasting three seconds is awaited within the actual six-second budget');
   const imageFiles = {
     'index.html': '<!doctype html><html><body><h1 id="data">SHELL</h1><script type="module">const data=await fetch("payload.json").then(r=>r.json());await new Promise(r=>setTimeout(r,180));const image=new Image();image.src="image.svg";document.body.append(image);document.querySelector("#data").textContent=data.text;</script></body></html>',
     'payload.json': JSON.stringify({ text: 'FETCH_READY' }),
     'image.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="green"/></svg>',
   };
   const fetched = await preview.run('index.html', imageFiles, signal, true);
   assert.equal(fetched.ok, true, fetched.stderr);
   assert.match(fetched.stdout, /FETCH_READY/);
   assert.equal(await preview.window.webContents.executeJavaScript('document.images[0].naturalWidth'), 40);
   outcomes.push('initial fetch and dynamically added image complete before first capture');

   const targetViewport = { width: 880, height: 620 };
   assert.notDeepEqual(fetched.state.viewport, targetViewport, 'the resize must change the viewport');
   preview.window.setContentSize(targetViewport.width, targetViewport.height);
   const resized = await preview.see(true);
   assert.equal(resized.ok, true, resized.stderr);
   const resizedImage = nativeImage.createFromDataURL(resized.image).getSize();
   assert.deepEqual(resized.state.viewport, targetViewport);
   assert.equal(resized.state.capture.width, targetViewport.width);
   assert.equal(resized.state.capture.height, targetViewport.height);
   assert.ok(Math.abs(resizedImage.height - resizedImage.width * resized.state.capture.height / resized.state.capture.width) <= 2, 'image aspect follows current viewport, including DPI scaling');
   outcomes.push('resize before capture yields matching DOM viewport and real image dimensions');

   const blank = await preview.run('index.html', { 'index.html': '<!doctype html><html><body></body></html>' }, signal, true);
   assert.equal(blank.ok, true, blank.stderr);
   assert.equal(blank.stdout, '');
   assert.ok(blank.image);
   outcomes.push('a legitimate empty page remains capturable');

   const animated = '<!doctype html><html><body><b id="counter"></b><script>let n=0;function draw(){document.querySelector("b").textContent=String(n++);requestAnimationFrame(draw);}draw();</script></body></html>';
   const animatedAt = Date.now();
   const live = await preview.run('index.html', { 'index.html': animated }, signal, true);
   assert.equal(live.ok, true, live.stderr);
   assert.equal(live.readiness.state, 'live');
   assert.ok(Date.now() - animatedAt < 6500, 'continuous DOM animation is bounded');
   assert.match(live.note, /einzelnen Zeitpunkt/);
   outcomes.push('continuous DOM animation returns an explicitly labelled live frame within the bound');

   const missing = await preview.run('index.html', { 'index.html': '<!doctype html><html><body><img src="missing.png"></body></html>' }, signal, true);
   assert.equal(missing.ok, false);
   assert.match(missing.error || missing.stderr, /Bild|Datei|404|geladen/);
   assert.equal(missing.image, undefined);
   outcomes.push('failed image/resource never produces a successful capture');

   const futureTimer = '<!doctype html><html><body>ALREADY_READY<script>window.future=0;setTimeout(()=>window.future++,30000);let fired=0;const cancelled=setTimeout(()=>{fired++;},200);clearInterval(cancelled);const interval=setInterval(()=>{fired++;},30);clearTimeout(interval);window.testFired=()=>fired;</script></body></html>';
   const futureAt = Date.now();
   const immediate = await preview.run('index.html', { 'index.html': futureTimer }, signal, true);
   assert.equal(immediate.ok, true, immediate.stderr);
   assert.match(immediate.stdout, /ALREADY_READY/);
   assert.ok(Date.now() - futureAt < 3000, 'a background timer must not delay readiness');
   assert.equal(await preview.window.webContents.executeJavaScript('window.future+window.testFired()'), 0);
   outcomes.push('long background timers do not block; interchangeable clearTimeout/clearInterval semantics remain intact');

   const timerAnimation = '<!doctype html><html><body><b></b><script>let n=0;function draw(){document.querySelector("b").textContent=String(n++);setTimeout(draw,60);}draw();</script></body></html>';
   const timerLive = await preview.run('index.html', { 'index.html': timerAnimation }, signal, true);
   assert.equal(timerLive.ok, true, timerLive.stderr);
   assert.equal(timerLive.readiness.state, 'live');
   outcomes.push('self-rescheduling timers reach bounded live capture rather than initialisation failure');

   const slow = '<!doctype html><html><body aria-busy="true">SHELL<script type="module">await new Promise(r=>setTimeout(r,10000));document.body.removeAttribute("aria-busy");document.body.textContent="TOO_LATE";</script></body></html>';
   const timedAt = Date.now();
   const incomplete = await preview.run('index.html', { 'index.html': slow }, signal, true);
   assert.equal(incomplete.ok, false);
   assert.match(incomplete.error || incomplete.stderr, /vorbereitet|bereit|Initialisierung/);
   assert.equal(incomplete.image, undefined);
   assert.ok(Date.now() - timedAt < 9000);
   outcomes.push('unfinished initial async work fails honestly within a finite deadline');

   const abort = new AbortController();
   const abortedAt = Date.now();
   const aborting = preview.run('index.html', { 'index.html': slow }, abort.signal, true);
   setTimeout(() => abort.abort(new Error('TEST_ABORT')), 120);
   await assert.rejects(aborting);
   assert.ok(Date.now() - abortedAt < 2200);
   outcomes.push('abort during preparation terminates without an image or delayed success');

   const old = preview.run('index.html', { 'index.html': slow }, signal, true);
   const oldOutcome = old.then(value => ({ value }), error => ({ error }));
   await new Promise(resolve => setTimeout(resolve, 120));
   const replacement = await preview.run('index.html', { 'index.html': '<!doctype html><html><body>REPLACEMENT_READY</body></html>' }, signal, true);
   assert.equal(replacement.ok, true, replacement.stderr);
   assert.match(replacement.stdout, /REPLACEMENT_READY/);
   assert.ok((await oldOutcome).error, 'superseded run must reject');
   outcomes.push('replacement rejects the previous generation and only returns the replacement frame');
   writeFileSync(join(root, 'result.json'), JSON.stringify({ ok: true, outcomes }, null, 2));
   preview.close(); app.exit(0);
 } catch (error) {
   writeFileSync(join(root, 'result.json'), JSON.stringify({ ok: false, error: error.stack, outcomes }, null, 2));
   preview.close(); app.exit(1);
 }
});

