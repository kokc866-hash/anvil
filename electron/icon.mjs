import { nativeImage } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function iconPath(root) {
  const ico = join(root, "public", "icon.ico");
  const png = join(root, "public", "icon.png");
  if (process.platform === "win32" && existsSync(ico)) return ico;
  if (existsSync(png)) return png;
  if (existsSync(ico)) return ico;
  return "";
}

export function loadAppIcon(root) {
  const p = iconPath(root);
  if (!p) return undefined;
  try {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) return img;
  } catch {
    /* */
  }
  return undefined;
}
