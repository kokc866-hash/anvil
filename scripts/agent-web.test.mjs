import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer,request as localRequest } from 'node:http';
import { readAgentWeb,publicWebAddress } from '../electron/agent-web.mjs';

test('public address policy rejects local, metadata, mapped, transition and reserved ranges',()=>{
 for(const address of ['127.0.0.1','169.254.169.254','10.0.0.1','100.64.0.1','172.31.1.1','192.168.1.1','198.18.0.1','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::'])assert.equal(publicWebAddress(address),false,address);
 for(const address of ['93.184.216.34','8.8.8.8','2606:4700:4700::1111'])assert.equal(publicWebAddress(address),true,address);
});

test('public fetch pins DNS, bounds responses and redirects, and aborts without sending credentials',async()=>{
 const seen=[];
 const server=createServer((req,res)=>{
  seen.push(req.headers);
  if(req.url==='/redirect'){res.writeHead(302,{Location:'http://127.0.0.1/private'}).end();return;}
  if(req.url==='/rebind'){res.writeHead(302,{Location:'http://rebound.test/final'}).end();return;}
  if(req.url==='/large'){res.end('x'.repeat(2000));return;}
  if(req.url==='/slow'){return;}
  res.end('<h1>Public fixture</h1><script>secretInstruction()</script><p>Readable &amp; safe</p>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let connections=0;
 const resolveHost=async host=>[{address:host==='rebound.test'?'192.168.0.2':'93.184.216.34',family:4}];
 const request=(url,options,callback)=>{
  connections++;
  options.lookup(url.hostname,{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'93.184.216.34');assert.equal(family,4);});
  // Test-only connector routes the vetted public request into this synthetic server.
  return localRequest(new URL(url.pathname,`http://127.0.0.1:${server.address().port}`),{...options,lookup:undefined},callback);
 };
 try{
  const result=await readAgentWeb('https://public.test/',{resolveHost,request});assert.equal(result.ok,true);assert.equal(result.text,'Public fixture Readable & safe');
  assert.equal(seen[0].authorization,undefined);assert.equal(seen[0].cookie,undefined);
  const direct=connections;
  assert.equal((await readAgentWeb('http://user:password@public.test/',{resolveHost,request})).ok,false);assert.equal(connections,direct);
  assert.equal((await readAgentWeb('http://private.test/',{resolveHost:async()=>[{address:'127.0.0.1',family:4}],request})).ok,false);assert.equal(connections,direct);
  assert.equal((await readAgentWeb('https://public.test/redirect',{resolveHost,request})).ok,false);assert.equal(connections,direct+1);
  assert.equal((await readAgentWeb('https://public.test/rebind',{resolveHost,request})).ok,false);assert.equal(connections,direct+2);
  assert.match((await readAgentWeb('https://public.test/large',{resolveHost,request,maxBytes:1024})).text,/Leselimit/);
  const controller=new AbortController();const pending=readAgentWeb('https://public.test/slow',{resolveHost,request,signal:controller.signal});
  setTimeout(()=>controller.abort(),30);await assert.rejects(pending,error=>error.name==='AbortError');
  const timeout=await readAgentWeb('https://public.test/slow',{resolveHost,request,timeoutMs:30});assert.equal(timeout.ok,false);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
