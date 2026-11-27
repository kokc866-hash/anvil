/** Real foreground Canvas owner with an isolated Chromium capture adapter. No model or profile access. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = resolve('artifacts/completion-plan-preview-2026-10-29/preview/foreground');
mkdirSync(root, { recursive: true });
const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { '@': resolve('src') } }, server: { host: '127.0.0.1', port: 0, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
server.middlewares.use((req,res,next)=>{
 if(req.url !== '/__preview-readiness'){next();return;}
 res.setHeader('Content-Type','text/html');
 res.end('<!doctype html><html><head><style>body{margin:0}iframe{width:640px;height:400px;border:0}</style></head><body><iframe id="frame" sandbox="allow-scripts"></iframe></body></html>');
});
await server.listen();
const address=server.httpServer.address();
let browser, captureMode='', captures=0;
const outcomes=[];
try {
 browser=await chromium.launch({ executablePath: process.env.ANVIL_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless:true });
 const page=await browser.newPage({viewport:{width:1100,height:800}});
 const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.exposeFunction('nativeCapture',async rect=>{
  captures++;
  if(captureMode==='resize'&&captures===1)await page.evaluate(()=>{document.querySelector('#frame').style.width='420px';});
  if(captureMode==='delay')await new Promise(r=>setTimeout(r,250));
  const bytes=await page.screenshot({clip:rect});
  return 'data:image/png;base64,'+bytes.toString('base64');
 });
 await page.goto('http://127.0.0.1:'+address.port+'/__preview-readiness', { timeout: 10000 });
 await page.evaluate(async()=>{
  const {registerCanvasFrame}=await import('/src/lib/canvas/session.ts');
  const {withEngine}=await import('/src/lib/game-host.ts');
  window.withEngine=withEngine;
  window.registerCanvasFrame=registerCanvasFrame;
  window.owner=registerCanvasFrame(document.querySelector('#frame'),{scope:'isolated-readiness',capture:window.nativeCapture});
 });
 const delayed='<!doctype html><html><body><h1 id="data">SHELL</h1><script type="module">await new Promise(r=>setTimeout(r,350));document.querySelector("#data").textContent="FOREGROUND_READY";</script></body></html>';
 const ready=await page.evaluate(async html=>{const result=await window.owner.load(window.withEngine(html));return{ok:result.ok,state:result.state};},delayed);
 assert.equal(ready.ok,true);
 assert.equal(await page.frameLocator('iframe').locator('#data').innerText(),'FOREGROUND_READY');
 const shot=await page.evaluate(()=>window.owner.command('shot'));
 assert.equal(shot.ok,true);
 assert.equal(shot.readiness.state,'settled');
 writeFileSync(resolve(root,'delayed-foreground.png'),Buffer.from(shot.image.split(',')[1],'base64'));
 outcomes.push('foreground owner waits for async module before first native capture');
 captureMode='resize';captures=0;
 const resize=await page.evaluate(()=>window.owner.command('shot'));
 assert.equal(resize.ok,true);
 assert.equal(resize.w,420);
 assert.ok(captures>=2,'a resize during capture must retry with the new rectangle');
 outcomes.push('foreground rectangle change invalidates the first native image and retries');
 captureMode='delay';captures=0;
 const cancelled=await page.evaluate(async()=>{
  const controller=new AbortController();
  const result=window.owner.command('shot',{},controller.signal).then(()=>({ok:true}),error=>({error:String(error)}));
  setTimeout(()=>controller.abort(),80);
  return result;
 });
 assert.match(cancelled.error,/Abgebrochen|Abort/);
 outcomes.push('aborted native capture cannot return a successful image');
 const replaced=await page.evaluate(async()=>{
  const result=window.owner.command('shot').then(()=>({ok:true}),error=>({error:String(error)}));
  setTimeout(()=>{void window.owner.load(window.withEngine('<!doctype html><html><body>NEW_GENERATION</body></html>'));},80);
  return result;
 });
 assert.match(replaced.error,/ersetzt/);
 outcomes.push('native capture of an old document is rejected after replacement');
 await page.evaluate(()=>window.owner.command('ready'));
 const raster = await page.evaluate(async html => {
  window.owner.dispose();
  window.owner=window.registerCanvasFrame(document.querySelector('#frame'),{scope:'isolated-raster-readiness'});
  await window.owner.load(window.withEngine(html));
  return window.owner.command('shot');
 }, delayed);
 assert.equal(raster.ok,true,raster.error);
 assert.equal(raster.readiness.state,'settled');
 assert.match(raster.image,/^data:image\/png;base64,/);
 const pixels = await page.evaluate(async source => {
  const image = new Image(); image.src = source; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  let transparent=0,dark=0,white=0;
  for(let i=0;i<data.length;i+=4){if(data[i+3]!==255)transparent++;if(data[i]<80&&data[i+1]<80&&data[i+2]<80)dark++;if(data[i]>240&&data[i+1]>240&&data[i+2]>240)white++;}
  return{transparent,dark,white};
 },raster.image);
 assert.equal(pixels.transparent,0,'raster must carry opaque paper instead of invisible black text');
 assert.ok(pixels.dark>100&&pixels.white>1000,'black content and white paper must both be visible');
 outcomes.push('browser-only raster capture uses the same readiness gate');
 outcomes.push('real SVG-raster pixels preserve opaque default paper and readable black content');
 writeFileSync(resolve(root,'raster-foreground.png'),Buffer.from(raster.image.split(',')[1],'base64'));
 const colored=await page.evaluate(async()=>{
  await window.owner.load(window.withEngine('<!doctype html><html><body style="margin:0;background:#123456;color:white"><h1>COLORED_PAPER</h1></body></html>'));
  return window.owner.command('shot');
 });
 assert.equal(colored.ok,true,colored.error);
 const paperPixel=await page.evaluate(async source=>{const image=new Image();image.src=source;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return[...ctx.getImageData(image.width-2,image.height-2,1,1).data];},colored.image);
 assert.deepEqual(paperPixel,[18,52,86,255]);
 outcomes.push('raster respects the actual body paper color');
 writeFileSync(resolve(root,'raster-colored-paper.png'),Buffer.from(colored.image.split(',')[1],'base64'));
 assert.equal(errors.length,0,errors.join('\n'));
 await page.screenshot({path:resolve(root,'host-after-replacement.png')});
 writeFileSync(resolve(root,'result.json'),JSON.stringify({ok:true,outcomes,errors},null,2));
 console.log(JSON.stringify({ok:true,outcomes},null,2));
} catch(error) {
 writeFileSync(resolve(root,'result.json'),JSON.stringify({ok:false,error:error.stack,outcomes},null,2));
 throw error;
} finally {await browser?.close();await server.close();}

