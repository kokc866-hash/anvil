// Syntax checks use their own interpreter; they cannot alter or block a running program.
let runtime;
let tail = Promise.resolve();
self.onmessage = ({ data }) => {
  tail = tail.catch(() => undefined).then(async () => {
    try {
      runtime ??= (async () => {
        importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");
        return self.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" });
      })();
      const py = await runtime;
      const result = await py.runPythonAsync(`
import json
_anvil_syntax_results = []
for item in json.loads(${JSON.stringify(JSON.stringify(data.files))}):
    try:
        compile(item["content"], item["path"], "exec")
    except SyntaxError as e:
        _anvil_syntax_results.append({"path": item["path"], "line": e.lineno or 1, "col": e.offset or 1, "message": str(e.msg or e)})
json.dumps(_anvil_syntax_results)
`);
      self.postMessage({ id: data.id, hits: JSON.parse(String(result || "[]")) });
    } catch (error) { self.postMessage({ id: data.id, error: String(error) }); }
  });
};
