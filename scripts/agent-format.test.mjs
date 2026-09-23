import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { formatAgentFile } from '../electron/agent-format.mjs';
import { spawnRun } from '../companion/run-process.mjs';

mkdirSync('artifacts',{recursive:true});
const root=mkdtempSync(resolve('artifacts','agent-format-'));
process.env.ANVIL_INSTALL_DIR=root;
const noTools={gofmt:null,rustfmt:null,'clang-format':null,ruff:null,black:null,python:null};
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};

test('unsupported, missing, unsafe and oversized formatting fails without changing source',async()=>{
 for(const path of ['../main.go','C:/main.go','main.txt']){
  const result=await formatAgentFile({path,content:'original'},{tools:noTools});
  assert.equal(result.ok,false);assert.equal(result.content,'original');
 }
 for(const path of ['main.py','main.go','main.rs','main.cpp']){
  const result=await formatAgentFile({path,content:'original'},{tools:noTools});
  assert.equal(result.ok,false);assert.equal(result.content,'original');assert.match(result.error,/installierter Formatter/);
 }
 const huge=await formatAgentFile({path:'main.go',content:'x'.repeat(2_000_001)},{tools:noTools});
 assert.equal(huge.ok,false);assert.match(huge.error,/groß/);
});

test('native adapters use explicit isolated configuration and return only formatted copy',async()=>{
 const cases=[['main.go','gofmt'],['main.rs','rustfmt'],['main.cpp','clang-format'],['main.py','ruff'],['main.pyi','black']];
 const original=join(root,'main.go');writeFileSync(original,'USER ORIGINAL');
 for(const [path,name] of cases){
  let work;
  const result=await formatAgentFile({path,content:'original',options:{tabSize:4,insertSpaces:false}},
   {tools:{...noTools,[name]:process.execPath},run:async(file,args,cwd,timeout,env,{signal})=>{
    assert.equal(file,process.execPath);assert.ok(timeout>0&&timeout<=20000);assert.equal(signal,undefined);
    work=cwd;assert.notEqual(cwd,root);assert.equal(env.RUSTUP_AUTO_INSTALL,'0');assert.equal(env.GOTOOLCHAIN,'local');
    assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.PYTHONPATH,undefined);
    const full=args.at(-1);assert.equal(readFileSync(full,'utf8'),'original');
    if(name==='rustfmt'){assert.ok(args.includes('--config-path'));assert.match(readFileSync(args[1],'utf8'),/tab_spaces = 4/);}
    if(name==='clang-format'){
     assert.ok(args.some(x=>x.includes('BasedOnStyle: LLVM')));
     if(args.includes('--output-replacements-xml'))return {ok:true,stdout:"<replacements incomplete_format='false'></replacements>",stderr:''};
    }
    if(name==='ruff')assert.ok(args.includes('--isolated'));
    if(name==='black'){assert.ok(args.includes('--config'));assert.equal(readFileSync(args[1],'utf8'),'');}
    writeFileSync(full,'formatted');return {ok:true,stdout:'',stderr:''};
   }});
  assert.deepEqual(result,{ok:true,content:'formatted',via:name});assert.equal(existsSync(work),false);
 }
 assert.equal(readFileSync(original,'utf8'),'USER ORIGINAL');
});

test('clang-format rejects incomplete or missing XML diagnostics before changing the copy',async()=>{
 for(const stdout of ["<replacements incomplete_format='true'></replacements>",'']){
  let calls=0;
  const result=await formatAgentFile({path:'main.cpp',content:'int main( {'},{tools:{...noTools,'clang-format':process.execPath},run:async(_file,args)=>{
   calls++;assert.ok(args.includes('--output-replacements-xml'));assert.ok(!args.includes('--fail-on-incomplete-format'));
   return {ok:true,stdout,stderr:''};
  }});
  assert.equal(result.ok,false);assert.equal(result.content,'int main( {');assert.equal(calls,1);
 }
});

test('Python module selection and formatter failures are explicit, not successful unchanged code',async()=>{
 let calls=0;
 const result=await formatAgentFile({path:'main.py',content:'x= 1'},{tools:{...noTools,python:process.execPath},run:async(file,args,cwd)=>{
  calls++;assert.ok(args.includes('-I'));
  if(calls===1)return {ok:true,stdout:'{"ruff":false,"black":true}',stderr:''};
  assert.deepEqual(args.slice(0,3),['-I','-m','black']);writeFileSync(args.at(-1),'x = 1\n');return {ok:true,stderr:''};
 }});
 assert.equal(calls,2);assert.equal(result.via,'black');assert.equal(result.content,'x = 1\n');
 const fail=await formatAgentFile({path:'main.go',content:'broken'},{tools:{...noTools,gofmt:process.execPath},run:async()=>({ok:false,stderr:'syntax error'})});
 assert.equal(fail.ok,false);assert.equal(fail.content,'broken');assert.match(fail.error,/syntax error/);
 const missing=await formatAgentFile({path:'main.go',content:'x'},{tools:{...noTools,gofmt:join(root,'missing.exe')}});
 assert.equal(missing.ok,false);assert.match(missing.error,/Start fehlgeschlagen/);
});

for(const [language,path,content,expected]of[
 ['Go','main.go','package main\nfunc main(){println("hi")}\n',/func main\(\) \{/],
 ['Rust','main.rs','fn main(){println!("hi");}\n',/fn main\(\) \{/],
 ['Python','main.py','value= [1,2]\n',/value = \[1, 2\]/],
 ['C++','main.cpp','int main(){return 0;}\n',/int main\(\) \{/]
])test(`real installed ${language} formatter handles valid and invalid syntax without touching project`,async t=>{
 const result=await formatAgentFile({path,content});
 if(!result.ok&&/Kein installierter Formatter/.test(result.error)){t.skip(result.error);return;}
 assert.equal(result.ok,true,result.error);assert.match(result.content,expected);
 const broken=await formatAgentFile({path,content:language==='Go'?'package main\nfunc main( {':language==='Rust'?'fn main( {':language==='Python'?'def main( :':'int main( {'});
 assert.equal(broken.ok,false,`${language} must report invalid syntax`);
});

test('abort and timeout terminate formatter plus descendants and remove temporary source',async()=>{
 for(const mode of ['abort','timeout']){
  const fixture=join(root,mode+'.cjs'),pidFile=join(root,mode+'.pid');
  writeFileSync(fixture,`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit',windowsHide:true});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000);`);
  const controller=new AbortController();let parent,work;
  const promise=formatAgentFile({path:'main.go',content:'package main'},{tools:{...noTools,gofmt:process.execPath},signal:controller.signal,timeoutMs:mode==='timeout'?1800:10000,run:(file,args,cwd,timeout,env,opts)=>{
   work=cwd;return spawnRun(process.execPath,[fixture],cwd,timeout,env,{...opts,onStart:pid=>parent=pid});
  }});
  try{
   for(let i=0;i<100&&!existsSync(pidFile);i++)await new Promise(r=>setTimeout(r,20));
   assert.ok(existsSync(pidFile),'formatter descendant started');const child=Number(readFileSync(pidFile,'utf8'));
   if(mode==='abort'){controller.abort();await assert.rejects(promise,e=>e.name==='AbortError');}
   else{const result=await promise;assert.equal(result.ok,false);assert.match(result.error,/Zeitlimit/);}
   for(let i=0;i<100&&(alive(parent)||alive(child));i++)await new Promise(r=>setTimeout(r,20));
   assert.equal(alive(parent),false);assert.equal(alive(child),false);assert.equal(existsSync(work),false);
  }finally{controller.abort();await promise.catch(()=>{});}
 }
});
