import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/** Restrict fetch_url to globally routable addresses, including redirect destinations. */
export function publicWebAddress(address) {
 const value=String(address).toLowerCase().replace(/^\[|\]$/g,'');
 if(isIP(value)===4){
  const [a,b,c]=value.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||
   (a===172&&b>=16&&b<=31)||(a===192&&(b===168||(b===0&&(c===0||c===2))||(b===88&&c===99)))||
   (a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
 }
 // Only native global-unicast IPv6; exclude special transition/documentation ranges.
 return isIP(value)===6 && /^[23][0-9a-f]{3}:/.test(value) &&
  !/^2001:(?:0*:|0*db8:|0*1[0-9a-f]:|0*2[0-9a-f]:)/.test(value) && !/^2002:/.test(value);
}
function publicUrl(raw) {
 const url=new URL(String(raw));
 const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Nur öffentliche HTTP(S)-Adressen ohne Zugangsdaten sind erlaubt.');
 if(host==='localhost'||/\.(?:localhost|local|lan|internal|ts\.net)$/.test(host)||(isIP(host)&&!publicWebAddress(host)))throw Error('Lokale oder reservierte Netzwerkadressen sind gesperrt.');
 return url;
}
function abortable(promise,signal){
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
  promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
const strip=text=>text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();

/** Stateless public reader: no cookies, credentials, project content, or browser session. */
export async function readAgentWeb(raw,{signal,resolveHost=lookup,request=(url,options,callback)=>(url.protocol==='https:'?httpsRequest:httpRequest)(url,options,callback),timeoutMs=12000,maxBytes=1024*1024}={}) {
 const deadline=AbortSignal.timeout(Math.min(30000,Math.max(1,timeoutMs)));
 const combined=signal?AbortSignal.any([signal,deadline]):deadline;
 try{
  let url=publicUrl(raw);
  for(let redirects=0;redirects<5;redirects++){
   combined.throwIfAborted();
   const hostname=url.hostname.replace(/^\[|\]$/g,'');
   const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await abortable(resolveHost(hostname,{all:true,verbatim:true}),combined);
   if(!addresses.length||addresses.some(item=>!publicWebAddress(item.address)))throw Error('DNS-Ziel ist lokal oder reserviert; Abruf gesperrt.');
   const pinned=addresses[0];
   const result=await new Promise((resolve,reject)=>{
    let req;
    try{
     req=request(url,{signal:combined,agent:false,autoSelectFamily:false,
      lookup:(_host,options,callback)=>options?.all?callback(null,[pinned]):callback(null,pinned.address,pinned.family),
      headers:{Accept:'text/plain, text/html, application/json','Accept-Encoding':'identity','User-Agent':'Anvil-public-reader'},
     },res=>{
      const status=res.statusCode||0;
      if(status>=300&&status<400&&res.headers.location){res.destroy();resolve({status,location:res.headers.location});return;}
      if(Number(res.headers['content-length'])>maxBytes){res.destroy();reject(Error('Webseite überschreitet das Leselimit.'));return;}
      if(res.headers['content-encoding']&&!/^identity$/i.test(String(res.headers['content-encoding']))){res.destroy();reject(Error('Komprimierte Antwort wird nicht ungeprüft eingelesen.'));return;}
      let size=0;const chunks=[];
      res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){res.destroy();reject(Error('Webseite überschreitet das Leselimit.'));}else chunks.push(chunk);});
      res.on('error',reject);res.on('aborted',()=>reject(Error('Webantwort wurde abgebrochen.')));
      res.on('end',()=>resolve({status,text:Buffer.concat(chunks).toString('utf8')}));
     });
     req.on('error',reject);req.end();
    }catch(error){req?.destroy();reject(error);}
   });
   if(result.location){url=publicUrl(new URL(result.location,url).href);continue;}
   const text=strip(result.text||'').slice(0,20000);
   return result.status>=200&&result.status<300?{ok:true,status:result.status,text}:{ok:false,status:result.status,text:`HTTP ${result.status}: ${text.slice(0,400)}`};
  }
  throw Error('Zu viele Weiterleitungen.');
 }catch(error){
  signal?.throwIfAborted();
  return {ok:false,text:error instanceof Error?error.message:String(error)};
 }
}
