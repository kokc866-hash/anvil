import * as prettier from 'prettier/standalone';
import * as babel from 'prettier/plugins/babel';
import * as estree from 'prettier/plugins/estree';
import * as typescript from 'prettier/plugins/typescript';
import * as html from 'prettier/plugins/html';
import * as markdown from 'prettier/plugins/markdown';
import * as postcss from 'prettier/plugins/postcss';
import * as yaml from 'prettier/plugins/yaml';
import type { Options } from 'prettier';

export type BackgroundFormat = { tabSize?: number; insertSpaces?: boolean };
const parsers: Record<string,string> = {js:'babel',mjs:'babel',cjs:'babel',jsx:'babel',ts:'typescript',tsx:'typescript',mts:'typescript',cts:'typescript',json:'json',jsonc:'json',html:'html',htm:'html',md:'markdown',mdx:'mdx',css:'css',scss:'scss',less:'less',yaml:'yaml',yml:'yaml'};

/** Fixed bundled parsers only. Project plugins and executable config are never loaded. */
export async function formatBackgroundFile(path:string,content:string,files:Record<string,string>,settings:BackgroundFormat={}) {
 if(!path||path.length>512||/[\\:\x00-\x1f]/.test(path)||path.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Ungültiger Formatierpfad.');
 if(content.length>1000000)throw Error('Datei für die Hintergrund-Formatierung zu groß.');
 const parser=parsers[path.split('.').pop()!.toLowerCase()];
 if(!parser)throw Error('Für diesen Dateityp ist kein unabhängiger Formatter eingebunden.');
 const options:Options={tabWidth:Math.max(1,Math.min(16,Number(settings.tabSize)||2)),useTabs:settings.insertSpaces===false};
 const parents=path.split('/');parents.pop();
 for(let i=0;i<=parents.length;i++){
  const prefix=parents.slice(0,i).join('/');
  for(const name of ['.prettierrc','.prettierrc.json']){
   const raw=files[(prefix?prefix+'/':'')+name];if(!raw||raw.length>64000)continue;
   let cfg:Record<string,unknown>;try{cfg=JSON.parse(raw);}catch{continue;}
   if(!cfg||typeof cfg!=='object'||Array.isArray(cfg))continue;
   for(const key of ['tabWidth','useTabs','printWidth','singleQuote','semi','trailingComma','bracketSpacing','endOfLine'] as const)
    if(['string','number','boolean'].includes(typeof cfg[key]))Object.assign(options,{[key]:cfg[key]});
  }
 }
 return prettier.format(content,{...options,parser,plugins:[babel,estree,typescript,html,markdown,postcss,yaml]});
}
