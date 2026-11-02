import type { Vec3 } from '@chatdom/shared';
import type { LightVolume } from '@chatdom/voxel';
import { getEnvironment } from '@chatdom/render';
import { buildLightFieldSamples } from '../kingdom/light-field-worker';

/** The hearth and the three hanging lanterns in the authored room, in room coordinates. */
export function tavernLightSources(hearth: Vec3): readonly Vec3[] {
  return [hearth, [3, 3.25, 4.5], [7.625, 3.25, 4.5], [10.5, 3.25, 7.375]];
}

/** The sheltered grade is shared with citizens, so faces belong to the same room. */
export function tavernInteriorEnvironment(hour: number): ReturnType<typeof getEnvironment> {
  const sky = getEnvironment(hour);
  return { ...sky, sunIntensity: .08, ambientIntensity: .56, ambient: '#a292b2', shadow: '#3c304c', night: Math.max(.85, sky.night) };
}

/** One static near field shared by every room mesh, rather than a light per candle. */
export function tavernLight(sources: readonly Vec3[]): LightVolume & { surfaceSamples: Uint8Array } {
  // Keep the occupied room four metres inside the field's blend boundary, including beneath the floor.
  const size: Vec3 = [60, 36, 52], origin: Vec3 = [-8, -8, -8], cellSize = .5;
  const light = new Uint8Array(size[0] * size[1] * size[2]);
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const px = origin[0] + (x + .5) * cellSize, py = origin[1] + (y + .5) * cellSize, pz = origin[2] + (z + .5) * cellSize;
    let energy = 0;
    for (const [sx, sy, sz] of sources) {
      // A hanging lantern spills down onto the table and faces beneath it, but adjacent
      // lanterns do not add up to an evenly lit ceiling or wash the corners orange.
      const distance = Math.hypot(px - sx, (py - sy) * .7, pz - sz);
      energy = Math.max(energy, Math.exp(-(distance ** 1.4) / 5.8));
    }
    light[x + size[0] * (y + size[1] * z)] = Math.round(energy * 15);
  }
  return { revision: 1, origin, size, cellSize, light, visited: light.length, estimatedPeakBytes: light.length * 3,
    surfaceSamples: buildLightFieldSamples(size, new Uint8Array(light.length), light) };
}
