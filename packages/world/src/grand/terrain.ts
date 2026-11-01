import { erode, thermal } from './erosion';
import { distanceTransform, blur } from './distance';
import { fbm, hash2, ridged, simplex2, smoothstep, clamp, lerp, type Noise2 } from './noise';
import { toIsland, toWorld, type GrandPlan } from './plan';

/**
 * The land's shape in four layers (worldgen-at-scale §4): authored macro masks, simulated meso (erosion,
 * rivers, lakes), noise micro detail, then material rules (cover.ts). Coarse work runs on a half-resolution
 * grid; the fine grid only adds cheap detail, so a 1536² land shapes in a few seconds in one worker.
 */
export interface Shaped {
  readonly size: number;
  /** Fine ground: top solid y + 1, as floats until quantised. */
  readonly ground: Float32Array;
  /** Fine water surface (y + 1), 0 where dry; sea columns are filled later. */
  readonly water: Float32Array;
  /** 1 where a waterfall sheet stands. */
  readonly fall: Uint8Array;
  /** Continent value on the fine grid (positive inland, in island-radius units). */
  readonly continent: Float32Array;
  /** 0..1 mountain influence. */
  readonly mountain: Float32Array;
  /** 1 on lake beds, 2 on river beds. */
  readonly bed: Uint8Array;
  readonly coast: Float32Array;
  readonly riverCells: number;
  readonly lakeCells: number;
  readonly waterfalls: number;
  readonly stacks: number;
  readonly mere: { x: number; z: number; level: number } | null;
}

interface Noises { warp: Noise2; warp2: Noise2; hills: Noise2; ridge: Noise2; jag: Noise2; jag2: Noise2; micro: Noise2; edge: Noise2; spine: Noise2 }

function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
  const len = vx * vx + vz * vz;
  const t = len > 0 ? clamp((wx * vx + wz * vz) / len, 0, 1) : 0;
  const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
  return { d: Math.sqrt(dx * dx + dz * dz), t };
}

/** Continent value at an island-frame point: 1 - rho / R(theta), with harmonics, bay and islets. */
function continentAt(plan: GrandPlan, noise: Noises, u: number, v: number, x: number, z: number): number {
  const nu = u / plan.radiusU, nv = v / plan.radiusV;
  const theta = Math.atan2(nv, nu);
  let rho = Math.sqrt(nu * nu + nv * nv);
  rho += 0.075 * fbm(noise.warp, x / 340, z / 340, 3) + 0.03 * fbm(noise.warp2, x / 90, z / 90, 2);
  let radius = 1;
  for (const h of plan.harmonics) radius += h.a * Math.cos(h.k * theta + h.phase);
  const bay = angleDelta(theta, plan.bay.angle) / plan.bay.width;
  radius -= plan.bay.depth * Math.exp(-bay * bay);
  let m = 1 - rho / radius;
  for (const islet of plan.islets) {
    const du = (u - islet.u) / islet.r, dv = (v - islet.v) / islet.r;
    const d = Math.sqrt(du * du + dv * dv) + 0.25 * noise.edge(x / 40, z / 40);
    m = Math.max(m, (1 - d) * 0.12);
  }
  return m;
}

function landHeight(plan: GrandPlan, m: number): number {
  const sea = plan.seaLevel;
  if (m >= 0) return sea - 1 + 4 * smoothstep(0, 0.035, m) + 24 * smoothstep(0.02, 0.6, m);
  return sea - 1.5 - 34 * smoothstep(0, 0.26, -m);
}

export function shapeLand(plan: GrandPlan): Shaped {
  const size = plan.size, sea = plan.seaLevel;
  const s = plan.seed;
  const noise: Noises = {
    warp: simplex2(s ^ 0x1001), warp2: simplex2(s ^ 0x1002), hills: simplex2(s ^ 0x1003), ridge: simplex2(s ^ 0x1004),
    jag: simplex2(s ^ 0x1005), jag2: simplex2(s ^ 0x1006), micro: simplex2(s ^ 0x1007), edge: simplex2(s ^ 0x1008), spine: simplex2(s ^ 0x1009),
  };
  // ---- Coarse macro + meso (half resolution) ----
  const g = size / 2;
  const coarse = new Float32Array(g * g), cont = new Float32Array(g * g), mount = new Float32Array(g * g), strength = new Float32Array(g * g);
  const cliffWeight = (theta: number) => {
    const d = angleDelta(theta, plan.cliffCoast.angle) / plan.cliffCoast.width;
    return Math.exp(-d * d * 2);
  };
  for (let gz = 0; gz < g; gz++) for (let gx = 0; gx < g; gx++) {
    const x = gx * 2 + 1, z = gz * 2 + 1;
    const [u, v] = toIsland(plan, x, z);
    const m = continentAt(plan, noise, u, v, x, z);
    let h = landHeight(plan, m);
    const inland = smoothstep(0.0, 0.16, m);
    h += plan.hills * (fbm(noise.hills, x / 240, z / 240, 5) * 0.9 + 0.25) * inland;
    // Coastal cliffs on one stretch of shore: land rises fast behind the beach line.
    const theta = Math.atan2(v / plan.radiusV, u / plan.radiusU);
    h += plan.cliffCoast.height * cliffWeight(theta) * smoothstep(0.004, 0.05, m) * (0.7 + 0.3 * noise.edge(x / 60, z / 60));
    // Mountains follow their spines (signed distance to a warped polyline), not noise blobs.
    let mountain = 0, peakHere = 0;
    const wu = u + 46 * noise.spine(x / 260, z / 260), wv = v + 46 * noise.spine(z / 260 + 7.1, x / 260 - 3.3);
    for (const spine of plan.spines) {
      let best = 1e9, along = 0;
      for (let i = 0; i + 1 < spine.points.length; i++) {
        const a = spine.points[i]!, b = spine.points[i + 1]!;
        const { d, t } = segmentDistance(wu, wv, a[0], a[1], b[0], b[1]);
        if (d < best) { best = d; along = (i + t) / (spine.points.length - 1); }
      }
      const taper = smoothstep(0, 0.14, along) * smoothstep(1, 0.86, along) * 0.55 + 0.45;
      const t = smoothstep(spine.width, spine.width * 0.08, best);
      const lift = Math.pow(t, 1.4) * taper;
      if (lift > mountain) { mountain = lift; peakHere = spine.peak; }
    }
    if (mountain > 0) {
      const crest = ridged(noise.ridge, x / 300, z / 300, 6, 2.0, 0.5, 1);
      const relief = mountain * peakHere * (0.42 + 0.78 * crest) * smoothstep(-0.03, 0.07, m);
      h = Math.max(h, h * (1 - mountain) + (sea + relief) * Math.min(1, mountain * 1.6)) + relief * 0.25;
    }
    const i = gx + gz * g;
    coarse[i] = h; cont[i] = m; mount[i] = mountain;
    strength[i] = m > 0.01 ? clamp(0.35 + mountain * 0.9 + inland * 0.2, 0, 1) : 0;
  }
  erode(coarse, g, { droplets: Math.round(g * g * 0.32), seed: s ^ 0x2001, scale: 36, strength, floor: sea + 1, lifetime: 34 });
  const talusMask = new Float32Array(g * g);
  for (let i = 0; i < talusMask.length; i++) talusMask[i] = cont[i]! > 0 ? (1 - smoothstep(0.35, 0.7, mount[i]!)) : 0;
  thermal(coarse, g, 12, 2.6, talusMask);

  // ---- Fine detail ----
  const ground = new Float32Array(size * size), continent = new Float32Array(size * size), mountain = new Float32Array(size * size);
  const castle = toWorld(plan, plan.castle.u, plan.castle.v);
  const town = toWorld(plan, plan.town.u, plan.town.v);
  const fields = toWorld(plan, plan.fields.u, plan.fields.v);
  const mere = toWorld(plan, plan.mere.u, plan.mere.v);
  const cos = Math.cos(plan.rotation), sin = Math.sin(plan.rotation);
  const sample = (field: Float32Array, fx: number, fz: number) => {
    const cx = clamp(fx, 0, g - 1.001), cz = clamp(fz, 0, g - 1.001);
    const ix = Math.floor(cx), iz = Math.floor(cz), tx = cx - ix, tz = cz - iz, i = ix + iz * g;
    const a = field[i]!, b = field[Math.min(i + 1, g * g - 1)]!, c = field[Math.min(i + g, g * g - 1)]!, d = field[Math.min(i + g + 1, g * g - 1)]!;
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const fx = (x - 0.5) / 2, fz = (z - 0.5) / 2;
    let h = sample(coarse, fx, fz);
    const m = sample(cont, fx, fz), mt = sample(mount, fx, fz);
    const i = x + z * size;
    continent[i] = m; mountain[i] = mt;
    if (m > -0.02) {
      // Needle jag on the high ground only, mostly upward (half-negative), never eroded away.
      const relative = (h - sea) / 260;
      const peakMask = smoothstep(0.3, 0.75, relative) * smoothstep(0.15, 0.45, mt);
      if (peakMask > 0) {
        const j1 = noise.jag(x / 9.5, z / 9.5), j2 = noise.jag2(x / 4.3, z / 4.3);
        const jag = (j1 < 0 ? j1 * 0.4 : j1) * 0.7 + (j2 < 0 ? j2 * 0.4 : j2) * 0.3;
        h += jag * plan.jag * peakMask + peakMask * plan.jag * 0.25;
      }
      h += 0.9 * noise.micro(x / 13, z / 13) * smoothstep(0, 0.05, m) + 0.6 * noise.micro(x / 5, z / 5) * mt;
    }
    // The castle rock: a domed plateau whose edge breaks into cliffs.
    {
      const dx = x - castle[0], dz = z - castle[1];
      const r = Math.sqrt(dx * dx + dz * dz);
      // Edge noise moves the rim by at most 15 %: cells further out cannot be on the rock.
      const edge = r > plan.castle.radius * 1.3 ? 0 : plan.castle.radius * (1 + 0.1 * noise.edge(Math.atan2(dz, dx) * 2.2, 3.7) + 0.05 * noise.edge(x / 18, z / 18));
      if (r < edge * 1.12) {
        const top = plan.castle.top + 2.5 * (1 - (r / edge) ** 2) + 0.8 * noise.micro(x / 20, z / 20);
        const k = r / edge;
        const plateau = k < 0.86 ? top : lerp(top, h, Math.pow(smoothstep(0.86, 1.12, k), 0.55));
        h = Math.max(h, plateau);
      }
    }
    // The town flat: gentle ground between the rock and the harbour.
    {
      const dx = x - town[0], dz = z - town[1];
      const lu = (dx * cos + dz * sin) / plan.town.ru, lv = (-dx * sin + dz * cos) / plan.town.rv;
      const e0 = Math.sqrt(lu * lu + lv * lv);
      const e = e0 > 1.3 ? e0 : e0 + 0.08 * noise.edge(x / 50, z / 50);
      const w = (1 - smoothstep(0.7, 1.2, e)) * smoothstep(-0.005, 0.03, m);
      if (w > 0) {
        const level = plan.town.level + 2.2 * fbm(noise.hills, x / 110, z / 110, 2) + Math.max(0, -lv) * -1.5;
        h = lerp(h, Math.max(level, Math.min(h, level + 6)), w);
      }
    }
    // Fields: the slope relaxes toward a soft rolling plain.
    {
      const dx = x - fields[0], dz = z - fields[1];
      const r0 = Math.sqrt(dx * dx + dz * dz) / plan.fields.radius;
      const r = r0 > 1.36 ? r0 : r0 + 0.1 * noise.edge(x / 70, z / 70);
      const w = (1 - smoothstep(0.75, 1.25, r)) * (1 - smoothstep(0.08, 0.3, mt)) * smoothstep(0.0, 0.04, m);
      if (w > 0) h = lerp(h, sea + 5 + Math.max(0, h - sea - 5) * 0.4, w);
    }
    // The mere's basin; the flood fill below makes it a lake at its spill height.
    {
      const dx = x - mere[0], dz = z - mere[1];
      const r0 = Math.sqrt(dx * dx + dz * dz) / plan.mere.radius;
      const r = r0 > 1.47 ? r0 : r0 + 0.16 * noise.edge(x / 35, z / 35);
      if (r < 1.3) h -= plan.mere.depth * (1 - smoothstep(0.0, 1.3, r)) * (1 - smoothstep(0.3, 0.7, mt)) * smoothstep(0, 0.05, m);
    }
    ground[i] = clamp(h, 2, plan.height - 4);
  }

  // ---- Hydrology on the half grid of the finished shape ----
  const hydro = new Float32Array(g * g);
  for (let gz = 0; gz < g; gz++) for (let gx = 0; gx < g; gx++) {
    const i = gx * 2 + gz * 2 * size;
    hydro[gx + gz * g] = (ground[i]! + ground[i + 1]! + ground[i + size]! + ground[i + size + 1]!) / 4;
  }
  const filled = priorityFill(hydro, g, sea);
  const water = new Float32Array(size * size), fall = new Uint8Array(size * size), bed = new Uint8Array(size * size);
  // Lakes: depressions deep and wide enough to hold water; small sinks are simply filled in.
  const lakeLabel = new Int32Array(g * g).fill(-1);
  const lakes: { cells: number[]; level: number }[] = [];
  for (let i = 0; i < g * g; i++) {
    if (lakeLabel[i] !== -1 || filled[i]! - hydro[i]! < 0.9 || hydro[i]! < sea) continue;
    const cells: number[] = [], stack = [i];
    lakeLabel[i] = lakes.length;
    while (stack.length) {
      const c = stack.pop()!; cells.push(c);
      const cx = c % g, cz = (c / g) | 0;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + ox, nz = cz + oz;
        if (nx < 0 || nz < 0 || nx >= g || nz >= g) continue;
        const n = nx + nz * g;
        if (lakeLabel[n] === -1 && filled[n]! - hydro[n]! >= 0.5 && Math.abs(filled[n]! - filled[i]!) < 0.6) { lakeLabel[n] = lakes.length; stack.push(n); }
      }
    }
    let level = 0;
    for (const c of cells) level = Math.max(level, filled[c]!);
    lakes.push({ cells, level });
  }
  let lakeCells = 0, mereSite: Shaped['mere'] = null, mereSize = 0;
  for (const lake of lakes) {
    const keep = lake.cells.length >= 40;
    for (const c of lake.cells) {
      const cx = c % g, cz = (c / g) | 0;
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
        const i = cx * 2 + dx + (cz * 2 + dz) * size;
        if (keep) {
          if (ground[i]! < lake.level) { water[i] = Math.round(lake.level); bed[i] = 1; lakeCells++; }
        } else if (ground[i]! < lake.level - 0.5) ground[i] = lake.level - 0.5;
      }
    }
    if (keep && lake.cells.length > mereSize) {
      mereSize = lake.cells.length;
      let sx = 0, sz = 0;
      for (const c of lake.cells) { sx += (c % g) * 2 + 1; sz += ((c / g) | 0) * 2 + 1; }
      mereSite = { x: sx / lake.cells.length, z: sz / lake.cells.length, level: Math.round(lake.level) };
    }
  }
  // D8 flow over the filled surface, then accumulation with more rain on the heights.
  const order = new Int32Array(g * g);
  for (let i = 0; i < order.length; i++) order[i] = i;
  order.sort((a, b) => filled[b]! - filled[a]!);
  const down = new Int32Array(g * g).fill(-1);
  const acc = new Float32Array(g * g);
  let landCells = 0;
  for (let i = 0; i < g * g; i++) {
    if (hydro[i]! < sea) continue;
    landCells++;
    const cx = i % g, cz = (i / g) | 0;
    let best = -1, drop = 0;
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oz) continue;
      const nx = cx + ox, nz = cz + oz;
      if (nx < 0 || nz < 0 || nx >= g || nz >= g) continue;
      const n = nx + nz * g;
      const d = (filled[i]! - filled[n]!) / (ox && oz ? 1.414 : 1);
      if (d > drop) { drop = d; best = n; }
    }
    down[i] = best;
    acc[i] = 1 + 2.2 * smoothstep(sea + 30, sea + 200, hydro[i]!);
  }
  for (const i of order) { const d = down[i]!; if (d >= 0 && hydro[i]! >= sea) acc[d] = acc[d]! + acc[i]!; }
  const threshold = Math.max(220, landCells * 0.0022);
  let riverCells = 0, waterfalls = 0;
  for (const i of order) {
    if (acc[i]! < threshold || hydro[i]! < sea || lakeLabel[i]! >= 0 && lakes[lakeLabel[i]!]!.cells.length >= 40) continue;
    const d = down[i]!;
    if (d < 0) continue;
    riverCells++;
    const flow = acc[i]! / threshold;
    const width = clamp(1.6 + 1.1 * Math.sqrt(flow), 2.2, 9);
    const depth = clamp(1.5 + 0.5 * Math.sqrt(flow), 2, 4);
    const ax = (i % g) * 2 + 1, az = ((i / g) | 0) * 2 + 1, bx = (d % g) * 2 + 1, bz = ((d / g) | 0) * 2 + 1;
    const levelA = filled[i]!, levelB = Math.max(sea, filled[d]!);
    const isFall = levelA - levelB > 5;
    if (isFall) waterfalls++;
    const reach = Math.ceil(width + 2);
    for (let z = Math.max(1, Math.min(az, bz) - reach); z <= Math.min(size - 2, Math.max(az, bz) + reach); z++) {
      for (let x = Math.max(1, Math.min(ax, bx) - reach); x <= Math.min(size - 2, Math.max(ax, bx) + reach); x++) {
        const { d: dist, t } = segmentDistance(x, z, ax, az, bx, bz);
        if (dist > width) continue;
        const j = x + z * size;
        if (ground[j]! < sea - 0.5) continue;
        const level = Math.round(isFall ? (t < 0.5 ? levelA : levelB) : lerp(levelA, levelB, t));
        const k = dist / width;
        const floor = level - 1 - depth * (1 - k * k);
        if (ground[j]! > floor) ground[j] = Math.max(floor, sea - 1);
        if (level > water[j]!) water[j] = level;
        bed[j] = 2;
        if (isFall && t >= 0.5 && t < 0.95 && k < 0.8) { water[j] = Math.round(levelA); fall[j] = 1; }
      }
    }
  }
  // Banks: still water never stands against air. Raise any dry neighbour lower than the surface.
  for (let pass = 0; pass < 3; pass++) {
    for (let z = 1; z < size - 1; z++) for (let x = 1; x < size - 1; x++) {
      const i = x + z * size, w = water[i]!;
      if (w <= 0 || fall[i]) continue;
      for (const o of [1, -1, size, -size]) {
        const n = i + o;
        if (water[n]! > 0 || fall[n]) continue;
        if (ground[n]! < w && ground[n]! >= sea - 0.5) ground[n] = w;
      }
    }
  }
  // Coast distance, then beaches graded toward the waterline on low shores.
  const land = new Uint8Array(size * size), seaMask = new Uint8Array(size * size);
  for (let i = 0; i < land.length; i++) { const dry = ground[i]! >= sea || (water[i]! > 0); land[i] = dry ? 1 : 0; seaMask[i] = dry ? 0 : 1; }
  const toSea = distanceTransform(seaMask, size, 200), toLand = distanceTransform(land, size, 200);
  const coast = new Float32Array(size * size);
  for (let i = 0; i < coast.length; i++) coast[i] = land[i] ? toSea[i]! : -toLand[i]!;
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const i = x + z * size, c = coast[i]!;
    if (c <= 0 || c > 14 || water[i]! > 0) continue;
    const beach = 4 + 6 * (0.5 + 0.5 * noise.edge(x / 80, z / 80));
    if (c < beach && ground[i]! < sea + 6) ground[i] = Math.min(ground[i]!, sea + 0.6 + c * 0.35);
  }
  const stacks = placeSeaStacks(plan, ground, coast, size, noise);
  return { size, ground, water, fall, continent, mountain, bed, coast, riverCells, lakeCells, waterfalls, stacks, mere: mereSite };
}

/** Priority-flood (Barnes, Lehman & Mulla 2014) with an epsilon, so filled flats still drain. */
function priorityFill(height: Float32Array, size: number, sea: number): Float32Array {
  const filled = Float32Array.from(height);
  const done = new Uint8Array(size * size);
  // Binary heap of (height, index).
  const heapH = new Float32Array(size * size), heapI = new Int32Array(size * size);
  let count = 0;
  const push = (h: number, i: number) => {
    let k = count++;
    while (k > 0) { const p = (k - 1) >> 1; if (heapH[p]! <= h) break; heapH[k] = heapH[p]!; heapI[k] = heapI[p]!; k = p; }
    heapH[k] = h; heapI[k] = i;
  };
  const pop = (): number => {
    const top = heapI[0]!; const h = heapH[--count]!, i = heapI[count]!;
    let k = 0;
    while (true) {
      let c = 2 * k + 1;
      if (c >= count) break;
      if (c + 1 < count && heapH[c + 1]! < heapH[c]!) c++;
      if (heapH[c]! >= h) break;
      heapH[k] = heapH[c]!; heapI[k] = heapI[c]!; k = c;
    }
    heapH[k] = h; heapI[k] = i;
    return top;
  };
  for (let i = 0; i < size * size; i++) {
    const x = i % size, z = (i / size) | 0;
    if (height[i]! < sea || x === 0 || z === 0 || x === size - 1 || z === size - 1) { done[i] = 1; push(filled[i]!, i); }
  }
  while (count > 0) {
    const i = pop();
    const x = i % size, z = (i / size) | 0;
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const nx = x + ox, nz = z + oz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const n = nx + nz * size;
      if (done[n]) continue;
      done[n] = 1;
      filled[n] = Math.max(filled[n]!, filled[i]! + 0.002);
      push(filled[n]!, n);
    }
  }
  return filled;
}

function placeSeaStacks(plan: GrandPlan, ground: Float32Array, coast: Float32Array, size: number, noise: Noises): number {
  const placed: [number, number][] = [];
  const seed = plan.seed ^ 0x3001;
  for (let attempt = 0; attempt < 4000 && placed.length < plan.seaStacks; attempt++) {
    const x = 8 + Math.floor(hash2(attempt, 1, seed) * (size - 16)), z = 8 + Math.floor(hash2(attempt, 2, seed) * (size - 16));
    const c = coast[x + z * size]!;
    if (c > -10 || c < -34) continue;
    if (placed.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 70 * 70)) continue;
    const [u, v] = toIsland(plan, x, z);
    const theta = Math.atan2(v / plan.radiusV, u / plan.radiusU);
    const nearCliff = Math.abs(angleDelta(theta, plan.cliffCoast.angle)) < plan.cliffCoast.width * 1.3;
    if (!nearCliff && hash2(attempt, 3, seed) > 0.25) continue;
    placed.push([x, z]);
    const radius = 4 + hash2(attempt, 4, seed) * 6, top = plan.seaLevel + 16 + hash2(attempt, 5, seed) * 36;
    const reach = Math.ceil(radius * 1.6);
    for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
      const i = x + dx + (z + dz) * size;
      const d = Math.sqrt(dx * dx + dz * dz) / radius + 0.22 * noise.edge((x + dx) / 6, (z + dz) / 6);
      if (d >= 1.25) continue;
      const profile = d < 0.75 ? 1 - 0.18 * d : (1.25 - d) / 0.5 * 0.86;
      const h = plan.seaLevel - 3 + (top - plan.seaLevel + 3) * profile;
      if (h > ground[i]!) ground[i] = h;
    }
  }
  return placed.length;
}

export { blur };
