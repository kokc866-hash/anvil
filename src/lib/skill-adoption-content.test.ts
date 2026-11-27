import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { load } from 'js-yaml';
import { parseSkillMd } from './learn-parse.ts';
import { planSkillPackage } from './skill-package.ts';
import { debugKnowledgeSkill, ANVIL_SKILL_TOOL_NAMES } from '../../electron/knowledge-skill-check.mjs';

const directory = 'skills/anvil';
const catalog = JSON.parse(readFileSync(join(directory, 'catalog.json'), 'utf8')) as {id:string;version:string;tools:string[];readOnly:boolean}[];
const additions = ['anvil-eigenschaftstests', 'anvil-react', 'anvil-bedienung-verbessern'];
const adapted = ['anvil-fehler-beheben','anvil-tests','anvil-aenderungen-pruefen','anvil-web','anvil-freecad','anvil-godot','anvil-unity','anvil-skill-erstellen','anvil-dienste',...additions];
const read = (id:string, resource='SKILL.md') => readFileSync(join(directory,id,resource),'utf8');
function packageFiles(id:string):Record<string,string> {
  const root=join(directory,id);
  const visit=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?visit(join(dir,item.name)):[join(dir,item.name)]);
  return Object.fromEntries(visit(root).map(file=>[relative(root,file).replaceAll('\\','/'),readFileSync(file,'utf8')]));
}

test('curated skill packages include all resources and retain metadata through actual import planning',()=>{
  for(const id of adapted){
    const files=packageFiles(id),body=read(id),parsed=parseSkillMd(body,'SKILL.md');
    assert.ok(parsed,id);
    assert.equal(parsed.name,id);
    assert.ok(parsed.body.length<3500,`${id}: bundled entry instructions must remain below 3500 characters`);
    const planned=planSkillPackage(files,{});
    assert.equal(planned.skill.name,id);
    assert.ok(Object.keys(planned.files).every(file=>file.startsWith(`.anvil/skills/${id}/`)),`${id}: writes confined to skill directory`);
    assert.equal(planned.files[`.anvil/skills/${id}/SKILL.md`],body);
    assert.equal(planned.files[`.anvil/skills/${id}/references/quellen.json`],files['references/quellen.json']);
    assert.ok(Object.keys(files).every(file=>file==='SKILL.md'||/^references\/.+\.(?:md|txt|json)$/.test(file)),`${id}: no executable upstream payload`);
    const resources=Object.fromEntries(Object.entries(files).filter(([file])=>file!=='SKILL.md'));
    const checked=debugKnowledgeSkill({name:id,when:parsed.when,body:parsed.body},{resources});
    assert.equal(checked.ok,true,`${id}: ${checked.issues.join('; ')}`);
    assert.equal(checked.checks.references,'pass');
    assert.equal(checked.checks.behavior,'unverified','Static import never becomes behavioral acceptance');
    const header=load(body.match(/^---\n([\s\S]*?)\n---/)![1]) as {metadata:{version:string;provenance:string}};
    assert.equal(header.metadata.version,catalog.find(item=>item.id===id)!.version);
    assert.equal(header.metadata.provenance,'references/quellen.json');
  }
});

test('curated sources stay pinned and disclose adaptation and unverified runtime behavior',()=>{
  for(const id of adapted){
    const provenance=JSON.parse(read(id,'references/quellen.json')) as {adaptedFor:string;runtimeAcceptance:string;upstreamCodeExecuted:boolean;sources:{repo:string;commit:string;path:string;license:string;url:string}[]};
    assert.equal(provenance.adaptedFor,'Anvil');
    assert.equal(provenance.runtimeAcceptance,'unverified');
    assert.equal(provenance.upstreamCodeExecuted,false);
    assert.ok(provenance.sources.length>0);
    for(const source of provenance.sources){
      assert.match(source.commit,/^[a-f0-9]{40}$/);
      assert.equal(source.url,`https://github.com/${source.repo}/blob/${source.commit}/${source.path}`);
      assert.ok(source.license.length>0);
    }
    assert.match(read(id,'references/quellen.md'),/keine fremden Installer, Hooks/);
  }
});

test('license and attribution travel with derived property, security and design guides',()=>{
  const property=load(read('anvil-eigenschaftstests').match(/^---\n([\s\S]*?)\n---/)![1]) as {license:string};
  assert.equal(property.license,'CC-BY-SA-4.0');
  for(const id of ['anvil-eigenschaftstests','anvil-aenderungen-pruefen']){
    assert.match(read(id,'references/lizenz-trail.txt'),/Creative Commons|Attribution-ShareAlike/i);
    assert.match(read(id,'references/quellen.md'),/Trail of Bits/);
    assert.match(read(id,'references/quellen.md'),/CC-BY-SA-4.0/);
  }
  const ui='anvil-bedienung-verbessern';
  assert.match(read(ui,'references/lizenz-impeccable.txt'),/Apache License/);
  assert.match(read(ui,'references/notice-impeccable.md'),/Third-Party Notices/);
  assert.match(read(ui,'references/quellen.md'),/nicht übernommen/);
  assert.match(read('anvil-react','references/lizenz-vercel.txt'),/declare license: MIT/);
  assert.match(read('anvil-react','references/lizenz-vercel.txt'),/Permission is hereby granted/);
  assert.match(read('anvil-dienste','references/lizenz-notion.txt'),/Copyright 2025 Notion Labs, Inc\./);
  assert.match(read('anvil-fehler-beheben','references/lizenz-hf.txt'),/Apache License/);
});

test('native bindings are bounded known names and read-only review cannot advertise mutations',()=>{
  assert.equal(catalog.length,23);
  assert.equal(new Set(catalog.map(skill=>skill.id)).size,catalog.length);
  const known=new Set(ANVIL_SKILL_TOOL_NAMES);
  for(const skill of catalog){
    assert.ok(skill.tools.length>0 && skill.tools.length<=4,skill.id);
    assert.equal(new Set(skill.tools).size,skill.tools.length);
    for(const tool of skill.tools)assert.ok(known.has(tool),`${skill.id}: ${tool}`);
  }
  const review=catalog.find(skill=>skill.id==='anvil-aenderungen-pruefen')!;
  assert.equal(review.readOnly,true);
  assert.ok(review.tools.every(name=>['git_status','read_file','grep','review_read_baseline'].includes(name)));
});

test('specialist entry instructions keep details lazy and preserve concrete user boundaries',()=>{
  for(const id of additions){
    const parsed=parseSkillMd(read(id),'SKILL.md')!;
    assert.ok(parsed.body.length<5000,`${id}: details stay in references`);
    assert.ok(Object.keys(packageFiles(id)).some(file=>file.startsWith('references/')));
  }
  assert.match(read('anvil-eigenschaftstests'),/Absichtliche Fehler.*nicht ungefragt reparieren/);
  assert.match(read('anvil-eigenschaftstests'),/kein Auftrag zur Installation/);
  assert.match(read('anvil-react'),/Eine TSX-Datei.*allein belegt keine/);
  assert.match(read('anvil-react'),/kein Grund, Next.js/);
  assert.match(read('anvil-bedienung-verbessern'),/Eine reine Bewertung bleibt lesend/);
  assert.match(read('anvil-bedienung-verbessern'),/keine zusätzlichen Abnahmefenster/);
  assert.match(read('anvil-godot','references/headless-und-verhalten.md'),/keine neue engine_run-Aktion/);
  assert.match(read('anvil-freecad','references/parametrik-und-messfaelle.md'),/keine opaken Python-Aktionen blind wiederholen/i);
});

test('Notion workflow and model diagnostics preserve real service scope and selected network settings',()=>{
  const notion=read('anvil-dienste','references/notion-spezifikation-und-aufgaben.md');
  assert.match(notion,/Nur bestätigte Namen und inputSchema verwenden/);
  assert.match(notion,/noch kein Auftrag, Notion-Seiten/);
  assert.match(notion,/Ein erfolgreicher Notion-Schreibaufruf bestätigt nur die Änderung in Notion/);
  assert.match(notion,/Keine Aufgaben oder Kommentare blind erneut erstellen/);
  assert.match(notion,/keine Codex-App-ID, fremde OAuth-Datei/);
  const diagnostics=read('anvil-fehler-beheben','references/kontext-und-modell.md');
  assert.match(diagnostics,/Schätzung.*keine vom Anbieter gemeldete aktuelle Tokenzahl/s);
  assert.match(diagnostics,/keine stillschweigende Kontextreduzierung/i);
  assert.match(diagnostics,/keinen CPU-Fallback/);
  assert.match(diagnostics,/keinen zusätzlichen llama.cpp-\/Ollama-\/KI-Studio-Server starten/);
  assert.match(diagnostics,/Lange aktive Berechnung ist kein Schleifennachweis/);
  const sources=JSON.parse(read('anvil-fehler-beheben','references/quellen.json')) as {sources:{repo:string;path:string}[]};
  assert.ok(sources.sources.some(source=>source.repo==='affaan-m/ECC'&&source.path==='skills/context-budget/SKILL.md'));
  assert.ok(sources.sources.some(source=>source.repo==='huggingface/skills'&&source.path==='skills/huggingface-local-models/SKILL.md'));
});
