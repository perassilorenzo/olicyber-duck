/** Calcolo della larghezza effettiva dei pannelli con splitter a pixel fissi. */

export const SPLITTER_PX = 12;

export function effectiveAssistantPercent(libraryWidth, innerWidth, splitterPx = SPLITTER_PX) {
  const rawWidth = Number(libraryWidth);
  const width = Number.isFinite(rawWidth) ? Math.min(100, Math.max(0, rawWidth)) : 0;
  const inner = Number(innerWidth);
  if (!Number.isFinite(inner) || inner <= 0) return Math.round(100 - width);
  const splitterShare = (Math.max(0, splitterPx) / inner) * 100;
  return Math.max(0, Math.round(100 - width - splitterShare));
}
