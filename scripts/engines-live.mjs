// Explicit opt-in test against installed engines. Uses only a fresh QA project tree.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
const output = path.resolve('artifacts/engines');
await mkdir(output,{recursive:true});
const root = await mkdtemp(path.join(output,'live-'));
const godot = path.join(root,'Godot Probe'), unreal = path.join(root,'Unreal Probe');
await mkdir(godot); await mkdir(unreal);
await writeFile(path.join(godot,'project.godot'),'config_version=5\n[application]\nconfig/name="Anvil Engine Probe"\nrun/main_scene="res://main.tscn"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
await writeFile(path.join(godot,'main.tscn'),'[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="Probe" type="Node2D"]\nscript=ExtResource("1")\n');
await writeFile(path.join(godot,'main.gd'),'extends Node2D\nfunc _ready():\n\tprint("ANVIL_GODOT_SCENE_OK")\n\tget_tree().quit(0)\n');
await writeFile(path.join(unreal,'AnvilProbe.uproject'),JSON.stringify({FileVersion:3,EngineAssociation:'5.8',Category:'',Description:'Isolated Anvil engine startup probe'}));
const listener=net.createServer(); listener.listen(0,'127.0.0.1'); await once(listener,'listening'); const port=listener.address().port; await new Promise(r=>listener.close(r));
const token='anvil-isolated-engine-live';
const env={...process.env,ANVIL_ENGINE_ROOT:root,ANVIL_COMPANION_PORT:String(port),ANVIL_COMPANION_HOST:'127.0.0.1',ANVIL_COMPANION_TOKEN:token,ANVIL_HOME:path.join(root,'home'),ANVIL_TOOLCHAIN_HOME:path.join(root,'tools'),ANVIL_INSTALL_DIR:root};
const child=spawn(process.execPath,['companion/server.mjs'],{env,cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs=''; child.stderr.on('data',d=>logs+=d);
const report={root,checks:[]};
async function request(route,body){const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{'x-anvil-token':token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(130000)}); return r.json();}
try {
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Companion startup timeout')),12000);child.once('error',reject);child.stdout.on('data',d=>{if(String(d).includes('Anvil companion')){clearTimeout(t);resolve();}});});
 const status=await request('/v1/engines'); assert.ok(status.bins.godot); assert.ok(status.bins.UnrealEditor);
 const detected=await request('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'engine_detect',arguments:{cwd:root}}});
 await writeFile(path.join(output,'live-detection.json'),JSON.stringify(detected,null,2));
 for(const [name,body] of [
  ['godot-import',{cmd:'godot --headless --path "Godot Probe" --import',action:'check',timeoutMs:60000}],
  ['godot-scene',{cmd:'godot --headless --path "Godot Probe"',action:'check',timeoutMs:30000}],
  ['unreal-startup',{cmd:'UnrealEditor "Unreal Probe/AnvilProbe.uproject" -unattended -nullrhi -nosound -nosplash -stdout -FullStdOutLogOutput -ExecCmds="QUIT_EDITOR"',action:'check',timeoutMs:120000}],
 ]) {
   const result=await request('/v1/run',{...body,cwd:root});
   await writeFile(path.join(output,`${name}.json`),JSON.stringify(result,null,2));
   report.checks.push({name,ok:result.ok,code:result.code,duration:result.duration,stage:result.stage});
   console.log(`${name}: ok=${result.ok} code=${result.code} duration=${result.duration}`);
   assert.equal(result.ok,true, `${name} failed; inspect artifacts/engines/${name}.json`);
   if(name==='godot-scene') assert.match(result.stdout,/ANVIL_GODOT_SCENE_OK/);
 }
 await writeFile(path.join(godot,'main.gd'),'extends Node2D\nfunc _ready():\n\tthis is invalid syntax !!!\n');
 const invalid=await request('/v1/run',{cmd:'godot --headless --path "Godot Probe" --import',action:'check',cwd:root,timeoutMs:30000});
 await writeFile(path.join(output,'godot-invalid.json'),JSON.stringify(invalid,null,2));
 report.invalid={ok:invalid.ok,code:invalid.code,diagnostics:invalid.stderr||invalid.stdout};
 console.log(`godot-invalid: ok=${invalid.ok} code=${invalid.code}`);
 assert.equal(invalid.ok,false, "Godot script errors must fail even with exitcode zero");
 await writeFile(path.join(godot,'main.gd'),'extends Node2D\nfunc _ready():\n\tprint("ANVIL_GODOT_SCENE_OK")\n\tget_tree().quit(0)\n');
} finally {
 await writeFile(path.join(output,'live-result.json'),JSON.stringify(report,null,2));
 await writeFile(path.join(output,'companion.log'),logs);
 if(child.exitCode===null){child.kill();await once(child,'exit');}
}
