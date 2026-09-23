import { existsSync } from "node:fs";
import { join } from "node:path";

export function packedServerPath(root) {
  return join(root, "ui-build", "server", "index.mjs");
}

export function viteBinPath(root) {
  return join(root, "node_modules", "vite", "bin", "vite.js");
}

export function packedServerEnv(port) {
  const p = String(port);
  return {
    PORT: p,
    NITRO_PORT: p,
    HOST: "127.0.0.1",
    NITRO_HOST: "127.0.0.1",
  };
}

/** Packaged installer runs the built UI. start.bat keeps Vite. */
export function serverLaunch(root, isPackaged, port = 8080, mode = "development") {
  if (isPackaged || mode === "production") {
    const packed = packedServerPath(root);
    if (!existsSync(packed)) {
      return { error: isPackaged
        ? "Die Installation enthält keine Benutzeroberfläche. Installiere Anvil erneut mit der aktuellen Setup-EXE von GitHub Releases."
        : "Die gebaute Testversion fehlt. Bitte zuerst test.bat ausführen." };
    }
    return { kind: "packed", args: [packed], extraEnv: packedServerEnv(port) };
  }
  const wrapper = join(root, "scripts", "with-app-env.mjs");
  const vite = viteBinPath(root);
  if (!existsSync(vite)) {
    return { error: "Die Entwicklungsumgebung ist unvollständig: Vite fehlt. Führe install.bat oder npm install aus." };
  }
  if (!existsSync(wrapper)) {
    return { error: "Startskript fehlt: " + wrapper };
  }
  return {
    kind: "vite",
    args: [wrapper, vite, "dev", "--host", "127.0.0.1", "--port", String(port)],
    extraEnv: {},
  };
}
