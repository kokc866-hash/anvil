// Resolve clipboard payloads in the main process before crossing IPC. Electron
// 44 uses asynchronous ClipboardItems; Promises and Blobs are not IPC results.
export async function readChatClipboard(clipboard) {
  let text = "", image = "", readable = false;
  try {
    const items = await clipboard.read();
    readable = items.length === 0;
    for (const item of items) {
      for (const type of item.types) {
        try {
          if (type === "text/plain" && !text) {
            text = await (await item.getType(type)).text();
            readable = true;
          } else if (type.startsWith("image/") && !image) {
            const blob = await item.getType(type);
            const bytes = Buffer.from(await blob.arrayBuffer());
            if (bytes.length) image = `data:${type};base64,${bytes.toString("base64")}`;
            readable = true;
          }
        } catch {
          // One unavailable representation must not hide another readable one.
        }
      }
    }
  } catch {
    // Plain text may still be available when rich clipboard reading fails.
  }
  if (!text) {
    try {
      text = await clipboard.readText();
      readable = true;
    } catch {
      /* Preserve a readable image or a confirmed empty clipboard. */
    }
  }
  if (!readable) throw new Error("Clipboard access unavailable.");
  return { text, image };
}
