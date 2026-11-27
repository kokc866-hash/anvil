import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeFileChange, checkProtectedWrite, validFileProtection } from '../electron/file-protection.mjs';

const original = 'header { color: black; }\nbody { background: #f5f5f5; }\nfooter { color: black; }\n';
const manual = original.replace('#f5f5f5', '#242323');
const protection = () => observeFileChange(undefined, original, manual);

test('an unchanged acknowledged file creates no user protection', () => {
  assert.equal(observeFileChange(undefined, original, original), undefined);
  assert.equal(checkProtectedWrite(undefined, original, original.replace('header', 'nav')).ok, true);
});

test('a manual CSS color cannot be reverted by a stale broad write', () => {
  const p = protection();
  assert.equal(validFileProtection(p), true);
  assert.equal(checkProtectedWrite(p, manual, original.replace('black', 'white')).ok, false);
  assert.equal(p.content, manual);
});

test('reading the current file does not authorize overwriting the user color', () => {
  const p = observeFileChange(protection(), manual, manual);
  assert.equal(checkProtectedWrite(p, manual, manual.replace('#242323', '#1a1a2e')).ok, false);
  assert.equal(checkProtectedWrite(p, manual, manual).ok, true);
});

test('narrow independent edits can continue and retain the protected line', () => {
  const next = manual.replace('header { color: black; }', 'header { color: white; padding: 8px; }');
  const accepted = checkProtectedWrite(protection(), manual, next);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.protection.content, next);
  assert.equal(validFileProtection(accepted.protection), true);
  assert.equal(checkProtectedWrite(accepted.protection, next, next.replace('#242323', '#ffffff')).ok, false);
  const final = next.replace('footer { color: black; }', 'footer { color: white; }');
  assert.equal(checkProtectedWrite(accepted.protection, next, final).ok, true);
});

test('a broad edit spanning a protected line is conservatively refused', () => {
  const next = manual.replaceAll('black', 'white');
  assert.equal(checkProtectedWrite(protection(), manual, next).ok, false);
});

test('copying the protected text elsewhere cannot license its removal', () => {
  const next = manual.replace('body { background: #242323; }', 'body { background: pink; }')
    + '/* body { background: #242323; } */\n';
  assert.equal(checkProtectedWrite(protection(), manual, next).ok, false);
});

test('the whole modified line is protected rather than just its color value', () => {
  assert.equal(checkProtectedWrite(protection(), manual, manual.replace('body {', '.other {')).ok, false);
  assert.equal(checkProtectedWrite(protection(), manual, manual.replace('body {', '// body {')).ok, false);
});

test('CRLF and BOM are preserved exactly and remain protected', () => {
  const before = '\ufeffheader {}\r\nbody { color: black; }\r\nfooter {}\r\n';
  const current = before.replace('black', 'weiß');
  const p = observeFileChange(undefined, before, current);
  const after = current.replace('header {}', 'header { margin: 1px; }');
  const result = checkProtectedWrite(p, current, after);
  assert.equal(result.ok, true);
  assert.equal(result.protection.content, after);
  assert.equal(checkProtectedWrite(result.protection, after, after.replace('weiß', 'black')).ok, false);
});

test('UTF16 offsets remain correct around emoji and non-ASCII text', () => {
  const before = '/* 🐣 */\nTitel: Alt\nNachlauf\n';
  const current = before.replace('Alt', 'Bäume 🌲');
  const p = observeFileChange(undefined, before, current);
  const next = current.replace('/* 🐣 */', '/* 🐣🐣 Ä */');
  const result = checkProtectedWrite(p, current, next);
  assert.equal(result.ok, true);
  assert.equal(checkProtectedWrite(result.protection, next, next.replace('Bäume 🌲', 'Alt')).ok, false);
});

test('later external edits add protection without dropping earlier user changes', () => {
  const current = manual.replace('footer { color: black; }', 'footer { color: orange; }');
  const p = observeFileChange(protection(), manual, current);
  assert.equal(checkProtectedWrite(p, current, current.replace('#242323', '#fff')).ok, false);
  assert.equal(checkProtectedWrite(p, current, current.replace('orange', 'blue')).ok, false);
  assert.equal(checkProtectedWrite(p, current, current.replace('header', 'nav')).ok, true);
});

test('an external replacement of an already protected line protects its new value', () => {
  const current = manual.replace('#242323', '#112233');
  const p = observeFileChange(protection(), manual, current);
  assert.equal(checkProtectedWrite(p, current, current.replace('#112233', '#242323')).ok, false);
  assert.equal(checkProtectedWrite(p, current, current.replace('footer', 'section')).ok, true);
});

test('user deletion of a whole file cannot be silently resurrected', () => {
  const p = observeFileChange(undefined, original, null);
  assert.equal(validFileProtection(p), true);
  assert.equal(checkProtectedWrite(p, null, original).ok, false);
  assert.equal(checkProtectedWrite(p, null, null).ok, true);
});

test('a user-created file after deletion remains protected', () => {
  const deleted = observeFileChange(undefined, original, null);
  const p = observeFileChange(deleted, null, 'User replacement\n');
  assert.equal(checkProtectedWrite(p, 'User replacement\n', original).ok, false);
});

test('a deleted line leaves an anchor that cannot be reinserted over', () => {
  const before = 'first\nremove this\nlast\n', current = 'first\nlast\n';
  const p = observeFileChange(undefined, before, current);
  assert.equal(p.ranges.some(([a,b]) => a === b), true);
  assert.equal(checkProtectedWrite(p, current, before).ok, false);
  assert.equal(checkProtectedWrite(p, current, 'FIRST last\n').ok, false, 'removing the newline ending on a deletion anchor is conservatively blocked');
  assert.equal(checkProtectedWrite(p, current, 'first\nlast\nextra\n').ok, true);
});

test('partial line deletion protects the surviving user-edited line', () => {
  const before = 'top\nbody { color: red; }\nbottom\n';
  const current = before.replace('red', '');
  const p = observeFileChange(undefined, before, current);
  assert.equal(checkProtectedWrite(p, current, current.replace('color:', 'background:')).ok, false);
  assert.equal(checkProtectedWrite(p, current, before).ok, false);
});

test('binary representations are protected as opaque content', () => {
  const before = 'data:application/octet-stream;base64,AAEC';
  const current = 'data:application/octet-stream;base64,AwQF';
  const p = observeFileChange(undefined, before, current);
  assert.equal(p.opaque, true);
  assert.equal(checkProtectedWrite(p, current, before).ok, false);
  assert.equal(checkProtectedWrite(p, current, current).ok, true);
});

test('a stale protected snapshot must be refreshed, not granted as a write base', () => {
  assert.equal(checkProtectedWrite(protection(), original, manual).ok, false);
});

test('serialized protection rejects malformed, excess and unknown state', () => {
  const p = protection();
  assert.equal(validFileProtection(JSON.parse(JSON.stringify(p))), true);
  for (const bad of [null,{},[],{...p,version:2},{...p,content:42},{...p,ranges:[]},
    {...p,ranges:[[-1,2]]},{...p,ranges:[[0,manual.length+1]]},{...p,ranges:[[2,1]]},
    {...p,ranges:[[0,1],[0,1]]},{...p,ranges:[[0,1,2]]},{...p,ranges:[[0.5,1]]},
    {...p,grant:true},{...p,opaque:'yes'},{version:1,content:null,ranges:[[0,1]]},
    {...p,ranges:Array.from({length:257},()=>[0,0])}]) {
    assert.equal(validFileProtection(bad),false,JSON.stringify(bad));
    assert.equal(checkProtectedWrite(bad,manual,original).ok,false,'invalid state must fail closed');
    assert.throws(()=>observeFileChange(bad,manual,manual));
  }
});

test('oversized UTF8 snapshots are refused rather than dropping protection', () => {
  const large = '🌲'.repeat(600000);
  assert.throws(()=>observeFileChange(undefined, '', large));
  assert.equal(checkProtectedWrite(protection(),manual,large).ok,false);
  assert.equal(validFileProtection({version:1,content:large,ranges:[[0,1]]}),false);
});

test('many bounded edits preserve source text and protection positions', () => {
  let text = manual, p = protection();
  for (let i=0;i<150;i++) {
    const next = text.replace(/header[^\n]*/,`header { padding: ${i}px; }`);
    const result = checkProtectedWrite(p,text,next);
    assert.equal(result.ok,true,'independent header edit '+i);
    text = next; p = result.protection;
    assert.equal(p.content.includes('body { background: #242323; }'),true);
    assert.equal(checkProtectedWrite(p,text,text.replace('#242323','#fff')).ok,false);
  }
});

test('a user-inserted newline protects both halves of the split line', () => {
  const before='first\nalpha beta\nlast\n', current='first\nalpha\n beta\nlast\n';
  const p=observeFileChange(undefined,before,current);
  assert.equal(checkProtectedWrite(p,current,current.replace('alpha','changed')).ok,false);
  assert.equal(checkProtectedWrite(p,current,current.replace('beta','changed')).ok,false);
  assert.equal(checkProtectedWrite(p,current,current.replace('first','FIRST')).ok,true);
});

test('a later user insertion before an existing protected line remaps both restrictions', () => {
  const current='/* User note */\n'+manual;
  const p=observeFileChange(protection(),manual,current);
  assert.equal(checkProtectedWrite(p,current,current.replace('User note','Other')).ok,false);
  assert.equal(checkProtectedWrite(p,current,current.replace('#242323','#fff')).ok,false);
  const next=current.replace('header { color: black; }','header { color: white; }');
  const result=checkProtectedWrite(p,current,next);
  assert.equal(result.ok,true);
  assert.equal(checkProtectedWrite(result.protection,next,next.replace('#242323','#fff')).ok,false);
});

test('user removal of an already protected line preserves its deletion anchor', () => {
  const current=manual.replace('body { background: #242323; }\n','');
  const p=observeFileChange(protection(),manual,current);
  assert.equal(validFileProtection(p),true);
  assert.equal(checkProtectedWrite(p,current,manual).ok,false);
});

test('appending to an unterminated protected line is not an unrelated insertion', () => {
  const p=observeFileChange(undefined,'top\nuser:old','top\nuser:new');
  assert.equal(checkProtectedWrite(p,'top\nuser:new','top\nuser:new suffix').ok,false);
  assert.equal(checkProtectedWrite(p,'top\nuser:new','TOP\nuser:new').ok,true);
});

test('fragmented later edits stay bounded without losing earlier protection', () => {
  let text=Array.from({length:604},(_,i)=>`line${i}: old\n`).join('');
  let p;
  for(let i=0;i<600;i+=2){
    const next=text.replace(`line${i}: old\n`,`line${i}: user\n`);
    p=observeFileChange(p,text,next);text=next;
  }
  assert.equal(validFileProtection(p),true);
  assert.ok(p.ranges.length<=256);
  assert.equal(checkProtectedWrite(p,text,text.replace('line0: user','line0: old')).ok,false);
  assert.equal(checkProtectedWrite(p,text,text.replace('line598: user','line598: old')).ok,false);
  assert.equal(checkProtectedWrite(p,text,text.replace('line603: old','line603: agent')).ok,true);
});

test('a refreshed observed snapshot retains protection even if caller cache was stale', () => {
  const p=protection();
  assert.deepEqual(observeFileChange(p,original,manual),p);
  assert.equal(checkProtectedWrite(observeFileChange(p,original,manual),manual,original).ok,false);
});

test('protection operations do not mutate or alias persisted input ranges', () => {
  const p=protection(), snapshot=JSON.stringify(p);
  p.ranges.forEach(Object.freeze);Object.freeze(p.ranges);Object.freeze(p);
  const result=checkProtectedWrite(p,manual,manual.replace('header','nav'));
  assert.equal(result.ok,true);
  assert.equal(JSON.stringify(p),snapshot);
  assert.notEqual(result.protection,p);assert.notEqual(result.protection.ranges,p.ranges);
  const observed=observeFileChange(p,manual,manual);
  assert.notEqual(observed.ranges,p.ranges);
});
