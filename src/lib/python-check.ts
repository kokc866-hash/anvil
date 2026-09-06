let worker: Worker | null = null, id = 0;
let tail: Promise<unknown> = Promise.resolve();
let previous: { signature: string; hits: PyHit[] } | null = null;
type PyHit = { path: string; line: number; col: number; message: string };
export function pythonCheck(files: { path: string; content: string }[]): Promise<PyHit[]> {
  const signature = JSON.stringify(files);
  if (previous?.signature === signature) return Promise.resolve(previous.hits);
  const request = ++id;
  const result = tail.catch(() => undefined).then(() => new Promise<PyHit[]>((resolve, reject) => {
    if (request !== id) { reject(new Error("Überholte Python-Prüfung")); return; }
    worker ??= new Worker("/python-check-worker.js");
    const timer = setTimeout(() => { worker?.terminate(); worker = null; reject(new Error("Python-Prüfung hat das Zeitlimit erreicht.")); }, 60000);
    worker.onerror = () => { clearTimeout(timer); worker?.terminate(); worker = null; reject(new Error("Python-Prüfung nicht verfügbar.")); };
    worker.onmessage = ({ data }) => {
      if (data.id !== request) return;
      clearTimeout(timer);
      if (data.error) reject(new Error(data.error));
      else { previous = { signature, hits: data.hits }; resolve(data.hits); }
    };
    worker.postMessage({ id: request, files });
  }));
  tail = result;
  return result;
}
