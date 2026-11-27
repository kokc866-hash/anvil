import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentWorkflow } from "./agent-workflow.ts";
import { selectRunTarget } from "./run-target.ts";

const options: ConstructorParameters<typeof AgentWorkflow>[1] = { runLoop: false, graphLoop: false, testLoop: false, loopTries: 3, afterWrite: "none", autoRunAgent: true };
const app = {
  "index.html": '<canvas id="game"></canvas><script src="game.js"></script>',
  "game.js": "const canvas = document.getElementById('game'); canvas.dataset.loaded = 'true';",
};

test("only linked browser inputs are redirected; CLI and explicit test entries stay executable", () => {
  assert.equal(selectRunTarget(Object.keys(app), "game.js", app), "index.html");
  const mixed={...app,"tools/build.js":"console.log('build');","game.test.js":"console.log('test');","docs.html":'<p>tools/build.js</p>'};
  assert.equal(selectRunTarget(Object.keys(mixed),"tools/build.js",mixed),"tools/build.js");
  assert.equal(selectRunTarget(Object.keys(mixed),"game.test.js",mixed),"game.test.js");
  assert.equal(selectRunTarget(["main.py"],"main.py",{"main.py":"print(1)"}),"main.py");
});

test("automatic final verification launches the browser entry for its changed JavaScript", async () => {
  const workflow = new AgentWorkflow(app, options, ["run_file", "play"]);
  await workflow.update(app);
  workflow.confirmedChanges(["index.html", "game.js"]);
  assert.equal((await workflow.next(true))?.args.path, "index.html");
});

test("an already observed browser application is not subsequently launched as a Node module", async () => {
  const workflow = new AgentWorkflow(app, options, ["run_file", "play"]);
  await workflow.update(app);
  workflow.confirmedChanges(["index.html", "game.js"]);
  for (const [name,args,result] of [
    ["run_file", {path:"index.html"}, {ok:true,image:"rendered-frame",graphical:true,stage:{kind:"html"}}],
    ["play", {keys:["right"]}, {ok:true,image:"observed-frame",state:{text:"Player moved"}}],
  ] as const) {
    const operation = await workflow.begin(name,args);
    workflow.finish(operation.id,name,args,result);
  }
  assert.equal(await workflow.next(true), undefined, "current HTML evidence must cover its module without a spurious Node execution");
});

test("a changed browser script invalidates its old preview and a real browser error stays failed", async () => {
  const workflow = new AgentWorkflow(app, options, ["run_file"]);
  await workflow.update(app);workflow.confirmedChanges(["game.js"]);
  const first=(await workflow.next(true))!;
  const operation=await workflow.begin(first.name,first.args,first.id);
  workflow.finish(operation.id,first.name,first.args,{ok:true,image:"frame"});
  await workflow.update({...app,"game.js":app["game.js"]+"\nthrow Error('BROWSER_FAILURE');"});
  const next=(await workflow.next(true))!;assert.equal(next.args.path,"index.html");
  const failed=await workflow.begin(next.name,next.args,next.id);
  workflow.finish(failed.id,next.name,next.args,{ok:false,stderr:"BROWSER_FAILURE"});
  assert.ok(workflow.outstandingChecks().failed.length>0);
  assert.equal(await workflow.next(true),undefined,"a failed browser run must not trigger an unrelated Node run");
});
