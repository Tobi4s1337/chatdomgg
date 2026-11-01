import type { GrandField, GrandSeat, SettlementFrame } from './types';
import { LAND_CELL } from './types';

/** Land columns the seated kingdom owns: its exact region plus the inner half of the blend band. */
export interface KingdomReserve { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }

/**
 * Where the seated kingdom really is, in the land's column and voxel units, so the land's composers and the orbit
 * director aim at the town and castle that are drawn rather than at the sites the land first shaped.
 */
export interface KingdomSites {
  readonly castle: { readonly x: number; readonly z: number; readonly radius: number; readonly top: number };
  readonly town: { readonly x: number; readonly z: number; readonly rx: number; readonly rz: number; readonly angle: number; readonly level: number };
  /** Hero focus points in voxels: the castle keep, the market and the town's middle. */
  readonly focus: readonly { readonly id: string; readonly x: number; readonly y: number; readonly z: number }[];
  /** Composers keep whole pieces out of these columns; nothing of the land's own is built over the kingdom. */
  readonly reserve: KingdomReserve;
}

const column = (metres: number, offset: number) => Math.round((metres + offset) / LAND_CELL);

export function kingdomSites(field: Pick<GrandField, 'size' | 'ground'>, seat: GrandSeat, frame: SettlementFrame): KingdomSites {
  const [ox, oy, oz] = seat.offset, size = field.size;
  const groundAt = (x: number, z: number) => field.ground[Math.max(0, Math.min(size - 1, x)) + Math.max(0, Math.min(size - 1, z)) * size]!;
  const castleBounds = frame.castle.bounds;
  const cx = column(frame.castle.centre[0], ox), cz = column(frame.castle.centre[2], oz);
  const castle = {
    x: cx, z: cz,
    radius: Math.ceil(Math.hypot(castleBounds.maxX - castleBounds.minX, castleBounds.maxZ - castleBounds.minZ) / 2 / LAND_CELL),
    top: Math.round((frame.castle.centre[1] + oy) / LAND_CELL),
  };
  const plan = frame.plan, homes = plan.homes;
  const tx = column(frame.centre[0], ox), tz = column(frame.centre[1], oz);
  // The town ellipse: the homes' spread about their centre along the principal axis of their lots.
  let sxx = 0, szz = 0, sxz = 0;
  for (const home of homes) {
    const dx = (home.lot.minX + home.lot.maxX) / 2 - frame.centre[0], dz = (home.lot.minZ + home.lot.maxZ) / 2 - frame.centre[1];
    sxx += dx * dx; szz += dz * dz; sxz += dx * dz;
  }
  const n = Math.max(1, homes.length), angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const spread = (a: number) => Math.sqrt(Math.max(1, (Math.cos(a) ** 2 * sxx + Math.sin(a) ** 2 * szz + 2 * Math.sin(a) * Math.cos(a) * sxz) / n));
  const town = {
    x: tx, z: tz, angle,
    rx: Math.ceil(2 * spread(angle) / LAND_CELL), rz: Math.ceil(2 * spread(angle + Math.PI / 2) / LAND_CELL),
    level: groundAt(tx, tz),
  };
  const market = plan.nodes.find(node => node.id === plan.market.nodeId)?.position;
  const focus = [
    { id: 'kingdom:castle', x: castle.x, y: castle.top + 16, z: castle.z },
    ...(market ? [{ id: 'kingdom:market', x: column(market[0], ox), y: Math.round((market[1] + oy) / LAND_CELL) + 4, z: column(market[2], oz) }] : []),
    { id: 'kingdom:town', x: tx, y: town.level + 6, z: tz },
  ];
  const inner = Math.ceil(seat.band / 2), c = seat.columns;
  const reserve = { x0: Math.max(0, c.x0 - inner), z0: Math.max(0, c.z0 - inner), x1: Math.min(size, c.x1 + inner), z1: Math.min(size, c.z1 + inner) };
  return { castle, town, focus, reserve };
}

/** `STRUCTURE_STRIDE` in the land: x0, y0, z0, x1, y1, z1 (exclusive, land voxels), material. */
export const STRUCTURE_STRIDE = 7;

/**
 * Drop composed structure boxes that stand in the kingdom's reserve. Composers that read `reserve` never place
 * there; this keeps a land composed before the kingdom was seated honest (its castle wing would stand on the town).
 */
export function clearKingdomStructures(structures: Int32Array, count: number, reserve: KingdomReserve): { structures: Int32Array; count: number; removed: number } {
  const kept: number[] = [];
  let removed = 0;
  for (let i = 0; i < count; i++) {
    const o = i * STRUCTURE_STRIDE;
    const x0 = structures[o]!, z0 = structures[o + 2]!, x1 = structures[o + 3]!, z1 = structures[o + 5]!;
    if (x0 < reserve.x1 && x1 > reserve.x0 && z0 < reserve.z1 && z1 > reserve.z0) { removed++; continue; }
    for (let k = 0; k < STRUCTURE_STRIDE; k++) kept.push(structures[o + k]!);
  }
  return { structures: Int32Array.from(kept), count: kept.length / STRUCTURE_STRIDE, removed };
}
