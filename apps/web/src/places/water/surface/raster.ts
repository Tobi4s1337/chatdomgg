import * as THREE from 'three';
import { assertGround, assertQuantizedUnits, groundAt, groundSample, type WaterAt, type WaterGround } from './coverage';

/** Water levels on the ground grid. Float metres use NaN for dry; zero remains a valid wet level.
 * Quantized samples are wet only above their shared encoded bed, then decode with the ground's units. */
export type WaterRaster = { readonly seaLevel: number }
  & ({ readonly levels: Float32Array; readonly encoding?: 'metres' }
    | { readonly levels: Uint16Array; readonly encoding: 'quantized'; readonly scale: number; readonly offset: number;
      readonly dryGround: Uint16Array });

export function assertRaster(raster: WaterRaster, ground: WaterGround): void {
  assertGround(ground);
  if (raster.levels.length !== ground.width * ground.height || !Number.isFinite(raster.seaLevel))
    throw new RangeError('Water raster needs one level per ground sample and a finite sea level');
  if (raster.encoding === 'quantized') {
    if (!(raster.levels instanceof Uint16Array) || !(raster.dryGround instanceof Uint16Array)
      || raster.dryGround.length !== raster.levels.length)
      throw new RangeError('Quantized water raster needs complete Uint16 level and bed samples');
    assertQuantizedUnits(raster.scale, raster.offset);
    if (ground.encoding !== 'quantized' || ground.scale !== raster.scale || ground.offset !== raster.offset
      || ground.data !== raster.dryGround)
      throw new RangeError('Quantized water raster must share its ground samples and units');
  } else if (!(raster.levels instanceof Float32Array) || (raster.encoding !== undefined && raster.encoding !== 'metres'))
    throw new RangeError('Water raster needs Float32 metre samples or an explicit quantized encoding');
}

/** Decode one valid raster index; dry remains NaN even when the translated world has negative heights. */
export function rasterLevel(raster: WaterRaster, index: number): number {
  if (raster.encoding !== 'quantized') return raster.levels[index]!;
  const level = raster.levels[index]!;
  return level > raster.dryGround[index]! ? level * raster.scale + raster.offset : NaN;
}

/** Each sample owns the cell beginning at its grid position. */
export function rasterWaterAt(raster: WaterRaster, ground: WaterGround, x: number, z: number): WaterAt | null {
  const gx = (x - ground.origin[0]) / ground.step, gz = (z - ground.origin[1]) / ground.step;
  if (!(gx >= 0 && gz >= 0 && gx < ground.width && gz < ground.height)) return null;
  const i = Math.floor(gx), k = Math.floor(gz);
  const level = rasterLevel(raster, i + ground.width * k), bed = groundAt(ground, Math.min(x, ground.origin[0] + (ground.width - 1) * ground.step), Math.min(z, ground.origin[1] + (ground.height - 1) * ground.step));
  return Number.isFinite(level) && Number.isFinite(bed) && bed < level ? { id: 'raster', level, depth: level - bed } : null;
}

/** One indexed mesh, greedily merging equal-level cells in both dimensions. */
export function rasterGeometry(raster: WaterRaster, ground: WaterGround): THREE.BufferGeometry {
  const { width: w, height: h, origin, step } = ground;
  const used = new Uint8Array(w * h);
  let capacity = 256, count = 0;
  let positions = new Float32Array(capacity * 12), flows = new Float32Array(capacity * 12), indices = new Uint32Array(capacity * 6);
  function grow() {
    capacity *= 2;
    const p = new Float32Array(capacity * 12), f = new Float32Array(capacity * 12), ix = new Uint32Array(capacity * 6);
    p.set(positions); f.set(flows); ix.set(indices); positions = p; flows = f; indices = ix;
  }
  for (let k = 0; k < h; k++) for (let i = 0; i < w; i++) {
    const start = i + k * w, level = rasterLevel(raster, start);
    if (used[start] || !Number.isFinite(level)) continue;
    let end = i + 1;
    while (end < w && !used[end + k * w] && rasterLevel(raster, end + k * w) === level) end++;
    let bottom = k + 1;
    rows: while (bottom < h) {
      for (let x = i; x < end; x++) if (used[x + bottom * w] || rasterLevel(raster, x + bottom * w) !== level) break rows;
      bottom++;
    }
    for (let z = k; z < bottom; z++) used.fill(1, z * w + i, z * w + end);
    if (count === capacity) grow();
    const x0 = origin[0] + i * step, x1 = origin[0] + end * step;
    const z0 = origin[1] + k * step, z1 = origin[1] + bottom * step;
    positions.set([x0, level, z0, x1, level, z0, x0, level, z1, x1, level, z1], count * 12);
    // A local downhill gradient gives stepped courses a consistent native flow; still water remains still.
    const neighbour = (x: number, z: number) => {
      if (x < 0 || x >= w || z < 0 || z >= h) return level;
      const sample = rasterLevel(raster, x + z * w);
      return Number.isFinite(sample) ? sample : level;
    };
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

/** Legacy materializing adapter. Production raster rendering clamps edge texels in the shader instead.
 * Extend edge heights one sample so the final row and column of cells have a bed, in decoded metres. */
export function rasterGround(ground: WaterGround): WaterGround {
  const width = ground.width + 1, height = ground.height + 1;
  const data = new Float32Array(width * height);
  for (let z = 0; z < height; z++) {
    const source = Math.min(z, ground.height - 1) * ground.width;
    for (let x = 0; x < ground.width; x++) data[z * width + x] = groundSample(ground, source + x);
    data[z * width + ground.width] = groundSample(ground, source + ground.width - 1);
  }
  return { data, width, height, origin: ground.origin, step: ground.step };
}

/** Bed depth of the open sea under its sea level, metres: deep enough to take the deep body colour. */
export const OPEN_SEA_DEPTH = 40;

/**
 * The open sea around a raster: four still quads at sea level out to `reach` metres from the land's centre. Their
 * inner edge reaches two cells inside the raster and the shader draws them over its outermost cell and beyond
 * (`uOpenSeaMesh`), so the raster's many edge quads and these long ones never meet in a T-junction.
 * The shader finds the deep bed beyond the grid, so they read as open water from the first metre past the land.
 */
export function openSeaGeometry(seaLevel: number, ground: WaterGround, reach: number): THREE.BufferGeometry {
  const inset = ground.step * 2;
  const x0 = ground.origin[0] + inset, z0 = ground.origin[1] + inset;
  const x1 = ground.origin[0] + ground.width * ground.step - inset, z1 = ground.origin[1] + ground.height * ground.step - inset;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (!(reach > Math.max(ground.width, ground.height) * ground.step)) throw new RangeError('The open sea must reach well beyond the land');
  const X0 = cx - reach, X1 = cx + reach, Z0 = cz - reach, Z1 = cz + reach;
  const quads: [number, number, number, number][] = [[X0, X1, Z0, z0], [X0, X1, z1, Z1], [X0, x0, z0, z1], [x1, X1, z0, z1]];
  const positions: number[] = [], indices: number[] = [];
  quads.forEach(([a, b, c, d], q) => {
    positions.push(a, seaLevel, c, b, seaLevel, c, a, seaLevel, d, b, seaLevel, d);
    const v = q * 4; indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
