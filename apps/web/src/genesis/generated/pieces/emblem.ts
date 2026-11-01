import type { Grid } from './kit';

/** The figure a piece's roundel carries: drawn from the kingdom's charge cloth, chosen by the seed. */
export type EmblemFigure = 'heart' | 'star' | 'diamond' | 'note';

/** Whether offset (u, v) from the roundel's centre, in units of the figure's half size, is inside the figure. */
function figureAt(figure: EmblemFigure, u: number, v: number): boolean {
  switch (figure) {
    case 'heart': {
      const x = u * 1.15, y = v * 1.15 + 0.15;
      return (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0;
    }
    case 'star':
      return Math.abs(u) * 3.2 + Math.abs(v) <= 1.05 || Math.abs(u) + Math.abs(v) * 3.2 <= 1.05 || Math.abs(u) + Math.abs(v) <= 0.45;
    case 'diamond':
      return Math.abs(u) * 1.25 + Math.abs(v) * 0.95 <= 1 && !(Math.abs(u) * 1.25 + Math.abs(v) * 0.95 < 0.42);
    case 'note': {
      const head = ((u + 0.32) / 0.42) ** 2 + ((v + 0.62) / 0.3) ** 2 <= 1;
      const stem = u >= 0.0 && u <= 0.2 && v >= -0.6 && v <= 0.95;
      const flag = v >= 0.45 && v <= 0.95 && u >= 0.0 && u <= 0.2 + (0.95 - v) * 1.1 && u <= 0.75;
      return head || stem || flag;
    }
  }
}

/**
 * A roundel in a vertical plane: a ring of `border` round a `ground` disc carrying the figure in `charge`. `axis`
 * is the plane's normal: 'z' paints the x–y plane at depth `d` (facing +Z). Radius in cells.
 */
export function emblem(g: Grid, figure: EmblemFigure, cx: number, cy: number, d: number, radius: number, charge: number, border: number, ground: number, axis: 'z' | 'x'): void {
  const s = radius - 1.6;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const e = Math.hypot(dx, dy);
    if (e > radius + 0.35) continue;
    const m = e > radius - 0.9 ? border : figureAt(figure, dx / s, dy / s) ? charge : ground;
    if (axis === 'z') g.set(cx + dx, cy + dy, d, m);
    else g.set(d, cy + dy, cx + dx, m);
  }
}

/** The first candidate that is none of `avoid`: a roundel's ground must never swallow its figure or ring. */
export function contrast(candidates: readonly number[], avoid: readonly number[]): number {
  return candidates.find(m => !avoid.includes(m)) ?? candidates[candidates.length - 1]!;
}
