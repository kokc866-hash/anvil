import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {AgentEngines} from '../electron/agent-engines.mjs';
import {runEngineCommand} from '../companion/engine-runtime.mjs';
const output=resolve('artifacts/stage5-engines');mkdirSync(output,{recursive:true});
const root=mkdtempSync(join(output,'projects-'));
const unity=process.env.ANVIL_QA_UNITY,unreal=process.env.ANVIL_QA_UNREAL;
assert.ok(unity&&unreal&&existsSync(unity)&&existsSync(unreal));
const results=[];
for(const engine of ['unity','unreal']){
 const project=join(root,engine);mkdirSync(project,{recursive:true});
 if(engine==='unity'){
  mkdirSync(join(project,'ProjectSettings'));mkdirSync(join(project,'Assets','Editor'),{recursive:true});mkdirSync(join(project,'Packages'));
  writeFileSync(join(project,'ProjectSettings','ProjectVersion.txt'),'m_EditorVersion: 6000.5.2f1\n');
  writeFileSync(join(project,'Packages','manifest.json'),'{"dependencies":{}}');
  writeFileSync(join(project,'Assets','Editor','AnvilProbe.cs'),`using UnityEngine;using UnityEditor;using UnityEditor.SceneManagement;using System.IO;
[InitializeOnLoad] public static class AnvilProbe {static AnvilProbe(){EditorApplication.delayCall+=Check;}public static void Check(){if(File.Exists("anvil-qa-ready.txt"))return;var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);var obj=new GameObject("Anvil background probe");obj.transform.position=new Vector3(1,2,3);if(!EditorSceneManager.SaveScene(scene,"Assets/Probe.unity"))throw new System.Exception("Save failed");File.WriteAllText("anvil-qa-ready.txt",Application.unityVersion+"|"+obj.transform.position.ToString());Debug.Log("ANVIL_UNITY_PROBE_OK");}}`);
 }else{
  mkdirSync(join(project,'Content'));mkdirSync(join(project,'Config'));
  writeFileSync(join(project,'AnvilProbe.uproject'),JSON.stringify({FileVersion:3,EngineAssociation:'5.8',Category:'',Description:'Isolated Anvil background test',Modules:[]}));
  writeFileSync(join(project,'Config','DefaultEngine.ini'),'[/Script/EngineSettings.GameMapsSettings]\nEditorStartupMap=/Engine/Maps/Templates/Template_Default\n');
 }
 const manager=new AgentEngines({environment:()=>({...process.env,ANVIL_UNITY_BIN:unity,ANVIL_UNREAL_BIN:unreal})});manager.begin({project});
 let result;
 try{
  const detected=manager.status();assert.ok(detected.engines.some(e=>e.id===engine&&e.installed));
  result=await manager.execute({action:'run',args:{engine,action:'editor'}},{signal:new AbortController().signal,verifyFiles(){}});
  assert.equal(result.running,true,result.stderr);
  const started=Date.now();let ready=false,proof='';
  while(Date.now()-started<180000){
   if(engine==='unity'){try{const log=readFileSync(join(project,'Logs','Editor.log'),'utf8');if(log.includes('Application.AssetDatabase Initial Refresh End')&&log.includes('Assembly-CSharp-Editor.dll')){proof='Editor initialized and C# editor script compiled';ready=true;break;}}catch{}}
   if(engine==='unreal'){
    try{const log=readFileSync(join(project,'Saved','Logs','AnvilProbe.log'),'utf8');if(/Engine is initialized|Total Blueprint Compile Time|Editor is initialized/.test(log)){proof=log.split('\n').filter(s=>/Engine is initialized|Total Blueprint Compile Time|Editor is initialized/.test(s)).join('\n');ready=true;break;}}catch{}
   }
   if(!manager.jobs.size)break;
   await new Promise(r=>setTimeout(r,1000));
  }
  assert.ok(ready,`${engine} did not report ready within 3 minutes: ${JSON.stringify(manager.last).slice(-1200)}`);
  await manager.close();assert.throws(()=>process.kill(result.pid,0));
  if(engine==='unity'){const checked=await runEngineCommand(project,'unity -batchmode -nographics -projectPath "." -executeMethod AnvilProbe.Check -quit -logFile -',120000,{env:{...process.env,ANVIL_UNITY_BIN:unity},action:'check'});assert.equal(checked.ok,true,checked.stderr);assert.ok(existsSync(join(project,'Assets','Probe.unity')));proof+='; scene created and saved by batch check';}
  results.push({engine,ok:true,proof,project,pid:result.pid,stopped:true});console.log(JSON.stringify(results.at(-1)));
 }catch(e){results.push({engine,ok:false,error:String(e),project});console.log(JSON.stringify(results.at(-1)));}
 finally{await manager.close();writeFileSync(join(output,'result.json'),JSON.stringify(results,null,2));}
}
assert.ok(results.every(r=>r.ok),'One or more real engines failed; inspect results');
