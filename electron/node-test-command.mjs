/** A deliberately narrow argv grammar shared by native execution and the editor. */
/** @param {string} command @returns {{paths:string[],args:string[]}|null} */
export function parseNodeTestCommand(command) {
  if(typeof command!=='string'||command.length>32768)return null;
  /** @type {string[]} */ const tokens=[];
  let word='',quote='',started=false;
  for(let i=0;i<command.length;i++) {
    const ch=command[i];
    if(ch.charCodeAt(0)<32||ch.charCodeAt(0)===127)return null;
    if(quote) {
      if(ch===quote)quote='';
      else if(ch==='\\'&&command[i+1]===quote&&quote==='"'){word+=quote;i++;}
      else word+=ch;
    }else if(ch==='"'||ch==="'"){quote=ch;started=true;}
    else if(/\s/.test(ch)){if(started){tokens.push(word);word='';started=false;}}
    else if(/[;&|`$()<>]/.test(ch))return null;
    else{word+=ch;started=true;}
  }
  if(quote)return null;
  if(started)tokens.push(word);
  if(tokens.shift()!=='node'||tokens.shift()!=='--test'||!tokens.length||tokens.length>256)return null;
  const paths=tokens.map(path=>path.replace(/^\.\//,''));
  if(paths.some(path=>!path||path.length>=512||path.startsWith('-')||/[\\:]/.test(path)||!/\.(?:js|mjs|cjs)$/i.test(path)
    ||path.split('/').some(segment=>!segment||['.','..','__proto__','constructor','prototype'].includes(segment))
    ||/(^|\/)(?:\.git|\.env(?:\..*)?|secrets?)(\/|$)/i.test(path)))return null;
  return {paths,args:['--test',...paths]};
}
