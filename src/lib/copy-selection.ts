/** Only use a selection belonging to the copied surface, never another panel. */
export function selectedTextWithin(root: Element | null): string {
  if (!root) return '';
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return '';
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return '';
  return selection.toString();
}
