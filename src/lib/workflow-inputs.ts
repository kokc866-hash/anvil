// Documentation is usually task guidance; executable skill/plugin files and assets are inputs.
const metadata = /^\.anvil\/(?:harness|graph|board)\.json$/i;
export const isWorkflowInputPath = (path: string) => !/^\.git(?:\/|$)/i.test(path) && !metadata.test(path) && !/\.(?:md|mdx)$/i.test(path);

export function workflowInputPaths(files: Record<string,string>): Set<string> {
  const paths=new Set(Object.keys(files).filter(isWorkflowInputPath));
  const sources=Object.entries(files).filter(([path])=>paths.has(path)&&/\.(?:py|js|mjs|cjs|ts|tsx|jsx|go|rs|cs|cpp|c|h|java|rb|php|html?)$/i.test(path)).map(([,content])=>content);
  // Explicit document dependencies (for example readFile('data.md')) stay versioned too.
  for(const path of Object.keys(files))if(!paths.has(path)&&!/^\.git(?:\/|$)/i.test(path)&&/\.(?:md|mdx)$/i.test(path)&&!/^\.anvil\/(?:session|knowledge)\.md$/i.test(path)){
    const basename=path.split('/').at(-1)!;
    if(sources.some(source=>source.includes(path)||source.includes(basename)))paths.add(path);
  }
  return paths;
}
