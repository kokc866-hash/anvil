/** Monaco 0.52's word highlighter rejects its delayed work when a model is disposed.
 * That cancellation is expected during tab/project switches; other errors remain visible. */
export function isEditorCancellation(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "Canceled" || error.message !== "Canceled") return false;
  return /\/monaco\/vs\/editor\/editor\.main\.js|\/monaco-editor@[^/]+\/min\/vs\/editor\/editor\.main\.js/.test(error.stack ?? "") && /\.cancel\b/.test(error.stack ?? "") && /\.dispose\b/.test(error.stack ?? "");
}
