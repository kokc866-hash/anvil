/** Shared Chromium session for the editor AND the Run/Console windows.
 *
 * BroadcastChannel (ide-sync) and zustand persist are per session.
 * A temp partition on /run made the preview show "Keine Datei." after compile.
 * Untrusted HTML is the iframe (sandbox, no allow-same-origin), not the window.
 */
export const ANVIL_PARTITION = "persist:anvil";

export const ANVIL_PERMS = [
  "local-network-access",
  "media",
  "clipboard-sanitized-write",
  "clipboard-read",
  "pointerLock",
  "fullscreen",
];

export function anvilWebPrefs(preload) {
  const prefs = {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    partition: ANVIL_PARTITION,
  };
  if (preload) prefs.preload = preload;
  return prefs;
}

export function allowAnvilPerm(perm) {
  return ANVIL_PERMS.includes(String(perm || ""));
}
