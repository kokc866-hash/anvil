import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChoiceTextStream, createCliStream } from "../electron/cli-stream.mjs";
import { validateCliImages, writeCliImages, claudeInput } from "../electron/cli-images.mjs";
import { completeCodexServer, codexThreadConfig, CODEX_TRANSPORT_CONFIG } from "../electron/cli-codex-server.mjs";
import { cliEnvironment } from "../electron/cli-runner.mjs";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=";
test("CLI stream emits only top-level content, including split escapes and Unicode", () => {
  const expected = 'Hallo "Welt"\nGrüße 👋 / \\';
  const envelope = JSON.stringify({ tool_calls: [{ name:"write_file", arguments: JSON.stringify({ content: "NEVER DISPLAY TOOL CONTENT" }) }], content: expected });
  for (const width of [1, 2, 5, 37, 1000]) {
    const output = []; const stream = createChoiceTextStream(text => output.push(text));
    const encoded = "```json\n" + envelope.replace("👋", "\\ud83d\\udc4b") + "\n```";
    for (let i=0; i<encoded.length; i+=width) stream.push(encoded.slice(i,i+width));
    assert.equal(output.join(""), expected);
    assert.ok(output.every(text => !/[\uD800-\uDBFF]$/.test(text)));
  }
  const output=[]; const stream=createChoiceTextStream(text=>output.push(text));
  stream.push('diagnostic with {"content":"not an envelope"}');
  assert.equal(output.join(""), "");
});

test("Claude and Copilot partial output arrives before result without protocol/tool leakage or duplication", () => {
  const raw=JSON.stringify({ content:"First line\nSecond line",tool_calls:[{name:"write_file",arguments:'{"content":"secret tool payload"}'}] });
  for (const kind of ["claude","copilot"]) {
    const output=[];const stream=createCliStream(kind,text=>output.push(text));
    const event = text => kind === "claude" ? {type:"stream_event",event:{type:"content_block_delta",delta:{type:"text_delta",text}}} : {type:"assistant.message_delta",data:{deltaContent:text}};
    stream.push(JSON.stringify(event(raw.slice(0,24)))+'\n');
    assert.ok(output.join("").startsWith("First line"));
    stream.push(JSON.stringify(event(raw.slice(24)))+'\n');
    const result=kind === "claude" ? {type:"result",result:raw} : {type:"assistant.message",data:{content:raw}};
    const line=JSON.stringify(result);stream.push(line.slice(0,8));stream.push(line.slice(8));stream.finish();
    assert.equal(output.join(""),"First line\nSecond line");
  }
});

test("image transport rejects arbitrary URLs/paths, malformed bytes, count and size excess", async () => {
  for (const value of ["https://example.com/secret.png", "C:\\secret.png", "data:image/png;base64,YWJj", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,AAAA="])
    assert.throws(()=>validateCliImages([value]),/CLI/);
  assert.throws(()=>validateCliImages(Array(9).fill(png)),/8/);
  assert.throws(()=>validateCliImages(["x".repeat(8*1024*1024)]),/groß/);
  const images=validateCliImages([png]);
  const input=JSON.parse(claudeInput("Inspect attached image 1",images));
  assert.equal(input.message.content[1].source.data,png.split(",")[1]);
  assert.equal(input.message.content[1].source.media_type,"image/png");
  const dir=await mkdtemp(join(tmpdir(),"anvil-image-test-"));
  try { const paths=await writeCliImages(images,dir); assert.deepEqual(await readFile(paths[0]),images[0].data); }
  finally { await rm(dir,{recursive:true,force:true}); }
});

test("Codex disables each inherited MCP entry instead of trusting empty-table merging", () => {
  const config=codexThreadConfig({features:{hooks:false,plugins:false,apps:false},mcp_servers:{ personal:{command:"evil"}, 'with.dot':{url:"https://remote"}}});
  assert.equal(config.mcp_servers.personal.enabled,false);
  assert.equal(config.mcp_servers['with.dot'].enabled,false);
  assert.equal(config["features.shell_tool"],false);
  assert.throws(()=>codexThreadConfig({features:{hooks:true,plugins:false,apps:false}}),/sicher/);
});

async function codexFixture(mode, action) {
  const dir=await mkdtemp(join(tmpdir(),"anvil-codex-test-"));
  const path=join(dir,"server.mjs");
  await writeFile(path, `import readline from 'node:readline';
const mode=${JSON.stringify(mode)};
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
readline.createInterface({input:process.stdin}).on('line', line=>{const q=JSON.parse(line);
if(q.method==='initialize') send({id:q.id,result:{}});
if(q.method==='config/read') send({id:q.id,result:{config:{features:{hooks:false,plugins:false,apps:false},mcp_servers:{personal:{command:'do-not-start'}}}}});
if(q.method==='thread/start') {if(q.params.config.mcp_servers.personal.enabled!==false||q.params.sandbox!=='read-only'||q.params.approvalPolicy!=='never'||!q.params.ephemeral) process.exit(9);send({id:q.id,result:{thread:{id:'thread'},approvalPolicy:'never',sandbox:{type:'readOnly'}}});}
if(q.method==='turn/start') {if(q.params.input[1]?.type!=='localImage'||q.params.effort!=='high'||!q.params.outputSchema)process.exit(10);send({id:q.id,result:{turn:{id:'turn'}}});
if(mode==='request'){send({id:99,method:'item/commandExecution/requestApproval',params:{threadId:'thread'}});return;}
send({method:'turn/started',params:{threadId:'thread',turn:{id:'turn'}}});
const raw=JSON.stringify({content:'Streaming works',tool_calls:[]});
send({method:'item/agentMessage/delta',params:{threadId:'thread',delta:raw.slice(0,20)}});
if(mode==='hang') return;
setTimeout(()=>{send({method:'item/agentMessage/delta',params:{threadId:'thread',delta:raw.slice(20)}});send({method:'item/completed',params:{threadId:'thread',item:{type:'agentMessage',text:raw}}});send({method:'turn/completed',params:{threadId:'thread',turn:{status:'completed'}}});},150);
}});`);
  try { await action({file:process.execPath,args:[path]},dir); }
  finally { await rm(dir,{recursive:true,force:true}); }
}
const params=dir=>({model:"fixture-model",prompt:"Check image",imagePaths:[join(dir,"image-1.png")],effort:"high",schema:{type:"object"},cwd:dir});
test("Codex app-server streams content before completion and cleans up its process",()=>codexFixture("success",async(command,dir)=>{
  const output=[];let done=false;
  const raw=await completeCodexServer(command,params(dir),{env:cliEnvironment(),timeoutMs:5000,onText:text=>{assert.equal(done,false);output.push(text);}});done=true;
  assert.ok(output.length>=2);assert.equal(output.join(""),"Streaming works");assert.equal(JSON.parse(raw).content,output.join(""));
}));
test("Codex refuses native approval/tool requests",()=>codexFixture("request",async(command,dir)=>{
  await assert.rejects(completeCodexServer(command,params(dir),{env:cliEnvironment(),timeoutMs:5000}),/Ausführung verhindert/);
}));
test("Codex cancellation stops a streaming process",()=>codexFixture("hang",async(command,dir)=>{
  const abort=new AbortController();
  await assert.rejects(completeCodexServer(command,params(dir),{env:cliEnvironment(),signal:abort.signal,timeoutMs:5000,onText:()=>abort.abort()}),/abgebrochen/);
}));
