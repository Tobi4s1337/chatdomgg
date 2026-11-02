/**
 * Greedy screen-space collision for stamps and labels. Callers offer boxes in priority order (the order must be
 * stable, e.g. tier, then observed average, then channel ID) and the first box to claim a patch of screen keeps it.
 */
export interface Rect { x: number; y: number; w: number; h: number }

const CELL = 64;

export class CollisionGrid {
  private readonly cells = new Map<number, Rect[]>();
  private readonly cols: number;

  constructor(readonly width: number, readonly height: number, private readonly margin = 256) {
    this.cols = Math.ceil((width + margin * 2) / CELL) + 1;
  }

  private range(rect: Rect): [number, number, number, number] {
    const m = this.margin;
    return [
      Math.max(0, Math.floor((rect.x + m) / CELL)),
      Math.max(0, Math.floor((rect.y + m) / CELL)),
      Math.max(0, Math.floor((rect.x + rect.w + m) / CELL)),
      Math.max(0, Math.floor((rect.y + rect.h + m) / CELL)),
    ];
  }

  /** True when the box overlaps nothing claimed so far (touching edges do not count). */
  free(rect: Rect): boolean {
    const [x0, y0, x1, y1] = this.range(rect);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const bucket = this.cells.get(gy * this.cols + gx);
        if (!bucket) continue;
        for (const other of bucket) if (overlaps(rect, other)) return false;
      }
    }
    return true;
  }

  claim(rect: Rect): void {
    const [x0, y0, x1, y1] = this.range(rect);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const key = gy * this.cols + gx;
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(rect);
        else this.cells.set(key, [rect]);
      }
    }
  }

  /** Claim the box if it is free; report whether it was. */
  take(rect: Rect): boolean {
    if (!this.free(rect)) return false;
    this.claim(rect);
    return true;
  }
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Survey marks by tier in CSS px: the small ink symbol for a holding too small to draw at this distance. A hamlet's
 * dot is a step below a village's.
 */
export const MARK_PX = [9, 7, 5, 3.6, 3] as const;
/** Paper kept between a lettered name and a survey mark, so no dot sits in a word or between its spaced letters. */
export const LETTER_CLEARANCE = 3;

/**
 * Whether a survey mark at (x, y) would sit inside a language, archipelago or realm name. Names knock out the small
 * marks under them, as a cartographer lifts a dot out of the lettering; a stamp, a selection or a found holding is
 * never knocked out, and the holding stays findable by search and appears again closer in.
 */
export function underLettering(x: number, y: number, tierRank: number, lettering: readonly Rect[]): boolean {
  if (!lettering.length) return false;
  const half = (MARK_PX[tierRank] ?? MARK_PX[3]) / 2 + LETTER_CLEARANCE;
  const dot: Rect = { x: x - half, y: y - half, w: half * 2, h: half * 2 };
  for (const rect of lettering) if (overlaps(dot, rect)) return true;
  return false;
}

/**
 * Stable priority: bigger tier first, then the larger observed average, then the smaller channel ID. The tier rank
 * decides first, so a hamlet never outranks a village, whatever its audience.
 */
export function comparePriority(a: { tierRank: number; average: number; id: string }, b: { tierRank: number; average: number; id: string }): number {
  if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank;
  if (a.average !== b.average) return b.average - a.average;
  if (a.id.length !== b.id.length) return a.id.length - b.id.length;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
