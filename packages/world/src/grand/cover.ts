import { M } from './palette';
import { fbm, hash2, simplex2, smoothstep } from './noise';
import { toWorld, type GrandPlan } from './plan';
import { Cover, type FieldPlot } from './types';

export interface CoverInput {
  readonly plan: GrandPlan;
  readonly ground: Uint16Array;
  readonly water: Uint16Array;
  readonly coast: Int8Array;
  readonly mountain: Float32Array;
  readonly bed: Uint8Array;
}

export interface CoverResult {
  readonly cover: Uint8Array;
  readonly plot: Uint16Array;
  readonly plots: FieldPlot[];
  /** 0..1 forest density used by flora placement. */
  readonly forest: Float32Array;
}

export function slopeAt(ground: Uint16Array, size: number, x: number, z: number): number {
  const xa = Math.max(0, x - 1), xb = Math.min(size - 1, x + 1), za = Math.max(0, z - 1), zb = Math.min(size - 1, z + 1);
  return Math.max(Math.abs(ground[xb + z * size]! - ground[xa + z * size]!), Math.abs(ground[x + zb * size]! - ground[x + za * size]!)) / 2;
}

/** Crops weighted per biome: lavender and wheat carry the patchwork, ploughed earth breaks it. */
function cropTable(plan: GrandPlan): readonly (readonly [number, number])[] {
  const c = M.crop;
  return [[c.wheat, 3], [c.wheatPale, 1.2], [c.lavender, plan.style.grass === 'highland' ? 0.6 : 2], [c.rapeseed, 1.2], [c.ploughed, 1.4],
    [c.cabbage, 0.9], [c.barley, 1], [c.sunflower, 0.6], [c.hay, 0.8], [c.flax, 0.4], [c.pumpkin, 0.35]];
}

export function classifyCover(input: CoverInput): CoverResult {
  const { plan, ground, water, coast, mountain, bed } = input;
  const size = plan.size, sea = plan.seaLevel, seed = plan.seed;
  const n1 = simplex2(seed ^ 0x4001), n2 = simplex2(seed ^ 0x4002), n3 = simplex2(seed ^ 0x4003);
  const cover = new Uint8Array(size * size);
  const forest = new Float32Array(size * size);
  const castle = toWorld(plan, plan.castle.u, plan.castle.v), town = toWorld(plan, plan.town.u, plan.town.v);
  const forestCentre = toWorld(plan, plan.forest.u, plan.forest.v), fieldsCentre = toWorld(plan, plan.fields.u, plan.fields.v);
  const cos = Math.cos(plan.rotation), sin = Math.sin(plan.rotation);
  const townWeight = (x: number, z: number) => {
    const dx = x - town[0], dz = z - town[1];
    const lu = (dx * cos + dz * sin) / plan.town.ru, lv = (-dx * sin + dz * cos) / plan.town.rv;
    return Math.sqrt(lu * lu + lv * lv);
  };
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const i = x + z * size, y = ground[i]!, w = water[i]!;
    if (y < sea && w <= sea) { cover[i] = Cover.sea; continue; }
    if (w > y) { cover[i] = bed[i] === 1 ? Cover.lakebed : Cover.riverbed; continue; }
    const slope = slopeAt(ground, size, x, z);
    const jitter = n1(x / 60, z / 60);
    const mt = mountain[i]!;
    if (y > plan.snowline + 16 * jitter && slope < 2.4) { cover[i] = Cover.snow; continue; }
    if (slope > 1.35 + 0.35 * jitter || (mt > 0.55 && y > plan.treeline + 18 * n2(x / 50, z / 50) && slope > 0.55)) { cover[i] = Cover.rock; continue; }
    if (mt > 0.4 && y > plan.treeline - 12 && slope > 0.7) { cover[i] = Cover.scree; continue; }
    const c = coast[i]!;
    const beach = 3 + 6 * (0.5 + 0.5 * n3(x / 80, z / 80));
    if (c > 0 && c <= beach && y <= sea + 4) { cover[i] = n3(x / 30, z / 30) > 0.45 || slope > 0.8 ? Cover.shingle : Cover.sand; continue; }
    const dcx = x - castle[0], dcz = z - castle[1];
    if (dcx * dcx + dcz * dcz < (plan.castle.radius * 0.86) ** 2 && y >= plan.castle.top - 2) { cover[i] = Cover.reserved; continue; }
    if (townWeight(x, z) < 0.95) { cover[i] = Cover.reserved; continue; }
    // Forest density: the plan's woodland, foothill forests below the treeline, and groves elsewhere.
    const fdx = x - forestCentre[0], fdz = z - forestCentre[1];
    const zone = 1 - smoothstep(0.55, 1.15, Math.sqrt(fdx * fdx + fdz * fdz) / plan.forest.radius + 0.25 * n2(x / 90, z / 90));
    const foothill = smoothstep(0.12, 0.35, mt) * (1 - smoothstep(plan.treeline - 30, plan.treeline + 10, y));
    // Groves are woods with edges, not scattered trees: a broad band of the noise becomes forest.
    const groves = smoothstep(0.02, 0.4, fbm(n2, x / 170, z / 170, 3) + 0.15);
    let density = Math.max(zone * plan.forest.density, foothill * 0.95, groves * 0.8);
    if (townWeight(x, z) < 1.25) density *= smoothstep(0.95, 1.25, townWeight(x, z));
    const fcx = x - fieldsCentre[0], fcz = z - fieldsCentre[1];
    if (fcx * fcx + fcz * fcz < (plan.fields.radius * 1.05) ** 2) density *= 0.15;
    forest[i] = density;
    if (density > 0.52) { cover[i] = Cover.forest; continue; }
    const meadow = fbm(n1, x / 130 + 40, z / 130 - 20, 3);
    cover[i] = meadow > 0.18 ? Cover.meadow : Cover.grass;
  }
  // Patchwork fields: recursive splits of the zone's bounding square into plots on gentle land.
  const plots: FieldPlot[] = [];
  const plot = new Uint16Array(size * size);
  const crops = cropTable(plan);
  const total = crops.reduce((sum, [, weight]) => sum + weight, 0);
  const pickCrop = (h: number) => { let t = h * total; for (const [crop, weight] of crops) { t -= weight; if (t <= 0) return crop; } return crops[0]![0]; };
  const r = plan.fields.radius;
  const split = (x0: number, z0: number, x1: number, z1: number, depth: number) => {
    const w = x1 - x0, d = z1 - z0;
    const h = hash2(x0 * 7 + depth, z0 * 13 + x1, seed ^ 0x4100);
    if ((w > 64 || d > 64 || (w > 30 && d > 30 && h < 0.7)) && depth < 9) {
      if (w >= d) { const cut = x0 + Math.round(w * (0.35 + 0.3 * h)); split(x0, z0, cut, z1, depth + 1); split(cut, z0, x1, z1, depth + 1); }
      else { const cut = z0 + Math.round(d * (0.35 + 0.3 * h)); split(x0, z0, x1, cut, depth + 1); split(x0, cut, x1, z1, depth + 1); }
      return;
    }
    // A plot: gentle, dry, inside the zone, clear of the town and rock.
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const dr = Math.hypot(cx - fieldsCentre[0], cz - fieldsCentre[1]) / r + 0.2 * n3(cx / 60, cz / 60);
    if (dr > 1.05) return;
    let good = 0, count = 0, lo = 1e9, hi = -1e9;
    for (let z = z0 + 1; z < z1 - 1; z += 2) for (let x = x0 + 1; x < x1 - 1; x += 2) {
      count++;
      const i = x + z * size, k = cover[i]!;
      if (k === Cover.grass || k === Cover.meadow || k === Cover.forest) good++;
      lo = Math.min(lo, ground[i]!); hi = Math.max(hi, ground[i]!);
    }
    if (count === 0 || good / count < 0.92 || hi - lo > Math.max(6, (w + d) * 0.07)) return;
    const crop = pickCrop(hash2(x0, z0, seed ^ 0x4200));
    plots.push({ x0: x0 + 1, z0: z0 + 1, x1: x1 - 1, z1: z1 - 1, crop, rows: hash2(z0, x0, seed ^ 0x4300) < 0.5 ? 0 : 1 });
  };
  const bx0 = Math.max(8, Math.floor(fieldsCentre[0] - r)), bz0 = Math.max(8, Math.floor(fieldsCentre[1] - r));
  const bx1 = Math.min(size - 8, Math.ceil(fieldsCentre[0] + r)), bz1 = Math.min(size - 8, Math.ceil(fieldsCentre[1] + r));
  if (bx1 - bx0 > 40 && bz1 - bz0 > 40) split(bx0, bz0, bx1, bz1, 0);
  plots.forEach((p, index) => {
    // Hedgerows on the north and west edges of each plot, broken by gates.
    for (let z = p.z0 - 1; z <= p.z1; z++) for (let x = p.x0 - 1; x <= p.x1; x++) {
      const i = x + z * size;
      if (cover[i] !== Cover.grass && cover[i] !== Cover.meadow && cover[i] !== Cover.forest) continue;
      const edge = x === p.x0 - 1 || z === p.z0 - 1;
      if (x >= p.x0 && z >= p.z0 && x < p.x1 && z < p.z1) { cover[i] = Cover.field; plot[i] = index + 1; forest[i] = 0; }
      else if (edge && hash2(Math.floor(x / 9), Math.floor(z / 9), seed ^ 0x4400) > 0.28) { cover[i] = Cover.hedge; forest[i] = 0; }
    }
  });
  return { cover, plot, plots, forest };
}
