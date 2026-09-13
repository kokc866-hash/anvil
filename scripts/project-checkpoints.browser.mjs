// Real built Electron/IPC/disk and restore controls, no user project or model calls.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { _electron } from "playwright";
const root=process.cwd(), output=path.resolve("artifacts/project-checkpoints-browser");
await mkdir(output,{recursive:true});
const profile=await mkdtemp(path.join(output,"profile-")), project=await mkdtemp(path.join(output,"project-"));
const socket=createServer(); await new Promise(r=>socket.listen(0,"127.0.0.1",r)); const port=socket.address().port; await new Promise(r=>socket.close(r));
const env={...process.env,ANVIL_PORT:String(port),ANVIL_QA_USER_DATA:profile,ANVIL_HOME:path.join(profile,"packages")}; delete env.ELECTRON_RUN_AS_NODE;
const server=spawn(process.execPath,[path.join(root,".output/server/index.mjs")],{cwd:root,windowsHide:true,stdio:"ignore",env:{...env,PORT:String(port),NITRO_PORT:String(port),HOST:"127.0.0.1",NITRO_HOST:"127.0.0.1"}});
const pause=ms=>new Promise(r=>setTimeout(r,ms)); let app,page; const errors=[];
async function launch(){
  app=await _electron.launch({executablePath:path.join(root,"node_modules/electron/dist/electron.exe"),args:[`--user-data-dir=${profile}`,path.join(root,"fixtures/electron-boot.mjs")],env,timeout:45000});
  for(let i=0;i<360;i++){page=app.windows().find(p=>p.url()===`http://127.0.0.1:${port}/`);if(page)break;await pause(125);}
  assert.ok(page); page.setDefaultTimeout(15000); page.on("pageerror",e=>errors.push(e.message));
  await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
}
try {
  for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${port}/`)).ok)break;}catch{} await pause(250);}
  await launch();
  await writeFile(path.join(project,"unopened.bin"),Buffer.from([0,255,17,3]));
  const id=randomUUID();
  const before=await page.evaluate(async args=>window.anvilNative.projectCheckpoint(args),{action:"before",root:project,id});
  assert.equal(before.files,1);
  await writeFile(path.join(project,"unopened.bin"),Buffer.from([7,8,9]));
  await writeFile(path.join(project,"new.bin"),Buffer.from([99]));
  await page.evaluate(async args=>window.anvilNative.projectCheckpoint(args),{action:"after",root:project,id});
  await page.evaluate(({id,project,before})=>{
    window.__anvilIde.setState({setupDone:true,autoUpdate:false,autoSaveDisk:false,locale:"de",workspaceCwd:project,companionUrl:"http://127.0.0.1:7845",files:{},dirs:[],dirty:{},editBases:{},pendingDiffs:[],running:false,agentBusy:false,mcpServers:[],
      checkpoints:[{id:"asset-round",at:Date.now(),label:"Assets",files:{},dirs:[],endFiles:{},endDirs:[],workspace:project,disk:{id,root:project,epoch:0,status:"sealed",files:before.files,bytes:before.bytes,excluded:before.excluded},externalCalls:[{server:"Demo",name:"update_item",ok:true}]}],
      chat:[{id:"asset-message",role:"assistant",content:"Asset-Runde abgeschlossen.",checkpointId:"asset-round",changes:[]}],
    });
  },{id,project,before});
  const trail=page.getByRole("button",{name:/Spur/}).first();if(await trail.count())await trail.click();
  await page.getByRole("button",{name:"Zurück vor diese Runde",exact:true}).click();
  await page.getByRole("button",{name:"Zurücknehmen und speichern",exact:true}).waitFor();
  assert.match(await page.locator("body").innerText(),/unopened\.bin/);
  assert.match(await page.locator("body").innerText(),/update_item/);
  await page.getByRole("dialog").evaluate(async element => { await Promise.all(element.getAnimations({subtree:true}).filter(a=>a.effect?.getComputedTiming().iterations !== Infinity).map(a=>a.finished.catch(()=>{}))); });
  await pause(300);
  await page.screenshot({path:path.join(output,"asset-preview.png")});
  await page.getByRole("button",{name:"Abbrechen",exact:true}).click();
  assert.deepEqual(await readFile(path.join(project,"unopened.bin")),Buffer.from([7,8,9]));
  // Persist the isolated round while avoiding startup project loading via a shared Companion.
  await page.evaluate(()=>window.__anvilIde.setState({workspaceCwd:""})); await pause(500);
  await app.close(); app=undefined; await launch();
  await page.evaluate(project=>window.__anvilIde.setState({workspaceCwd:project,files:{},dirty:{},agentBusy:false,running:false}),project);
  assert.equal(await page.evaluate(()=>window.__anvilIde.getState().checkpoints[0].disk.status),"sealed");
  await writeFile(path.join(project,"unopened.bin"),Buffer.from([42]));
  assert.equal(await page.evaluate(()=>window.__anvilIde.getState().restoreCheckpoint("asset-round")),false);
  assert.deepEqual(await readFile(path.join(project,"new.bin")),Buffer.from([99]));
  await writeFile(path.join(project,"unopened.bin"),Buffer.from([7,8,9]));
  const trail2=page.getByRole("button",{name:/Spur/}).first();if(await trail2.count())await trail2.click();
  await page.getByRole("button",{name:"Zurück vor diese Runde",exact:true}).click();
  await page.getByRole("button",{name:"Zurücknehmen und speichern",exact:true}).click();
  await page.waitForFunction(()=>/Projektdateien und Assets dieser Runde zurückgenommen/.test(window.__anvilIde.getState().notice));
  assert.deepEqual(await readFile(path.join(project,"unopened.bin")),Buffer.from([0,255,17,3]));
  await assert.rejects(readFile(path.join(project,"new.bin")),{code:"ENOENT"});
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(output,"asset-restored.png")});
  await page.evaluate(()=>window.__anvilIde.setState({workspaceCwd:""}));
  await writeFile(path.join(output,"result.json"),JSON.stringify({ok:true,errors,project,profile},null,2));
  console.log("PASS: native binary snapshots, review/cancel, external-call disclosure, full restart, conflict protection and actual restore controls");
} finally {await app?.close().catch(()=>{});server.kill();}
