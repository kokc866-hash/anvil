import { existsSync,lstatSync,readdirSync,readFileSync,writeFileSync,mkdirSync,renameSync,unlinkSync,rmdirSync } from 'node:fs';
import { join,dirname,resolve,relative,isAbsolute } from 'node:path';
import { hasAsciiControl } from './text-controls.mjs';
import { fileBytes,sameBytes } from '../scripts/file-content.mjs';

export const safePath=p=>typeof p==='string'&&p.length>0&&p.length<512&&!/[\\:]/.test(p)&&!hasAsciiControl(p)&&!p.split('/').some(x=>!x||['.','..','__proto__','constructor','prototype'].includes(x))&&!/(^|\/)(?:\.git|\.env(?:\..*)?|secrets?)(\/|$)/i.test(p);
export function diskPath(root,p){
  if(!safePath(p))throw Error('Ungültiger Projektpfad.');
  const full=resolve(root,p),rel=relative(resolve(root),full);
  if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith('../')||rel.startsWith('..\\'))throw Error('Pfad außerhalb des Projekts.');
  let part=resolve(root);for(const segment of p.split('/')){part=join(part,segment);try{if(lstatSync(part).isSymbolicLink())throw Error('Verknüpfungen im Hintergrund nicht verändern.');}catch(e){if(e.code!=='ENOENT')throw e;}}
  return full;
}
export const diskMatches=(root,p,value)=>{const full=diskPath(root,p);return !existsSync(full)?value===null:value!==null&&lstatSync(full).isFile()&&sameBytes(readFileSync(full),fileBytes(value));};
const child=(p,dir)=>p===dir||p.startsWith(dir+'/');
// Only raised during preflight, before any source or destination is changed.
export class FileActionConflict extends Error {
  constructor(path,message){super(message);this.name='FileActionConflict';this.path=path;}
}
export function planFileAction(files,dirs,op){
  const changes={},create=[],remove=[];
  const assign=(p,after)=>{if(!safePath(p))throw Error('Ungültiger Projektpfad.');changes[p]={before:files[p]??null,after};if(after!==null){const parts=p.split('/');while(parts.length>1){parts.pop();const parent=parts.join('/');if(!dirs.includes(parent))create.push(parent);}}};
  if(op.kind==='write')assign(op.path,op.content);
  else if(op.kind==='mkdir'){if(!safePath(op.path)||Object.hasOwn(files,op.path))throw Error('Ordnerpfad belegt.');if(!dirs.includes(op.path))create.push(op.path);}
  else if(op.kind==='delete'){
    if(!safePath(op.path))throw Error('Ungültiger Löschpfad.');
    for(const p of Object.keys(files).filter(p=>child(p,op.path)))assign(p,null);
    remove.push(...dirs.filter(p=>child(p,op.path)));
    if(!Object.keys(changes).length&&!remove.length)throw Error('Datei oder Ordner fehlt.');
  }else if(op.kind==='rename'){
    if(!safePath(op.from)||!safePath(op.to)||child(op.to.toLowerCase(),op.from.toLowerCase()))throw Error('Ungültiges Verschiebeziel.');
    if([...Object.keys(files),...dirs].some(p=>child(p.toLowerCase(),op.to.toLowerCase())))throw Error('Verschiebeziel bereits belegt.');
    for(const p of Object.keys(files).filter(p=>child(p,op.from))){assign(op.to+p.slice(op.from.length),files[p]);assign(p,null);}
    const moved=dirs.filter(p=>child(p,op.from));remove.push(...moved);create.push(...moved.map(p=>op.to+p.slice(op.from.length)));
    if(!Object.keys(changes).length&&!moved.length)throw Error('Verschiebequelle fehlt.');
  }else throw Error('Unbekannte Dateiaktion.');
  for(const p of [...create]){const parts=p.split('/');while(parts.length>1){parts.pop();const parent=parts.join('/');if(!dirs.includes(parent))create.push(parent);}}
  return {changes,create:[...new Set(create)],remove:[...new Set(remove)]};
}

/** Durable before-images and complete preflight before any mutation. Never recursive deletion. */
export function applyFileChanges(root,plan,backupPath,{recover=false}={}){
  const entries=Object.entries(plan.changes),create=plan.create||[],remove=plan.remove||[];
  for(const [p,c]of entries)if(!diskMatches(root,p,c.before)&&!(recover&&diskMatches(root,p,c.after)))throw new FileActionConflict(p,`Datei inzwischen geändert: ${p}. Keine Übernahme.`);
  const removing=new Set(entries.filter(([,c])=>c.after===null).map(([p])=>p));
  for(const p of [...create,...remove])diskPath(root,p);
  for(const p of remove){
    const full=diskPath(root,p);if(!existsSync(full))continue;
    for(const item of readdirSync(full,{withFileTypes:true})){
      const name=p+'/'+item.name;
      if(item.isSymbolicLink())throw Error(`Ordner enthält eine Verknüpfung: ${p}. Keine Übernahme.`);
      if((!item.isDirectory()&&!removing.has(name))||(item.isDirectory()&&!remove.includes(name)))throw new FileActionConflict(item.isDirectory()?undefined:name,`Ordner enthält weitere Dateien: ${p}. Eigene Dateien bleiben erhalten; andere Dateien können weiter bearbeitet werden.`);
    }
  }
  for(const p of create){const full=diskPath(root,p);if(existsSync(full)&&!lstatSync(full).isDirectory())throw new FileActionConflict(p,`Ordnerpfad belegt: ${p}`);}
  mkdirSync(dirname(backupPath),{recursive:true});
  if(!existsSync(backupPath))writeFileSync(backupPath,JSON.stringify({project:root,...plan}),{flag:'wx',mode:0o600});
  for(const p of [...create].sort((a,b)=>a.length-b.length))mkdirSync(diskPath(root,p),{recursive:true});
  // New destinations exist durably before source files disappear.
  for(const [p,c]of entries.filter(([,c])=>c.after!==null)){
    const full=diskPath(root,p);mkdirSync(dirname(full),{recursive:true});
    const tmp=full+'.anvil-change.tmp';writeFileSync(tmp,fileBytes(c.after),{flag:'wx'});
    try{if(!diskMatches(root,p,c.before)&&!(recover&&diskMatches(root,p,c.after)))throw Error(`Datei während der Übernahme geändert: ${p}`);renameSync(tmp,full);}finally{if(existsSync(tmp))unlinkSync(tmp);}
  }
  for(const [p,c]of entries.filter(([,c])=>c.after===null)){
    const full=diskPath(root,p);if(!existsSync(full))continue;
    if(!diskMatches(root,p,c.before))throw Error(`Datei während der Übernahme geändert: ${p}`);unlinkSync(full);
  }
  for(const p of [...remove].sort((a,b)=>b.length-a.length)){const full=diskPath(root,p);if(existsSync(full))rmdirSync(full);}
  return {ok:true,applied:true};
}
