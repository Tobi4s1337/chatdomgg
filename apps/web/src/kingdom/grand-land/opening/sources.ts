import type { SettlementPlan } from '@chatdom/world';
import type { BakedMetadata, BakedSurface } from '../../../../../../packages/world/src/grand/baked/types';
import type { OpeningLand, OpeningStreets } from './journal';

/**
 * The opening map's land, read from the verified baked surface (never generated): a coarse grid of the real
 * ground heights and which cells lie under water, in the native settlement frame.
 */
export function openingLandFromSurface(surface: BakedSurface, metadata: Pick<BakedMetadata, 'seat' | 'physicalRegion'>, columns = 256): OpeningLand {
  const [ox, oy, oz] = metadata.seat.offset, metres = surface.size * .5;
  if (!(surface.size > 0) || surface.ground.length !== surface.size ** 2 || surface.water.length !== surface.ground.length) throw new Error('The land surface is incomplete');
  const rows = columns, cell = metres / columns, heights = new Float32Array(columns * rows), water = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    // The column at the cell's centre; the surface is half-metre columns, x fastest.
    const cx = Math.min(surface.size - 1, Math.floor((column + .5) * cell * 2)), cz = Math.min(surface.size - 1, Math.floor((row + .5) * cell * 2));
    const index = cx + cz * surface.size, ground = surface.ground[index]!, level = surface.water[index]!;
    heights[column + row * columns] = ground * .5 - oy;
    water[column + row * columns] = level > ground ? 1 : 0;
  }
  return { bounds: { minX: -ox, maxX: -ox + metres, minZ: -oz, maxZ: -oz + metres }, columns, rows, heights, water,
    seaLevel: surface.seaLevel * .5 - oy, town: { ...metadata.physicalRegion } };
}

/** The verified town plan as a map: open and planned streets, the standing homes' lots, squares and the castle. */
export function openingStreetsFromPlan(plan: SettlementPlan, ownSlot: number | null = null): OpeningStreets {
  const open = new Set(plan.activeStreetIds);
  const xz = (points: readonly (readonly number[])[]) => points.map(point => [point[0]!, point[point.length === 2 ? 1 : 2]!] as const);
  return {
    bounds: { ...plan.bounds },
    streets: plan.streets.map(street => ({ points: xz(street.points), width: street.width, open: open.has(street.id), kind: street.kind })),
    homes: [...plan.homes].sort((a, b) => a.slot - b.slot)
      .map(home => ({ slot: home.slot, minX: home.lot.minX, maxX: home.lot.maxX, minZ: home.lot.minZ, maxZ: home.lot.maxZ })),
    squares: [plan.market, ...plan.courts, plan.castle.court].map(square => xz(square.boundary)),
    castle: { ...plan.castle.bounds },
    ownSlot: ownSlot !== null && plan.homes.some(home => home.slot === ownSlot) ? ownSlot : null,
    lake: plan.lake ? { x: plan.lake.x, z: plan.lake.z, radiusX: plan.lake.radiusX, radiusZ: plan.lake.radiusZ } : null,
  };
}
