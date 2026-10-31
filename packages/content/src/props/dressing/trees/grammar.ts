import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '../../../materials';

type Box = VoxelBlueprint['boxes'][number];
export type Vec = [number, number, number];
/** A point in build cells, measured to cell corners: the centre of cell (x, y, z) is (x + ½, y + ½, z + ½). */
export type Point = readonly [number, number, number];
export type Piece = { size: Vec; boxes: Box[] };

/** Materials a crown may be made of. A lobe fills only air, so a limb that runs into it stays wood inside. */
const FOLIAGE = new Set<number>([MAT.leaf, MAT.moss, MAT.goldLeaf, MAT.grass]);

/**
 * A tree is grown, not scattered: a skeleton of tapered limbs from a flared root plate, and a crown of broad
 * stepped lobes on a coarse lattice, each lobe seated on a limb's end. Nothing here is random. Every form names
 * its limbs and lobes, so its asymmetry is authored and the same form always grows the same tree.
 *
 * Lobes fill whole blocks of `grain` cells on one lattice shared by every lobe of the tree. Their faces therefore
 * step in broad courses rather than single-cell noise, two lobes fuse into one mass without seams, and a render
 * LOD of the same factor keeps each block whole.
 */
export function grow(size: Vec, grain: 1 | 2 | 4 = 2, course: 1 | 2 | 4 = grain, speck = 8) {
  const [sx, sy, sz] = size;
  const cells = new Uint8Array(sx * sy * sz);
  const index = (x: number, y: number, z: number) => x + sx * (y + sy * z);
  const inside = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz;
  const get = (x: number, y: number, z: number) => inside(x, y, z) ? cells[index(x, y, z)]! : 0;
  const set = (x: number, y: number, z: number, material: number) => {
    if (!inside(x, y, z)) throw new Error(`Cell ${x},${y},${z} lies outside ${size.join('×')}.`);
    cells[index(x, y, z)] = material;
  };

  /**
   * A tapered limb from `a` (radius `r0`) to `b` (radius `r1`), as round as the cells allow. Radii stay at or above
   * 0.9 cells, so a limb at any angle is one face-connected run of cells. A limb whose radius stays at or above
   * 2.5 cells is a bole or a great bough: it is laid in 2-cell blocks on a lattice shared by the whole tree, so its
   * bark steps in quarter metres like the crowns above it, and twigs keep their single-cell taper. A limb
   * overwrites foliage but never other wood, so the first limb drawn at a joint keeps its colour.
   */
  const limb = (a: Point, b: Point, r0: number, r1: number, material: number = MAT.bark) => {
    if (r0 < 0.9 || r1 < 0.9) throw new Error('A limb must be at least 0.9 cells in radius to stay connected.');
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const, length2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2 || 1;
    const r = Math.max(r0, r1), g = Math.min(r0, r1) >= 2.5 ? 2 : 1;
    const paint = (x: number, y: number, z: number) => {
      if (!inside(x, y, z)) throw new Error(`A limb at ${a.join(',')} leaves the ${size.join('×')} box.`);
      const current = get(x, y, z); if (current === 0 || FOLIAGE.has(current)) set(x, y, z, material);
    };
    const start = (v: number) => Math.floor((v - r) / g) * g;
    for (let z = start(Math.min(a[2], b[2])); z <= Math.max(a[2], b[2]) + r; z += g)
      for (let y = Math.max(0, start(Math.min(a[1], b[1]))); y <= Math.max(a[1], b[1]) + r; y += g)
        for (let x = start(Math.min(a[0], b[0])); x <= Math.max(a[0], b[0]) + r; x += g) {
          const px = x + g / 2 - a[0], py = y + g / 2 - a[1], pz = z + g / 2 - a[2];
          const t = Math.max(0, Math.min(1, (px * d[0] + py * d[1] + pz * d[2]) / length2));
          const radius = r0 + (r1 - r0) * t;
          if ((px - d[0] * t) ** 2 + (py - d[1] * t) ** 2 + (pz - d[2] * t) ** 2 > radius * radius) continue;
          for (let k = z; k < z + g; k++) for (let j = y; j < y + g; j++) for (let i = x; i < x + g; i++) paint(i, j, k);
        }
  };

  /** A chain of limbs through `points`, tapering evenly from `r0` to `r1` along its length. */
  const bough = (points: readonly Point[], r0: number, r1: number, material: number = MAT.bark) => {
    const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i]![0], p[1] - points[i]![1], p[2] - points[i]![2]));
    const total = lengths.reduce((n, l) => n + l, 0) || 1;
    let run = 0;
    lengths.forEach((l, i) => {
      const from = r0 + (r1 - r0) * (run / total);
      run += l;
      limb(points[i]!, points[i + 1]!, from, r0 + (r1 - r0) * (run / total), material);
    });
  };

  /**
   * A root running from the trunk to the ground at `foot`: it leaves the trunk at `from`, arches down and ends in
   * the ground course, so the whole flare stands on the turf rather than floating on it.
   */
  const root = (from: Point, foot: readonly [number, number], r0: number, r1 = 1, material: number = MAT.bark) => {
    const mid: Point = [from[0] + (foot[0] - from[0]) * 0.55, Math.max(r1 + 0.2, from[1] * 0.3), from[2] + (foot[1] - from[2]) * 0.55];
    bough([from, mid, [foot[0], 0.5, foot[1]]], r0, r1, material);
  };

  /**
   * One rounded lobe of foliage: an ellipsoid with radii `r` about `c`, its underside drawn up by `belly` (0–1,
   * the fraction of `r[1]` it keeps below the centre), filled block by block on the tree's lattice.
   */
  const lobe = (c: Point, r: Point, material: number = MAT.leaf, belly = 0.6) => {
    const g = grain, h = course;
    const lo = (v: number, rad: number, step: number) => Math.floor((v - rad) / step) * step;
    for (let bz = lo(c[2], r[2], g); bz < c[2] + r[2] + g; bz += g)
      for (let by = Math.max(0, lo(c[1], r[1], h)); by < c[1] + r[1] + h; by += h)
        for (let bx = lo(c[0], r[0], g); bx < c[0] + r[0] + g; bx += g) {
          const dy = by + h / 2 - c[1];
          const ry = dy < 0 ? r[1] * belly : r[1];
          if (((bx + g / 2 - c[0]) / r[0]) ** 2 + (dy / ry) ** 2 + ((bz + g / 2 - c[2]) / r[2]) ** 2 > 1) continue;
          // A lobe that meets the form's box would be sliced flat there: that is an authoring error, not a shape.
          if (bx < 0 || bz < 0 || bx + g > sx || by + h > sy || bz + g > sz) throw new Error(`A lobe at ${c.join(',')} is cut by the ${size.join('×')} box.`);
          for (let z = bz; z < bz + g; z++) for (let y = by; y < by + h; y++) for (let x = bx; x < bx + g; x++)
            if (get(x, y, z) === 0) set(x, y, z, material);
        }
  };

  /**
   * A cloud of foliage: one broad lobe and `bumps` smaller ones set round its upper shoulder at authored turns, so
   * the outline breaks into soft rounded masses instead of one balloon. `turn` rotates the ring of bumps (in turns
   * of a circle), so neighbouring clouds never repeat one another.
   */
  const cloud = (c: Point, r: Point, bumps: number, turn = 0, material: number = MAT.leaf, belly = 0.6) => {
    lobe(c, r, material, belly);
    for (let i = 0; i < bumps; i++) {
      const angle = (turn + i / bumps + (i % 2) * 0.07) * Math.PI * 2;
      // Each bump stays within 1.15 radii of the centre, so a cloud's reach is easy to fit inside its box.
      const lift = i % 2 ? 0.42 : 0.18, reach = i % 2 ? 0.58 : 0.7, scale = i % 3 === 0 ? 0.45 : 0.4;
      lobe([c[0] + Math.cos(angle) * r[0] * reach, c[1] + r[1] * lift, c[2] + Math.sin(angle) * r[2] * reach],
        [r[0] * scale, r[1] * scale * 1.05, r[2] * scale], material, belly);
    }
  };

  /**
   * Light on the crown: the top `depth` cells of every block of `from` whose upper face is open to the sky above
   * `minY` become `material`. Only up-facing shoulders change, so the crown reads lit above and shaded beneath,
   * in whole blocks, never as speckle.
   */
  const light = (from: number, material: number, minY = 0, depth: number = course) => {
    const lit: number[] = [];
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) for (let y = sy - 1; y >= minY; y--) {
      const m = get(x, y, z);
      if (m === 0) continue;
      if (m === from) for (let k = 0; k < depth && y - k >= 0 && get(x, y - k, z) === from; k++) lit.push(index(x, y - k, z));
      break;
    }
    for (const i of lit) cells[i] = material;
  };

  /**
   * Moss on the flat tops of `from` between courses `y0` and `y1`: wherever a 3×3 of its top faces lies open and
   * level, that patch and its rim along the same top become `material`. Old roots and the upper side of a great
   * limb carry it in pads; the single steps of a sloping root stay bare, so it never reads as speckle.
   */
  const overgrow = (from: number, material: number, y0: number, y1: number, keep: (x: number, y: number, z: number) => boolean = () => true) => {
    const open = (x: number, y: number, z: number) => y >= Math.max(0, y0) && y < Math.min(sy, y1) && get(x, y, z) === from && get(x, y + 1, z) === 0 && keep(x, y, z);
    const grown = new Set<number>();
    for (let z = 1; z < sz - 1; z++) for (let y = Math.max(0, y0); y < Math.min(sy, y1); y++) for (let x = 1; x < sx - 1; x++) {
      let level = true;
      for (let dz = -1; dz <= 1 && level; dz++) for (let dx = -1; dx <= 1; dx++) if (!open(x + dx, y, z + dz)) { level = false; break; }
      if (!level) continue;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (open(x + dx, y, z + dz)) grown.add(index(x + dx, y, z + dz));
    }
    for (const i of grown) cells[i] = material;
  };

  /**
   * Foliage in fragments smaller than `speck` cells (a rim of moss cut off by a step, a leaf trapped between two
   * limbs) takes the material of the wood it rests on, or goes if it rests on nothing. What is left reads as
   * masses, never confetti.
   */
  const tidy = () => {
    const seen = new Uint8Array(cells.length), queue = new Int32Array(cells.length), plane = sx * sy;
    for (let start = 0; start < cells.length; start++) {
      if (seen[start] || !FOLIAGE.has(cells[start]!)) continue;
      let head = 0, tail = 0, rest = 0;
      queue[tail++] = start; seen[start] = 1;
      while (head < tail) {
        const i = queue[head++]!, x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / plane);
        for (let n = 0; n < 6; n++) {
          const j = n === 0 ? (x + 1 < sx ? i + 1 : -1) : n === 1 ? (x > 0 ? i - 1 : -1) : n === 2 ? (y + 1 < sy ? i + sx : -1)
            : n === 3 ? (y > 0 ? i - sx : -1) : n === 4 ? (z + 1 < sz ? i + plane : -1) : (z > 0 ? i - plane : -1);
          if (j < 0) continue;
          const m = cells[j]!;
          if (FOLIAGE.has(m)) { if (!seen[j]) { seen[j] = 1; queue[tail++] = j; } } else if (m && !rest) rest = m;
        }
      }
      if (tail < speck) for (let k = 0; k < tail; k++) cells[queue[k]!] = rest;
    }
  };

  /**
   * Wood buried inside foliage takes the foliage's material. It is never seen: every cell within two of it is
   * filled, and it touches leaves. It would only split the crown's boxes, and in a far level it would vote for bark
   * inside a leafy block. Wood that shows, and the solid core of a bole far from any leaf, stay wood.
   */
  const bury = () => {
    const changes: [number, number][] = [];
    for (let z = 2; z < sz - 2; z++) for (let y = 2; y < sy - 2; y++) for (let x = 2; x < sx - 2; x++) {
      const m = cells[index(x, y, z)]!;
      if (!m || FOLIAGE.has(m)) continue;
      let hidden = true, foliage = 0;
      for (let dz = -2; dz <= 2 && hidden; dz++) for (let dy = -2; dy <= 2 && hidden; dy++) for (let dx = -2; dx <= 2; dx++) {
        const n = cells[index(x + dx, y + dy, z + dz)]!;
        if (!n) { hidden = false; break; }
        if (!foliage && Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && Math.abs(dz) <= 1 && FOLIAGE.has(n)) foliage = n;
      }
      if (hidden && foliage) changes.push([index(x, y, z), foliage]);
    }
    for (const [i, m] of changes) cells[i] = m;
  };

  /**
   * Cells to non-overlapping boxes: greedy runs up Y, grown across X, then along Z while the whole face repeats.
   * Trees are made of columns (boles, hanging crowns), so vertical runs merge best; every cell is written once.
   */
  const piece = (): Piece => {
    tidy();
    bury();
    const boxes: Box[] = [], used = new Uint8Array(cells.length), plane = sx * sy;
    // Up Y first (stride sx), then across X (stride 1), then along Z (stride sx·sy).
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) for (let y = 0, start = x + z * plane; y < sy; y++, start += sx) {
      const m = cells[start]!;
      if (!m || used[start]) continue;
      let y1 = y + 1;
      while (y1 < sy && !used[start + (y1 - y) * sx] && cells[start + (y1 - y) * sx] === m) y1++;
      const run = (from: number) => { for (let u = 0, p = from; u < y1 - y; u++, p += sx) if (used[p] || cells[p] !== m) return false; return true; };
      let x1 = x + 1;
      while (x1 < sx && run(start + (x1 - x))) x1++;
      let z1 = z + 1;
      along: while (z1 < sz) { for (let v = 0; v < x1 - x; v++) if (!run(start + v + (z1 - z) * plane)) break along; z1++; }
      for (let w = 0; w < z1 - z; w++) for (let v = 0; v < x1 - x; v++) for (let u = 0, p = start + v + w * plane; u < y1 - y; u++, p += sx) used[p] = 1;
      boxes.push({ from: [x, y, z], to: [x1, y1, z1], material: m });
    }
    return { size, boxes };
  };

  /** Buttress roots round a trunk at (x, z): each leaves the trunk at `rise` and meets the ground `reach` cells out. */
  const flare = (x: number, z: number, rise: number, roots: readonly (readonly [turn: number, reach: number, radius: number])[], material: number = MAT.bark) => {
    for (const [turn, reach, radius] of roots) {
      const a = turn * Math.PI * 2;
      root([x + Math.cos(a) * radius * 0.6, rise, z + Math.sin(a) * radius * 0.6], [x + Math.cos(a) * reach, z + Math.sin(a) * reach], radius, 1.1, material);
    }
  };

  return { size, cells, get, set, limb, bough, root, flare, lobe, cloud, light, overgrow, piece };
}

export type Grower = ReturnType<typeof grow>;
