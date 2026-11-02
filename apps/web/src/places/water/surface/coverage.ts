import type { WaterBody } from '@chatdom/world';
import type { WaterReach } from '../../../../../../packages/world/src/places/water/reaches';

/**
 * The caller's actual ground in row-major order at `origin + [i, k] * step`. Under water this is the bed.
 * Float samples are metres; quantized samples become metres through sample * scale + offset.
 * The surface reads it but never owns, copies into its own authority or changes it.
 */
export type WaterGround = {
  readonly width: number;
  readonly height: number;
  readonly origin: readonly [number, number];
  readonly step: number;
} & ({ readonly data: Float32Array; readonly encoding?: 'metres' }
  | { readonly data: Uint16Array; readonly encoding: 'quantized'; readonly scale: number; readonly offset: number });

/** Extra wet margin beside a course's supplied width: its banks shelve, and the bed decides the real edge. */
export const REACH_MARGIN = 1;

export function assertQuantizedUnits(scale: number, offset: number): void {
  if (!Number.isFinite(scale) || !(scale > 0) || !Number.isFinite(offset) || !Number.isFinite(65535 * scale + offset))
    throw new RangeError('Quantized water heights need a finite positive scale and finite offset');
}

export function assertGround(ground: WaterGround): void {
  const { data, width, height, step, origin } = ground;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 2 || height < 2 || data.length !== width * height)
    throw new RangeError('Water needs a complete ground height grid');
  if (!Number.isFinite(step) || !(step > 0) || origin.length !== 2 || !origin.every(Number.isFinite)
    || !Number.isFinite(origin[0] + (width - 1) * step) || !Number.isFinite(origin[1] + (height - 1) * step))
    throw new RangeError('Water ground needs a finite origin and positive step');
  if (ground.encoding === 'quantized') {
    if (!(data instanceof Uint16Array)) throw new RangeError('Quantized water ground needs Uint16 samples');
    assertQuantizedUnits(ground.scale, ground.offset);
  } else if (!(data instanceof Float32Array) || (ground.encoding !== undefined && ground.encoding !== 'metres'))
    throw new RangeError('Water ground needs Float32 metre samples or an explicit quantized encoding');
}

/** Decode one valid grid index without allocating a metre raster. */
export function groundSample(ground: WaterGround, index: number): number {
  return ground.encoding === 'quantized' ? ground.data[index]! * ground.scale + ground.offset : ground.data[index]!;
}

/**
 * Ground height with the terrain mesh's fixed diagonal, exactly as the shader samples it. Outside the grid the
 * ground is treated as dry land (`Infinity`), so nothing draws water there.
 */
export function groundAt(ground: WaterGround, x: number, z: number): number {
  const gx = (x - ground.origin[0]) / ground.step, gz = (z - ground.origin[1]) / ground.step;
  if (!(gx >= 0 && gz >= 0 && gx <= ground.width - 1 && gz <= ground.height - 1)) return Infinity;
  const i = Math.min(Math.floor(gx), ground.width - 2), k = Math.min(Math.floor(gz), ground.height - 2);
  const fx = gx - i, fz = gz - k, w = ground.width;
  const h00 = groundSample(ground, i + w * k), h10 = groundSample(ground, i + 1 + w * k);
  const h01 = groundSample(ground, i + w * (k + 1)), h11 = groundSample(ground, i + 1 + w * (k + 1));
  return fx <= fz ? h00 + fx * (h11 - h01) + fz * (h01 - h00) : h00 + fx * (h10 - h00) + fz * (h11 - h10);
}

/** Normalised elliptical distance from a basin's centre: below 1 is inside its supplied outline. */
export const basinDistance = (body: WaterBody, x: number, z: number): number =>
  Math.hypot((x - body.x) / body.radiusX, (z - body.z) / body.radiusZ);

/** How far past its outline a basin may still draw where its bed is under water (metres). */
export const BASIN_FEATHER = 0.75;

export interface WaterAt { readonly id: string; readonly level: number; readonly depth: number }

/**
 * Where the supplied water actually is: inside a basin's outline (plus its feather) or beside a course's centreline,
 * and only where the bed lies below that water's surface. Courses report their interpolated local level.
 */
export function waterAt(bodies: readonly WaterBody[], reaches: readonly WaterReach[], ground: WaterGround, x: number, z: number): WaterAt | null {
  const bed = groundAt(ground, x, z);
  if (!Number.isFinite(bed)) return null;
  let best: WaterAt | null = null;
  for (const body of bodies) {
    const feather = BASIN_FEATHER / Math.min(body.radiusX, body.radiusZ);
    if (basinDistance(body, x, z) <= 1 + feather && bed < body.level && (!best || body.level - bed > best.depth))
      best = { id: body.id, level: body.level, depth: body.level - bed };
  }
  for (const reach of reaches) {
    const near = nearestSegment(reach, x, z);
    if (!near || near.lateral > near.width / 2 + REACH_MARGIN || bed >= near.level) continue;
    if (!best || near.level - bed > best.depth) best = { id: reach.id, level: near.level, depth: near.level - bed };
  }
  return best;
}

/** The nearest point on a course's polyline, with its interpolated level and width. */
export function nearestSegment(reach: WaterReach, x: number, z: number): { lateral: number; level: number; width: number } | null {
  let best: { lateral: number; level: number; width: number } | null = null;
  const pts = reach.points;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const dx = b.position[0] - a.position[0], dz = b.position[1] - a.position[1], length2 = dx * dx + dz * dz;
    const t = length2 > 0 ? Math.min(1, Math.max(0, ((x - a.position[0]) * dx + (z - a.position[1]) * dz) / length2)) : 0;
    const lateral = Math.hypot(x - (a.position[0] + dx * t), z - (a.position[1] + dz * t));
    if (!best || lateral < best.lateral) best = { lateral, level: a.level + (b.level - a.level) * t, width: a.width + (b.width - a.width) * t };
  }
  return best;
}
