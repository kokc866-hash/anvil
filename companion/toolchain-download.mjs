import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';

// Keep maintenance branches stable. These are minimum corrected releases, not
// fallback downloads: failed metadata must never reinstall an older runtime.
const minimums={python:{'3.14':'3.14.9'},ruby:{'3.3':'3.3.13','3.4':'3.4.12','4.0':'4.0.9'}};
const stable=value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value);
const descending=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);return y[0]-x[0]||y[1]-x[1]||y[2]-x[2];};
function versionAtLeast(kind,version,channel){
  const minimum=minimums[kind]?.[channel];
  if(!stable(version)||!version.startsWith(channel+'.')||!minimum||descending(version,minimum)>0)
    throw Error(`Keine unterstützte, korrigierte ${kind}-Version im Zweig ${channel} gefunden.`);
}
function artifact(url,sha256,version,origin,prefix){
  const parsed=new URL(url);
  if(parsed.origin!==origin||parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||!parsed.pathname.startsWith(prefix))
    throw Error('Der Sprachdownload verweist nicht auf die erwartete Herstelleradresse.');
  if(typeof sha256!=='string'||!/^[a-f\d]{64}$/i.test(sha256))throw Error('Für den Sprachdownload fehlt eine gültige SHA256-Prüfsumme.');
  return {url:parsed.href,sha256:sha256.toLowerCase(),version};
}
async function metadata(url,fetchImpl,json=true){
  const response=await fetchImpl(url,{headers:{'user-agent':'Anvil-toolchain-update'},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`Sprachversion konnte nicht geprüft werden (HTTP ${response.status}).`);
  const limit=8*1024*1024;
  if(Number(response.headers.get('content-length'))>limit)throw Error('Die Versionsmetadaten sind zu groß.');
  const reader=response.body?.getReader();if(!reader)throw Error('Die Versionsmetadaten sind leer.');
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('Die Versionsmetadaten sind zu groß.');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const text=Buffer.concat(chunks).toString('utf8');
  return json?JSON.parse(text):text;
}

/** Resolve an exact archive and its checksum from the publisher, without installing. */
export async function resolveToolchainArtifact(kind,{platform=process.platform,arch=process.arch,channel,fetchImpl=globalThis.fetch}={}){
  if(!['x64','arm64'].includes(arch))throw Error('Diese Prozessorarchitektur wird für Sprachdownloads nicht unterstützt.');
  if(!['win32','darwin','linux'].includes(platform))throw Error('Dieses Betriebssystem wird für Sprachdownloads nicht unterstützt.');
  const win=platform==='win32',osName=win?'windows':platform==='darwin'?'darwin':'linux';
  if(kind==='go'){
    const releases=await metadata('https://go.dev/dl/?mode=json',fetchImpl);
    const release=releases.filter(r=>r.stable&&stable(String(r.version).replace(/^go/,''))).sort((a,b)=>descending(a.version.slice(2),b.version.slice(2)))[0];
    const file=release?.files?.find(f=>f.os===osName&&f.arch===(arch==='x64'?'amd64':'arm64')&&f.kind==='archive');
    if(!file||!/^[\w.-]+$/.test(file.filename))throw Error('Kein passendes, stabiles Go-Archiv verfügbar.');
    return artifact(`https://go.dev/dl/${file.filename}`,file.sha256,release.version.slice(2),'https://go.dev','/dl/');
  }
  if(kind==='node'){
    const releases=await metadata('https://nodejs.org/dist/index.json',fetchImpl);
    const release=releases.filter(r=>r.lts&&stable(String(r.version).replace(/^v/,''))).sort((a,b)=>descending(a.version.slice(1),b.version.slice(1)))[0];
    if(!release)throw Error('Keine stabile Node.js-LTS-Version verfügbar.');
    const file=`node-${release.version}-${win?'win':osName}-${arch}.${win?'zip':'tar.gz'}`;
    const base=`https://nodejs.org/dist/${release.version}/`;
    const sums=await metadata(base+'SHASUMS256.txt',fetchImpl,false);
    const hash=sums.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).find(row=>row[1]===file)?.[0];
    return artifact(base+file,hash,release.version.slice(1),'https://nodejs.org',`/dist/${release.version}/`);
  }
  if(kind==='zig'){
    const releases=await metadata('https://ziglang.org/download/index.json',fetchImpl);
    const target=`${arch==='x64'?'x86_64':'aarch64'}-${win?'windows':platform==='darwin'?'macos':'linux'}`;
    const version=Object.keys(releases).filter(v=>stable(v)&&releases[v]?.[target]).sort(descending)[0];
    if(!version)throw Error('Kein passendes, stabiles Zig-Archiv verfügbar.');
    const file=releases[version][target];
    return artifact(file.tarball,file.shasum,version,'https://ziglang.org',`/download/${version}/`);
  }
  if(!win)throw Error(`${kind}: Für dieses Betriebssystem bitte den vorhandenen Paketmanager verwenden.`);
  if(kind==='rustup'){
    const release=await metadata('https://static.rust-lang.org/rustup/release-stable.toml',fetchImpl,false);
    const version=release.match(/^version\s*=\s*["'](\d+\.\d+\.\d+)["']/m)?.[1];
    if(!stable(version)||descending(version,'1.29.2')>0)throw Error('Keine korrigierte rustup-Version verfügbar.');
    const target=arch==='x64'?'x86_64-pc-windows-msvc':'aarch64-pc-windows-msvc';
    const url=`https://static.rust-lang.org/rustup/archive/${version}/${target}/rustup-init.exe`;
    const sums=await metadata(url+'.sha256',fetchImpl,false);
    return artifact(url,sums.trim().split(/\s+/)[0],version,'https://static.rust-lang.org',`/rustup/archive/${version}/${target}/`);
  }
  if(kind==='php'){
    if(arch!=='x64')throw Error('Ein passendes PHP-Archiv für diese Architektur ist nicht verfügbar.');
    const series=channel||'8.3';if(!/^8\.\d+$/.test(series))throw Error('Ungültiger PHP-Versionszweig.');
    const releases=await metadata('https://downloads.php.net/~windows/releases/releases.json',fetchImpl);
    const release=releases[series];const file=release?.['nts-vs16-x64']?.zip;
    if(!stable(release?.version)||!release.version.startsWith(series+'.')||!file||!/^php-[\w.-]+\.zip$/.test(file.path))throw Error('Kein passendes PHP-Archiv verfügbar.');
    return artifact(`https://downloads.php.net/~windows/releases/${file.path}`,file.sha256,release.version,'https://downloads.php.net','/~windows/releases/');
  }
  if(kind==='python'){
    const series=channel||'3.14';if(!minimums.python[series])throw Error('Dieser Python-Versionszweig wird nicht als Ersatzinstallation unterstützt.');
    const page=await metadata('https://www.python.org/downloads/windows/',fetchImpl,false);
    const versions=[...page.matchAll(/Python (\d+\.\d+\.\d+)(?![\da-z])/gi)].map(m=>m[1]).filter(v=>v.startsWith(series+'.'));
    const version=versions.sort(descending)[0];versionAtLeast('python',version,series);
    const manifest=await metadata(`https://www.python.org/ftp/python/${version}/windows-${version}.json`,fetchImpl);
    const entry=manifest.versions?.find(row=>row.id===`pythonembed-${series}-${arch==='x64'?'64':'arm64'}`&&row['sort-version']===version);
    if(!entry)throw Error('Im Python-Manifest fehlt das passende eingebettete Paket.');
    return artifact(entry.url,entry.hash?.sha256,version,'https://www.python.org',`/ftp/python/${version}/`);
  }
  if(kind==='ruby'){
    const series=channel||'4.0';if(!minimums.ruby[series])throw Error('Dieser Ruby-Versionszweig wird nicht als Ersatzinstallation unterstützt.');
    const releases=await metadata('https://api.github.com/repos/oneclick/rubyinstaller2/releases?per_page=100',fetchImpl);
    const candidates=releases.filter(r=>!r.prerelease&&!r.draft&&/^RubyInstaller-\d+\.\d+\.\d+-\d+$/.test(r.tag_name));
    const release=candidates.filter(r=>r.tag_name.startsWith(`RubyInstaller-${series}.`)).sort((a,b)=>descending(a.tag_name.match(/\d+\.\d+\.\d+/)[0],b.tag_name.match(/\d+\.\d+\.\d+/)[0])||Number(b.tag_name.split('-').at(-1))-Number(a.tag_name.split('-').at(-1)))[0];
    const version=release?.tag_name.match(/\d+\.\d+\.\d+/)?.[0];versionAtLeast('ruby',version,series);
    const file=release.assets?.find(a=>a.name===`rubyinstaller-${release.tag_name.slice('RubyInstaller-'.length)}-${arch==='x64'?'x64':'arm'}.exe`);
    if(!file)throw Error('Kein passender Ruby-Installer verfügbar.');
    return artifact(file.browser_download_url,file.digest?.replace(/^sha256:/,''),version,'https://github.com',`/oneclick/rubyinstaller2/releases/download/${release.tag_name}/`);
  }
  throw Error(`Unbekannter Sprachdownload: ${kind}`);
}

/** Check before unpacking or executing; the existing toolchain is still intact. */
export async function verifyToolchainDownload(file,expected){
  if(!expected?.sha256||!/^[a-f\d]{64}$/i.test(expected.sha256))throw Error('Die Download-Prüfsumme fehlt.');
  const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
  if(hash.digest('hex')!==expected.sha256.toLowerCase())throw Error('Die SHA256-Prüfsumme des Sprachdownloads stimmt nicht. Die vorhandene Installation bleibt erhalten.');
}
