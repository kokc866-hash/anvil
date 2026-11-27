import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {AgentJobHost} from './agent-job-host.mjs';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8xoAAAAASUVORK5CYII=';
const gif='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const wideGif='data:image/gif;base64,R0lGODlhAgABAAD/ACwAAAAAAQABAAACADs=';
const widerGif='data:image/gif;base64,R0lGODlhAwABAAD/ACwAAAAAAQABAAACADs=';
function fixture(t){
  const root=resolve('artifacts/cursor-adoption-2026-10-19/host-fixtures');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'steering-'));
  const sent=[];let child;
  const runtime={begin(){},close(){},finish(){}};
  const host=new AgentJobHost({snapshotPath:join(dir,'latest.json'),runtime,launch:()=>{child=new EventEmitter();child.send=m=>sent.push(m);child.kill=()=>{};return child;}});
  t.after(()=>host.close());
  const request={project:'synthetic-steering-project',model:{provider:'custom',model:'fixture',vision:false},messages:[{role:'user',content:'Build the artificial file.'}],files:{'a.txt':'unchanged'},execution:true};
  host.start(request);return {host,request,sent,get child(){return child;},dir};
}
test('host persists a correction before ready, delivers once and acknowledges exact IDs',t=>{
  const f=fixture(t),id=f.host.state.id;
  f.host.steer(id,'Do not change files; inspect only.','correction-1');assert.equal(f.sent.length,0);
  assert.equal(JSON.parse(readFileSync(join(f.dir,'latest.json'),'utf8')).steering[0].status,'queued');
  f.child.emit('message',{type:'ready'});assert.deepEqual(f.sent.map(m=>m.type),['start','steer']);
  f.host.steer(id,'Do not change files; inspect only.','correction-1');assert.equal(f.sent.length,2);
  assert.throws(()=>f.host.steer(id,'Different contents.','correction-1'));
  f.child.emit('message',{type:'steering-applied',ids:['forged']});assert.equal(f.host.state.steering[0].status,'queued');
  f.child.emit('message',{type:'steering-applied',ids:['correction-1']});assert.equal(f.host.state.steering[0].status,'applied');
  assert.throws(()=>f.host.steer('old-job','wrong','correction-2'));
});
test('stopped job rejects steering; continuation preserves corrections as human context without replaying calls',t=>{
  const f=fixture(t),id=f.host.state.id;f.child.emit('message',{type:'ready'});
  f.host.steer(id,'Only the clock, no network.','correction-2');f.host.stop();
  assert.throws(()=>f.host.steer(id,'Late input.','correction-3'));
  f.host.resume(id,f.request);f.child.emit('message',{type:'ready'});
  const start=f.sent.filter(m=>m.type==='start').at(-1);
  assert.match(start.request.messages.at(-1).content,/Only the clock, no network/);
  assert.deepEqual(f.host.state.steering,[],'continuation uses context, not old dispatch IDs');
});
test('recovered corrections remain visible and are never sent without explicit continuation',t=>{
  const f=fixture(t),id=f.host.state.id;f.host.steer(id,'Keep the intentional failure.','correction-4');f.host.persist();
  const recovered=new AgentJobHost({snapshotPath:join(f.dir,'latest.json'),launch(){throw Error('must not start');}});t.after(()=>recovered.close());
  assert.equal(recovered.state.status,'interrupted');assert.equal(recovered.state.steering[0].text,'Keep the intentional failure.');assert.equal(recovered.child,null);
});
test('manual correction images are persisted, delivered and deduplicated with their text',t=>{
  const f=fixture(t),id=f.host.state.id;
  f.host.steer(id,'Use the first example.','visual-1',[png]);
  assert.deepEqual(JSON.parse(readFileSync(join(f.dir,'latest.json'),'utf8')).steering[0].images,[png]);
  f.child.emit('message',{type:'ready'});
  assert.deepEqual(f.sent[1].message.images,[png]);
  f.host.steer(id,'Use the first example.','visual-1',[png]);
  assert.throws(()=>f.host.steer(id,'Use the first example.','visual-1',[gif]),/Kennung/);
  assert.equal(f.sent.length,2);
  f.host.steer(id,'Compare the second example.','visual-2',[gif]);
  assert.deepEqual(f.sent.at(-1).message.images,[gif]);
  f.child.emit('message',{type:'steering-applied',ids:['visual-2']});
  assert.deepEqual(f.host.state.steering.map(({status})=>status),['queued','applied']);
});
test('invalid correction images do not touch the running job or dispatch anything',t=>{
  const f=fixture(t),id=f.host.state.id;f.child.emit('message',{type:'ready'});
  const previous=f.host.snapshot();
  for(const images of [null,new Array(1),['https://image.invalid/a.png'],['data:image/png;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='],Array(5).fill(png)])
    assert.throws(()=>f.host.steer(id,'Use the picture.','invalid-image',images),/Bild/);
  assert.deepEqual(f.host.snapshot(),previous);
  assert.deepEqual(f.sent.map(({type})=>type),['start']);
});
test('repeated resume restores actual correction images without replay or duplicates',t=>{
  const f=fixture(t);const oldId=f.host.state.id;f.child.emit('message',{type:'ready'});
  const pictures=[png,gif,wideGif,widerGif];
  f.host.steer(oldId,'Use the first example.','visual-1',pictures);
  f.host.steer(oldId,'Ignore the second example.','visual-2',[gif]);
  f.child.emit('message',{type:'steering-rejected',id:'visual-2'});
  f.host.stop();
  const request={...f.request,messages:[{role:'user',content:'Korrektur: Use the first example.',images:pictures.slice(0,2)},...f.request.messages]};
  f.host.resume(oldId,request);f.child.emit('message',{type:'ready'});
  const attached=()=>f.sent.filter(m=>m.type==='start').at(-1).request.messages.filter(m=>m.images?.length);
  assert.deepEqual(attached(),[{role:'user',content:'Korrektur: Use the first example.',images:pictures}]);
  const recovered=new AgentJobHost({snapshotPath:join(f.dir,'latest.json'),launch(){throw Error('must not start');}});t.after(()=>recovered.close());
  assert.deepEqual(recovered.state.resumedImageCorrections,[{text:'Use the first example.',images:pictures}]);
  const nextId=f.host.state.id;f.host.stop();f.host.resume(nextId,f.request);f.child.emit('message',{type:'ready'});
  assert.deepEqual(attached(),[{role:'user',content:'Use the first example.',images:pictures}]);
  assert.equal(f.sent.filter(m=>m.type==='steer').length,2);
});
test('exact and shortened correction history entries each pair with just one native entry',t=>{
  const f=fixture(t),id=f.host.state.id;f.child.emit('message',{type:'ready'});
  const text='Use these references.';
  const pictures=[png,gif,wideGif,widerGif];
  const otherPictures=[png,gif,widerGif,wideGif];
  f.host.steer(id,text,'visual-1',pictures);
  f.host.steer(id,text,'visual-2',otherPictures);
  f.host.steer(id,text,'visual-3',pictures);
  f.host.stop();
  const visible=images=>({role:'user',content:`Korrektur: ${text}`,images});
  const messages=[visible(pictures.slice(0,2)),visible(otherPictures),visible(pictures.slice(0,2)),...f.request.messages];
  f.host.resume(id,{...f.request,messages});f.child.emit('message',{type:'ready'});
  const restored=f.sent.filter(m=>m.type==='start').at(-1).request.messages.filter(m=>m.images?.length);
  assert.deepEqual(restored,[visible(pictures),visible(otherPictures),visible(pictures)]);
});
