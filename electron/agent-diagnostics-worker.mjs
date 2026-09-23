// Trusted parser entry. Project source is data, never imported or executed.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, dirname, basename } from 'node:path';
const [compiler, manifest] = process.argv.slice(2);
const module = await import(pathToFileURL(compiler));
const ts = module.default || module;
const { files, roots } = JSON.parse(readFileSync(manifest, 'utf8'));
const options = { noEmit:true, target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext,
  moduleResolution:ts.ModuleResolutionKind.Bundler, jsx:ts.JsxEmit.ReactJSX,
  strict:true, skipLibCheck:true, allowJs:true, checkJs:true };
const base = process.cwd(), normalize = path => {
  const full=resolve(path).replaceAll('\\','/');
  return process.platform==='win32'?full.toLowerCase():full;
};
const sources = new Map(files.map(file=>[normalize(resolve(base,file.path)),file]));
const original=ts.createCompilerHost(options), libDir=normalize(dirname(ts.getDefaultLibFilePath(options)));
const isLibrary=path=>normalize(dirname(path))===libDir && /^lib(?:\..*)?\.d\.ts$/i.test(basename(path));
const host={...original,
  fileExists:path=>sources.has(normalize(path)) || (isLibrary(path)&&original.fileExists(path)),
  readFile:path=>sources.get(normalize(path))?.content ?? (isLibrary(path)?original.readFile(path):undefined),
  directoryExists:path=>[...sources.keys()].some(name=>name.startsWith(normalize(path)+'/')) || normalize(path)===libDir,
  getSourceFile(path,version){const source=this.readFile(path);return source===undefined?undefined:ts.createSourceFile(path,source,version,true);},
  writeFile(){throw new Error('Diagnostic worker cannot emit files.');},
};
const program=ts.createProgram(roots.map(path=>resolve(base,path)),options,host);
const hits = [];
for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const source=diagnostic.file;
    const path=source?sources.get(normalize(source.fileName))?.path:roots[0];
    if(!path)continue;
    const point=source?.getLineAndCharacterOfPosition(diagnostic.start||0)||{line:0,character:0};
    hits.push({ path, line: point.line + 1, col: point.character + 1,
      severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').slice(0, 500), source: 'typescript' });
    if (hits.length >= 100) break;
}
process.stdout.write(JSON.stringify({ hits }));
