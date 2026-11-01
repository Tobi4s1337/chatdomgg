import { cellular, hash2, mix32, smoothstep } from './noise';
import { toWorld, type GrandPlan } from './plan';
import { slopeAt } from './cover';
import { Cover, TREE_SPECIES, TREE_STRIDE, type TreeSpecies } from './types';
import { GRAND_KITS } from './kits';

export interface FloraInput {
  readonly plan: GrandPlan;
  readonly ground: Uint16Array;
  readonly water: Uint16Array;
  readonly cover: Uint8Array;
  readonly coast: Int8Array;
  readonly forest: Float32Array;
}

/**
 * Trees from a grove map, not a sprinkle. A low-frequency cellular map gives each grove a dominant species
 * (the "patches of autumn" of the reference), blended with neighbours; altitude and water override it.
 * Placement is dart throwing over a shuffled jittered grid with a variable radius (a Poisson-disk
 * approximation after Bridson 2007): dense in woodland, open in parkland, a few lone trees in meadows.
 */
export function placeTrees(input: FloraInput): { trees: Float32Array; count: number; bySpecies: Record<string, number> } {
  const { plan, ground, water, cover, coast, forest } = input;
  const size = plan.size, sea = plan.seaLevel, seed = plan.seed ^ 0x5001;
  const weights = Object.entries(plan.groves) as [TreeSpecies, number][];
  const totalWeight = weights.reduce((sum, [, w]) => sum + w, 0);
  const lowland = weights.filter(([s]) => s !== 'pine' && s !== 'spruce');
  const lowlandWeight = lowland.reduce((sum, [, w]) => sum + w, 0);
  const pickWeighted = (h: number, table: readonly [TreeSpecies, number][], total: number): TreeSpecies => {
    let t = h * total;
    for (const [species, w] of table) { t -= w; if (t <= 0) return species; }
    return table[0]![0];
  };
  const cell = 4, gw = Math.ceil(size / cell);
  const order = new Int32Array(gw * gw);
  for (let i = 0; i < order.length; i++) order[i] = i;
  for (let i = order.length - 1; i > 0; i--) { const j = mix32(i ^ seed) % (i + 1); const t = order[i]!; order[i] = order[j]!; order[j] = t; }
  // Spatial hash of accepted trees: buckets of 16 columns.
  const bucket = 16, bw = Math.ceil(size / bucket);
  const buckets: number[][] = Array.from({ length: bw * bw }, () => []);
  const xs: number[] = [], zs: number[] = [], rs: number[] = [], out: number[] = [];
  const bySpecies: Record<string, number> = {};
  const fits = (x: number, z: number, radius: number) => {
    const reach = Math.ceil((radius + 12) / bucket);
    const bx = Math.floor(x / bucket), bz = Math.floor(z / bucket);
    for (let oz = -reach; oz <= reach; oz++) for (let ox = -reach; ox <= reach; ox++) {
      const nx = bx + ox, nz = bz + oz;
      if (nx < 0 || nz < 0 || nx >= bw || nz >= bw) continue;
      for (const t of buckets[nx + nz * bw]!) {
        // Crowns may interlock a little: a wood reads as one canopy with gaps, not a grid of balls.
        const min = Math.max(radius, rs[t]!) * 0.8;
        if ((xs[t]! - x) ** 2 + (zs[t]! - z) ** 2 < min * min) return false;
      }
    }
    return true;
  };
  const add = (x: number, z: number, species: TreeSpecies, scale: number, radius: number) => {
    const index = xs.length;
    xs.push(x); zs.push(z); rs.push(radius);
    buckets[Math.floor(x / bucket) + Math.floor(z / bucket) * bw]!.push(index);
    out.push(x, z, ground[x + z * size]!, TREE_SPECIES.indexOf(species), mix32(x * 73856093 ^ z * 19349663 ^ seed) >>> 8, scale);
    bySpecies[species] = (bySpecies[species] ?? 0) + 1;
  };
  // Hero trees first, on open ground with a view: near the town's edge or the castle approach.
  const town = toWorld(plan, plan.town.u, plan.town.v), castle = toWorld(plan, plan.castle.u, plan.castle.v);
  const heroes: TreeSpecies[] = ['hero-gold', plan.style.grass === 'highland' ? 'hero-teal' : 'hero-cherry', 'hero-teal'];
  let heroPlaced = 0;
  for (let attempt = 0; attempt < 3000 && heroPlaced < plan.heroTrees; attempt++) {
    const a = hash2(attempt, 11, seed) * Math.PI * 2, d = 1.15 + hash2(attempt, 12, seed) * 0.6;
    const x = Math.round(town[0] + Math.cos(a) * plan.town.ru * d), z = Math.round(town[1] + Math.sin(a) * plan.town.rv * d * 1.2);
    if (x < 40 || z < 40 || x >= size - 40 || z >= size - 40) continue;
    const i = x + z * size, k = cover[i]!;
    if ((k !== Cover.grass && k !== Cover.meadow && k !== Cover.forest) || slopeAt(ground, size, x, z) > 0.6 || coast[i]! < 18) continue;
    if ((x - castle[0]) ** 2 + (z - castle[1]) ** 2 < (plan.castle.radius * 1.5) ** 2) continue;
    const species = heroes[heroPlaced]!;
    const radius = GRAND_KITS.trees.extent(species, 1).radius;
    if (!fits(x, z, radius * 1.6)) continue;
    add(x, z, species, 1, radius * 0.95);
    heroPlaced++;
  }
  for (const g of order) {
    const gx = g % gw, gz = (g / gw) | 0;
    const x = Math.min(size - 3, Math.max(2, gx * cell + Math.floor(hash2(gx, gz, seed) * cell)));
    const z = Math.min(size - 3, Math.max(2, gz * cell + Math.floor(hash2(gz, gx, seed ^ 0x77) * cell)));
    const i = x + z * size, k = cover[i]!, y = ground[i]!;
    if (water[i]! > y || y <= sea + 1) continue;
    if (k === Cover.sea || k === Cover.sand || k === Cover.shingle || k === Cover.rock || k === Cover.snow || k === Cover.field
      || k === Cover.reserved || k === Cover.riverbed || k === Cover.lakebed || k === Cover.hedge) continue;
    const slope = slopeAt(ground, size, x, z);
    if (slope > (k === Cover.scree ? 1.1 : 1.25)) continue;
    const density = forest[i]!;
    // Probability and spacing by ground: woodland dense, parkland open, meadows rare.
    let chance: number, spacing: number;
    if (k === Cover.forest || density > 0.52) { chance = 0.92; spacing = 1.0; }
    else if (k === Cover.scree) { chance = 0.22; spacing = 1.4; }
    else if (k === Cover.meadow) { chance = 0.05 + density * 0.2; spacing = 2.6; }
    else { chance = 0.09 + density * 0.45; spacing = 2.0; }
    if (hash2(x, z, seed ^ 0x99) > chance) continue;
    // Species: altitude first, then water's edge, then the grove.
    let species: TreeSpecies;
    const alpine = smoothstep(plan.treeline - 70, plan.treeline - 15, y);
    const h = hash2(x, z, seed ^ 0x123);
    if (alpine > h) species = y > plan.treeline - 30 || h < 0.5 ? 'spruce' : 'pine';
    else if (coast[i]! < 30 && coast[i]! > 4 && h < 0.08 && plan.groves.pine) species = 'pine';
    else if (nearWater(water, ground, size, x, z, 9) && h < 0.42) species = 'willow';
    else {
      const grove = cellular(x / 95, z / 95, seed ^ 0x456);
      const blend = hash2(x >> 3, z >> 3, seed ^ 0x789) < 0.2;
      const groveHash = ((blend ? mix32(grove.id ^ 0xabcdef) : grove.id) >>> 0) / 4294967296;
      species = pickWeighted(groveHash, lowland.length ? lowland : weights, lowland.length ? lowlandWeight : totalWeight);
      if (k === Cover.meadow && h < 0.3) species = 'shrub';
      if (density < 0.3 && h < 0.18) species = 'shrub';
    }
    const scale = 0.78 + hash2(z, x, seed ^ 0x321) * 0.42 + (density > 0.8 ? 0.12 : 0);
    const radius = Math.max(3, GRAND_KITS.trees.extent(species, scale).radius * spacing * 0.95);
    if (!fits(x, z, radius)) continue;
    add(x, z, species, scale, radius);
  }
  return { trees: Float32Array.from(out), count: xs.length, bySpecies };
}

function nearWater(water: Uint16Array, ground: Uint16Array, size: number, x: number, z: number, reach: number): boolean {
  for (let dz = -reach; dz <= reach; dz += 3) for (let dx = -reach; dx <= reach; dx += 3) {
    const nx = x + dx, nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
    const i = nx + nz * size;
    if (water[i]! > ground[i]!) return true;
  }
  return false;
}

export { TREE_STRIDE };
