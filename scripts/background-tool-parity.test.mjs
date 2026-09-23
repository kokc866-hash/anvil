import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBackgroundFile } from '../src/agent-runtime/format.ts';
import { readBackgroundKnowledge } from '../src/agent-runtime/knowledge.ts';

test('background formatter honors indentation and nested JSON preferences without running project plugins',async()=>{
 const files={'.prettierrc':JSON.stringify({singleQuote:true,semi:false,plugins:['./evil.js']}),'src/.prettierrc.json':JSON.stringify({tabWidth:4}),'.prettierrc.js':'throw Error("must never load config")','evil.js':'throw Error("must never load plugin")'};
 const result=await formatBackgroundFile('src/demo.ts','function greet(){const name="World";return name;}',files,{tabSize:8,insertSpaces:true});
 assert.match(result,/\n {4}const name = 'World'\n/);assert.ok(!result.includes(';'));
 const tabs=await formatBackgroundFile('demo.js','if(true){console.log("hi")}',{}, {insertSpaces:false});
 assert.match(tabs,/\n\tconsole/);
 assert.equal(await formatBackgroundFile('config.json','{"a":1}',{}),'{ "a": 1 }\n');
 const html=await formatBackgroundFile('page.html','<html><body><h1>Hi</h1></body></html>',{});assert.match(html,/<h1>Hi<\/h1>/);
 const invalid=()=>formatBackgroundFile('bad.js','const x = ;',{});await assert.rejects(invalid);
 await assert.rejects(()=>formatBackgroundFile('../bad.js','const x=1',{}),/Ungültiger/);
 await assert.rejects(()=>formatBackgroundFile('main.py','pass',{}),/kein unabhängiger Formatter/);
});

test('read-only knowledge respects injection, skill listing and body permissions and cannot mutate snapshot',()=>{
 const snapshot={enabled:true,skillsEnabled:true,skillBodies:true,memories:[{id:'u',text:'User fact',scope:'user'},{id:'p',text:'This project',scope:'project'}],skills:[{id:'s1',name:'test-workflow',description:'test workflow checks',body:'1. Inspect files.\n2. Run checks.',baseDirectory:'.anvil/skills/test',resources:['.anvil/skills/test/reference.md']}]};
 const before=JSON.stringify(snapshot);
 assert.deepEqual(readBackgroundKnowledge(snapshot,'list').project,[snapshot.memories[1]]);
 assert.equal(readBackgroundKnowledge(snapshot,'skills')[0].name,'test-workflow');
 assert.equal(readBackgroundKnowledge(snapshot,'skills')[0].body,undefined,'list does not expose bodies');
 assert.equal(readBackgroundKnowledge(snapshot,'read',{name:'s1'}).body,snapshot.skills[0].body);
 assert.equal(readBackgroundKnowledge(snapshot,'debug').broken.length,0);
 assert.match(readBackgroundKnowledge(snapshot,'read',{name:'foreign-project-skill'}).error,/fehlt/);
 for(const action of ['add','forget','write','patch','run','outcome'])assert.ok(readBackgroundKnowledge(snapshot,action,{name:'s1',text:'altered'}).error);
 assert.equal(JSON.stringify(snapshot),before);
 assert.match(readBackgroundKnowledge({...snapshot,enabled:false},'list').error,/Zugriff aus/);
 assert.match(readBackgroundKnowledge({...snapshot,skillsEnabled:false},'skills').error,/Skills aus/);
 assert.match(readBackgroundKnowledge({...snapshot,skillBodies:false},'read',{name:'s1'}).error,/Anweisungen aus/);
 assert.match(readBackgroundKnowledge({...snapshot,skillBodies:false},'debug').error,/Anweisungen aus/);
 assert.equal(readBackgroundKnowledge({...snapshot,skillBodies:false},'skills').length,1);
});
