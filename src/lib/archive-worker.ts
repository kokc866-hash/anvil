import { decodeArchive, encodeArchive } from "./archive-codec.ts";

// A module worker bundles fflate locally. No CDN, filesystem or native bridge.
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void };
scope.onmessage = event => {
  void (async () => {
    try {
      if (event.data.operation === "zip") {
        const bytes = encodeArchive(event.data.files);
        scope.postMessage({ ok: true, bytes }, [bytes.buffer as ArrayBuffer]);
      } else if (event.data.operation === "unzip") {
        scope.postMessage({ ok: true, files: await decodeArchive(event.data.buffer) });
      } else throw new Error("Unbekannter Archivvorgang.");
    } catch (error) { scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  })();
};
