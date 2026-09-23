import { build } from 'vite';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
export async function buildAgentRuntime(outDir = 'agent-build') {
  for (const name of ['worker', 'service-contract', 'preview-runtime', 'debug-trace']) {
  const result = await build({ configFile: false, publicDir: false, logLevel: 'silent', resolve: { alias: { '@': resolve('src') } }, ssr:{noExternal:['prettier']},
    build: { ssr: `src/agent-runtime/${name}.ts`, outDir, write: false, emptyOutDir: false, minify: false,
      rollupOptions: { output: { entryFileNames: `${name}.mjs`, chunkFileNames: '[name]-[hash].mjs' } } } });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
  const entry = chunks.find(item => item.type === 'chunk' && item.isEntry);
  // Tree shaking must leave a standalone Node entry. Never ship unused UI chunks.
  if (!entry) throw new Error('Agent runtime entry missing.');
  // Vite's final transform can remove imports after Rolldown's metadata was made.
  const ast = ts.createSourceFile('worker.mjs', entry.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function check(node) {
    const allowed = name === 'worker' ? ['zustand'] : name === 'service-contract' ? ['ajv', 'ajv/dist/2020.js', 'ajv/dist/2019.js', 'ajv-formats'] : [];
    if ((ts.isImportDeclaration(node) && !allowed.includes(node.moduleSpecifier.text)) ||
        (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)) throw new Error(`Agent runtime depends on an unbundled import (${node.getText(ast).slice(0,240)}). Refactor the boundary before packaging.`);
    ts.forEachChild(node, check);
  }
  check(ast);
  mkdirSync(outDir, { recursive: true }); writeFileSync(resolve(outDir, `${name}.mjs`), entry.code);
  console.log(`Agent-Hintergrundprozess ${name} gebaut (${Buffer.byteLength(entry.code)} Bytes).`);
  }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/build-agent-runtime.mjs')) await buildAgentRuntime();
