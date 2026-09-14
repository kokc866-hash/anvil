import { toolCallKey } from "./tool-compat.ts";

/** Keep replay/progress history independent of document and image argument sizes. */
export async function toolCallFingerprint(name: string, args: Record<string, unknown>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(toolCallKey(name, args)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
