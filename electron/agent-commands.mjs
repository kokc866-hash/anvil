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
import { parseNodeTestCommand } from './node-test-command.mjs';
import { ToolRejection, shellRejectionGuidance } from './tool-rejection.mjs';

const shellRejected = (message, command) => new ToolRejection(message, shellRejectionGuidance(command));

export class AgentCommands {
  begin(request){this.root='';if(isAbsolute(request.project||'')&&existsSync(request.project)&&lstatSync(request.project).isDirectory())this.root=realpathSync(resolve(request.project));}
  async execute(op,{signal,files,verifyFiles,changedPaths=[]}){
    signal.throwIfAborted();
    if(op.kind==='shell')return this.shell(op.command,files,signal,op.expectedExitCode);
    if(op.kind!=='git'||!['status','commit'].includes(op.action))throw new ToolRejection('Unbekannte Projektaktion.');
    if(!this.root)throw new ToolRejection('Für Git zuerst einen lokalen Projektordner öffnen.');
    const bin=gitBin();if(!bin)throw new ToolRejection('Git ist nicht installiert.');
    const env={...toolEnv(),GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
    const run=args=>spawnRun(bin,['--no-pager',...args],this.root,120000,env,{signal});
    const top=await run(['rev-parse','--show-toplevel']);if(!top.ok) return top;
    if(realpathSync(top.stdout.trim()).toLowerCase()!==this.root.toLowerCase())throw new ToolRejection('Den Git-Projektstamm öffnen; Unterordner dürfen keine fremden Dateien committen.');
    if(op.action==='status')return run(['status','--short','--branch']);
    verifyFiles(this.root);
    const staged=await run(['diff','--cached','--name-only']);if(!staged.ok)return staged;
    if(staged.stdout.trim())throw new ToolRejection('Es liegen bereits vorgemerkte Git-Änderungen vor. Zuerst mit git_status prüfen; Anvil verändert diesen Index nicht.', {suggestedTools:['git_status']});
    const message=String(op.message||'').trim();if(!message||message.length>1000)throw new ToolRejection('Commit-Nachricht fehlt oder ist zu lang.');
    // Pathspecs are literal. Unrelated untracked files and secrets stay outside.
    const paths=changedPaths.filter(safePath);if(!paths.length)throw new ToolRejection('Keine gespeicherten Änderungen dieses Auftrags für einen Commit.');
    const add=await run(['--literal-pathspecs','add','--',...paths]);if(!add.ok)return add;
    signal.throwIfAborted();
    const committed=await run(['commit','-m',message]);
    // Never reset another process's index on errors; surface its actual state.
    return {...committed,note:'Lokaler Commit. Kein Push. Bei Abbruch Git-Status prüfen; vorgemerkte Änderungen bleiben sichtbar.'};
  }
  async shell(command,files,signal,expectedExitCode){
    const reject = message => shellRejected(message, command);
    if(expectedExitCode!==undefined&&(!Number.isInteger(expectedExitCode)||expectedExitCode<0||expectedExitCode>255))throw reject('Ungültige Exitcode-Erwartung.');
    let args;
    try { args=commandArgs(String(command||'')); }
    catch(error) { throw reject(error.message.includes('Shell-Metazeichen') ? 'Befehl abgelehnt: Shell-Operatoren sind hier nicht verfügbar.' : error.message); }
    let bin=args.shift(),prefix=[];
    const nodeTest=parseNodeTestCommand(String(command||''));
    if(nodeTest){
      if(nodeTest.paths.some(path=>!safePath(path)||!Object.hasOwn(files,path)))throw reject('Node-Testdatei fehlt im gesicherten Dateistand oder ihr Pfad ist ungültig.');
      args.splice(0,args.length,...nodeTest.args);
    }
    const tests=Boolean(nodeTest)||(bin==='npm'&&(args[0]==='test'||(args[0]==='run'&&args[1]==='test')))||(['go','cargo','dotnet'].includes(bin)&&args[0]==='test')||['pytest','vitest','jest','phpunit','rspec'].includes(bin);
    const script=['node','python','python3','py','php','ruby','bun','deno'].includes(bin)&&args[0]&&!args[0].startsWith('-')&&safePath(args[0].replace(/^\.\//,''))&&Object.hasOwn(files,args[0].replace(/^\.\//,''));
    const pyTest=['python','python3','py'].includes(bin)&&args[0]==='-m'&&args[1]==='pytest';
    if(!tests&&!script&&!pyTest)throw reject('Nur Projektdateien ausführen oder bekannte Testbefehle verwenden. Kein freies System-Terminal.');
    if(args.some(a=>/[\r\n\0]/.test(a)))throw reject('Ungültige Befehlsargumente.');
    if(Object.keys(files).length>4000)throw reject('Zu viele Dateien im Befehls-Snapshot.');
    if(Object.keys(files).some(p=>!safePath(p)))throw reject('Ungültiger Snapshot-Pfad.');
    let file,node;
    if(bin==='node'){node=nodeCommand({isPackaged:Boolean(process.versions.electron),execPath:process.execPath});file=node.file;}
    else if(['npm','vitest','jest'].includes(bin)){
      const found=resolveBin('node');
      const cli=bin==='npm'&&found?join(dirname(found),'node_modules','npm','bin','npm-cli.js'):null;
      if(!cli||!existsSync(cli))throw reject('Dieser Testbefehl benötigt eine eingerichtete Node/npm-Installation.');file=found;prefix=[cli];
    }else file=resolveBin(bin==='py'?'python':bin);
    if(!file)throw reject(`${bin} ist nicht eingerichtet.`);
    const folders=createRunFolder('background-shell',this.root),env=runEnvironment(folders,toolEnv());
    if(node)Object.assign(env,withNodeEnv(env,node.electronAsNode));
    for(const [p,c]of Object.entries(files)){const full=join(folders.work,p);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,fileBytes(c));}
    // An independent CLI test must not inherit Node's internal parent test marker:
    // Node otherwise skips every file and returns a misleading successful exit.
    if(nodeTest)delete env.NODE_TEST_CONTEXT;
    const result=verifyExpectedExit(await spawnRun(file,[...prefix,...args],folders.work,120000,env,{signal}),expectedExitCode);
    const record={...result,command,note:'Befehl im gesicherten Dateistand ausgeführt. Erzeugte Dateien bleiben im Run-Ordner.',stage:{kind:'log',id:folders.id,out:folders.work}};saveRunRecord(folders,record);return record;
  }
}
