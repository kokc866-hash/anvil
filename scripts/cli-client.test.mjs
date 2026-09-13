import assert from "node:assert/strict";
import {test} from "node:test";
import {createServer} from "vite";
import path from "node:path";

test("renderer CLI bridge sends images, streams before completion, validates tools and cancels without late text",async()=>{
  const vite=await createServer({configFile:false,root:process.cwd(),resolve:{alias:{"@":path.resolve("src")}},server:{middlewareMode:true,hmr:false,watch:null},appType:"custom"});
  const previous=globalThis.window;
  try{
    const {completeViaCli}=await vite.ssrLoadModule("/src/lib/cli-client.ts");
    const {beginAgent,abortAgent}=await vite.ssrLoadModule("/src/lib/abort.ts");
    const listeners=new Map();let current,resolveRun,cancels=0;
    globalThis.window={anvilNative:{
      onCliEvent:(id,fn)=>{listeners.set(id,fn);return()=>listeners.delete(id);},
      cliRun:request=>{current=request;return new Promise(resolve=>{resolveRun=resolve;});},
      cliCancel:async id=>{assert.equal(id,current.id);cancels++;},
    }};
    const image="data:image/png;base64,YQ==";
    const messages=[{role:"user",content:[{type:"text",text:"Look"},{type:"image_url",image_url:{url:image}}]}];
    const tools=[{function:{name:"read_file"}}];
    const deltas=[];beginAgent();
    const pending=completeViaCli("claude","model",messages,tools,0,text=>deltas.push(text));
    assert.deepEqual(current.images,[image]);assert.ok(!current.prompt.includes(image));
    listeners.get(current.id)({text:"Part one"});assert.deepEqual(deltas,["Part one"]);
    resolveRun({ok:true,value:JSON.stringify({content:"Part one and two",tool_calls:[{name:"read_file",arguments:'{"path":"index.html"}'}]})});
    const result=await pending;assert.equal(deltas.join(""),result.content);assert.equal(result.tool_calls[0].function.name,"read_file");assert.equal(listeners.size,0);

    beginAgent();const cancelDeltas=[];
    const cancelled=completeViaCli("codex","model",messages,[],0,text=>cancelDeltas.push(text));
    listeners.get(current.id)({text:"Early"});abortAgent();listeners.get(current.id)({text:"Late"});
    resolveRun({ok:false,error:"CLI abgebrochen."});
    await assert.rejects(cancelled,/Abgebrochen/);assert.equal(cancels,1);assert.deepEqual(cancelDeltas,["Early"]);assert.equal(listeners.size,0);

    beginAgent();const invalid=completeViaCli("copilot","model",messages,[],0,()=>{});
    resolveRun({ok:true,value:JSON.stringify({content:"Done",tool_calls:[{name:"unapproved",arguments:"{}"}]})});
    await assert.rejects(invalid,/unbekannt/);assert.equal(listeners.size,0);

    beginAgent();const mismatch=completeViaCli("claude","model",messages,[],0,()=>{});
    listeners.get(current.id)({text:"Different"});resolveRun({ok:true,value:'{"content":"Final","tool_calls":[]}'});
    await assert.rejects(mismatch,/widerspricht/);assert.equal(listeners.size,0);
  }finally{globalThis.window=previous;await vite.close();}
});
