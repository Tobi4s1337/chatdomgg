import { MAT } from '@chatdom/content';
import type { VoxelBlueprint } from '@chatdom/shared';
import { blueprint, box, type BannerKit, type Box } from './banner';
import { brazierBlueprint, gatePoleBlueprint } from './raid-art';
import { TOWN_COLOURS, TOWN_DYES, type TownColour } from './town';

/**
 * The town's own pieces in build cells (0.125 m), authored for this lane. Every blueprint's origin is its minimum
 * corner; the `*_CELLS` constants say where its pivot sits so the view can place and animate it.
 *
 * - The follower's sapling (about 1.25 m): a turned planting ring with grass at its rim, a slim stem whose young top
 *   is still green, three leaf sprigs that unfold from the stem, and a rounded two-tone tuft on top.
 * - The planted tree (about 3.5 m): a young broadleaf on a short flared bole that forks into three limbs, its crown
 *   three rounded masses on a two-cell lattice (dark leaf beneath, moss where the sky catches it), the top dressed in
 *   blossom (rose or cream by home). Grown, not scattered: every lobe and limb is authored, so the same tree always
 *   grows the same way. Distinct from the town's oaks, beeches and firs, but in their grammar.
 * - The name tag: a fresh-cut tag on a cord from a brass nail on a short peg; a blank tag for a citizen who is not
 *   publicly named, otherwise a line or two of burnt-in writing whose length follows the name.
 * - The night's gate: the raid's brazier and standard pole (shared parts), the town's standard woven from one cell of
 *   each dye, and an iron beacon cresset that seats on the castle's crown.
 */

type V3 = readonly [number, number, number];

// ---------------------------------------------------------------- a small sculptor

/** Foliage a crown is made of; a limb overwrites foliage but never other wood. */
const FOLIAGE = new Set<number>([MAT.leaf, MAT.moss, MAT.grass, MAT.petal, MAT.cream]);

/**
 * Cells in a box, each tagged with a group, merged into boxes per group. Lobes fill whole blocks of `grain` cells on
 * one lattice so a crown steps in broad courses, never single-cell noise; limbs taper and stay face-connected.
 */
class Sculpt {
  readonly cells: Uint8Array;
  readonly groups: Uint8Array;
  constructor(readonly size: readonly [number, number, number]) {
    this.cells = new Uint8Array(size[0] * size[1] * size[2]);
    this.groups = new Uint8Array(this.cells.length);
  }
  private index(x: number, y: number, z: number) { return x + this.size[0] * (y + this.size[1] * z); }
  inside(x: number, y: number, z: number) { return x >= 0 && y >= 0 && z >= 0 && x < this.size[0] && y < this.size[1] && z < this.size[2]; }
  get(x: number, y: number, z: number) { return this.inside(x, y, z) ? this.cells[this.index(x, y, z)]! : 0; }
  set(x: number, y: number, z: number, material: number, group = 0) {
    if (!this.inside(x, y, z)) return;
    const i = this.index(x, y, z);
    this.cells[i] = material; this.groups[i] = group;
  }

  /** A tapered limb from `a` to `b` (cell-corner coordinates), radius `r0` to `r1` in cells. */
  limb(a: V3, b: V3, r0: number, r1: number, material: number = MAT.bark) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const, length2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2 || 1, r = Math.max(r0, r1);
    for (let z = Math.floor(Math.min(a[2], b[2]) - r); z <= Math.max(a[2], b[2]) + r; z++)
      for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r)); y <= Math.max(a[1], b[1]) + r; y++)
        for (let x = Math.floor(Math.min(a[0], b[0]) - r); x <= Math.max(a[0], b[0]) + r; x++) {
          const px = x + 0.5 - a[0], py = y + 0.5 - a[1], pz = z + 0.5 - a[2];
          const t = Math.max(0, Math.min(1, (px * d[0] + py * d[1] + pz * d[2]) / length2)), radius = r0 + (r1 - r0) * t;
          if ((px - d[0] * t) ** 2 + (py - d[1] * t) ** 2 + (pz - d[2] * t) ** 2 > radius * radius) continue;
          const current = this.get(x, y, z);
          if (current === 0 || FOLIAGE.has(current)) this.set(x, y, z, material);
        }
  }
  bough(points: readonly V3[], r0: number, r1: number, material: number = MAT.bark) {
    const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i]![0], p[1] - points[i]![1], p[2] - points[i]![2]));
    const total = lengths.reduce((n, l) => n + l, 0) || 1;
    let run = 0;
    lengths.forEach((l, i) => {
      const from = r0 + (r1 - r0) * (run / total);
      run += l;
      this.limb(points[i]!, points[i + 1]!, from, r0 + (r1 - r0) * (run / total), material);
    });
  }

  /**
   * A rounded lobe: an ellipsoid about `c` with radii `r`, its underside drawn up by `belly`, filled block by block on
   * the shared lattice. It fills only air (and never a cell `skip` keeps), so the first lobe at a seam keeps it.
   */
  lobe(c: V3, r: V3, material: number, group: number, belly = 0.6, grain = 2, skip?: (x: number, y: number, z: number) => boolean) {
    const g = grain, lo = (v: number, rad: number) => Math.floor((v - rad) / g) * g;
    for (let bz = lo(c[2], r[2]); bz < c[2] + r[2] + g; bz += g)
      for (let by = Math.max(0, lo(c[1], r[1])); by < c[1] + r[1] + g; by += g)
        for (let bx = lo(c[0], r[0]); bx < c[0] + r[0] + g; bx += g) {
          const dy = by + g / 2 - c[1], ry = dy < 0 ? r[1] * belly : r[1];
          if (((bx + g / 2 - c[0]) / r[0]) ** 2 + (dy / ry) ** 2 + ((bz + g / 2 - c[2]) / r[2]) ** 2 > 1) continue;
          for (let z = bz; z < bz + g; z++) for (let y = by; y < by + g; y++) for (let x = bx; x < bx + g; x++)
            if (this.inside(x, y, z) && this.get(x, y, z) === 0 && !skip?.(x, y, z)) this.set(x, y, z, material, group);
        }
  }

  /** The top `depth` cells of every column whose top is `from` become `to`: lit above, shaded beneath. */
  light(from: number, to: number, depth: number, minY = 0) {
    const [sx, sy, sz] = this.size;
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) for (let y = sy - 1; y >= minY; y--) {
      const m = this.get(x, y, z);
      if (m === 0) continue;
      if (m === from) for (let k = 0; k < depth && y - k >= 0 && this.get(x, y - k, z) === from; k++) this.cells[this.index(x, y - k, z)] = to;
      break;
    }
  }

  /** Top cell of column (x, z) and its y, or -1. */
  top(x: number, z: number): number {
    for (let y = this.size[1] - 1; y >= 0; y--) if (this.get(x, y, z) !== 0) return y;
    return -1;
  }

  /** Cells to non-overlapping boxes, one group at a time: runs up Y, grown across X, then along Z. */
  boxes(group: number | null = null): Box[] {
    const [sx, sy, sz] = this.size, plane = sx * sy, used = new Uint8Array(this.cells.length), out: Box[] = [];
    const want = (i: number, m: number) => !used[i] && this.cells[i] === m && (group === null || this.groups[i] === group);
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) {
      const start = x + y * sx + z * plane, m = this.cells[start]!;
      if (!m || !want(start, m)) continue;
      let y1 = y + 1;
      while (y1 < sy && want(start + (y1 - y) * sx, m)) y1++;
      const column = (from: number) => { for (let u = 0, p = from; u < y1 - y; u++, p += sx) if (!want(p, m)) return false; return true; };
      let x1 = x + 1;
      while (x1 < sx && column(start + (x1 - x))) x1++;
      let z1 = z + 1;
      along: while (z1 < sz) { for (let v = 0; v < x1 - x; v++) if (!column(start + v + (z1 - z) * plane)) break along; z1++; }
      for (let w = 0; w < z1 - z; w++) for (let v = 0; v < x1 - x; v++) for (let u = 0, p = start + v + w * plane; u < y1 - y; u++, p += sx) used[p] = 1;
      out.push(box(x, y, z, x1, y1, z1, m));
    }
    return out;
  }
}

/** Deterministic 0..1 from cell coordinates, so the same piece always carries the same tufts and blossom. */
const speck = (x: number, y: number, z: number) => {
  let h = Math.imul(x * 73856093 ^ y * 19349663 ^ z * 83492791, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

// ---------------------------------------------------------------- the follower's sapling

/**
 * The sapling, all parts standing on the ground point beside the door:
 * - soil: 7 × 2 × 7, pivot (3.5, 1, 3.5): the lower course sinks into the ground, the ring mound stands one cell.
 * - stem: 1 × 6 × 1, pivot (0.5, 0, 0.5), from the ground; the tuft sits on its top (y 6).
 * - leaf: a sprig 3 × 1 × 2 that leaves the stem at its pivot (0, 0.5, 1) and reaches out along +x.
 * - tuft: 5 × 4 × 5, pivot (2.5, 0, 2.5).
 */
export const SAPLING_CELLS = {
  soil: { size: [7, 2, 7] as const, pivot: [3.5, 1, 3.5] as const },
  stem: { size: [1, 6, 1] as const, pivot: [0.5, 0, 0.5] as const, height: 6 },
  leaf: { size: [3, 1, 2] as const, pivot: [0, 0.5, 1] as const },
  tuft: { size: [5, 4, 5] as const, pivot: [2.5, 0, 2.5] as const },
  /** Each sprig: height on the stem (cells) and its turn about the stem (radians). */
  sprigs: [[2.5, 0.4], [3.5, 2.6], [4.5, 4.6]] as const,
  /** Height of the whole sapling, cells. */
  height: 10,
} as const;

export function saplingSoilBlueprint(kit: BannerKit): VoxelBlueprint {
  const boxes: Box[] = [], { size, pivot } = SAPLING_CELLS.soil;
  for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
    const d = Math.hypot(x + 0.5 - pivot[0], z + 0.5 - pivot[2]);
    if (d <= 3.4) boxes.push(box(x, 0, z, x + 1, 1, z + 1, MAT.earth));
    // The mound: turned earth round the stem, its hole left open for the stem itself.
    if (d > 0.6 && d <= 2.3) boxes.push(box(x, 1, z, x + 1, 2, z + 1, MAT.earth));
    // A few tufts of grass and one pebble where the spade turned the turf back at the rim.
    else if (d > 2.3 && d <= 3.3) {
      const k = speck(x, 1, z);
      if (k < 0.2) boxes.push(box(x, 1, z, x + 1, 2, z + 1, MAT.grass));
      else if (k > 0.94) boxes.push(box(x, 1, z, x + 1, 2, z + 1, MAT.stone));
    }
  }
  return blueprint(`moment-town-sapling-soil-${kit}`, kit, [...size], boxes);
}

export function saplingStemBlueprint(kit: BannerKit): VoxelBlueprint {
  // Old bark at the foot, the year's green wood above it.
  const h = SAPLING_CELLS.stem.height;
  return blueprint(`moment-town-sapling-stem-${kit}`, kit, [1, h, 1], [box(0, 0, 0, 1, h - 2, 1, MAT.bark), box(0, h - 2, 0, 1, h, 1, MAT.grass)]);
}

export function saplingLeafBlueprint(kit: BannerKit): VoxelBlueprint {
  // A green twig, the blade in leaf, its sunlit tip in moss.
  return blueprint(`moment-town-sapling-leaf-${kit}`, kit, [3, 1, 2], [box(0, 0, 0, 1, 1, 1, MAT.grass), box(1, 0, 0, 2, 1, 2, MAT.leaf), box(2, 0, 0, 3, 1, 2, MAT.moss)]);
}

export function saplingTuftBlueprint(kit: BannerKit): VoxelBlueprint {
  const s = new Sculpt([5, 4, 5]);
  for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) {
    const corner = (x === 0 || x === 4) && (z === 0 || z === 4), inner = x >= 1 && x <= 3 && z >= 1 && z <= 3;
    if (inner) s.set(x, 0, z, MAT.leaf);
    if (!corner) { s.set(x, 1, z, MAT.leaf); s.set(x, 2, z, MAT.leaf); }
    if (inner && !((x === 1 || x === 3) && (z === 1 || z === 3) && (x + z) % 4 === 0)) s.set(x, 3, z, MAT.leaf);
  }
  // The leading shoot pokes one cell proud at the back, so the tuft never reads as a cube.
  s.set(2, 3, 1, MAT.leaf);
  s.light(MAT.leaf, MAT.moss, 1);
  // One fresh pale-green leaf on the crown.
  s.set(2, 3, 2, MAT.grass);
  return blueprint(`moment-town-sapling-tuft-${kit}`, kit, [5, 4, 5], s.boxes());
}

/** A crumb of turned earth thrown up as the soil breaks. Pivot: its centre. */
export const crumbBlueprint = (kit: BannerKit): VoxelBlueprint => blueprint(`moment-town-crumb-${kit}`, kit, [1, 1, 1], [box(0, 0, 0, 1, 1, 1, MAT.earth)]);

// ---------------------------------------------------------------- the name tag

/**
 * The peg: 1 × 6 × 2, pivot (0.5, 0, 0.5); a brass nail stands out of its front face at `nail`. The tag (5 × 4 × 1)
 * hangs from its cord at `hang` (top centre), plate rows 0..2 under a cord cell at the top; it swings in its own plane.
 */
export const TAG_CELLS = {
  peg: { size: [1, 6, 2] as const, pivot: [0.5, 0, 0.5] as const, nail: [0.5, 4, 1.5] as const },
  tag: { size: [5, 4, 1] as const, hang: [2.5, 4, 0.5] as const },
} as const;
export const TAG_VARIANTS = ['blank', 'short', 'mid', 'long'] as const;
export type TagVariant = typeof TAG_VARIANTS[number];
/** The writing on a tag follows the name's length; no name, no writing. */
export const tagVariant = (name: string | null): TagVariant => {
  const length = name ? [...name.trim()].length : 0;
  return length === 0 ? 'blank' : length <= 6 ? 'short' : length <= 12 ? 'mid' : 'long';
};

export function tagPegBlueprint(kit: BannerKit): VoxelBlueprint {
  // A split stake, darker where it went into the ground, a brass nail near its top.
  return blueprint(`moment-town-tag-peg-${kit}`, kit, [1, 6, 2], [box(0, 0, 0, 1, 1, 1, MAT.bark), box(0, 1, 0, 1, 6, 1, MAT.timber), box(0, 4, 1, 1, 5, 2, MAT.brass)]);
}

export function tagBlueprint(kit: BannerKit, variant: TagVariant): VoxelBlueprint {
  const boxes: Box[] = [];
  // Fresh-cut light wood, the lower corners rounded off, hung on a cream cord.
  boxes.push(box(1, 0, 0, 4, 1, 1, MAT.thatch), box(0, 1, 0, 5, 3, 1, MAT.thatch), box(2, 3, 0, 3, 4, 1, MAT.cream));
  // Burnt-in writing: one short word, one line, or a line and a half.
  const lines: Readonly<Record<TagVariant, readonly (readonly [number, number, number])[]>> = {
    blank: [], short: [[1, 3, 1]], mid: [[1, 4, 1]], long: [[1, 4, 2], [1, 3, 1]],
  };
  for (const [x0, x1, y] of lines[variant]) boxes.push(box(x0, y, 0, x1, y + 1, 1, MAT.bark));
  return blueprint(`moment-town-tag-${variant}-${kit}`, kit, [5, 4, 1], boxes);
}

// ---------------------------------------------------------------- the planted tree

/**
 * The tree, in two grids that share one lattice:
 * - soil 12 × 2 × 12, pivot (6, 1, 6): the planting ring, around the bole and its roots, on the trunk's own lattice.
 * - trunk 12 × 18 × 12, pivot (6, 0, 6): bole, root flare and three limbs into the crown.
 * - crown 24 × 18 × 24, pivot (12, 0, 12), seated `seat` cells up the trunk: three parts (heart, east, west) carved
 *   from one grid so they never overlap, each growing from the seat on its own beat. The heart carries the blossom.
 */
export const TREE_CELLS = {
  soil: { size: [12, 2, 12] as const, pivot: [6, 1, 6] as const },
  trunk: { size: [12, 18, 12] as const, pivot: [6, 0, 6] as const },
  crown: { size: [24, 18, 24] as const, pivot: [12, 0, 12] as const },
  seat: 12,
  /** Height of the whole tree, cells (3.5 m). */
  height: 28,
  /** Crown radius from the bole, metres: what the view keeps clear of the house. */
  reach: 1.45,
} as const;
export const CROWN_PARTS = ['heart', 'east', 'west'] as const;
export type CrownPart = typeof CROWN_PARTS[number];
export const BLOSSOMS = ['rose', 'cream'] as const;
export type Blossom = typeof BLOSSOMS[number];

let trunkGrid: Sculpt | null = null;
function trunk(): Sculpt {
  if (trunkGrid) return trunkGrid;
  const t = new Sculpt(TREE_CELLS.trunk.size);
  // A young bole with a slight lean, forking at 1.25 m into a leader and two side limbs.
  t.bough([[6, 0, 6], [6.1, 6, 6.1], [6.4, 10.5, 5.9]], 1.75, 1.25);
  for (const [turn, reach] of [[0.05, 3.6], [0.3, 3.1], [0.55, 3.5], [0.8, 3.0]] as const) {
    const a = turn * Math.PI * 2;
    t.bough([[6 + Math.cos(a) * 0.9, 2.2, 6 + Math.sin(a) * 0.9], [6 + Math.cos(a) * 2, 0.9, 6 + Math.sin(a) * 2], [6 + Math.cos(a) * reach, 0.5, 6 + Math.sin(a) * reach]], 1.1, 0.9);
  }
  t.bough([[6.4, 10, 5.9], [4.2, 13.5, 6.4], [2.6, 17.5, 7]], 1.15, 0.9);
  t.bough([[6.4, 10.5, 5.9], [8.6, 14, 4.9], [9.8, 17.5, 4.2]], 1.15, 0.9);
  t.bough([[6.4, 10.5, 5.9], [6.6, 14.5, 6.8], [6.9, 17.6, 7.6]], 1.05, 0.9);
  trunkGrid = t;
  return t;
}

export function treeTrunkBlueprint(kit: BannerKit): VoxelBlueprint {
  const t = trunk();
  return blueprint(`moment-town-tree-trunk-${kit}`, kit, [...TREE_CELLS.trunk.size], t.boxes());
}

export function treeSoilBlueprint(kit: BannerKit): VoxelBlueprint {
  const t = trunk(), { size, pivot } = TREE_CELLS.soil, s = new Sculpt(size);
  // The trunk grid's ground course, in the soil's cells (the soil's top course is the trunk's y 0).
  const dx = TREE_CELLS.trunk.pivot[0] - pivot[0], dz = TREE_CELLS.trunk.pivot[2] - pivot[2];
  for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
    const d = Math.hypot(x + 0.5 - pivot[0], z + 0.5 - pivot[2]);
    if (d <= 5.4) s.set(x, 0, z, MAT.earth);
    if (d > 4.6 || t.get(x + dx, 0, z + dz) !== 0) continue;
    const k = speck(x, 7, z);
    s.set(x, 1, z, d > 3.6 && k < 0.22 ? MAT.grass : d > 3.6 && k > 0.95 ? MAT.stone : d < 2.6 && k < 0.12 ? MAT.moss : MAT.earth);
  }
  return blueprint(`moment-town-tree-soil-${kit}`, kit, [...size], s.boxes());
}

/** Lobes of the crown in its own cells: centre, radii, part, and the turn of the bumps on its shoulder. */
const CROWN_LOBES: readonly (readonly [c: V3, r: V3, part: CrownPart])[] = [
  [[12, 9, 12], [8.4, 7.4, 8.4], 'heart'],
  [[9.5, 13.4, 13.5], [4.6, 3.4, 4.6], 'heart'],
  [[15, 12.4, 9.5], [4.2, 3.4, 4.2], 'heart'],
  [[17.6, 8.6, 13.6], [5.2, 4.6, 5.2], 'east'],
  [[13, 7.6, 18.2], [4.8, 4.2, 4.4], 'east'],
  [[6.4, 9.2, 10.4], [5.2, 4.6, 5.2], 'west'],
  [[11, 8, 5.8], [4.8, 4.2, 4.4], 'west'],
];

const crowns = new Map<Blossom, Sculpt>();
function crown(blossom: Blossom): Sculpt {
  const known = crowns.get(blossom);
  if (known) return known;
  const t = trunk(), s = new Sculpt(TREE_CELLS.crown.size);
  // Never fill a cell the trunk's limbs already hold: no two parts share a cell, so no faces fight.
  const ox = TREE_CELLS.trunk.pivot[0] - TREE_CELLS.crown.pivot[0], oy = TREE_CELLS.seat, oz = TREE_CELLS.trunk.pivot[2] - TREE_CELLS.crown.pivot[2];
  const wood = (x: number, y: number, z: number) => t.get(x + ox, y + oy, z + oz) !== 0;
  CROWN_LOBES.forEach(([c, r, part]) => s.lobe(c, r, MAT.leaf, CROWN_PARTS.indexOf(part) + 1, 0.6, 2, wood));
  s.light(MAT.leaf, MAT.moss, 2, 6);
  // Blossom on the heart's sunlit top, in whole 2 × 2 patches so it reads as flowers, never as speckle.
  const flower = blossom === 'rose' ? MAT.petal : MAT.cream;
  for (let bz = 0; bz < 24; bz += 2) for (let bx = 0; bx < 24; bx += 2) {
    if (speck(bx, blossom === 'rose' ? 3 : 5, bz) > 0.24) continue;
    for (let z = bz; z < bz + 2; z++) for (let x = bx; x < bx + 2; x++) {
      const y = s.top(x, z);
      if (y >= 10 && s.get(x, y, z) === MAT.moss && s.groups[x + 24 * (y + 18 * z)] === 1) s.set(x, y, z, flower, 1);
    }
  }
  crowns.set(blossom, s);
  return s;
}

export function treeCrownBlueprint(kit: BannerKit, part: CrownPart, blossom: Blossom = 'rose'): VoxelBlueprint {
  // Only the heart flowers; the side masses are the same leaf in either tree.
  const s = crown(part === 'heart' ? blossom : 'rose');
  const id = part === 'heart' ? `moment-town-tree-crown-heart-${blossom}-${kit}` : `moment-town-tree-crown-${part}-${kit}`;
  return blueprint(id, kit, [...TREE_CELLS.crown.size], s.boxes(CROWN_PARTS.indexOf(part) + 1));
}

// ---------------------------------------------------------------- the night's gate and the beacon

/** The beacon cresset that seats on the castle's crown: 8 × 7 × 8, pivot (4, 0, 4); the fire burns at `fire`. */
export const BEACON_CELLS = { size: [8, 7, 8] as const, pivot: [4, 0, 4] as const, fire: [4, 5.6, 4] as const } as const;

export function beaconBlueprint(kit: BannerKit): VoxelBlueprint {
  const iron = MAT.darkStone, boxes: Box[] = [];
  // Socket over the finial, a dished floor, then a flared basket of iron straps with a brass rim at its corners.
  boxes.push(box(3, 0, 3, 5, 2, 5, iron), box(2, 2, 2, 6, 3, 6, iron));
  boxes.push(box(1, 3, 1, 7, 4, 2, iron), box(1, 3, 6, 7, 4, 7, iron), box(1, 3, 2, 2, 4, 6, iron), box(6, 3, 2, 7, 4, 6, iron));
  for (const y of [4, 5]) boxes.push(box(0, y, 0, 8, y + 1, 1, iron), box(0, y, 7, 8, y + 1, 8, iron), box(0, y, 1, 1, y + 1, 7, iron), box(7, y, 1, 8, y + 1, 7, iron));
  // Open slots in the straps so the coals show between them.
  for (const [x, z] of [[3, 0], [4, 7], [0, 4], [7, 3]] as const) boxes.push(box(x, 4, z, x + 1, 5, z + 1, MAT.air));
  for (let x = 1; x < 7; x++) for (let z = 1; z < 7; z++) boxes.push(box(x, 4, z, x + 1, 5, z + 1, (x * 3 + z * 5) % 4 === 0 ? MAT.terracotta : MAT.hairCopper));
  for (const [x, z] of [[0, 0], [7, 0], [0, 7], [7, 7]] as const) boxes.push(box(x, 6, z, x + 1, 7, z + 1, MAT.brass));
  return blueprint(`moment-town-beacon-${kit}`, kit, [8, 7, 8], boxes);
}

/** One cell of a dye; a standard is woven from runs of it, scaled along a row. Pivot: its minimum corner. */
export const dyeCellBlueprint = (kit: BannerKit, material: number): VoxelBlueprint =>
  blueprint(`moment-town-dye-${kit}-${material}`, kit, [1, 1, 1], [box(0, 0, 0, 1, 1, 1, material)]);
/** Every dye the town's colours use. */
export const TOWN_DYE_MATERIALS: readonly number[] = [...new Set(TOWN_COLOURS.flatMap(c => [TOWN_DYES[c].field, TOWN_DYES[c].trim]))];

export interface DyeRun { readonly x0: number; readonly x1: number; readonly material: number }

/**
 * The town's standard as it hangs from the gate pole's crossbar (GATE_CELLS.cloth: 13 across, 22 rows, a three-row
 * swallowtail): a trim header and border, the kingdom's chevron over its lozenge in the trim on the field, and a
 * trim band above the tails. Row 0 is the top.
 */
export const STANDARD_CELLS = { width: 13, rows: 22, tail: 3 } as const;
export function standardRuns(colour: TownColour): DyeRun[][] {
  const { field, trim } = TOWN_DYES[colour], { width, rows, tail } = STANDARD_CELLS, centre = (width - 1) / 2;
  const out: DyeRun[][] = [];
  for (let row = 0; row < rows; row++) {
    const cells: number[] = [];
    for (let col = 0; col < width; col++) {
      const fromHem = rows - 1 - row, d = Math.abs(col - centre);
      if (fromHem < tail && d <= tail - 1 - fromHem) { cells.push(MAT.air); continue; }
      const lozenge = [0, 1, 2, 1, 0][row - 11];
      const isTrim = row === 0 || col === 0 || col === width - 1 || row === 17
        || (row >= 4 && row <= 9 && (d === row - 4 || d === row - 5)) || (lozenge !== undefined && d <= lozenge);
      cells.push(isTrim ? trim : field);
    }
    const runs: DyeRun[] = [];
    let start = 0;
    for (let col = 1; col <= width; col++) {
      if (col < width && cells[col] === cells[start]) continue;
      if (cells[start] !== MAT.air) runs.push({ x0: start, x1: col, material: cells[start]! });
      start = col;
    }
    out.push(runs);
  }
  return out;
}

/** Every town part, meshed up front. The brazier and pole are the Raid Gate's own parts (same ids, meshed once). */
export function townParts(kit: BannerKit): VoxelBlueprint[] {
  return [
    saplingSoilBlueprint(kit), saplingStemBlueprint(kit), saplingLeafBlueprint(kit), saplingTuftBlueprint(kit), crumbBlueprint(kit),
    tagPegBlueprint(kit), ...TAG_VARIANTS.map(v => tagBlueprint(kit, v)),
    treeSoilBlueprint(kit), treeTrunkBlueprint(kit), ...BLOSSOMS.map(b => treeCrownBlueprint(kit, 'heart', b)), treeCrownBlueprint(kit, 'east'), treeCrownBlueprint(kit, 'west'),
    beaconBlueprint(kit), ...TOWN_DYE_MATERIALS.map(m => dyeCellBlueprint(kit, m)), brazierBlueprint(kit), gatePoleBlueprint(kit),
  ];
}
