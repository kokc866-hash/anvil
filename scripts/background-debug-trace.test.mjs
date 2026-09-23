import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentDebugger } from '../electron/agent-debugger.mjs';
import { evaluateRecordedLocals } from '../electron/agent-debugger-values.mjs';
import { buildDebugHelper } from './fixtures/background-debug-helper.mjs';
import { resolveBin } from '../companion/toolchain.mjs';

const helper = await buildDebugHelper();
const loadTrace = async () => helper;
const run = (d,action,args={},files={},signal) => d.execute({kind:'debug',action,args},{files,signal});

test('trace locals evaluate primitive expressions without executing arbitrary JavaScript', () => {
  assert.equal(evaluateRecordedLocals('x + 2 * 3',{x:'4'}),'10');
  assert.equal(evaluateRecordedLocals('(x + 2) * 3',{x:'4'}),'18');
  assert.equal(evaluateRecordedLocals('x >= 4 && x < 8',{x:'4'}),'true');
  assert.equal(evaluateRecordedLocals('"a b" + "c"',{}),'a bc');
  for(const expr of ['process.exit()','x.constructor','(()=>42)()','unknown'])assert.match(evaluateRecordedLocals(expr,{x:'4'}),/^Trace:/);
});

for(const [entry,source] of [
  ['trace.go','package main\n\nfunc main() {\n x := 1\n x += 2\n println(x)\n}\n'],
  ['trace.rs','fn main() {\n let mut x = 1;\n x += 2;\n println!("{}", x);\n}\n']
]) test(`real compiler trace ${entry} records once and replays original line/locals`, {timeout:150000,skip:!resolveBin(entry.endsWith('.go')?'go':'rustc')?'Optional native compiler not installed':false},async()=>{
  const d=new AgentDebugger({loadTrace,timeoutMs:120000});d.begin({debug:{watches:['x']}});
  try{
    let r=await run(d,'start',{path:entry},{[entry]:source});assert.equal(r.ok,true,r.error||r.stderr);assert.equal(r.mode,'replay');assert.equal(r.runCompleted,true);assert.equal(r.paused,true);assert.match(r.note,/einmal/);
    r=await run(d,'step');assert.equal(r.locals.x,'1');assert.equal(r.watchValues.x,'1');
    r=await run(d,'eval',{expr:'x + 4'});assert.equal(r.eval,'5');
    r=await run(d,'step');assert.equal(r.locals.x,'3');assert.equal(r.watchValues.x,'3');
    r=await run(d,'continue');assert.equal(r.active,false);assert.equal(r.reason,'trace-ended');
  }finally{await d.close();}
});

test('all existing trace languages use compiler snapshots once, retain breakpoints, and never retry failed runs',async()=>{
  const sources={'a.go':'package main\nfunc main() {\n println(1)\n}', 'a.rs':'fn main() {\n println!("1");\n}', 'A.java':'class A {\npublic static void main(String[] args) {\nSystem.out.println(1);\n}\n}', 'a.c':'int main() {\nreturn 0;\n}', 'a.cpp':'int main() {\nreturn 0;\n}', 'a.cs':'System.Console.WriteLine(1);', 'a.php':'<?php\necho 1;\n', 'a.rb':'puts 1\n'};
  for(const [entry,source]of Object.entries(sources)){
    let calls=0;const d=new AgentDebugger({loadTrace,runTrace:async body=>{calls++;assert.equal(body.entry,entry);assert.equal(body.headless,true);assert.ok(body.files.find(f=>f.path===entry).content.includes('__ANVIL__')||['a.go','a.rs','A.java'].includes(entry));return {ok:false,code:9,stdout:'SIDE_EFFECT_ONCE',stderr:`__ANVIL__${JSON.stringify({path:entry,line:3,locals:{x:'1'}})}\n__ANVIL__${JSON.stringify({path:entry,line:5,locals:{x:'2'}})}\nfixture failure`};}});d.begin({debug:{breakpoints:{[entry]:[5]}}});
    try{let r=await run(d,'start',{path:entry},{[entry]:source});assert.equal(calls,1);assert.equal(r.ok,false);assert.equal(r.line,3);r=await run(d,'continue');assert.equal(r.line,5);assert.equal(r.locals.x,'2');assert.equal(calls,1);assert.match(r.stdout,/SIDE_EFFECT_ONCE/);assert.match(r.error,/fixture failure/);}finally{await d.close();}
  }
});

test('trace recording Stop aborts the compiler operation and leaves no replay',async()=>{
  let started=false,signal;
  const d=new AgentDebugger({loadTrace,runTrace:(_body,options)=>{started=true;signal=options.signal;return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({ok:false,code:1,stderr:'aborted'}),{once:true}));}});d.begin({});
  const pending=run(d,'start',{path:'a.go'},{'a.go':'package main\nfunc main() {\n println(1)\n}'});
  while(!started)await new Promise(r=>setImmediate(r));await d.close();const result=await pending;assert.equal(signal.aborted,true);assert.equal(result.ok,false);assert.equal(result.active,false);assert.equal(d.replay,null);
});

test('trace preparation keeps Go helper next to nested entry and refuses reserved-file collisions',()=>{
  const files={'cmd/main.go':'package main\nfunc main() {\n println(1)\n}'};
  const prepared=helper.prepareDebugTrace('cmd/main.go',files);assert.ok(prepared.files.some(f=>f.path==='cmd/anvil_dbg.go'));
  assert.throws(()=>helper.prepareDebugTrace('cmd/main.go',{...files,'cmd/anvil_dbg.go':'USER CONTENT'}),/Reservierter/);
});

test('TypeScript enums and parameter properties execute with original source breakpoints',async()=>{
  const source='enum Shade { Red = 1, Blue = 2 }\nclass Box {\n constructor(public value: number) {}\n}\nconst box = new Box(Shade.Blue);\nconsole.log(box.value);\n';
  const d=new AgentDebugger({loadTrace});d.begin({debug:{breakpoints:{'types.ts':[6]},watches:['box.value']}});
  try{const r=await run(d,'start',{path:'types.ts',pause_on_entry:false},{'types.ts':source});assert.equal(r.ok,true,r.error||r.stderr);assert.equal(r.paused,true);assert.equal(r.path,'types.ts');assert.equal(r.line,6);assert.equal(r.watchValues['box.value'],'2');assert.equal((await run(d,'eval',{expr:'Shade.Blue'})).eval,'2');assert.equal((await run(d,'continue')).active,false);}finally{await d.close();}
  const jsx=helper.prepareTypeScriptDebug({'view.tsx':'export const view = <div>Fixture</div>;'},'view.tsx');assert.match(jsx.files['view.js'],/react\/jsx-runtime/);assert.equal(jsx.maps['view.js'].originalPath,'view.tsx');
});

test('trace total deadline aborts the whole compiler operation without retry',async()=>{
  let calls=0,signal;
  const d=new AgentDebugger({loadTrace,timeoutMs:40,runTrace:(_body,options)=>{calls++;signal=options.signal;return new Promise(resolve=>{const runningHandle=setInterval(()=>{},1000);signal.addEventListener('abort',()=>{clearInterval(runningHandle);resolve({ok:false,code:1,stderr:'deadline'});},{once:true});});}});d.begin({});
  try{const result=await run(d,'start',{path:'a.go'},{'a.go':'package main\nfunc main() {\n println(1)\n}'});assert.equal(result.ok,false);assert.match(result.error,/Zeitlimit/);assert.equal(result.active,false);assert.equal(signal.aborted,true);assert.equal(calls,1);}finally{await d.close();}
});
