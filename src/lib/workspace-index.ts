const cache = new WeakMap<Record<string, string>, { paths: string[]; key: string }>();
export function workspaceIndex(files: Record<string, string>) {
  let value = cache.get(files);
  if (!value) {
    const paths = Object.keys(files).sort();
    value = { paths, key: paths.join("\n") };
    cache.set(files, value);
  }
  return value;
}
export function selectFileKeys(state: { files: Record<string, string> }) {
  return workspaceIndex(state.files).key;
}
