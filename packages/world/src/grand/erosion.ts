import { rng } from './noise';

/**
 * Particle hydraulic erosion after Hans Beyer's thesis (2015) as popularised by Sebastian Lague's
 * "Coding Adventure: Hydraulic Erosion" (MIT): droplets with inertia carry and drop sediment, eroding
 * through a radial brush. Our own implementation over a float heightfield; heights are normalised by
 * `scale` while it runs so the published constants hold at voxel units.
 */
export interface ErosionOptions {
  readonly droplets: number;
  readonly seed: number;
  readonly scale: number;
  readonly radius?: number;
  readonly inertia?: number;
  readonly capacity?: number;
  readonly minCapacity?: number;
  readonly erode?: number;
  readonly deposit?: number;
  readonly evaporate?: number;
  readonly gravity?: number;
  readonly lifetime?: number;
  /** Where droplets may start (1 = allowed), and a 0..1 strength per cell. */
  readonly strength?: Float32Array;
  readonly floor?: number;
}

export function erode(height: Float32Array, size: number, options: ErosionOptions): void {
  const radius = options.radius ?? 3, inertia = options.inertia ?? 0.05, capacityFactor = options.capacity ?? 4;
  const minCapacity = options.minCapacity ?? 0.01, erodeSpeed = options.erode ?? 0.3, depositSpeed = options.deposit ?? 0.3;
  const evaporate = options.evaporate ?? 0.01, gravity = options.gravity ?? 4, lifetime = options.lifetime ?? 30;
  const scale = options.scale, floor = (options.floor ?? -Infinity) / scale;
  const n = size * size;
  const h = new Float32Array(n);
  for (let i = 0; i < n; i++) h[i] = height[i]! / scale;
  // Brush offsets and weights, precomputed once.
  const offsets: number[] = [], weights: number[] = [];
  let weightSum = 0;
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= radius) continue;
    const w = 1 - d / radius;
    offsets.push(dx, dz); weights.push(w); weightSum += w;
  }
  const brushX = Int32Array.from(offsets.filter((_, i) => i % 2 === 0));
  const brushZ = Int32Array.from(offsets.filter((_, i) => i % 2 === 1));
  const brushW = Float32Array.from(weights.map(w => w / weightSum));
  const brushCount = brushW.length;
  const draw = rng(options.seed);
  const strength = options.strength;
  let dropped = 0, attempts = 0;
  while (dropped < options.droplets && attempts < options.droplets * 4) {
    attempts++;
    let px = draw() * (size - 2) + 0.5, pz = draw() * (size - 2) + 0.5;
    const startIndex = Math.floor(px) + Math.floor(pz) * size;
    const local = strength ? strength[startIndex]! : 1;
    if (local <= 0.02 || h[startIndex]! < floor) continue;
    dropped++;
    let dx = 0, dz = 0, speed = 1, water = 1, sediment = 0;
    for (let step = 0; step < lifetime; step++) {
      const nx = Math.floor(px), nz = Math.floor(pz);
      const index = nx + nz * size;
      const ox = px - nx, oz = pz - nz;
      const h00 = h[index]!, h10 = h[index + 1]!, h01 = h[index + size]!, h11 = h[index + size + 1]!;
      const gx = (h10 - h00) * (1 - oz) + (h11 - h01) * oz;
      const gz = (h01 - h00) * (1 - ox) + (h11 - h10) * ox;
      const here = h00 * (1 - ox) * (1 - oz) + h10 * ox * (1 - oz) + h01 * (1 - ox) * oz + h11 * ox * oz;
      dx = dx * inertia - gx * (1 - inertia);
      dz = dz * inertia - gz * (1 - inertia);
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-7) break;
      dx /= len; dz /= len;
      px += dx; pz += dz;
      if (px < 1 || pz < 1 || px >= size - 2 || pz >= size - 2) break;
      const qx = Math.floor(px), qz = Math.floor(pz), qi = qx + qz * size, fx = px - qx, fz = pz - qz;
      const next = h[qi]! * (1 - fx) * (1 - fz) + h[qi + 1]! * fx * (1 - fz) + h[qi + size]! * (1 - fx) * fz + h[qi + size + 1]! * fx * fz;
      const delta = next - here;
      const capacity = Math.max(-delta * speed * water * capacityFactor, minCapacity);
      if (sediment > capacity || delta > 0) {
        const amount = delta > 0 ? Math.min(delta, sediment) : (sediment - capacity) * depositSpeed;
        sediment -= amount;
        h[index] = h[index]! + amount * (1 - ox) * (1 - oz);
        h[index + 1] = h[index + 1]! + amount * ox * (1 - oz);
        h[index + size] = h[index + size]! + amount * (1 - ox) * oz;
        h[index + size + 1] = h[index + size + 1]! + amount * ox * oz;
      } else {
        const amount = Math.min((capacity - sediment) * erodeSpeed * (strength ? Math.max(0.15, strength[index]!) : 1), -delta);
        for (let b = 0; b < brushCount; b++) {
          const bx = nx + brushX[b]!, bz = nz + brushZ[b]!;
          if (bx < 0 || bz < 0 || bx >= size || bz >= size) continue;
          const bi = bx + bz * size;
          const weighed = amount * brushW[b]!;
          const take = h[bi]! < weighed ? h[bi]! : weighed;
          h[bi] = h[bi]! - take;
          sediment += take;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + delta * gravity));
      water *= 1 - evaporate;
    }
  }
  for (let i = 0; i < n; i++) height[i] = h[i]! * scale;
}

/** Talus relaxation: moves material downhill wherever a slope exceeds `talus`, scaled by `mask`. */
export function thermal(height: Float32Array, size: number, iterations: number, talus: number, mask: Float32Array): void {
  for (let it = 0; it < iterations; it++) {
    for (let z = 1; z < size - 1; z++) for (let x = 1; x < size - 1; x++) {
      const i = x + z * size, m = mask[i]!;
      if (m <= 0.01) continue;
      const here = height[i]!;
      let lowest = i, drop = 0;
      for (const o of [1, -1, size, -size]) {
        const d = here - height[i + o]!;
        if (d > drop) { drop = d; lowest = i + o; }
      }
      if (drop > talus) {
        const move = 0.5 * (drop - talus) * m;
        height[i] = here - move;
        height[lowest] = height[lowest]! + move;
      }
    }
  }
}
