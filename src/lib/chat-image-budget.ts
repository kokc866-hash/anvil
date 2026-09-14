// Tool screenshots are transient previews. Keep all text, statuses and user
// attachments, but do not keep every base64 frame from an unlimited agent run.
// Data URLs produced by the capture bridge are ASCII, so length is encoded bytes.
export const CHAT_IMAGE_COUNT = 8;
export const CHAT_IMAGE_BYTES = 8 * 1024 * 1024;

type MessageWithSteps = { steps?: { image?: string }[] };

/** One budget across the whole chat, newest first; unchanged rows keep identity. */
export function boundChatImages<T extends MessageWithSteps>(chat: T[]): T[] {
  let count = 0;
  let bytes = 0;
  let next = chat;
  for (let m = chat.length - 1; m >= 0; m--) {
    const message = chat[m];
    if (!Array.isArray(message?.steps)) continue;
    let steps = message.steps;
    for (let i = steps.length - 1; i >= 0; i--) {
      const image = steps[i]?.image;
      if (typeof image !== "string" || !image) continue;
      if (count < CHAT_IMAGE_COUNT && bytes + image.length <= CHAT_IMAGE_BYTES) {
        count++;
        bytes += image.length;
        continue;
      }
      if (steps === message.steps) steps = [...steps];
      const { image: _image, ...rest } = steps[i];
      steps[i] = rest;
    }
    if (steps !== message.steps) {
      if (next === chat) next = [...chat];
      next[m] = { ...message, steps };
    }
  }
  return next;
}
