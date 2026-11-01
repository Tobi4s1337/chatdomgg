import * as THREE from 'three';
import { groundAt, type WaterAt, type WaterGround } from './coverage';

/** Water levels at the ground grid's sample points. NaN means dry; zero is a valid level. */
export interface WaterRaster {
  readonly levels: Float32Array;
  readonly seaLevel: number;
}

export function assertRaster(raster: WaterRaster, ground: WaterGround): void {
  if (raster.levels.length !== ground.width * ground.height || !Number.isFinite(raster.seaLevel))
    throw new RangeError('Water raster needs one level per ground sample and a finite sea level');
}

/** Each sample owns the cell beginning at its grid position. */
export function rasterWaterAt(raster: WaterRaster, ground: WaterGround, x: number, z: number): WaterAt | null {
  const gx = (x - ground.origin[0]) / ground.step, gz = (z - ground.origin[1]) / ground.step;
  if (!(gx >= 0 && gz >= 0 && gx < ground.width && gz < ground.height)) return null;
  const i = Math.floor(gx), k = Math.floor(gz);
  const level = raster.levels[i + ground.width * k]!, bed = groundAt(ground, Math.min(x, ground.origin[0] + (ground.width - 1) * ground.step), Math.min(z, ground.origin[1] + (ground.height - 1) * ground.step));
  return Number.isFinite(level) && Number.isFinite(bed) && bed < level ? { id: 'raster', level, depth: level - bed } : null;
}

/** One indexed mesh, greedily merging equal-level cells in both dimensions. */
export function rasterGeometry(raster: WaterRaster, ground: WaterGround): THREE.BufferGeometry {
  const { width: w, height: h, origin, step } = ground, levels = raster.levels;
  const used = new Uint8Array(w * h);
  let capacity = 256, count = 0;
  let positions = new Float32Array(capacity * 12), flows = new Float32Array(capacity * 12), indices = new Uint32Array(capacity * 6);
  function grow() {
    capacity *= 2;
    const p = new Float32Array(capacity * 12), f = new Float32Array(capacity * 12), ix = new Uint32Array(capacity * 6);
    p.set(positions); f.set(flows); ix.set(indices); positions = p; flows = f; indices = ix;
  }
  for (let k = 0; k < h; k++) for (let i = 0; i < w; i++) {
    const start = i + k * w, level = levels[start]!;
    if (used[start] || !Number.isFinite(level)) continue;
    let end = i + 1;
    while (end < w && !used[end + k * w] && levels[end + k * w] === level) end++;
    let bottom = k + 1;
    rows: while (bottom < h) {
      for (let x = i; x < end; x++) if (used[x + bottom * w] || levels[x + bottom * w] !== level) break rows;
      bottom++;
    }
    for (let z = k; z < bottom; z++) used.fill(1, z * w + i, z * w + end);
    if (count === capacity) grow();
    const x0 = origin[0] + i * step, x1 = origin[0] + end * step;
    const z0 = origin[1] + k * step, z1 = origin[1] + bottom * step;
    positions.set([x0, level, z0, x1, level, z0, x0, level, z1, x1, level, z1], count * 12);
    // A local downhill gradient gives stepped courses a consistent native flow; still water remains still.
    const neighbour = (x: number, z: number) => x >= 0 && x < w && z >= 0 && z < h && Number.isFinite(levels[x + z * w]!) ? levels[x + z * w]! : level;
    const dx = neighbour(i - 1, k) - neighbour(end, k), dz = neighbour(i, k - 1) - neighbour(i, bottom);
    const length = Math.hypot(dx, dz), fx = length ? dx / length * 0.45 : 0, fz = length ? dz / length * 0.45 : 0;
    flows.set([fx, fz, 0, fx, fz, 0, fx, fz, 0, fx, fz, 0], count * 12);
    const v = count * 4; indices.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], count * 6);
    count++;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, count * 12), 3));
  geometry.setAttribute('aFlow', new THREE.BufferAttribute(flows.slice(0, count * 12), 3));
  geometry.setIndex(new THREE.BufferAttribute(indices.slice(0, count * 6), 1));
  if (count) { geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
  return geometry;
}

/** At most 4096 representative wet samples, weighted by their coarse block's area. */
export function rasterSamples(raster: WaterRaster, ground: WaterGround) {
  const stride = Math.max(1, Math.ceil(Math.max(ground.width, ground.height) / 64));
  const samples: { id: string; x: number; y: number; z: number; weight: number }[] = [];
  for (let k = 0; k < ground.height; k += stride) for (let i = 0; i < ground.width; i += stride) {
    const endK = Math.min(k + stride, ground.height), endI = Math.min(i + stride, ground.width);
    let found = false;
    for (let z = k; z < endK && !found; z++) for (let x = i; x < endI; x++) {
      const wx = ground.origin[0] + x * ground.step, wz = ground.origin[1] + z * ground.step;
      const water = rasterWaterAt(raster, ground, wx, wz);
      if (water) { samples.push({ id: water.id, x: wx, y: water.level, z: wz, weight: (endI - i) * (endK - k) * ground.step ** 2 }); found = true; break; }
    }
  }
  return samples;
}

/** Extend edge heights one sample so the final row and column of cells have a bed. */
export function rasterGround(ground: WaterGround): WaterGround {
  const width = ground.width + 1, height = ground.height + 1;
  const data = new Float32Array(width * height);
  for (let z = 0; z < height; z++) {
    const source = Math.min(z, ground.height - 1) * ground.width;
    data.set(ground.data.subarray(source, source + ground.width), z * width);
    data[z * width + ground.width] = ground.data[source + ground.width - 1]!;
  }
  return { ...ground, data, width, height };
}
