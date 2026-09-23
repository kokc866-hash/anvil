import { existsSync,mkdirSync,writeFileSync,lstatSync,realpathSync } from 'node:fs';
import { join,dirname,resolve,isAbsolute } from 'node:path';
import { gitBin } from '../companion/git.mjs';
import { toolEnv,resolveBin } from '../companion/toolchain.mjs';
import { commandArgs } from '../companion/engine-runtime.mjs';
import { spawnRun } from '../companion/run-process.mjs';
import { createRunFolder,saveRunRecord,runEnvironment } from '../companion/run-storage.mjs';
import { nodeCommand,withNodeEnv } from './node-cmd.mjs';
import { fileBytes } from '../scripts/file-content.mjs';
import { safePath } from './agent-file-actions.mjs';
import { verifyExpectedExit } from './expected-exit.mjs';

export class AgentCommands {
  begin(request){this.root='';if(isAbsolute(request.project||'')&&existsSync(request.project)&&lstatSync(request.project).isDirectory())this.root=realpathSync(resolve(request.project));}
  async execute(op,{signal,files,verifyFiles,changedPaths=[]}){
    signal.throwIfAborted();
    if(op.kind==='shell')return this.shell(op.command,files,signal,op.expectedExitCode);
    if(op.kind!=='git'||!['status','commit'].includes(op.action))throw Error('Unbekannte Projektaktion.');
    if(!this.root)throw Error('Für Git zuerst einen lokalen Projektordner öffnen.');
    const bin=gitBin();if(!bin)throw Error('Git ist nicht installiert.');
    const env={...toolEnv(),GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
    const run=args=>spawnRun(bin,['--no-pager',...args],this.root,120000,env,{signal});
    const top=await run(['rev-parse','--show-toplevel']);if(!top.ok) return top;
    if(realpathSync(top.stdout.trim()).toLowerCase()!==this.root.toLowerCase())throw Error('Den Git-Projektstamm öffnen; Unterordner dürfen keine fremden Dateien committen.');
    if(op.action==='status')return run(['status','--short','--branch']);
    verifyFiles(this.root);
    const staged=await run(['diff','--cached','--name-only']);if(!staged.ok)return staged;
    if(staged.stdout.trim())throw Error('Es liegen bereits vorgemerkte Git-Änderungen vor. Zuerst prüfen; Anvil verändert diesen Index nicht.');
    const message=String(op.message||'').trim();if(!message||message.length>1000)throw Error('Commit-Nachricht fehlt oder ist zu lang.');
    // Pathspecs are literal. Unrelated untracked files and secrets stay outside.
    const paths=changedPaths.filter(safePath);if(!paths.length)throw Error('Keine gespeicherten Änderungen dieses Auftrags für einen Commit.');
    const add=await run(['--literal-pathspecs','add','--',...paths]);if(!add.ok)return add;
    signal.throwIfAborted();
    const committed=await run(['commit','-m',message]);
    // Never reset another process's index on errors; surface its actual state.
    return {...committed,note:'Lokaler Commit. Kein Push. Bei Abbruch Git-Status prüfen; vorgemerkte Änderungen bleiben sichtbar.'};
  }
  async shell(command,files,signal,expectedExitCode){
    if(expectedExitCode!==undefined&&(!Number.isInteger(expectedExitCode)||expectedExitCode<0||expectedExitCode>255))throw Error('Ungültige Exitcode-Erwartung.');
    const args=commandArgs(String(command||''));let bin=args.shift(),prefix=[];
    const tests=(bin==='npm'&&(args[0]==='test'||(args[0]==='run'&&args[1]==='test')))||(['go','cargo','dotnet'].includes(bin)&&args[0]==='test')||['pytest','vitest','jest','phpunit','rspec'].includes(bin);
    const script=['node','python','python3','py','php','ruby','bun','deno'].includes(bin)&&args[0]&&!args[0].startsWith('-')&&safePath(args[0].replace(/^\.\//,''))&&Object.hasOwn(files,args[0].replace(/^\.\//,''));
    const pyTest=['python','python3','py'].includes(bin)&&args[0]==='-m'&&args[1]==='pytest';
    if(!tests&&!script&&!pyTest)throw Error('Nur Projektdateien ausführen oder bekannte Testbefehle verwenden. Kein freies System-Terminal.');
    if(args.some(a=>/[\r\n\0]/.test(a)))throw Error('Ungültige Befehlsargumente.');
    const folders=createRunFolder('background-shell',this.root),env=runEnvironment(folders,toolEnv());
    if(Object.keys(files).length>4000)throw Error('Zu viele Dateien im Befehls-Snapshot.');
    for(const [p,c]of Object.entries(files)){if(!safePath(p))throw Error('Ungültiger Snapshot-Pfad.');const full=join(folders.work,p);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,fileBytes(c));}
    let file;
    if(bin==='node'){const node=nodeCommand({isPackaged:Boolean(process.versions.electron),execPath:process.execPath});file=node.file;Object.assign(env,withNodeEnv(env,node.electronAsNode));}
    else if(['npm','vitest','jest'].includes(bin)){
      const found=resolveBin('node');
      const cli=bin==='npm'&&found?join(dirname(found),'node_modules','npm','bin','npm-cli.js'):null;
      if(!cli||!existsSync(cli))throw Error('Dieser Testbefehl benötigt eine eingerichtete Node/npm-Installation.');file=found;prefix=[cli];
    }else file=resolveBin(bin==='py'?'python':bin);
    if(!file)throw Error(`${bin} ist nicht eingerichtet.`);
    const result=verifyExpectedExit(await spawnRun(file,[...prefix,...args],folders.work,120000,env,{signal}),expectedExitCode);
    const record={...result,command,note:'Befehl im gesicherten Dateistand ausgeführt. Erzeugte Dateien bleiben im Run-Ordner.',stage:{kind:'log',id:folders.id,out:folders.work}};saveRunRecord(folders,record);return record;
  }
}
