import type { XZ } from '../../../settlement/types';

/**
 * A centre line with arc length. The town's interior lies on its left (the ring's orientation), so the outward
 * normal of a tangent (tx, tz) is (tz, -tx).
 */
export class Path {
  readonly lengths: number[];
  readonly total: number;
  constructor(readonly points: readonly XZ[]) {
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
    this.lengths = lengths; this.total = lengths.at(-1)!;
  }
  private segment(s: number): number {
    let lo = 1, hi = this.points.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.lengths[mid]! < s) lo = mid + 1; else hi = mid; }
    return lo;
  }
  /** Point at arc length s; beyond either end the end segment is extended straight. */
  at(s: number): XZ {
    const k = s <= 0 ? 1 : s >= this.total ? this.points.length - 1 : this.segment(s);
    const a = this.points[k - 1]!, b = this.points[k]!, span = this.lengths[k]! - this.lengths[k - 1]!;
    const t = span > 1e-9 ? (s - this.lengths[k - 1]!) / span : 0;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  /** Unit tangent of the chord over [s - reach, s + reach], clamped to the path. */
  tangent(s: number, reach = 1): XZ {
    const a = this.at(Math.max(0, s - reach)), b = this.at(Math.min(this.total, s + reach));
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    return length > 1e-9 ? [dx / length, dz / length] : [1, 0];
  }
  /**
   * Nearest point: arc length s and signed offset v (positive outward). `before`/`after` let the first and last
   * segments run on past the ends by that many metres.
   */
  project(x: number, z: number, before = 0, after = 0): { s: number; v: number; distance: number } {
    let best = { s: 0, v: 0, distance: Infinity };
    const last = this.points.length - 1;
    for (let k = 1; k <= last; k++) {
      const a = this.points[k - 1]!, b = this.points[k]!, dx = b[0] - a[0], dz = b[1] - a[1], span = Math.hypot(dx, dz);
      if (span < 1e-9) continue;
      const tx = dx / span, tz = dz / span;
      let along = (x - a[0]) * tx + (z - a[1]) * tz;
      const low = k === 1 ? -before : 0, high = k === last ? span + after : span;
      along = Math.max(low, Math.min(high, along));
      const px = a[0] + tx * along, pz = a[1] + tz * along, distance = Math.hypot(x - px, z - pz);
      if (distance < best.distance - 1e-9) best = { s: this.lengths[k - 1]! + along, v: (x - px) * tz - (z - pz) * tx, distance };
    }
    return best;
  }
  /** Points strictly between two arc lengths, with exact end points. */
  slice(from: number, to: number): XZ[] {
    const out: XZ[] = [this.at(from)];
    for (let k = 0; k < this.points.length; k++) if (this.lengths[k]! > from + 1e-6 && this.lengths[k]! < to - 1e-6) out.push(this.points[k]!);
    out.push(this.at(to));
    return out;
  }
}

export const outward = (t: XZ): XZ => [t[1], -t[0]];
export const yawOf = (direction: XZ): number => Math.atan2(direction[0], direction[1]);

/** Segment–segment intersection parameter along the first segment, or null. */
export function crossing(a: XZ, b: XZ, c: XZ, d: XZ): number | null {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
  const denominator = rx * sz - rz * sx;
  if (Math.abs(denominator) < 1e-12) return null;
  const qx = c[0] - a[0], qz = c[1] - a[1];
  const t = (qx * sz - qz * sx) / denominator, u = (qx * rz - qz * rx) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
