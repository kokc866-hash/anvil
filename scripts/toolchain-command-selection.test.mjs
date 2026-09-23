import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {toolchainBin} from '../companion/toolchain.mjs';
test('compiler packages select the requested command and never a different sibling',()=>{
 mkdirSync('artifacts',{recursive:true});const root=mkdtempSync(resolve('artifacts','toolchain-command-'));
 const previous=process.env.ANVIL_TOOLCHAIN_HOME;process.env.ANVIL_TOOLCHAIN_HOME=root;
 try{
  for(const [kind,names]of [['rust',['cargo','rustc']],['jdk',['java','javac']]]){
   const folder=join(root,kind,'bin');mkdirSync(folder,{recursive:true});
   for(const name of names)writeFileSync(join(folder,name+'.exe'),'fixture');
   for(const name of names)assert.equal(toolchainBin(name),join(folder,name+'.exe'));
  }
  const missing=join(root,'partial');mkdirSync(join(missing,'jdk'),{recursive:true});mkdirSync(join(missing,'rust'),{recursive:true});
  writeFileSync(join(missing,'jdk','java.exe'),'fixture');writeFileSync(join(missing,'rust','cargo.exe'),'fixture');
  process.env.ANVIL_TOOLCHAIN_HOME=missing;
  assert.equal(toolchainBin('javac'),null);assert.equal(toolchainBin('rustc'),null);
 }finally{if(previous===undefined)delete process.env.ANVIL_TOOLCHAIN_HOME;else process.env.ANVIL_TOOLCHAIN_HOME=previous;}
});
