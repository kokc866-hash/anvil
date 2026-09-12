/** A self-contained first result. Adding it never replaces a project file. */
export const FIRST_SUCCESS_HTML = `<!doctype html>
<html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mein erster Anvil-Test</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#151719;color:#eee;font:18px system-ui}main{padding:32px;max-width:440px}button{font:inherit;padding:12px 20px;border:0;border-radius:8px;background:#a8dbbf;color:#142419;cursor:pointer}output{display:block;font-size:64px;margin:24px 0}p{line-height:1.5;color:#bfc5c9}</style>
<main><h1>Mein erster Anvil-Test</h1><p>Das Beispiel läuft direkt in Anvil, ohne Download oder KI-Verbindung.</p><output id="count" aria-live="polite">0</output><button id="add">Eins dazu</button><p>Teste den Knopf. Ändere danach mit dem Agenten die Überschrift und führe die Datei erneut aus.</p></main>
<script>let count=0;document.querySelector('#add').addEventListener('click',()=>{document.querySelector('#count').textContent=String(++count)});</script></html>`;

export function firstSuccessPath(files: Record<string, string>, dirs: string[] = []): string {
  // The Windows workspace is case-insensitive, including unsaved buffers.
  const occupied = new Set([...Object.keys(files), ...dirs].map(path => path.toLowerCase()));
  let index = 0;
  let path = "anvil-erster-test.html";
  while (occupied.has(path)) path = `anvil-erster-test-${++index}.html`;
  return path;
}

export function firstSuccessPrompt(path: string, locale = "de") {
  return locale === "en"
    ? `In ${path}, change only the visible heading to "My first change". Keep the counter working. Run the file, check that clicking the button increases the number, and report what you actually verified. Wait for my review of the changes.`
    : `Ändere in ${path} nur die sichtbare Überschrift zu „Meine erste Änderung“. Erhalte den Zähler. Führe die Datei aus, prüfe, dass der Knopf die Zahl erhöht, und nenne, was du tatsächlich geprüft hast. Warte auf meine Prüfung der Änderungen.`;
}
