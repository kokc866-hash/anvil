import { useEffect, useState } from "react";
import { secretStorageStatus } from "@/lib/secrets";

export function SecretStorageStatus() {
  const [status, setStatus] = useState(secretStorageStatus);
  useEffect(() => {
    const update = () => setStatus(secretStorageStatus());
    window.addEventListener("anvil-secret-status", update);
    window.addEventListener("anvil-secrets-changed", update);
    return () => {
      window.removeEventListener("anvil-secret-status", update);
      window.removeEventListener("anvil-secrets-changed", update);
    };
  }, []);
  return (
    <p role="status" className="py-1 text-xs text-subtle">
      {status}
    </p>
  );
}
