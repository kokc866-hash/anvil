import tls from "node:tls";

/** Match Windows' configured HTTPS trust while retaining bundled and extra CAs. */
export function initializeSystemCertificates({ platform = process.platform, api = tls } = {}) {
  if (platform !== "win32") return { status: "unchanged", added: 0 };
  if (
    typeof api.getCACertificates !== "function" ||
    typeof api.setDefaultCACertificates !== "function"
  )
    return { status: "unsupported", added: 0 };
  try {
    const current = api.getCACertificates("default");
    const certificates = [...new Set([...current, ...api.getCACertificates("system")])];
    const added = certificates.length - new Set(current).size;
    if (added) api.setDefaultCACertificates(certificates);
    return { status: added ? "enabled" : "unchanged", added };
  } catch (error) {
    // Keep normal verification and the previous roots if Windows trust cannot be read.
    return { status: "unavailable", added: 0, error: String(error.message || error) };
  }
}
