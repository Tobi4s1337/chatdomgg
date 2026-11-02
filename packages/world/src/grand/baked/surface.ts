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
 * Borrow the verified Uint16 rasters without allocating expanded float grids. Both units are metres after
 * sample * scale + offset; water is wet only when its encoded level exceeds the very same ground sample.
 * The source owns these arrays and must retain them for the water owner's lifetime. */
export function bakedNativeWater(surface: BakedSurface, seat: Pick<GrandSeat, 'offset'>) {
  assertSurface(surface);
  const [ox, oy, oz] = seat.offset;
  if (seat.offset.length !== 3 || !seat.offset.every(Number.isFinite)) throw new RangeError('Baked water needs a finite seat offset');
  return {
    ground: { data: surface.ground, encoding: 'quantized' as const, scale: .5, offset: -oy,
      width: surface.size, height: surface.size, origin: [-ox, -oz] as const, step: .5 },
    raster: { levels: surface.water, encoding: 'quantized' as const, scale: .5, offset: -oy,
      dryGround: surface.ground, seaLevel: surface.seaLevel * .5 - oy },
  };
}
