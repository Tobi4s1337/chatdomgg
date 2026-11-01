import type { BoundsXZ } from '../../settlement/types';
import { KINGDOM_COVER, LAND_CELL, TREE_STRIDE, type GrandField, type GrandSeat, type SettlementGround } from './types';

export interface GradeReport {
  /** Columns written from the settlement's physical ground. */
  readonly exact: number;
  /** Columns blended between the region's edge and the natural land. */
  readonly blended: number;
  readonly paved: number;
  readonly wet: number;
  readonly treesRemoved: number;
  /** Columns dressed as rock because the graded ground is steep there (the castle's crag, cut banks). */
  readonly rock: number;
  /** Lowest and highest graded top, voxels. */
  readonly range: readonly [number, number];
  /** Paved public ground (streets, squares, aprons) per column, 1 where paved: the voxeliser lays setts here. */
  readonly pavedMask: Uint8Array;
}

const smooth = (t: number): number => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/** The castle's crag: the band within this reach of the castle (metres) falls as rock rather than easing as grass. */
export const CASTLE_CRAG_REACH = 72;
/** How far out from the region edge the crag's face runs before the natural land takes over, metres (± jitter). */
const CRAG_FACE = 7;
/** Graded ground rising this many voxels or more to a neighbour (45° and steeper) shows rock, not turf. */
const ROCK_STEP = 2;

/** Cheap stable hash noise in [0, 1) per column, for the crag's broken face. */
const jitter = (x: number, z: number): number => {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

/**
 * Write the settlement into the land, in place. Inside the physical region every column *is* the settlement's
 * physical ground (exact, half-metre) and its waters; paved public ground is marked; the land's trees there are
 * removed (the town brings its own groves). Around it a band eases from the region's edge to the natural land, so
 * mountains, coast and forest rise from the town's own ground with no step. Outside the band nothing changes.
 *
 * The grand sea and the settlement's water share one level (`seat.offset[1]` was chosen for it), so a town lake on
 * its edge opens into the sea rather than standing as a terrace.
 *
 * Near the castle (`castle`, its bounds in settlement metres) the band does not ease: the castle's ground breaks off
 * at the region's edge as a crag, a broken rock face a few metres deep down (or up) to the natural land, so the
 * castle reads as standing on its rock. Steep graded ground anywhere, inside or out, is dressed as rock. Neither
 * changes a single exact height inside the region.
 */
export function gradeSettlement(field: GrandField, seat: GrandSeat, ground: SettlementGround, castle?: BoundsXZ): GradeReport {
  const { size, seaLevel } = field, [ox, oy, oz] = seat.offset, { x0, z0, x1, z1 } = seat.columns, band = seat.band;
  if (![ox, oy, oz].every(v => Number.isFinite(v) && Math.abs(v / LAND_CELL - Math.round(v / LAND_CELL)) < 1e-9)) throw new Error('A seat offset must be half-metre exact');
  if (x1 <= x0 || z1 <= z0) throw new Error('A seat needs a nonempty region');
  const top = field.height - 2;
  const clampY = (v: number) => Math.max(1, Math.min(top, v));
  const pavedMask = new Uint8Array(size * size);
  let exact = 0, blended = 0, paved = 0, wet = 0, lo = Infinity, hi = -Infinity;
  // The castle in land columns, and how strongly a band column belongs to its crag (1 at the walls, 0 past reach).
  const keep = castle ? { x0: (castle.minX + ox) / LAND_CELL, x1: (castle.maxX + ox) / LAND_CELL, z0: (castle.minZ + oz) / LAND_CELL, z1: (castle.maxZ + oz) / LAND_CELL } : null;
  const crag = (cx: number, cz: number): number => {
    if (!keep) return 0;
    const d = Math.hypot(Math.max(keep.x0 - cx, 0, cx - keep.x1), Math.max(keep.z0 - cz, 0, cz - keep.z1)) * LAND_CELL;
    return 1 - smooth((d - CASTLE_CRAG_REACH * 0.45) / (CASTLE_CRAG_REACH * 0.55));
  };
  const ix0 = Math.max(0, x0), iz0 = Math.max(0, z0), ix1 = Math.min(size, x1), iz1 = Math.min(size, z1);
  for (let cz = iz0; cz < iz1; cz++) for (let cx = ix0; cx < ix1; cx++) {
    const i = cx + cz * size;
    // The column's centre in settlement metres is the founded compiler's own cell centre.
    const sx = (cx + 0.5) * LAND_CELL - ox, sz = (cz + 0.5) * LAND_CELL - oz;
    const metres = ground.top(sx, sz) + oy;
    const g = clampY(Math.round(metres / LAND_CELL));
    field.ground[i] = g;
    lo = Math.min(lo, g); hi = Math.max(hi, g);
    const w = ground.water(sx, sz);
    const level = w === null ? 0 : Math.round((w + oy) / LAND_CELL);
    if (level > g) {
      field.water[i] = level; wet++;
      field.cover[i] = level === seaLevel && g < seaLevel - 2 ? KINGDOM_COVER.sea : KINGDOM_COVER.lakebed;
    } else {
      field.water[i] = 0;
      if (ground.paved(sx, sz)) { pavedMask[i] = 1; paved++; field.cover[i] = KINGDOM_COVER.paved; }
      else field.cover[i] = g <= seaLevel + 1 ? KINGDOM_COVER.sand : KINGDOM_COVER.reserved;
    }
    exact++;
  }
  // The band: ease from the nearest region edge column to the natural land.
  const bx0 = Math.max(0, x0 - band), bz0 = Math.max(0, z0 - band), bx1 = Math.min(size, x1 + band), bz1 = Math.min(size, z1 + band);
  for (let cz = bz0; cz < bz1; cz++) for (let cx = bx0; cx < bx1; cx++) {
    if (cx >= x0 && cx < x1 && cz >= z0 && cz < z1) continue;
    const ex = Math.max(x0, Math.min(x1 - 1, cx)), ez = Math.max(z0, Math.min(z1 - 1, cz));
    if (ex < 0 || ez < 0 || ex >= size || ez >= size) continue;
    const d = Math.hypot(cx - ex, cz - ez);
    if (d > band) continue;
    const i = cx + cz * size, e = ex + ez * size;
    // The crag's face runs a few broken metres out from the edge; elsewhere the band eases over its whole width.
    // Only where the land falls away from the castle: a crag is a drop. Where the natural land rises (a mountain
    // behind the keep) the band eases as everywhere else, or the town would stand against a sheer wall.
    const natural = field.ground[i]!, edge = field.ground[e]!;
    const k = crag(ex, ez) * smooth((edge - natural) / 6), face = (CRAG_FACE + 4 * (jitter(cx >> 2, cz >> 2) - 0.5) + 2 * (jitter(cx, cz) - 0.5)) / LAND_CELL;
    const t = smooth(d / band) * (1 - k) + smooth(d / Math.max(2, face)) * k;
    const g = clampY(Math.round(edge + (natural - edge) * t));
    if (g === natural && t >= 1) continue;
    field.ground[i] = g;
    const naturalWater = field.water[i]!, edgeWater = field.water[e]!;
    // Open water continues across the band where the ground stays under it; elsewhere the band is dry land.
    // The land's own water stays only where its ground was not lowered: a mere whose bed the band cut down would
    // otherwise stand as a wall of water over the new slope.
    const keepNatural = naturalWater && t >= 0.5 && g >= natural;
    const level = Math.max(edgeWater && t < 0.5 ? edgeWater : 0, keepNatural ? naturalWater : 0, g < seaLevel ? seaLevel : 0);
    if (level > g) { field.water[i] = level; if (!keepNatural) field.cover[i] = level === seaLevel ? KINGDOM_COVER.sea : KINGDOM_COVER.lakebed; }
    else {
      field.water[i] = 0;
      const c = field.cover[i]!;
      if (c === KINGDOM_COVER.sea || c === KINGDOM_COVER.riverbed || c === KINGDOM_COVER.lakebed) field.cover[i] = g <= seaLevel + 2 ? KINGDOM_COVER.sand : KINGDOM_COVER.grass;
      else if (t < 0.35 && c !== KINGDOM_COVER.sand) field.cover[i] = KINGDOM_COVER.grass;
    }
    blended++;
  }
  // Rock: wherever the graded ground (region and band) steps two voxels or more to a neighbour, turf gives way to
  // stone. Cover only; heights stay as graded. The castle's crag gets it on every face it broke.
  let rock = 0;
  const rx0 = Math.max(1, bx0), rz0 = Math.max(1, bz0), rx1 = Math.min(size - 1, bx1), rz1 = Math.min(size - 1, bz1);
  for (let cz = rz0; cz < rz1; cz++) for (let cx = rx0; cx < rx1; cx++) {
    const i = cx + cz * size, g = field.ground[i]!;
    if (field.water[i] || pavedMask[i]) continue;
    const step = Math.max(Math.abs(g - field.ground[i - 1]!), Math.abs(g - field.ground[i + 1]!), Math.abs(g - field.ground[i - size]!), Math.abs(g - field.ground[i + size]!));
    if (step >= ROCK_STEP || (step >= 1 && crag(Math.max(x0, Math.min(x1 - 1, cx)), Math.max(z0, Math.min(z1 - 1, cz))) > 0.5 && !(cx >= x0 && cx < x1 && cz >= z0 && cz < z1))) {
      if (field.cover[i] !== KINGDOM_COVER.rock) { field.cover[i] = KINGDOM_COVER.rock; rock++; }
    }
  }
  // Trees: none inside the region or the band's inner half; the rest stand on the graded ground.
  let kept = 0, removed = 0;
  const t = field.trees;
  for (let n = 0; n < field.treeCount; n++) {
    const o = n * TREE_STRIDE, x = Math.floor(t[o]!), z = Math.floor(t[o + 1]!);
    const ex = Math.max(x0, Math.min(x1 - 1, x)), ez = Math.max(z0, Math.min(z1 - 1, z));
    const d = Math.hypot(x - ex, z - ez);
    const i = x >= 0 && z >= 0 && x < size && z < size ? x + z * size : -1;
    if (d < band * 0.5 || i < 0 || field.water[i]! > 0) { removed++; continue; }
    if (kept !== n) for (let k = 0; k < TREE_STRIDE; k++) t[kept * TREE_STRIDE + k] = t[o + k]!;
    t[kept * TREE_STRIDE + 2] = field.ground[i]!;
    kept++;
  }
  field.treeCount = kept;
  return { exact, blended, paved, wet, treesRemoved: removed, rock, range: [lo, hi], pavedMask };
}
