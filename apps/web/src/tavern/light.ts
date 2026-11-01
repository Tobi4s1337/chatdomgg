import type { Vec3 } from '@chatdom/shared';
import type { LightVolume } from '@chatdom/voxel';
import { buildLightFieldSamples } from '../kingdom/light-field-worker';

/** One static near field shared by every room mesh, rather than a light per candle. */
export function tavernLight(sources: readonly Vec3[]): LightVolume & { surfaceSamples: Uint8Array } {
  // Keep the occupied room four metres inside the field's blend boundary, including beneath the floor.
  const size: Vec3 = [60, 36, 52], origin: Vec3 = [-8, -8, -8], cellSize = .5;
  const light = new Uint8Array(size[0] * size[1] * size[2]);
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const px = origin[0] + (x + .5) * cellSize, py = origin[1] + (y + .5) * cellSize, pz = origin[2] + (z + .5) * cellSize;
    let energy = 0;
    for (const [sx, sy, sz] of sources) energy += Math.exp(-(Math.hypot(px - sx, py - sy, pz - sz) ** 1.4) / 12) ** 2;
    light[x + size[0] * (y + size[1] * z)] = Math.round(Math.min(1, Math.sqrt(energy)) * 15);
  }
  return { revision: 1, origin, size, cellSize, light, visited: light.length, estimatedPeakBytes: light.length * 3,
    surfaceSamples: buildLightFieldSamples(size, new Uint8Array(light.length), light) };
}
