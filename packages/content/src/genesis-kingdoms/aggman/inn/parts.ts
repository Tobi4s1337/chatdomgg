import type { VoxelBlueprint } from '@chatdom/shared';
import { Shell, gableCourses, type Gable } from '../../../homes/tide/grammar';
import { hash } from '../../../places/water/shore/shape';

/**
 * Construction parts for the harbour inn. The inn speaks the Tide homes' grammar (slate courses, gable walls,
 * valleys, inset casements, the crooked stack), so it builds on their `Shell`, widened to its own bounds, and adds
 * what a public house needs and a home does not: long-and-short quoins in any stone, elliptical door orders with
 * their voussoirs, and weathered slopes. Every helper writes ordered half-open boxes in build cells.
 */

type Box = VoxelBlueprint['boxes'][number];
export type Size = readonly [number, number, number];

export class InnShell extends Shell {
  constructor(private readonly bounds: Size) { super(); }

  /** One half-open box inside the inn's bounds. Authoring mistakes (inverted or stray boxes) fail loudly. */
  override put(material: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const from: [number, number, number] = [x0, y0, z0], to: [number, number, number] = [x1, y1, z1];
    if ([...from, ...to].some(v => !Number.isInteger(v))) throw new Error(`Box coordinates must be integers: ${from}→${to}`);
    if (from.some((v, axis) => v >= to[axis]!)) throw new Error(`Empty or inverted box ${from}→${to}`);
    if (from.some(v => v < 0) || to.some((v, axis) => v > this.bounds[axis]!)) throw new Error(`Box ${from}→${to} leaves the inn's ${this.bounds.join('×')} bounds`);
    this.boxes.push({ from, to, material });
  }

  /** The civic `Boxes` call shape (coordinates first, material last; empty boxes are skipped), for shared craft. */
  add(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number): void {
    if (x0 >= x1 || y0 >= y1 || z0 >= z1) return;
    this.put(material, x0, y0, z0, x1, y1, z1);
  }

  /** The box and its mirror across the plane x = width / 2. */
  pair(width: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number): void {
    this.add(x0, y0, z0, x1, y1, z1, material);
    this.add(width - x1, y0, z0, width - x0, y1, z1, material);
  }

  get list(): Box[] { return this.boxes; }
}

/**
 * Alternating long and short quoin stones up a corner, one cell deep on both faces. `x`/`z` are the corner's two
 * face planes; `xDir`/`zDir` point from the corner along each wall. Stones are `size` tall so they keep the coursing.
 */
export function quoins(s: InnShell, material: number, x: number, z: number, xDir: 1 | -1, zDir: 1 | -1, y0: number, y1: number, size = 4): void {
  for (let y = y0, i = 0; y < y1; y += size, i++) {
    const along = i % 2 === 0 ? 5 : 3, side = i % 2 === 0 ? 3 : 5, top = Math.min(y + size, y1);
    const [xa, xb] = xDir > 0 ? [x, x + along] : [x - along, x];
    const [za, zb] = zDir > 0 ? [z, z + side] : [z - side, z];
    s.put(material, xa, y, zDir > 0 ? z : z - 1, xb, top, zDir > 0 ? z + 1 : z);
    s.put(material, xDir > 0 ? x : x - 1, y, za, xDir > 0 ? x + 1 : x, top, zb);
  }
}

/** One row [y, x0, x1) of an opening. */
export type Row = readonly [number, number, number];

/**
 * The rows of an arched opening on axis `cx`: straight jambs `half` cells either side from `y0` up to `spring`,
 * then a flattened elliptical head `rise` cells tall. A cell is open when its centre lies inside the outline.
 */
export function archRows(cx: number, half: number, y0: number, spring: number, rise: number): Row[] {
  const rows: Row[] = [];
  for (let y = y0; y < spring + rise; y++) {
    let w = half;
    if (y >= spring) {
      const t = (y + 0.5 - spring) / rise;
      w = half * Math.sqrt(1 - t * t);
    }
    const x0 = Math.floor(cx - w - 0.5) + 1, x1 = Math.ceil(cx + w - 0.5);
    if (x1 > x0) rows.push([y, x0, x1]);
  }
  return rows;
}

/**
 * The voussoirs of an elliptical arch as cells (x, y, sector): the ring between the opening's head (`half` × `rise`)
 * and an outline `depth` cells wider and taller, cut into `count` wedge-shaped stones by angle from the springing.
 */
export function voussoirs(cx: number, half: number, spring: number, rise: number, depth: number, count: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const inside = (x: number, y: number, h: number, r: number) => {
    const dx = (x + 0.5 - cx) / h, dy = (y + 0.5 - spring) / r;
    return dx * dx + dy * dy < 1;
  };
  for (let y = spring; y < spring + rise + depth; y++) for (let x = cx - half - depth; x < cx + half + depth; x++) {
    if (!inside(x, y, half + depth, rise + depth) || inside(x, y, half, rise)) continue;
    const angle = Math.atan2((y + 0.5 - spring) / (rise + depth / 2), (x + 0.5 - cx) / (half + depth / 2));
    out.push([x, y, Math.min(count - 1, Math.max(0, Math.floor((angle / Math.PI) * count)))]);
  }
  return out;
}

/**
 * Odd slates on one slope of a gable roof: the exposed lip of each course (its butt and the strip the course above
 * leaves uncovered) is walked in slates of three to six cells, and `tone` may recolour any of them. Laid straight
 * after the roof it weathers, so later dormers, valleys and stacks still cut through it.
 */
export function weatherSlope(s: InnShell, g: Gable, side: 'lo' | 'hi', seed: number, tone: (r: number, course: number) => number | undefined): void {
  gableCourses(g).filter(c => c.side === side).forEach((c, k) => {
    const [l0, l1] = typeof g.along === 'function' ? g.along(c.y0) : g.along;
    const [a0, a1] = side === 'lo' ? [c.a0, c.a0 + 2] : [c.a1 - 2, c.a1];
    let l = l0 - Math.floor(hash(seed, k, 1) * 4);
    for (let i = 0; l < l1; i++) {
      const len = 3 + Math.floor(hash(seed, k, i, 2) * 4), m = tone(hash(seed, k, i, 3), k);
      const b0 = Math.max(l, l0), b1 = Math.min(l + len, l1);
      if (m !== undefined && b1 > b0) {
        if (g.ridge === 'x') s.put(m, b0, c.y0 + 1, a0, b1, c.y1, a1);
        else s.put(m, a0, c.y0 + 1, b0, a1, c.y1, b1);
      }
      l += len;
    }
  });
}

/**
 * A round section of diameter `d` in cells as half-open [u0, u1, v0, v1) rectangles: corners cut two cells, then
 * one, so a barrel or a table top reads round rather than as an octagon of straight cuts.
 */
export function round(u: number, v: number, d: number): [number, number, number, number][] {
  if (d < 6) return [[u + 1, u + d - 1, v, v + d], [u, u + d, v + 1, v + d - 1]];
  return [[u + 2, u + d - 2, v, v + d], [u, u + d, v + 2, v + d - 2], [u + 1, u + d - 1, v + 1, v + d - 1]];
}
