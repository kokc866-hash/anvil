import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AgentRepair} from './agent-repair.ts';

test('failed previews are reused only for identical execution input stamps',()=>{
  const repair=new AgentRepair(),args={path:'index.html'},bad={ok:false,stderr:'TypeError: missing ctx',stage:{kind:'html'}};
  repair.record('run_file',args,bad,'one');
  assert.equal(repair.cached('run_file',args,'one')?.reusedFailure,true);
  assert.equal(repair.cached('run_file',args,'two'),undefined);
  assert.equal(repair.cached('run_file',{path:'other.html'},'one'),undefined);
  assert.equal(repair.cached('shell',{path:'index.html'},'one'),undefined);
  repair.record('shell',{command:'restore prerequisite'},{ok:true,code:0},'one');
  assert.equal(repair.cached('run_file',args,'one'),undefined,'a changed execution prerequisite permits a fresh check');
});

test('a persistent cause across revisions requires inspection, not another blind edit or job restart',()=>{
  const files={'index.html':'<script src="main.js"></script>','main.js':'draw callback'};
  const repair=new AgentRepair(()=>files),args={path:'index.html'},bad={ok:false,stderr:"Cannot read properties of undefined (reading 'ctx')"};
  repair.record('run_file',args,bad,'one');assert.equal(repair.needsInspection,false);
  repair.record('run_file',args,{...bad,reusedFailure:true},'one');assert.equal(repair.needsInspection,false);
  repair.record('run_file',args,bad,'two');assert.equal(repair.needsInspection,true);
  assert.ok(repair.blockEdit('main.js'));assert.equal(repair.blockEdit('TEST_REPORT.md'),undefined);
  repair.record('read_file',{path:'main.js'},{error:'missing file'},'two');assert.equal(repair.needsInspection,true);
  repair.record('read_file',{path:'main.js'},{ok:true,content:'draw callback'},'two');assert.equal(repair.needsInspection,false);
  repair.record('run_file',args,bad,'three');assert.equal(repair.needsInspection,true);
  repair.record('run_file',args,{ok:true},'four');assert.equal(repair.needsInspection,false);
});

test('unrelated reads and empty or unrelated grep results do not release another target repair gate',()=>{
  const files={'index.html':'<script type="module" src="./src/main.js"></script>','src/main.js':'import {draw} from "./game.js"; draw();','src/game.js':'export const draw=()=>missing.ctx;','unrelated.txt':'shopping list','other.html':'<script src="other.js"></script>','other.js':'other source'};
  const repair=new AgentRepair(()=>files),bad={ok:false,stderr:'TypeError: missing ctx'};
  for(const target of ['index.html','other.html']){repair.record('run_file',{path:target},bad,'one');repair.record('run_file',{path:target},bad,'two');}
  repair.record('read_file',{path:'unrelated.txt'},{ok:true,content:'shopping list'},'two');
  assert.equal(repair.needsInspection,true);assert.ok(repair.blockEdit('src/game.js'));
  repair.record('grep',{query:'shopping'},{matches:['unrelated.txt:1:shopping list']},'two');assert.equal(repair.needsInspection,true);
  repair.record('grep',{query:'ctx'},{matches:[]},'two');assert.equal(repair.needsInspection,true);
  repair.record('grep',{query:'draw'},{matches:['src/game.js:1:export const draw=()=>missing.ctx;']},'two');
  assert.equal(repair.needsInspection,true,'inspection of one application must not clear another failing target');
  repair.record('read_file',{path:'other.js'},{ok:true,content:'other source'},'two');assert.equal(repair.needsInspection,false);
});

test('the current transitive source chain and local fetch/link references qualify without trusting remote or missing paths',()=>{
  let files:Record<string,string>={'web/index.html':'<script src="./src/main.js"></script><link href="./ui.css" />','web/src/main.js':'export {draw} from "./game.js"; fetch("../rules.json");','web/src/game.js':'export function draw(){}','web/ui.css':'body{}','web/rules.json':'{}','remote.js':'remote'};
  const repair=new AgentRepair(()=>files),bad={ok:false,stderr:'TypeError: missing ctx'};
  const fail=(revision:string)=>repair.record('run_file',{path:'web/index.html'},bad,revision);
  fail('one');fail('two');repair.record('read_file',{path:'web/src/game.js'},{ok:true,content:'source'},'two');assert.equal(repair.needsInspection,false);
  fail('three');repair.record('read_file',{path:'web/rules.json'},{ok:true,content:'{}'},'three');assert.equal(repair.needsInspection,false);
  fail('four');repair.record('read_file',{path:'web/ui.css'},{ok:true,content:'body{}'},'four');assert.equal(repair.needsInspection,false);
  fail('five');files={...files,'web/src/main.js':'import "https://example.invalid/remote.js";'};
  repair.record('read_file',{path:'remote.js'},{ok:true,content:'remote'},'five');assert.equal(repair.needsInspection,true);
  repair.record('read_file',{path:'web/src/game.js'},{ok:true,content:'old source'},'five');assert.equal(repair.needsInspection,true,'current imports, not an obsolete dependency chain');
  repair.record('read_file',{path:'not-present.js'},{ok:true,content:'invented'},'five');assert.equal(repair.needsInspection,true);
  repair.record('read_file',{path:'web/index.html'},{ok:true,content:files['web/index.html']},'five');assert.equal(repair.needsInspection,false);
});

test('without a workspace callback only reading the failing entry qualifies',()=>{
  const repair=new AgentRepair(),bad={ok:false,stderr:'TypeError: missing ctx'};
  repair.record('run_file',{path:'index.html'},bad,'one');repair.record('run_file',{path:'index.html'},bad,'two');
  repair.record('read_file',{path:'unrelated.js'},{ok:true,content:'source'},'two');assert.equal(repair.needsInspection,true);
  repair.record('read_file',{path:'index.html'},{ok:true,content:'<script></script>'},'two');assert.equal(repair.needsInspection,false);
});

test('a real diagnostic search can inspect a matching local interface reference',()=>{
  const files={'index.html':'<canvas></canvas>','ref/canvas-api.md':'The draw callback uses this.ctx.'};
  const repair=new AgentRepair(()=>files),bad={ok:false,stderr:'TypeError: missing ctx'};
  repair.record('run_file',{path:'index.html'},bad,'one');repair.record('run_file',{path:'index.html'},bad,'two');
  repair.record('grep',{query:'ctx'},{matches:['missing.md:1:ctx']},'two');assert.equal(repair.needsInspection,true,'a missing search target is not evidence');
  repair.record('grep',{query:'ctx'},{matches:['ref/canvas-api.md:1:The draw callback uses this.ctx.']},'two');assert.equal(repair.needsInspection,false);
});

test('abort, transient network errors, pending jobs and successful runs are not cached as repeatable failures',()=>{
  for(const result of [{ok:false,stderr:'aborted',aborted:true},{ok:false,stderr:'timeout',timedOut:true},{ok:false,stderr:'fetch failed UND_ERR_SOCKET'},{ok:false,stderr:'still loading',running:true},{ok:true},{ok:false,error:'blocked',definitelyNotExecuted:true}]){
    const repair=new AgentRepair();repair.record('run_file',{path:'a.py'},result,'one');
    assert.equal(repair.cached('run_file',{path:'a.py'},'one'),undefined);
  }
});
