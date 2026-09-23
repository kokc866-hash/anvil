// Uses the freshly built desktop; test data and tooling stay in one QA profile.
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:net';
import {_electron} from 'playwright';
import {verifyBackgroundRemaining} from './background-remaining-check.mjs';
const output=path.resolve('artifacts/background-remaining');await mkdir(output,{recursive:true});
const fixture=await mkdtemp(path.join(output,'profile-'));
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const env={...process.env,ANVIL_DESKTOP_MODE:'production',ANVIL_PORT:String(port),ANVIL_QA_USER_DATA:fixture,ANVIL_HOME:path.join(fixture,'packages'),ANVIL_WATCHDOG:'0'};delete env.ELECTRON_RUN_AS_NODE;
let app,page,proc;
try{
 app=await _electron.launch({args:[path.resolve('fixtures/electron-boot.mjs')],env,timeout:45000});proc=app.process();
 for(let i=0;i<400;i++){page=app.windows().find(w=>w.url()===`http://127.0.0.1:${port}/`);if(page)break;await new Promise(r=>setTimeout(r,100));}
 if(!page)throw Error('Desktop window missing');
 await page.waitForFunction(()=>window.__anvilIde?.persist.hasHydrated());
 const result=await verifyBackgroundRemaining(page,fixture);
 await writeFile(path.join(output,'result.json'),JSON.stringify({ok:true,fixture,result},null,2));
 console.log('BACKGROUND_REMAINING_DESKTOP_OK',result);
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'failure.json'),JSON.stringify({fixture,error:String(error)},null,2));throw error;}
finally{if(app){const timer=setTimeout(()=>proc?.kill(),8000);try{await app.close();}catch{}clearTimeout(timer);}}
