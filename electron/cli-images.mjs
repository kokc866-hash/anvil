import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** No URL downloads or arbitrary filesystem paths cross the renderer boundary. */
export function validateCliImages(images = []) {
  if (!Array.isArray(images) || images.length > 8) throw Error("CLI: höchstens 8 Bilder pro Anfrage.");
  let total = 0;
  return images.map((url) => {
    if (typeof url !== "string" || url.length > 7 * 1024 * 1024) throw Error("CLI-Bild zu groß (max. 5 MiB).");
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    if (!match || match[2].length % 4 !== 0) throw Error("Ungültiges CLI-Bild. PNG, JPEG, WebP oder GIF als Anhang verwenden.");
    const data = Buffer.from(match[2], "base64");
    if (data.toString("base64") !== match[2]) throw Error("Ungültige CLI-Bildkodierung.");
    const mime = match[1];
    const valid = mime === "image/png" ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : mime === "image/jpeg" ? data[0] === 255 && data[1] === 216 && data[2] === 255
      : mime === "image/gif" ? /^GIF8[79]a$/.test(data.subarray(0,6).toString("ascii"))
      : data.subarray(0,4).toString("ascii") === "RIFF" && data.subarray(8,12).toString("ascii") === "WEBP";
    if (!valid) throw Error("CLI-Bildinhalt passt nicht zum angegebenen Bildformat.");
    total += data.length;
    if (data.length > 5 * 1024 * 1024 || total > 20 * 1024 * 1024) throw Error("CLI-Bilder zu groß: 5 MiB je Bild, 20 MiB insgesamt.");
    return { mime, data, base64: match[2] };
  });
}

export async function writeCliImages(images, dir) {
  const paths = [];
  for (const [index, image] of images.entries()) {
    const path = join(dir, `image-${index + 1}.${image.mime.split("/")[1]}`);
    await writeFile(path, image.data, { mode: 0o600 });
    paths.push(path);
  }
  return paths;
}

export function claudeInput(prompt, images) {
  return JSON.stringify({ type: "user", message: { role: "user", content: [
    { type: "text", text: prompt },
    ...images.map(image => ({ type: "image", source: { type: "base64", media_type: image.mime, data: image.base64 } })),
  ] }, parent_tool_use_id: null }) + "\n";
}
