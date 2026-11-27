type EditorWithContributions = { getContribution?: (id: string) => unknown };
type WordHighlighterContribution = { wordHighlighter?: { runDelayer?: { completionPromise?: unknown } } };
const observed = new WeakMap<Promise<unknown>, Promise<unknown>>();

/**
 * Monaco 0.52.2's WordHighlighter ignores the Promise returned by its Delayer.
 * Delayer.dispose() rejects that pending work when an editor/model is removed.
 * Own that exact Promise before teardown, rather than filtering window errors.
 * The internal field is version-specific; absent contributions are left alone.
 */
export function observeMonacoTeardown(editor: EditorWithContributions): Promise<unknown> | undefined {
  const contribution = editor.getContribution?.("editor.contrib.wordHighlighter") as WordHighlighterContribution | null | undefined;
  const pending = contribution?.wordHighlighter?.runDelayer?.completionPromise;
  if (!(pending instanceof Promise)) return;
  const previous = observed.get(pending);
  if (previous) return previous;
  const completion = pending.catch((error: unknown) => {
    // This is the cancellation shape used by the owned Monaco Delayer. Errors
    // from other promises are never intercepted; genuine task errors propagate.
    if (error instanceof Error && error.name === "Canceled" && error.message === "Canceled") return;
    throw error;
  });
  observed.set(pending, completion);
  return completion;
}
