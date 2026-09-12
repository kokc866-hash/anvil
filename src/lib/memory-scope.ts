// Separate from helper/model state: deleting memory invalidates pending learning.
let revision = 0;
export function invalidateMemory(): void { revision += 1; }
export function captureMemory(): () => boolean {
  const captured = revision;
  return () => captured === revision;
}
