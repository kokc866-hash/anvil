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
export function serverLaunch(root, isPackaged, port = 8080) {
  if (isPackaged) {
    const packed = packedServerPath(root);
    if (!existsSync(packed)) {
      return { error: "UI fehlt in der Installation. Bitte die aktuelle Setup-exe von GitHub Releases nehmen." };
    }
    return { kind: "packed", args: [packed], extraEnv: packedServerEnv(port) };
  }
  const wrapper = join(root, "scripts", "with-app-env.mjs");
  const vite = viteBinPath(root);
  if (!existsSync(vite)) {
    return { error: "Vite fehlt. Einmal install.bat / npm install." };
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
