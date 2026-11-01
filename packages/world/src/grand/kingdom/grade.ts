import { KINGDOM_COVER, LAND_CELL, TREE_STRIDE, type GrandField, type GrandSeat, type SettlementGround } from './types';

export interface GradeReport {
  /** Columns written from the settlement's physical ground. */
  readonly exact: number;
  /** Columns blended between the region's edge and the natural land. */
  readonly blended: number;
  readonly paved: number;
  readonly wet: number;
  readonly treesRemoved: number;
  /** Lowest and highest graded top, voxels. */
  readonly range: readonly [number, number];
  /** Paved public ground (streets, squares, aprons) per column, 1 where paved: the voxeliser lays setts here. */
  readonly pavedMask: Uint8Array;
}

const smooth = (t: number): number => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/**
 * Write the settlement into the land, in place. Inside the physical region every column *is* the settlement's
 * physical ground (exact, half-metre) and its waters; paved public ground is marked; the land's trees there are
 * removed (the town brings its own groves). Around it a band eases from the region's edge to the natural land, so
 * mountains, coast and forest rise from the town's own ground with no step. Outside the band nothing changes.
 *
 * The grand sea and the settlement's water share one level (`seat.offset[1]` was chosen for it), so a town lake on
 * its edge opens into the sea rather than standing as a terrace.
 */
export function gradeSettlement(field: GrandField, seat: GrandSeat, ground: SettlementGround): GradeReport {
  const { size, seaLevel } = field, [ox, oy, oz] = seat.offset, { x0, z0, x1, z1 } = seat.columns, band = seat.band;
  if (![ox, oy, oz].every(v => Number.isFinite(v) && Math.abs(v / LAND_CELL - Math.round(v / LAND_CELL)) < 1e-9)) throw new Error('A seat offset must be half-metre exact');
  if (x1 <= x0 || z1 <= z0) throw new Error('A seat needs a nonempty region');
  const top = field.height - 2;
  const clampY = (v: number) => Math.max(1, Math.min(top, v));
  const pavedMask = new Uint8Array(size * size);
  let exact = 0, blended = 0, paved = 0, wet = 0, lo = Infinity, hi = -Infinity;
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
      if (ground.paved(sx, sz)) { pavedMask[i] = 1; paved++; field.cover[i] = KINGDOM_COVER.reserved; }
      else field.cover[i] = g <= seaLevel + 1 ? KINGDOM_COVER.sand : KINGDOM_COVER.grass;
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
    const t = smooth(d / band), natural = field.ground[i]!, edge = field.ground[e]!;
    const g = clampY(Math.round(edge + (natural - edge) * t));
    if (g === natural && t >= 1) continue;
    field.ground[i] = g;
    const naturalWater = field.water[i]!, edgeWater = field.water[e]!;
    // Open water continues across the band where the ground stays under it; elsewhere the band is dry land.
    const level = Math.max(edgeWater && t < 0.5 ? edgeWater : 0, naturalWater && t >= 0.5 ? naturalWater : 0, g < seaLevel ? seaLevel : 0);
    if (level > g) { field.water[i] = level; if (!naturalWater) field.cover[i] = level === seaLevel ? KINGDOM_COVER.sea : KINGDOM_COVER.lakebed; }
    else {
      field.water[i] = 0;
      const c = field.cover[i]!;
      if (c === KINGDOM_COVER.sea || c === KINGDOM_COVER.riverbed || c === KINGDOM_COVER.lakebed) field.cover[i] = g <= seaLevel + 2 ? KINGDOM_COVER.sand : KINGDOM_COVER.grass;
      else if (t < 0.35 && c !== KINGDOM_COVER.sand) field.cover[i] = KINGDOM_COVER.grass;
    }
    blended++;
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
  return { exact, blended, paved, wet, treesRemoved: removed, range: [lo, hi], pavedMask };
}
