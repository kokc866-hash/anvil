import { URL } from "node:url";

/** Only the HTTP origin served by this Anvil process may use private IPC. */
export function appOrigin(port) {
  const origin = new URL(`http://127.0.0.1:${port}/`).origin;
  return (value) => {
    try {
      const url = new URL(value);
      return url.origin === origin && !url.username && !url.password;
    } catch {
      return false;
    }
  };
}
