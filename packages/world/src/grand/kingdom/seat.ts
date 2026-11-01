import type { Vec3 } from '@chatdom/shared';
import { LAND_CELL, type GrandField, type GrandFieldSites, type GrandSeat, type SettlementFrame } from './types';

/** Blend band around the physical region, metres: wide enough that a 20 m step reads as a slope, not a wall. */
export const SEAT_BAND_METRES = 48;

const snap = (metres: number): number => Math.round(metres / LAND_CELL) * LAND_CELL;

export interface SeatChoice extends GrandSeat {
  /** Whole envelope and band inside the land. False means the land is smaller than the town asks for. */
  readonly fits: boolean;
  /** Share of the envelope's columns that were dry natural land before grading. */
  readonly landShare: number;
  /** The settlement's open-water side meets the land's sea within reach of its edge. */
  readonly seaMet: boolean;
}

/**
 * Seat a settlement on a generated land. Pure translation: the settlement keeps every metre, turn and lattice
 * alignment; only `offset` (half-metre exact) says where it lands. The search starts at the land's own town
 * site and prefers a seat whose region stands on dry land, whose open water side meets the land's sea, and whose
 * band stays inside the land. Vertically the settlement's water level becomes the grand sea level.
 */
export function seatSettlement(field: GrandField, sites: Pick<GrandFieldSites, 'town' | 'harbour'>, frame: SettlementFrame): SeatChoice {
  const size = field.size * LAND_CELL, band = SEAT_BAND_METRES;
  // The seat is judged over the envelope (all the town can grow into), so building a reserved plot never moves it.
  const r = frame.region, e = frame.envelope, width = e.maxX - e.minX, depth = e.maxZ - e.minZ;
  const town: readonly [number, number] = [(sites.town.x + 0.5) * LAND_CELL, (sites.town.z + 0.5) * LAND_CELL];
  const offsetY = snap(field.seaLevel * LAND_CELL - frame.waterLevel);
  const at = (mx: number, mz: number): number => {
    const cx = Math.floor(mx / LAND_CELL), cz = Math.floor(mz / LAND_CELL);
    return cx < 0 || cz < 0 || cx >= field.size || cz >= field.size ? -1 : cx + cz * field.size;
  };
  const cx0 = (ox: number) => frame.centre[0] + ox, cz0 = (oz: number) => frame.centre[1] + oz;
  const evaluate = (ox: number, oz: number) => {
    const x0 = e.minX + ox, z0 = e.minZ + oz;
    const fits = x0 - band >= 0 && z0 - band >= 0 && x0 + width + band <= size && z0 + depth + band <= size;
    let land = 0, samples = 0;
    const step = 8;
    for (let z = z0 + step / 2; z < z0 + depth; z += step) for (let x = x0 + step / 2; x < x0 + width; x += step) {
      const i = at(x, z); samples++;
      if (i >= 0 && field.ground[i]! > field.seaLevel && !field.water[i]) land++;
    }
    const landShare = samples ? land / samples : 0;
    let seaMet = false;
    if (frame.seaward) {
      // Walk out from the town centre past the envelope's edge on its water side; the sea must be there.
      const [sx, sz] = frame.seaward, cx = frame.centre[0] + ox, cz = frame.centre[1] + oz;
      for (let d = 0; d < Math.max(width, depth) + band * 2 && !seaMet; d += 4) {
        const x = cx + sx * d, z = cz + sz * d;
        const inside = x >= x0 && x < x0 + width && z >= z0 && z < z0 + depth;
        const i = at(x, z);
        if (!inside && i >= 0 && field.ground[i]! <= field.seaLevel) seaMet = true;
      }
    }
    // A seat that leaves the land loses everything; then dry ground, then the sea where the town expects it.
    const score = (fits ? 2 : 0) + landShare * 1.5 + (seaMet ? 0.6 : 0) - Math.hypot(cx0(ox) - town[0], cz0(oz) - town[1]) / size;
    return { fits, landShare, seaMet, score };
  };
  const baseX = town[0] - frame.centre[0], baseZ = town[1] - frame.centre[1];
  let best = { ox: snap(baseX), oz: snap(baseZ), ...evaluate(snap(baseX), snap(baseZ)) };
  const reach = size * 0.3, stride = Math.max(8, snap(size / 48));
  for (let dz = -reach; dz <= reach; dz += stride) for (let dx = -reach; dx <= reach; dx += stride) {
    const ox = snap(baseX + dx), oz = snap(baseZ + dz), e = evaluate(ox, oz);
    if (e.score > best.score + 1e-9) best = { ox, oz, ...e };
  }
  const offset: Vec3 = [best.ox, offsetY, best.oz];
  const columns = {
    x0: Math.round((r.minX + best.ox) / LAND_CELL), z0: Math.round((r.minZ + best.oz) / LAND_CELL),
    x1: Math.round((r.maxX + best.ox) / LAND_CELL), z1: Math.round((r.maxZ + best.oz) / LAND_CELL),
  };
  return { offset, columns, band: Math.round(band / LAND_CELL), fits: best.fits, landShare: best.landShare, seaMet: best.seaMet };
}

/** Settlement metres → land metres. */
export function toLand(seat: Pick<GrandSeat, 'offset'>, point: Vec3): Vec3 {
  return [point[0] + seat.offset[0], point[1] + seat.offset[1], point[2] + seat.offset[2]];
}

/** Land metres → settlement metres. */
export function toSettlement(seat: Pick<GrandSeat, 'offset'>, point: Vec3): Vec3 {
  return [point[0] - seat.offset[0], point[1] - seat.offset[1], point[2] - seat.offset[2]];
}

/** The most land, columns per side, the town's growth room may ask for (1536 m): a land this size raises and meshes in
 * minutes on a software renderer. The exact region and its band always get their land, past this if they must. */
export const LAND_COLUMNS_CAP = 3072;

const columnsFor = (b: SettlementFrame['region']): number => {
  const side = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 2 * SEAT_BAND_METRES;
  return Math.ceil(side * 1.2 / 0.54 / LAND_CELL / 128) * 128;
};

/**
 * The least land, in columns per side, a settlement asks for: its envelope (all it can grow into) and blend band inside
 * the island's narrow axis (at its slimmest a little over half the land's side), with a beach and some country beyond,
 * rounded up to whole 128-column tiles. Growth room is capped at `LAND_COLUMNS_CAP`; the built region never is. The
 * answer does not change as a town builds its reserved plots while its region stays within the cap. A land generated
 * smaller than this meets the town with a straight coast at its region.
 */
export function landColumnsFor(frame: Pick<SettlementFrame, 'region' | 'envelope'>): number {
  return Math.max(columnsFor(frame.region), Math.min(columnsFor(frame.envelope), LAND_COLUMNS_CAP));
}
