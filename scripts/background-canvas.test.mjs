import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import electron from 'electron';
import { buildAgentRuntime } from './build-agent-runtime.mjs';

test('background Canvas uses the packaged shared runtime in real isolated Chromium', {timeout:90000}, async () => {
 mkdirSync('artifacts',{recursive:true});
 const root=mkdtempSync(resolve('artifacts','background-canvas-'));
 await buildAgentRuntime(join(root,'agent-build'));
 const manifest=JSON.parse(readFileSync('package.json','utf8'));
 assert.ok(manifest.build.files.includes('agent-build/preview-runtime.mjs'));
 const env={...process.env,ANVIL_CANVAS_QA_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(electron,['scripts/background-canvas.electron.mjs'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
 let timer;
 try {
  const code=await new Promise((resolve,reject)=>{
   child.once('error',reject);child.once('exit',resolve);
   timer=setTimeout(()=>{child.kill();reject(Error('Isolated Canvas Electron test timed out'));},60000);
  });
  writeFileSync(join(root,'electron.log'),logs);
  const result=JSON.parse(readFileSync(join(root,'result.json'),'utf8'));
  assert.equal(code,0,JSON.stringify(result));assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.outcomes.length,5);
  console.log('Canvas browser evidence: '+root);
 } finally { clearTimeout(timer);if(child.exitCode===null)child.kill(); }
});
