export function cmpVer(a, b) {
  const pa = String(a || "")
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "")
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((n) => parseInt(n, 10) || 0);
  const n = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export function pickAssets(assets = []) {
  const list = Array.isArray(assets) ? assets : [];
  const zip = list.find((a) => /\.zip$/i.test(String(a.name || "")));
  const setup = list.find((a) => /\.exe$/i.test(String(a.name || "")) && /setup/i.test(String(a.name || "")));
  return {
    zipUrl: zip ? String(zip.browser_download_url || "") : "",
    zipName: zip ? String(zip.name || "Anvil.zip") : "",
    setupUrl: setup ? String(setup.browser_download_url || "") : "",
    setupName: setup ? String(setup.name || "Anvil.Setup.exe") : "",
  };
}
