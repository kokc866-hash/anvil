import assert from "node:assert/strict";
import {test} from "node:test";
import {createServer} from "vite";
import path from "node:path";

test("simple/vision completions use the same image-capable CLI bridge",async()=>{
  const vite=await createServer({configFile:false,root:process.cwd(),resolve:{alias:{"@":path.resolve("src")}},server:{middlewareMode:true,hmr:false,watch:null},appType:"custom"});
  const previous=globalThis.window;
  try{
    const {completeLocal}=await vite.ssrLoadModule("/src/lib/agent-client.ts");
    const {useIde}=await vite.ssrLoadModule("/src/store/ide.ts");
    const {beginAgent}=await vite.ssrLoadModule("/src/lib/abort.ts");
    const image="data:image/png;base64,YQ==";const calls=[];
    globalThis.window={anvilNative:{onCliEvent:()=>()=>{},cliCancel:async()=>{},cliRun:async request=>{calls.push(request);return {ok:true,value:'{"content":"Image received","tool_calls":[]}'};}}};
    useIde.setState({llmAuthMode:"abo"});
    for(const provider of ["codex","anthropic","github"]){
      beginAgent();
      const text=await completeLocal({prompt:"Describe diagram",provider,model:"fixture-model",baseUrl:"",apiKey:"",images:[image]});
      assert.equal(text,"Image received");assert.deepEqual(calls.at(-1).images,[image]);assert.match(calls.at(-1).prompt,/Describe diagram/);
    }
    assert.deepEqual(calls.map(call=>call.kind),["codex","claude","copilot"]);
  }finally{globalThis.window=previous;await vite.close();}
});
