import type { GrandSeat } from '../kingdom/types';
import type { BakedSurface } from './types';
import { assertSurface } from './validation';

/** Visual only. Installed scene collision remains authoritative; unknown space gains no support. */
export function bakedVisualHeight(surface: BakedSurface, seat: Pick<GrandSeat, 'offset'>, x: number, z: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const [ox, oy, oz] = seat.offset, cx = Math.floor((x + ox) * 2), cz = Math.floor((z + oz) * 2);
  return cx < 0 || cz < 0 || cx >= surface.size || cz >= surface.size ? null : surface.ground[cx + cz * surface.size]! * .5 - oy;
}
/** Exact native water-owner input, requiring only the compact surface and translation, never trees or generation.
 * Allocates two float rasters (8 bytes/column); caller retains them only while that water owner is installed. */
export function bakedNativeWater(surface: BakedSurface, seat: Pick<GrandSeat, 'offset'>) {
  assertSurface(surface);
  const [ox, oy, oz] = seat.offset, data = new Float32Array(surface.ground.length), levels = new Float32Array(surface.ground.length);
  for (let i = 0; i < data.length; i++) {
    data[i] = surface.ground[i]! * .5 - oy;
    levels[i] = surface.water[i]! > surface.ground[i]! ? surface.water[i]! * .5 - oy : NaN;
  }
  return { ground: { data, width: surface.size, height: surface.size, origin: [-ox, -oz] as const, step: .5 },
    levels, seaLevel: surface.seaLevel * .5 - oy };
}
