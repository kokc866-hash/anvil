import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentWorkflow } from "./agent-workflow.ts";
import type { HarnessOpts } from "./harness.ts";
import { validWorkflowSnapshot } from "../../electron/workflow-validation.mjs";
const opts: HarnessOpts = { runLoop: true, graphLoop: true, testLoop: true, loopTries: 3, afterWrite: "run" };
const files = { "main.py": "print(1)", "test_main.py": "def test_ok():\n    assert True", "README.md": "Description" };

test('a rejected manual shell call records its diagnostic without inventing an application check', async () => {
  const workflow = new AgentWorkflow(files, { ...opts, runLoop: false, testLoop: false, afterWrite: 'none' }, ['shell', 'read_file']);
  await workflow.update(files);
  const operation = await workflow.begin('shell', { command: 'cat main.py | head -100' });
  workflow.finish(operation.id, 'shell', { command: 'cat main.py | head -100' }, { ok: false, error: 'Use read_file', rejected: true, definitelyNotExecuted: true });
  assert.equal(workflow.snapshot().operations.at(-1)?.status, 'failed');
  assert.deepEqual(workflow.outstandingChecks(), { failed: [], pending: [] });
  assert.equal(workflow.testsPassed, false);
});

test('a required check remains unfulfilled when its command is rejected', async () => {
  const workflow = await create();
  const check = (await workflow.next())!;
  const operation = await workflow.begin(check.name, check.args, check.id);
  workflow.finish(operation.id, check.name, check.args, { ok: false, error: 'Prerequisite missing', definitelyNotExecuted: true, rejected: true });
  assert.equal(workflow.outstandingChecks().failed.length, 1);
  assert.match(workflow.outstandingChecks().failed[0], /nicht ausgeführt/);
  assert.equal(workflow.testsPassed, false);
});
async function create(overrides: Partial<HarnessOpts> = {}, capabilities = ["run_file", "see_run", "engine_run"]) {
  const workflow = new AgentWorkflow(files, { ...opts, ...overrides }, capabilities);
  await workflow.update(files); workflow.confirmedChanges(["main.py"]); return workflow;
}
async function execute(w: AgentWorkflow, name: string, args: Record<string, unknown>, result: Record<string, unknown>, id?: string) { const op = await w.begin(name, args, id); assert.ok(op.id); w.finish(op.id, name, args, result); }

test("an equivalent preview retry resolves only its earlier assertion failure and keeps the attempt history", async () => {
  const project = { "index.html": "<div id='item'></div>", "other.html": "<div id='item'></div>" };
  const settings = { ...opts, runLoop: false, testLoop: false, afterWrite: "none" as const };
  const workflow = new AgentWorkflow(project, settings, ["play"]);
  await workflow.update(project);
  const attempt = (focus: string, key = "Delete", selector = "#item", count = 0) => ({ actions: [
    { type: "click", selector: focus }, { type: "key", key }, { type: "assert", selector, count },
  ] });
  const failed = (selector: string) => ({
    ok: false, previewPath: "index.html", functionalChecks: false, error: `Prüfung fehlgeschlagen: ${selector} — erwartet 0 Elemente, erhalten 1.`,
    input: { mode: "native-preview", completed: 2, total: 3, assertions: 0 },
  });
  const passed = {
    ok: true, previewPath: "index.html", functionalChecks: true,
    input: { mode: "native-preview", completed: 3, total: 3, assertions: 1 },
  };
  await execute(workflow, "play", attempt("body"), failed("#item"));
  await execute(workflow, "play", attempt("body", "Delete", "#another"), failed("#another"));
  const saved = JSON.parse(JSON.stringify(workflow.snapshot()));
  assert.ok(validWorkflowSnapshot(saved));
  const resumed = new AgentWorkflow(project, settings, ["play"], saved);
  await resumed.update(project);
  const stillFailed = () => assert.equal(resumed.outstandingChecks().failed.length, 2);

  await execute(resumed, "play", attempt("#start", "Backspace"), passed);
  stillFailed();
  const rightClick = attempt("#start");
  Object.assign(rightClick.actions[0], { button: "right" });
  await execute(resumed, "play", rightClick, passed);
  stillFailed();
  await execute(resumed, "play", attempt("#start"), { ...passed, previewPath: "other.html" });
  stillFailed();
  await execute(resumed, "play", attempt("#start", "Delete", "#item", 1), passed);
  stillFailed();
  await execute(resumed, "play", { actions: [{ type: "assert", selector: "#item", count: 0 }] }, {
    ...passed, input: { mode: "native-preview", completed: 1, total: 1, assertions: 1 },
  });
  stillFailed();
  await execute(resumed, "play", attempt("body"), { ...passed, functionalChecks: false });
  stillFailed();

  await execute(resumed, "play", attempt("#start"), passed);
  const finalSnapshot = resumed.snapshot();
  assert.ok(validWorkflowSnapshot(finalSnapshot));
  assert.equal(resumed.outstandingChecks().failed.length, 1);
  assert.equal(finalSnapshot.nodes.filter(node => node.status === "retried").length, 1);
  assert.equal(finalSnapshot.operations.filter(op => op.status === "failed").length, 2);
  assert.equal(finalSnapshot.operations.at(-1)?.status, "confirmed");
  assert.equal(new AgentWorkflow(project, settings, ["play"], finalSnapshot).outstandingChecks().failed.length, 1);
});

test("checks follow confirmed writes without replay after a read", async () => {
  const w = await create(), action = (await w.next())!;
  assert.equal(action.args.path, "main.py"); await execute(w, action.name, action.args, { ok: true, code: 0 }, action.id);
  await execute(w, "read_file", { path: "main.py" }, { content: files["main.py"] });
  assert.equal((await w.next()), undefined);
  const check = (await w.next(true))!; assert.equal(check.args.path, "test_main.py");
  await execute(w, check.name, check.args, { ok: true, code: 0 }, check.id);
  assert.equal(w.testsPassed, true); assert.equal((await w.next(true)), undefined);
});
test("documentation preserves execution proofs while changed code invalidates them", async () => {
  const w = await create(), a = (await w.next())!; await execute(w, a.name, a.args, { ok: true, code: 0 }, a.id);
  const stamp = w.inputStamp; await w.update({ ...files, "README.md": "New description" });
  assert.equal(w.inputStamp, stamp); assert.ok(w.completed.has(a.id));
  await w.update({ ...files, "main.py": "print(2)" }); assert.notEqual(w.inputStamp, stamp);
  assert.equal(w.completed.has(a.id), false); assert.equal((await w.next())?.id, a.id);
});
test("unconfirmed service history survives reload without blocking a new deliberate call", async () => {
  const w = await create(); await w.begin("mcp_call", { server: "fixture", name: "create", arguments: { value: 1 } });
  const recovered = new AgentWorkflow(files, opts, ["mcp_call"], w.snapshot()); await recovered.update(files);
  assert.equal(recovered.snapshot().operations[0].status, "unclear");
  const next = await recovered.begin("mcp_call", { server: "fixture", name: "create", arguments: { value: 1 } });
  assert.ok(next.id); assert.notEqual(next.id, recovered.snapshot().operations[0].id);
  assert.ok((await recovered.begin("mcp_read_resource", { server: "fixture", uri: "fixture://result" })).id);
});
test("a known failed shell exit permits a later corrected attempt", async () => {
  const w = await create(); await execute(w, "shell", { command: "npm test" }, { ok: false, code: 1, stderr: "fixture failure" });
  assert.equal(w.snapshot().operations.at(-1)?.status, "failed"); assert.ok((await w.begin("shell", { command: "npm test" })).id);
});
test("a normal shell command and a running test do not prove test completion", async () => {
  const w = await create(); await execute(w, "shell", { command: "echo ok" }, { ok: true, code: 0 }); assert.equal(w.testsPassed, false);
  await execute(w, "shell", { command: "npm test" }, { ok: true, running: true }); assert.equal(w.testsPassed, false);
});
test("capability restrictions disable automatic actions", async () => {
  const w = await create({}, []); assert.equal((await w.next(true)), undefined);
  assert.ok(w.snapshot().nodes.every(n => n.status === "disabled"));
});
test("manual and disabled project rules never schedule service effects", async () => {
  const w = await create({ runLoop: false, testLoop: false, afterWrite: "preview" }, ["mcp_call"]);
  await w.update(files, { ...opts, runLoop: false, testLoop: false, afterWrite: "preview" }, [{ id: "service", tool: "mcp_call", edge: "mcp", phase: "plan", when: "Save", glob: "*.py" }]);
  assert.equal((await w.next(true)), undefined);
});
test("changed definitions invalidate a graph node and test/check actions remain distinct", async () => {
  const w = await create({ runLoop: false, engineLoop: true, afterWrite: "engine", testLoop: false });
  await execute(w, "engine_run", { action: "check" }, { ok: true, code: 0 }, "custom");
  await w.update(files, { ...opts, runLoop: false, engineLoop: true, afterWrite: "engine", testLoop: false }, [{ id: "custom", tool: "engine_run", args: { action: "test" }, edge: "engine", when: "Engine tests", glob: "*.py", condition: "changed" }]);
  assert.equal(w.completed.has("custom"), false);
  assert.equal((await w.next())?.args.action, "test");
});
test("a run-provided image consumes the preview proof without duplicate capture", async () => {
  const html = { "index.html": "<p>fixture</p>" }; const w = new AgentWorkflow(html, opts, ["run_file", "see_run"]);
  await w.update(html, opts, [{ id: "image", edge: "preview", tool: "see_run", condition: "success", when: "Capture", glob: "*.html" }]); w.confirmedChanges(["index.html"]);
  const a = (await w.next())!; await execute(w, a.name, a.args, { ok: true, image: "fixture-frame" }, a.id);
  assert.equal((await w.next()), undefined); assert.ok(w.completed.has("image"));
});
test("recovery metadata is bounded, validated and omits commands and output", async () => {
  const w = await create(); await execute(w, "shell", { command: "npm test --fixture-secret" }, { ok: true, code: 0, stdout: "PRIVATE OUTPUT" });
  const saved = w.snapshot(); assert.ok(validWorkflowSnapshot(saved));
  assert.doesNotMatch(JSON.stringify(saved), /fixture-secret|PRIVATE OUTPUT/);
  assert.equal(validWorkflowSnapshot({ ...saved, nodes: [...saved.nodes, saved.nodes[0]] }), false);
});
test("one passed test does not override another failed or obsolete test", async () => {
  const w=await create();await w.update({...files,"test_failure.py":"def test_failure():\n    assert False"});await execute(w,"run_file",{path:"test_main.py"},{ok:true,code:0});
  await execute(w,"run_file",{path:"test_failure.py"},{ok:false,code:1});assert.equal(w.testsPassed,false);
});
test("an interrupted shell remains ambiguous even if a code field is present",async()=>{
  const w=await create();await execute(w,"shell",{command:"npm test"},{ok:false,code:0,interrupted:true});
  assert.equal(w.snapshot().operations.at(-1)?.status,"unclear");assert.ok((await w.begin("shell",{command:"npm test"})).id);
});
test("expected negative exits cannot certify all tests",async()=>{
  const w=await create();await execute(w,"shell",{command:"npm test",expected_exit_code:1},{ok:true,code:1,expectedExitCode:1,exitExpectationMatched:true});assert.equal(w.testsPassed,false);
});

test("engine and project selectors cannot share the same successful proof",async()=>{
  const w=await create({afterWrite:"engine",engineLoop:true,runLoop:false,testLoop:false});
  const args={engine:"godot",projectRoot:"scene",action:"check"};
  await w.update(files,{...opts,afterWrite:"engine",engineLoop:true,runLoop:false,testLoop:false},[{id:"engine-specific",tool:"engine_run",edge:"engine",args,when:"Godot prüfen",glob:"*.py",condition:"changed"}]);
  await execute(w,"engine_run",{engine:"unreal",projectRoot:"scene",action:"check"},{ok:true,code:0});
  assert.deepEqual((await w.next())?.args,args);
});
test("legacy uncertain effects do not impose blanket tool locks on further work",async()=>{
  const w=await create();await w.begin("shell",{command:"npm test",expected_exit_code:0});
  await w.begin("mcp_call",{server:"fixture",name:"create",arguments:{value:1},timeout:10});
  const recovered=new AgentWorkflow(files,opts,["shell","mcp_call"],w.snapshot());await recovered.update(files);
  assert.ok((await recovered.begin("shell",{command:"npm test",expected_exit_code:1})).id);
  assert.ok((await recovered.begin("mcp_call",{server:"fixture",name:"create",arguments:{value:1},timeout:20})).id);
  assert.ok((await recovered.begin("mcp_call",{server:"fixture",name:"create",arguments:{value:2}})).id);
  assert.ok(recovered.snapshot().operations.slice(0,2).every(op=>op.status==='unclear'));
});
test("removed test files stop being prerequisites but remaining current tests must all run",async()=>{
  const all={...files,"test_failure.py":"def test_failure():\n    assert False"};
  const w=new AgentWorkflow(all,opts,["run_file"]);await w.update(all);
  await execute(w,"run_file",{path:"test_main.py"},{ok:true,code:0});assert.equal(w.testsPassed,false);
  await execute(w,"run_file",{path:"test_failure.py"},{ok:false,code:1});assert.equal(w.testsPassed,false);
  await w.update(files);await execute(w,"run_file",{path:"test_main.py"},{ok:true,code:0});assert.equal(w.testsPassed,true);
});
test("final automatic execution shares the workflow even with the immediate loop disabled",async()=>{
  const w=new AgentWorkflow(files,{...opts,runLoop:false,testLoop:false,graphLoop:false,afterWrite:"none",autoRunAgent:true},["run_file"]);
  await w.update(files);w.confirmedChanges(["main.py"]);assert.equal(await w.next(),undefined);
  const action=(await w.next(true))!;assert.equal(action.args.path,"main.py");await execute(w,action.name,action.args,{ok:true,code:0},action.id);
  assert.equal(await w.next(true),undefined);
});
test("malformed fingerprints, harness values and unexpected fields are rejected",async()=>{
  const w=await create();const action=(await w.next())!;await execute(w,action.name,action.args,{ok:false,code:1,stderr:"SECRET OUTPUT"},action.id);
  const saved=w.snapshot();assert.ok(validWorkflowSnapshot(saved));assert.doesNotMatch(JSON.stringify(saved),/SECRET OUTPUT/);
  assert.equal(validWorkflowSnapshot({...saved,credential:"no"}),false);
  assert.equal(validWorkflowSnapshot({...saved,nodes:[{...saved.nodes[0],fingerprint:{forged:true}}]}),false);
  assert.equal(validWorkflowSnapshot({...saved,harness:{budget:null}}),false);
});
test("project phase, dependency and observation budget gate actual scheduling",async()=>{
  const html={"index.html":"<p>fixture</p>"},options={...opts,runLoop:false,testLoop:false,afterWrite:"preview" as const};
  const w=new AgentWorkflow(html,options,["run_file","see_run"]);
  const edges=[{id:"after-look",edge:"preview" as const,tool:"see_run",phase:"see" as const,condition:"success" as const,dependsOn:["run:index.html"],when:"Bild ansehen",glob:"*.html"}];
  await w.update(html,options,edges);w.confirmedChanges(["index.html"]);
  const a=(await w.next())!;await execute(w,a.name,a.args,{ok:true,code:0},a.id);
  assert.equal(await w.next(false,0),undefined);
  assert.equal((await w.next(false,1))?.id,"after-look");
});
test("an action bound to the work phase cannot execute while the workflow is planning",async()=>{
  const options={...opts,testLoop:false};const w=new AgentWorkflow(files,options,["run_file"]);
  await w.update(files,options,[{id:"work-only",tool:"run_file",edge:"run",phase:"act",condition:"changed",args:{path:"main.py"},when:"Während der Arbeit prüfen",glob:"*.py"}]);
  w.confirmedChanges(["main.py"]);w.setPhase("plan");assert.equal(await w.next(),undefined);w.setPhase("act");assert.equal((await w.next())?.id,"work-only");
});
test("an explicit HTML recipe reuses its frame after a CSS or JavaScript change",async()=>{
  const app={"index.html":"<script src='app.js'></script>","app.js":"console.log(1)","style.css":"body{color:red}"};
  const options={...opts,runLoop:false,testLoop:false,afterWrite:"preview" as const};
  const w=new AgentWorkflow(app,options,["run_file","see_run"]);
  await w.update(app,options,[{id:"html",tool:"run_file",edge:"run",phase:"observe",args:{path:"index.html"},condition:"changed",when:"HTML starten",glob:"*.{html,js,css}"},{id:"frame",tool:"see_run",edge:"preview",phase:"see",dependsOn:["html"],condition:"success",when:"Aufnahme prüfen",glob:"*.{html,js,css}"}]);
  w.confirmedChanges(["app.js"]);w.setPhase("observe");const action=(await w.next())!;assert.equal(action.args.path,"index.html");
  await execute(w,action.name,action.args,{ok:true,code:0,image:"fixture"},action.id);w.setPhase("see");assert.equal(await w.next(),undefined);assert.ok(w.completed.has("frame"));assert.ok(w.completed.has("html"));
});

test("executable skill files and referenced document inputs invalidate current test proofs", async () => {
  const inputs={...files,".anvil/skills/demo/test_demo.py":"def test_demo():\n    assert True","ref/helper.py":"VALUE=1","data.md":"input one"};
  const w=new AgentWorkflow(inputs,{...opts,testLoop:false},["run_file"]);await w.update(inputs);
  await execute(w,"run_file",{path:"test_main.py"},{ok:true,code:0});const first=w.inputStamp;
  await w.update({...inputs,".anvil/skills/demo/test_demo.py":"def test_demo():\n    assert False"});assert.notEqual(w.inputStamp,first);assert.equal(w.testsPassed,false);
  const skillStamp=w.inputStamp;await w.update({...inputs,"ref/helper.py":"VALUE=2"});assert.notEqual(w.inputStamp,skillStamp);
  await w.update({...inputs,"main.py":"print(open('data.md').read())"});const dataStamp=w.inputStamp;
  await w.update({...inputs,"main.py":"print(open('data.md').read())","data.md":"input two"});assert.notEqual(w.inputStamp,dataStamp);
  const latest=w.inputStamp;await w.update({...inputs,"main.py":"print(open('data.md').read())","data.md":"input two",".anvil/session.md":"Log update",".anvil/skills/demo/SKILL.md":"Guidance update"});assert.equal(w.inputStamp,latest);
});

test("pending checks and unavailable automatic checks stay explicit while confirmed engine launches remain launches",async()=>{
  const w=await create();await execute(w,"run_file",{path:"test_main.py"},{ok:true,running:true});assert.ok(w.outstandingChecks().pending.length);
  const restricted=await create({},[]);await restricted.next(true);assert.ok(restricted.outstandingChecks().pending.every(s=>/nicht freigegeben/.test(s)));assert.ok(restricted.outstandingChecks().pending.length);
  const launch=await create({testLoop:false});await execute(launch,"engine_run",{engine:"godot",action:"editor"},{ok:true,running:true});assert.deepEqual(launch.outstandingChecks(),{failed:[],pending:[]});assert.equal(launch.testsPassed,false);
});

test("unsafe automatic engine commands are disabled with a current completion reason",async()=>{
  const options={...opts,runLoop:false,testLoop:false,engineLoop:true,afterWrite:"engine" as const};
  const w=new AgentWorkflow(files,options,["engine_run"]);await w.update(files,options,[{id:"custom-command",tool:"engine_run",edge:"engine",args:{action:"check",cmd:"arbitrary command"},when:"Engine prüfen",glob:"*.py",condition:"changed"}]);w.confirmedChanges(["main.py"]);
  assert.equal(await w.next(),undefined);assert.ok(w.outstandingChecks().pending.some(s=>/nicht automatisch/.test(s)));
});

test("a refreshed HTML frame replaces a stale observation reason", async () => {
  const options = { ...opts, testLoop: false };
  const initial = { "index.html": "<canvas>old</canvas>" };
  const workflow = new AgentWorkflow(initial, options, ["run_file", "see_run"]);
  await workflow.update(initial);
  await execute(workflow, "run_file", { path: "index.html" }, { ok: true, image: "first frame" });
  await workflow.update({ "index.html": "<canvas>new</canvas>" });
  assert.equal(workflow.snapshot().nodes.find(node => node.id === "preview:index.html")?.status, "stale");
  await execute(workflow, "run_file", { path: "index.html" }, { ok: true, image: "new frame" });
  const frame = workflow.snapshot().nodes.find(node => node.id === "preview:index.html")!;
  assert.equal(frame.status, "passed");
  assert.doesNotMatch(frame.reason, /geändert|unbestätigt|Wartet/);
  assert.match(frame.reason, /geladen|Aufnahme|Vorschau/);
});
