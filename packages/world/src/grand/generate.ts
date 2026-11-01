import { planGrandLand, toWorld, type GrandPlan } from './plan';
import { shapeLand } from './terrain';
import { classifyCover } from './cover';
import { placeTrees } from './flora';
import { composeStructures } from './kits';
import { Cover, type GrandLand, type GrandLandSeed, type GrandSites } from './types';

/**
 * One channel's land, whole, from its seed. Pure and deterministic: the same seed gives the same bytes on
 * every machine. Runs in a worker in the client (a few seconds for a 1536² land); a server bake can call
 * the same function and ship the arrays.
 */
export function generateGrandLand(seed: GrandLandSeed, clock: () => number = () => 0): GrandLand {
  const started = clock();
  const plan = planGrandLand(seed);
  const shaped = shapeLand(plan);
  const size = plan.size, n = size * size, sea = plan.seaLevel;
  const ground = new Uint16Array(n), water = new Uint16Array(n), coast = new Int8Array(n);
  let solid = 0, landCells = 0;
  for (let i = 0; i < n; i++) {
    const g = Math.max(1, Math.min(plan.height - 2, Math.round(shaped.ground[i]!)));
    ground[i] = g;
    let w = Math.round(shaped.water[i]!);
    if (g < sea && w < sea) w = sea;
    water[i] = w > g || shaped.fall[i] ? Math.max(w, g) : 0;
    if (shaped.fall[i] && water[i]! <= g) water[i] = 0;
    coast[i] = Math.max(-127, Math.min(127, Math.round(shaped.coast[i]!)));
    solid += g;
    if (g >= sea) landCells++;
  }
  const bed = shaped.bed;
  const { cover, plot, plots, forest } = classifyCover({ plan, ground, water, coast, mountain: shaped.mountain, bed });
  const flora = placeTrees({ plan, ground, water, cover, coast, forest });
  const sites = siteLand(plan, ground, coast, cover, shaped.mere);
  const stats = {
      size, solidVoxels: solid, trees: flora.count, treesBySpecies: flora.bySpecies, riverCells: shaped.riverCells,
      lakeCells: shaped.lakeCells, waterfalls: shaped.waterfalls, fieldPlots: plots.length, seaStacks: shaped.stacks, landCells,
      millis: 0,
  };
  const bare = {
    seed, style: plan.style, size, height: plan.height, seaLevel: sea, snowline: plan.snowline, treeline: plan.treeline, ground, water, cover, plot, plots, coast,
    trees: flora.trees, treeCount: flora.count, sites, stats,
  };
  // The dressing kits compose their pieces on the finished land (see "Dressing kits" in ./types.ts).
  const structures = composeStructures(bare);
  return {
    ...bare, structures: structures.boxes, structureCount: structures.count, structureColours: structures.colours,
    stats: { ...stats, millis: clock() - started },
  };
}

function siteLand(plan: GrandPlan, ground: Uint16Array, coast: Int8Array, cover: Uint8Array, mere: { x: number; z: number; level: number } | null): GrandSites {
  const size = plan.size, sea = plan.seaLevel;
  const [cx, cz] = toWorld(plan, plan.castle.u, plan.castle.v);
  const [tx, tz] = toWorld(plan, plan.town.u, plan.town.v);
  const [fx, fz] = toWorld(plan, plan.fields.u, plan.fields.v);
  // Harbour: march from the town toward the bay until the water.
  const bayDir = toWorld(plan, Math.cos(plan.bay.angle) * plan.radiusU, Math.sin(plan.bay.angle) * plan.radiusV);
  let hx = tx, hz = tz;
  const dx = bayDir[0] - tx, dz = bayDir[1] - tz, len = Math.hypot(dx, dz) || 1;
  for (let step = 0; step < size; step++) {
    const x = Math.round(tx + dx / len * step), z = Math.round(tz + dz / len * step);
    if (x < 1 || z < 1 || x >= size - 1 || z >= size - 1) break;
    hx = x; hz = z;
    if (coast[x + z * size]! <= 0) break;
  }
  const facing = Math.atan2(dz, dx);
  // Headland: the most seaward coast point within reach of the harbour.
  let best = -1e9, headland = { x: hx, z: hz, y: sea + 2 };
  const centre = size / 2;
  for (let z = 2; z < size - 2; z += 2) for (let x = 2; x < size - 2; x += 2) {
    const i = x + z * size, c = coast[i]!;
    if (c < 1 || c > 3 || cover[i] === Cover.lakebed || cover[i] === Cover.riverbed) continue;
    const d = Math.hypot(x - hx, z - hz);
    if (d < 70 || d > 300) continue;
    const out = Math.hypot(x - centre, z - centre) - d * 0.35;
    if (out > best) { best = out; headland = { x, z, y: ground[i]! }; }
  }
  let summit = { x: 0, z: 0, y: 0 };
  for (let i = 0; i < ground.length; i++) if (ground[i]! > summit.y) summit = { x: i % size, z: (i / size) | 0, y: ground[i]! };
  return {
    castle: { x: cx, z: cz, radius: plan.castle.radius, top: Math.round(plan.castle.top) },
    town: { x: tx, z: tz, rx: plan.town.ru, rz: plan.town.rv, angle: plan.rotation, level: Math.round(plan.town.level) },
    harbour: { x: hx, z: hz, facing },
    headland,
    mere: mere ?? null,
    fields: { x: fx, z: fz, radius: plan.fields.radius },
    summit,
    focus: [
      { id: 'castle', x: cx, y: plan.castle.top + 20, z: cz },
      { id: 'town', x: tx, y: plan.town.level, z: tz },
      { id: 'harbour', x: hx, y: sea, z: hz },
      { id: 'summit', x: summit.x, y: summit.y, z: summit.z },
      ...(mere ? [{ id: 'mere', x: mere.x, y: mere.level, z: mere.z }] : []),
    ],
  };
}
