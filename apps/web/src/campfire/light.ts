import type { Vec3 } from '@chatdom/shared';
import type { LightVolume } from '@chatdom/voxel';
import { buildLightFieldSamples } from '../kingdom/light-field-worker';

/*
 * The clearing's warm light, written into the renderer's existing near light-field contract
 * (0.5 m cells, corner samples). The kingdom floods light six-neighbour, which draws diamonds on
 * open ground; a lone fire in a clearing wants a round pool, so this field is radial with a short
 * occlusion march toward each source. Nothing here is a new lighting engine: the voxel material
 * shades it exactly like every window in the kingdom.
 */

export const LIGHT_CELL = .5;
export const LIGHT_ORIGIN: Vec3 = [-12, -1, -12];
export const LIGHT_SIZE: Vec3 = [48, 10, 48];

export interface LightBox { readonly min: Vec3; readonly max: Vec3 }
export interface ClearingLight {
  readonly position: Vec3;
  /** Warmth at the source, 0..1 (1 is the hearth). */
  readonly strength: number;
  /** Metres to where the light has all but faded. */
  readonly reach: number;
}

export interface SurfaceVolume extends LightVolume { readonly surfaceSamples: Uint8Array }

const [SX, SY, SZ] = LIGHT_SIZE;
const index = (x: number, y: number, z: number): number => x + SX * (y + SY * z);

/** Coarse occupancy: ground below y = 0 and every light blocker that covers most of a cell. */
export function rasterizeOccupancy(boxes: readonly LightBox[]): Uint8Array {
  const occupancy = new Uint8Array(SX * SY * SZ);
  const groundLayers = Math.round(-LIGHT_ORIGIN[1] / LIGHT_CELL);
  for (let z = 0; z < SZ; z++) for (let y = 0; y < groundLayers; y++) for (let x = 0; x < SX; x++) occupancy[index(x, y, z)] = 1;
  for (const box of boxes) {
    const from = box.min.map((v, a) => Math.round((v - LIGHT_ORIGIN[a]!) / LIGHT_CELL));
    const to = box.max.map((v, a) => Math.round((v - LIGHT_ORIGIN[a]!) / LIGHT_CELL));
    for (let z = Math.max(0, from[2]!); z < Math.min(SZ, to[2]!); z++) for (let y = Math.max(0, from[1]!); y < Math.min(SY, to[1]!); y++)
      for (let x = Math.max(0, from[0]!); x < Math.min(SX, to[0]!); x++) occupancy[index(x, y, z)] = 1;
  }
  return occupancy;
}

/**
 * Radial falloff with soft occlusion: a cell behind a log or a person keeps some bounce rather than
 * going black, so backs read as turned away from the fire, not cut out of the night.
 */
export function buildClearingLight(revision: number, occupancy: Uint8Array, lights: readonly ClearingLight[]): SurfaceVolume {
  if (occupancy.length !== SX * SY * SZ) throw new Error('Clearing occupancy does not match the light field.');
  const light = new Uint8Array(occupancy.length);
  for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
    const i = index(x, y, z);
    if (occupancy[i]) continue;
    const cx = LIGHT_ORIGIN[0] + (x + .5) * LIGHT_CELL, cy = LIGHT_ORIGIN[1] + (y + .5) * LIGHT_CELL, cz = LIGHT_ORIGIN[2] + (z + .5) * LIGHT_CELL;
    let warmth = 0;
    for (const source of lights) {
      const dx = cx - source.position[0], dy = cy - source.position[1], dz = cz - source.position[2];
      const d = Math.hypot(dx, dy, dz);
      if (d >= source.reach) continue;
      const falloff = Math.exp(-((d / (source.reach * .42)) ** 1.6));
      let open = 1;
      // March from just outside the source to the cell; each blocking cell passes a third of the light.
      const steps = Math.floor(d / (LIGHT_CELL * .5));
      for (let s = 1; s < steps && open > .05; s++) {
        const t = s / steps;
        const qx = Math.floor((source.position[0] + dx * t - LIGHT_ORIGIN[0]) / LIGHT_CELL), qy = Math.floor((source.position[1] + dy * t - LIGHT_ORIGIN[1]) / LIGHT_CELL), qz = Math.floor((source.position[2] + dz * t - LIGHT_ORIGIN[2]) / LIGHT_CELL);
        if (qx >= 0 && qy >= 0 && qz >= 0 && qx < SX && qy < SY && qz < SZ && occupancy[index(qx, qy, qz)] && index(qx, qy, qz) !== i) open *= .34;
      }
      // Sum as energy, so a lantern beside the hearth adds a little rather than doubling it.
      const contribution = source.strength * falloff * open;
      warmth = Math.sqrt(warmth * warmth + contribution * contribution);
    }
    light[i] = Math.min(15, Math.round(Math.min(1, warmth) * 15));
  }
  return {
    revision, origin: LIGHT_ORIGIN, size: LIGHT_SIZE, cellSize: LIGHT_CELL, light, visited: 0,
    estimatedPeakBytes: light.length * 3, surfaceSamples: buildLightFieldSamples(LIGHT_SIZE, occupancy, light),
  };
}
