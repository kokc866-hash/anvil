/** Only a bounded rectangle of the requesting Anvil window can be captured. */
export function captureRect(rect, bounds) {
  if (!rect || !["x", "y", "width", "height"].every((k) => Number.isFinite(rect[k])))
    throw new Error("Ungültiger Aufnahmebereich.");
  const x = Math.max(0, Math.floor(rect.x)),
    y = Math.max(0, Math.floor(rect.y));
  const width = Math.min(Math.ceil(rect.width), bounds.width - x),
    height = Math.min(Math.ceil(rect.height), bounds.height - y);
  if (width < 1 || height < 1 || width * height > 32_000_000)
    throw new Error("Aufnahmebereich liegt außerhalb des Fensters oder ist zu groß.");
  return { x, y, width, height };
}
