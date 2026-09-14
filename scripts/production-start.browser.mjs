import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { _electron } from "playwright";

const output = path.resolve("artifacts/production-start"); await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, "profile-"));
const socket = createServer(); await new Promise(r => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port; await new Promise(r => socket.close(r));
const url = `http://127.0.0.1:${port}/`;
const env = { ...process.env, ANVIL_DESKTOP_MODE: "production", ANVIL_PORT: String(port), ANVIL_QA_USER_DATA: profile, ANVIL_HOME: path.join(profile, "packages") };
delete env.ELECTRON_RUN_AS_NODE;
let app, watcher;
const timeout = setTimeout(() => { app?.process()?.kill(); process.exitCode = 1; }, 90000);
try {
  // No prestarted server: production main must start its own bundled UI.
  app = await _electron.launch({ args: [path.resolve("fixtures/electron-boot.mjs")], env });
  let page;
  for (let i=0; i<240; i++) {
    page = app.windows().find(p => p.url() === url);
    if (page) break;
    await new Promise(r=>setTimeout(r,250));
  }
  assert(page); await page.waitForFunction(() => window.__anvilIde?.persist.hasHydrated());
  const errors=[]; page.on("pageerror", e=>errors.push(e.message));
  await page.evaluate(async () => {
    const store=window.__anvilIde;
    store.setState({setupDone:true,autoUpdate:false,files:{"test.txt":"Production test"},dirty:{},workspaceCwd:""});
    store.getState().startAssistant();
    for(let i=0;i<200;i++) { store.getState().appendAssistant("Testausgabe "); await new Promise(r=>setTimeout(r,10)); }
  });
  const state=await page.evaluate(()=>({
    visible:document.body.innerText.length,
    vite:document.querySelector('script[src*="@vite/client"]')!==null,
    reactTracks:performance.getEntriesByType("measure").filter(m=>m.detail?.devtools?.track?.includes("Components")).length,
    text:window.__anvilIde.getState().chat.at(-1).content?.length,
  }));
  assert(state.visible>100); assert.equal(state.vite,false); assert.equal(state.reactTracks,0);
  assert.deepEqual(errors,[]);
  assert.match(await readFile(path.join(profile,"anvil-desktop.log"),"utf8"),/desktop-mode production/);
  for(let i=0;i<120;i++) {
    const runs=await readdir(path.join(profile,"waechter")).catch(()=>[]);
    watcher=runs[0]&&path.join(profile,"waechter",runs[0]);
    const summary=watcher&&await readFile(path.join(watcher,"summary.json"),"utf8").then(JSON.parse).catch(()=>null);
    if(summary?.samples>0&&!summary.ended)break;
    await new Promise(r=>setTimeout(r,250));
  }
  const summary=JSON.parse(await readFile(path.join(watcher,"summary.json"),"utf8"));
  assert(summary.samples>0&&!summary.ended);
  assert.equal(JSON.parse(await readFile(path.join(watcher,"config.json"),"utf8")).mode,"production");
  await page.screenshot({path:path.join(output,"production.png")});
  await writeFile(path.join(output,"result.json"),JSON.stringify({ok:true,...state,watcherRunning:true},null,2));
  console.log("PRODUCTION_START_WITHOUT_VITE_OR_REACT_TRACKS_OK");
} finally {
  clearTimeout(timeout);
  if(app) await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
  if(watcher) await writeFile(path.join(watcher,"stop"),"QA complete");
}
