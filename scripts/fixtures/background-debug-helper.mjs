import { build } from 'vite';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function buildDebugHelper() {
  mkdirSync('artifacts', { recursive: true });
  const outDir = mkdtempSync(resolve('artifacts', 'debug-trace-helper-'));
  await build({ configFile:false,publicDir:false,logLevel:'silent',ssr:{noExternal:['typescript']},build:{ssr:'src/agent-runtime/debug-trace.ts',outDir,emptyOutDir:false,minify:false,rollupOptions:{output:{entryFileNames:'debug-trace.mjs'}}} });
  return import(pathToFileURL(join(outDir,'debug-trace.mjs')).href);
}
