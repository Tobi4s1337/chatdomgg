/** Screen-space clearance for names and witnessed speech. Input positions remain tied to actual drawn heads. */
export interface WalkLabelAnchor {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly distance: number;
  readonly self: boolean;
  readonly speaking: boolean;
  readonly width: number;
  readonly height: number;
}
export interface LabelRect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export interface PlacedWalkLabel<T extends WalkLabelAnchor> { readonly anchor: T; readonly bounds: LabelRect }

const overlaps = (a: LabelRect, b: LabelRect) => a.left < b.right + 6 && a.right > b.left - 6 && a.top < b.bottom + 6 && a.bottom > b.top - 6;

/**
 * Keep speech first, then your name, then nearby people. Labels never detach from their head to make room;
 * occluded labels yield instead. No queued bubbles: the next frame uses only still-live candidates.
 * Caller measures real rendered text and supplies HUD/safe-area rectangles in the same CSS coordinate space.
 */
export function layoutWalkLabels<T extends WalkLabelAnchor>(anchors: readonly T[], viewport: { readonly width: number; readonly height: number },
  reserved: readonly LabelRect[] = [], maxLabels = 12, maxSpeech = 3): readonly PlacedWalkLabel<T>[] {
  if (!(viewport.width > 16 && viewport.height > 16) || !(maxLabels > 0)) return [];
  const occupied = [...reserved], placed: PlacedWalkLabel<T>[] = [], seen = new Set<string>();
  let speech = 0;
  const candidates = anchors.filter(a => [a.x, a.y, a.distance, a.width, a.height].every(Number.isFinite)
    && a.distance >= 0 && a.distance <= (a.speaking ? 28 : 40) && a.width > 0 && a.height > 0)
    .sort((a, b) => Number(b.speaking) - Number(a.speaking) || Number(b.self) - Number(a.self) || a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const anchor of candidates) {
    if (seen.has(anchor.id) || (anchor.speaking && speech >= maxSpeech)) continue;
    // Above-head plaques are centred horizontally and bottom-aligned at the head's anchor.
    const bounds = { left: anchor.x - anchor.width / 2, right: anchor.x + anchor.width / 2, top: anchor.y - anchor.height, bottom: anchor.y };
    if (bounds.left < 8 || bounds.right > viewport.width - 8 || bounds.top < 8 || bounds.bottom > viewport.height - 8 || occupied.some(rect => overlaps(rect, bounds))) continue;
    placed.push({ anchor, bounds }); occupied.push(bounds); seen.add(anchor.id);
    if (anchor.speaking) speech++;
    if (placed.length >= Math.max(0, Math.floor(maxLabels))) break;
  }
  return placed;
}
