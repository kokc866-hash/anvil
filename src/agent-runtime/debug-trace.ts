/** Standalone native-debugger helper. No renderer, store or server imports. */
export { prepareDebugTrace, parseTrace, canDebug, stackOf } from '../lib/debug-trace';
import type * as TypeScript from 'typescript';
import tsSource from 'typescript/lib/typescript.js?raw';
// Embed the same compiler as the foreground without its filesystem-backed Node sys.
// Only the shipped compiler source is evaluated; project code is transpiled as data.
const compilerModule = { exports: {} };
new Function('module', 'exports', 'require', 'process', tsSource)(compilerModule, compilerModule.exports, undefined, undefined);
const ts = compilerModule.exports as typeof TypeScript;

function sourceLines(mappings: string): number[] {
  let sourceLine = 0, source = 0, column = 0;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  return mappings.split(';').map(row => {
    let first: number | undefined;
    for (const segment of row.split(',')) {
      const values: number[] = []; let value = 0, shift = 0;
      for (const char of segment) { const digit = alphabet.indexOf(char); value += (digit & 31) * 2 ** shift; if (digit & 32) shift += 5; else { values.push(value & 1 ? -(value >> 1) : value >> 1); value = 0; shift = 0; } }
      if (values.length >= 4) { source += values[1]; sourceLine += values[2]; column += values[3]; first ??= sourceLine; }
    }
    return first ?? -1;
  });
}

/** Same TS target/JSX transformation as foreground, with source positions for Inspector. */
export function prepareTypeScriptDebug(files: Record<string,string>, entry: string) {
  const output: Record<string,string> = {...files};
  const maps: Record<string,{originalPath:string;lines:number[]}> = {};
  const generated = (path: string) => path.replace(/\.mts$/i,'.mjs').replace(/\.cts$/i,'.cjs').replace(/\.tsx?$/i,'.js');
  for (const [path, source] of Object.entries(files)) {
    if (!/\.[cm]?tsx?$/i.test(path) || /\.d\.[cm]?ts$/i.test(path)) continue;
    const dest = generated(path);
    if (Object.hasOwn(files,dest) || Object.hasOwn(maps,dest)) throw Error('TypeScript-Ausgabe kollidiert mit Projektdatei: '+dest);
    const result = ts.transpileModule(source,{fileName:path,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:/\.cts$/i.test(path)?ts.ModuleKind.CommonJS:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,isolatedModules:true,sourceMap:true,inlineSources:true,rewriteRelativeImportExtensions:true}});
    const errors=result.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error)||[];
    if(errors.length)throw Error(path+': '+errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')).join('\n'));
    delete output[path]; output[dest]=result.outputText.replace(/^\/\/# sourceMappingURL=.*$/m,'');
    maps[dest]={originalPath:path,lines:sourceLines(JSON.parse(result.sourceMapText||'{}').mappings||'')};
  }
  return {files:output,entry:generated(entry),maps};
}
