import { useEffect, useState } from "react";

/** 12s · 3:07 · 1:03:07 */
export function formatElapsed(ms: number): string {
  const n = Math.max(0, Math.floor(Number(ms) || 0));
  const s = Math.floor(n / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  if (m) return `${m}:${String(sec).padStart(2, "0")}`;
  return `${s}s`;
}

export function useElapsed(start: number | undefined, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || !start) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running, start]);
  if (!start) return 0;
  return Math.max(0, now - start);
}
