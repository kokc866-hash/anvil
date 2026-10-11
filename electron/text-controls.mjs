// Pure helpers shared by desktop, Companion and browser code; no Node imports.
/** @param {string} text @param {boolean} [includeDelete] */
export function hasAsciiControl(text, includeDelete = false) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || (includeDelete && code === 127)) return true;
  }
  return false;
}

// CSI sequences start with ASCII ESC. Construct it explicitly so this pattern's
// intentional control character cannot be confused with accidental source data.
const ansiCsi = new RegExp(String.fromCharCode(27) + "\\[[0-?]*[ -/]*[@-~]", "g");
/** @param {string} text */
export function stripAnsiCsi(text) {
  return text.replace(ansiCsi, "");
}
