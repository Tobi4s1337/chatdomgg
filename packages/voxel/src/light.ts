import { checkedVolume, voxelIndex, type Vec3 } from './coordinates';

export const MAX_LIGHT_VOLUME_CELLS = 524_288;
export const DEFAULT_LIGHT_VOLUME_SIZE: Vec3 = [64, 32, 64];

export interface LightVolumeSpec {
  readonly revision: number;
  readonly origin: Vec3;
  readonly size: Vec3;
  readonly cellSize: number;
}

export interface LightEmitter {
  /** Source positions must be in air, e.g. just outside the window's facade. */
  readonly position: Vec3;
  readonly level: number;
}

export interface LightVolumeRequest extends LightVolumeSpec {
  readonly occupancy: Uint8Array;
  readonly emitters: readonly LightEmitter[];
}

export interface LightVolume extends LightVolumeSpec {
  /** R8 levels 0..15. Colour is a shared warm-core shader uniform, never a subscriber multiplier. */
  readonly light: Uint8Array;
  readonly visited: number;
  readonly estimatedPeakBytes: number;
}

export interface OccluderBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

function validateSpec(spec: LightVolumeSpec): number {
  const count = checkedVolume(spec.size, MAX_LIGHT_VOLUME_CELLS);
  if (!Number.isFinite(spec.cellSize) || spec.cellSize <= 0 || spec.origin.some((n) => !Number.isFinite(n))) {
    throw new Error('Light-volume bounds must be finite with positive cell size.');
  }
  if (!Number.isSafeInteger(spec.revision) || spec.revision < 0) throw new Error('Invalid light-volume revision.');
  return count;
}

/** Conservative overlap keeps even a 0.125 m wall opaque on the coarser light grid. */
export function rasterizeLightOccluders(spec: LightVolumeSpec, boxes: readonly OccluderBox[]): Uint8Array {
  const occupancy = new Uint8Array(validateSpec(spec));
  for (const box of boxes) {
    if (box.min.some((n, axis) => !Number.isFinite(n) || !Number.isFinite(box.max[axis]) || n >= box.max[axis]!)) {
      throw new Error('Light blockers need finite, nonempty bounds.');
    }
    const from = box.min.map((n, axis) => Math.max(0, Math.floor((n - spec.origin[axis]!) / spec.cellSize)));
    const to = box.max.map((n, axis) => Math.min(spec.size[axis]!, Math.ceil((n - spec.origin[axis]!) / spec.cellSize)));
    for (let z = from[2]!; z < to[2]!; z++) for (let y = from[1]!; y < to[1]!; y++) {
      for (let x = from[0]!; x < to[0]!; x++) occupancy[voxelIndex(x, y, z, spec.size)] = 1;
    }
  }
  return occupancy;
}

/**
 * Six-neighbour max-light flood. Own implementation of the classic voxel flood algorithm.
 * A cell has at most one FIFO entry, so mixed source levels never overflow the fixed queue.
 * Optional sky beams preserve level 15 only while travelling straight down.
 */
export function floodLight(size: Vec3, occupancy: Uint8Array, light: Uint8Array, sky = false, seeds?: Iterable<number>): number {
  const count = checkedVolume(size);
  if (occupancy.length !== count || light.length !== count) throw new Error('Light arrays do not match their volume.');
  const queue = new Uint32Array(count);
  const queued = new Uint8Array(Math.ceil(count / 8));
  let head = 0, tail = 0, pending = 0, visited = 0;
  const enqueue = (index: number): void => {
    const byte = index >>> 3, bit = 1 << (index & 7);
    if ((queued[byte]! & bit) !== 0) return;
    queued[byte] = queued[byte]! | bit;
    queue[tail] = index;
    tail = (tail + 1) % count;
    pending++;
  };
  for (let i = 0; i < count; i++) {
    if (light[i]! > 15) throw new Error('Voxel light levels must be in 0..15.');
    if (occupancy[i]) light[i] = 0;
    else if (seeds === undefined && light[i]! > 1) enqueue(i);
  }
  if (seeds !== undefined) for (const index of seeds) {
    if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error('Light seed lies outside the volume.');
    if (light[index]! > 1 && !occupancy[index]) enqueue(index);
  }
  const width = size[0], plane = width * size[1];
  const visit = (index: number, level: number): void => {
    if (!occupancy[index] && light[index]! < level) {
      light[index] = level;
      if (level > 1) enqueue(index);
    }
  };
  while (pending > 0) {
    const index = queue[head]!;
    head = (head + 1) % count;
    pending--;
    queued[index >>> 3] = queued[index >>> 3]! & ~(1 << (index & 7));
    visited++;
    const level = light[index]!;
    const decayed = level - 1;
    const x = index % width;
    const y = Math.floor(index / width) % size[1];
    const z = Math.floor(index / plane);
    if (x > 0) visit(index - 1, decayed);
    if (x + 1 < width) visit(index + 1, decayed);
    if (y > 0) visit(index - width, sky && level === 15 ? 15 : decayed);
    if (y + 1 < size[1]) visit(index + width, decayed);
    if (z > 0) visit(index - plane, decayed);
    if (z + 1 < size[2]) visit(index + plane, decayed);
  }
  return visited;
}

/** Rebuilding a bounded camera volume makes removal and overlapping sources unambiguous. */
export function buildLightVolume(request: LightVolumeRequest): LightVolume {
  const count = validateSpec(request);
  if (request.occupancy.length !== count) throw new Error('Light occupancy does not match volume dimensions.');
  const light = new Uint8Array(count);
  for (const emitter of request.emitters) {
    if (!Number.isInteger(emitter.level) || emitter.level < 0 || emitter.level > 15
      || emitter.position.some((n) => !Number.isFinite(n))) throw new Error('Invalid voxel light emitter.');
    const cell = emitter.position.map((n, axis) => Math.floor((n - request.origin[axis]!) / request.cellSize));
    if (cell.some((n, axis) => n < 0 || n >= request.size[axis]!)) continue;
    const index = voxelIndex(cell[0]!, cell[1]!, cell[2]!, request.size);
    if (!request.occupancy[index]) light[index] = Math.max(light[index]!, emitter.level);
  }
  const visited = floodLight(request.size, request.occupancy, light);
  // Worker occupancy/output/FIFO/bits + caller occupancy + current CPU and GPU field.
  // One in-flight field job; finished FIFO is released before the next volume is submitted.
  const estimatedPeakBytes = count * 9 + Math.ceil(count / 8);
  return { revision: request.revision, origin: request.origin, size: request.size, cellSize: request.cellSize,
    light, visited, estimatedPeakBytes };
}

/** A surface normal bias belongs at the caller; nearest sampling cannot filter through a thin wall. */
export function sampleLightVolume(volume: LightVolume, position: Vec3): number {
  if (position.some(n => !Number.isFinite(n))) return 0;
  const cell = position.map((n, axis) => Math.floor((n - volume.origin[axis]!) / volume.cellSize));
  if (cell.some((n, axis) => n < 0 || n >= volume.size[axis]!)) return 0;
  return volume.light[voxelIndex(cell[0]!, cell[1]!, cell[2]!, volume.size)]!;
}
