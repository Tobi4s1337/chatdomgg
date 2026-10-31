// SIMULATED harbour headland for the Genesis landmark bench: authored bench ground, a sea basin, the watchtower the
// adapter proposed for the coastal showcase recipe, and a few existing water-place pieces for scale and life. Every
// height and site here is a bench fixture, never a land decision; the tower's real site, turn and ground belong to
// main. Production code never imports this module.
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { createRowingBoat, createUpturnedBoat, ROWING_BOAT } from '../../places/water/boats/index';
import { createCritter, type Critter } from '../../places/water/critters/index';
import { createPebbles, createReeds } from '../../places/water/shore/index';
import { createTree } from '../../core/index';
import { deriveWaterReaches, type WaterReach } from '../../../../world/src/places/water/reaches';
import type { KingdomLandform, LandStream } from '../../../../world/src/kingdom-land/types';
import { proposeGenesisLandmarks, type CathedralSiteProposal, type GenesisLandmarkProposal, type MountainLandmarkProposal, type RiverLandmarkProposal } from '../adapter';
import { CROWN_TOWER_AXIS } from '../crown-tower/crown';
import { Boxes, hash } from '../kit';
import { MAT } from '../../materials';
import { RIVER_HALL, RIVER_HALL_AXIS } from '../river-hall/hall';
import { HARBOUR_TARGET, MOUNTAIN_TARGET, RIVER_TARGET, showcaseFixture } from '../showcase-fixtures';

export const CELL = 0.125;
export interface BenchPlacement { readonly id: string; readonly blueprint: VoxelBlueprint; readonly origin: Vec3; readonly yaw: number; readonly bob?: number }
/** A lantern float on the basin (SIMULATED: a citizen would set it down), drifting slowly from `at`. */
export interface BenchFloat { readonly id: string; readonly critter: Critter; readonly at: readonly [number, number]; readonly drift: readonly [number, number]; readonly yaw: number }
export interface BenchView { readonly eye: Vec3; readonly target: Vec3; readonly fov: number }
export interface HarbourBench {
  readonly proposal: GenesisLandmarkProposal;
  readonly ground: { readonly origin: [number, number]; readonly step: number; readonly width: number; readonly depth: number; readonly data: Float32Array };
  readonly sea: { readonly id: string; readonly x: number; readonly z: number; readonly radiusX: number; readonly radiusZ: number; readonly level: number; readonly depth: number };
  readonly tower: Vec3;
  readonly placements: readonly BenchPlacement[];
  readonly floats: readonly BenchFloat[];
  readonly views: { readonly wide: BenchView; readonly tall: BenchView };
  readonly shadowBounds: { readonly min: Vec3; readonly max: Vec3 };
}

const smooth = (a: number, b: number, t: number) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
const PAD = 1.0;

/** The seaward shore behind the tower, and the quay edge in front of it where the harbour basin begins. */
const quayZ = (x: number) => 12.5 + 0.1 * x;
const shoreZ = (x: number) => -6.4 + (x < -8.5 ? 1.25 * (-8.5 - x) : 0) - (x > 14 ? 0.3 * (x - 14) : 0);

export function land(x: number, z: number): number {
  const d = Math.min(z - shoreZ(x), quayZ(x) - z);
  let h = PAD + 0.55 * smooth(4, 40, d) + 0.06 * Math.sin(x * 0.37 + z * 0.21) + 0.05 * Math.sin(z * 0.29 - x * 0.13);
  // A short rocky drop into the sea, then the shelving sea floor.
  if (d < 1.2) h = d > -3 ? -2.2 + (h + 2.2) * smooth(-3, 1.2, d) : -2.2 - 2.8 * smooth(-3, -26, d);
  // The tower's knoll is level under the plinth, the porch and the steps.
  const pad = Math.max(Math.abs(x) - 6.6, Math.max(-5.2 - z, z - 9.5));
  if (pad < 3) h = h + (PAD - h) * (1 - smooth(0, 3, pad));
  // Two islands off the headland.
  for (const [cx, cz, r, top] of [[-58, -78, 16, 7.5], [26, -92, 10, 4.2], [-12, -118, 7, 3]] as const) {
    const e = Math.hypot(x - cx, z - cz) / r;
    if (e < 1.4) h = Math.max(h, -4 + (top + 4) * Math.pow(Math.max(0, 1 - (e / 1.4) ** 2), 0.7) + 0.4 * Math.sin(x * 0.5 + z * 0.3));
  }
  return h;
}

export function harbourBench(): HarbourBench {
  const { recipe, landscape } = showcaseFixture(HARBOUR_TARGET);
  const proposal = proposeGenesisLandmarks(recipe, landscape)[0]!;
  const tower: Vec3 = [-6, PAD, -5.5];
  const width = 281, depth = 381, origin: [number, number] = [-80, -130], step = 0.5;
  const data = new Float32Array(width * depth);
  for (let k = 0; k < depth; k++) for (let i = 0; i < width; i++) data[i + width * k] = land(origin[0] + i * step, origin[1] + k * step);
  const style = proposal.piece.blueprint.styleId as 'tide';
  const boat = createRowingBoat(style, 0), upturned = createUpturnedBoat(style, 1);
  const at = (x: number, z: number, blueprint: VoxelBlueprint): Vec3 => [x - (blueprint.size[0] * CELL) / 2, land(x, z), z - (blueprint.size[2] * CELL) / 2];
  const reeds = [createReeds(style, 0), createReeds(style, 2)], pebbles = createPebbles(style, 1);
  return {
    proposal, tower,
    ground: { origin, step, width, depth, data },
    sea: { id: 'sea', x: -10, z: -70, radiusX: 280, radiusZ: 240, level: 0, depth: 6 },
    placements: [
      { id: 'tower', blueprint: proposal.piece.blueprint, origin: tower, yaw: 0 },
      { id: 'rowing-boat', blueprint: boat.blueprint, origin: [-3.5, -ROWING_BOAT.draft * CELL, 15.2], yaw: 1.42, bob: 1 },
      { id: 'upturned-boat', blueprint: upturned.blueprint, origin: at(10.5, 7.5, upturned.blueprint), yaw: -0.35 },
      { id: 'reeds-0', blueprint: reeds[0]!.blueprint, origin: at(-12.4, 11.4, reeds[0]!.blueprint), yaw: 0 },
      { id: 'reeds-1', blueprint: reeds[1]!.blueprint, origin: at(15.5, 13.8, reeds[1]!.blueprint), yaw: 0.8 },
      { id: 'pebbles', blueprint: pebbles.blueprint, origin: at(-8.6, 11.2, pebbles.blueprint), yaw: 0 },
    ],
    floats: ([[-7, 22.5, 0.06, 0.012], [-4.2, 27, 0.05, -0.01], [1.2, 30.5, 0.04, 0.015], [5.5, 24.6, 0.07, 0.008], [12.6, 27.4, 0.05, -0.012]] as const)
      .map(([x, z, dx, dz], i) => ({ id: `float-${i}`, critter: createCritter('floater', (i % 3) as 0 | 1 | 2), at: [x, z] as const, drift: [dx, dz] as const, yaw: i * 1.3 })),
    views: {
      wide: { eye: [17, 2.6, 45], target: [-5.5, 13.4, -3], fov: 46 },
      tall: { eye: [8, 2.6, 34], target: [-0.5, 13.5, -2], fov: 62 },
    },
    shadowBounds: { min: [-30, -3, -24], max: [24, 32, 26] },
  };
}

// ── The river valley ─────────────────────────────────────────────────────────────────────────────────────────────

export interface RiverBench {
  readonly proposal: RiverLandmarkProposal;
  readonly ground: HarbourBench['ground'];
  readonly reaches: readonly WaterReach[];
  readonly level: number;
  /** The hall's local origin in bench metres. */
  readonly hall: Vec3;
  readonly placements: readonly BenchPlacement[];
  readonly floats: readonly BenchFloat[];
  /** Chimney mouths, where the bench's smoke rises. */
  readonly chimneys: readonly Vec3[];
  readonly views: { readonly wide: BenchView; readonly tall: BenchView };
  readonly shadowBounds: { readonly min: Vec3; readonly max: Vec3 };
}

/** The bank height the hall is drawn for, above the water at y = 0. */
const BANK = (RIVER_HALL.bank - RIVER_HALL.water) * CELL;
/** The river's centre line: straight through the hall, bending towards the town bank downstream. */
const riverZ = (x: number) => (x > 14 ? 0.0045 * (x - 14) ** 2 : x < -14 ? -0.003 * (x + 14) ** 2 : 0);

export function riverLand(x: number, z: number): number {
  const dz = Math.abs(z - riverZ(x)), side = z > riverZ(x) ? 1 : -1;
  // The channel: a two-metre bed, shelving sides and a short steep bank up to the bank top; downstream of the hall
  // the town bank lies back into a long shingle shore.
  const shore = 2 + (side > 0 ? 11 * smooth(5, 15, x) : 0);
  if (dz < 7 + shore) {
    if (dz < 3.5) return -2;
    if (dz < 7) return -2 + 1.7 * smooth(3.5, 7, dz);
    return -0.3 + (BANK + 0.3) * smooth(7, 7 + shore, dz);
  }
  // Banks: the town side rises gently, the far side climbs to a wooded ridge behind the hall.
  const rise = side > 0 ? 1.3 * smooth(12 + shore, 46, dz) : 6.5 * smooth(14, 70, dz);
  let h = BANK + rise + 0.08 * Math.sin(x * 0.31 + z * 0.17) + 0.06 * Math.sin(z * 0.23 - x * 0.11);
  // Level pads at bank height under both pavilions, their landings and the town steps.
  const pad = Math.max(Math.abs(x) - 6.2, Math.abs(z) - 19.5);
  if (pad < 4) h = h + (BANK - h) * (1 - smooth(0, 4, pad));
  return h;
}

export function riverBench(): RiverBench {
  const { recipe, landscape } = showcaseFixture(RIVER_TARGET);
  const proposal = proposeGenesisLandmarks(recipe, landscape)[0] as RiverLandmarkProposal;
  // The span's middle at the bench origin; the drawn water line at y = 0.
  const hall: Vec3 = [-RIVER_HALL_AXIS.x * CELL, -RIVER_HALL.water * CELL, -RIVER_HALL_AXIS.z * CELL];
  const width = 321, depth = 281, origin: [number, number] = [-90, -80], step = 0.5;
  const data = new Float32Array(width * depth);
  for (let k = 0; k < depth; k++) for (let i = 0; i < width; i++) data[i + width * k] = riverLand(origin[0] + i * step, origin[1] + k * step);
  // A bench course in the land's own records: level through the hall, falling a few centimetres across the bench.
  const stream: LandStream = {
    id: 'river', kind: 'stream', bank: 6,
    points: Array.from({ length: 13 }, (_, i) => {
      const x = -86 + i * 20 - (i === 12 ? 4 : 0);
      return { position: [x, riverZ(x)] as const, bed: -2, level: 0.06 - 0.12 * (i / 12), width: 14 };
    }),
  };
  const landform: KingdomLandform = {
    version: 2, seed: 11, ridge: { origin: [0, -400], bearing: 0, length: 1, width: 1, height: 0 }, castleRise: { centre: [0, -500], radius: 1, height: 0 },
    lake: { x: 0, z: -600, radiusX: 1, radiusZ: 1, level: -50 }, hills: [], waters: [], streams: [stream],
  };
  const style = proposal.piece.blueprint.styleId as 'hearth';
  const at = (x: number, z: number, blueprint: VoxelBlueprint): Vec3 => [x - (blueprint.size[0] * CELL) / 2, riverLand(x, z), z - (blueprint.size[2] * CELL) / 2];
  const boat = createRowingBoat(style, 2), upturned = createUpturnedBoat(style, 0);
  const reeds = ([0, 1, 2, 0] as const).map(v => createReeds(style, v)), pebbles = createPebbles(style, 2);
  const trees = [createTree(0), createTree(2), createTree(1), createTree(0)];
  return {
    proposal, hall, level: 0,
    ground: { origin, step, width, depth, data },
    reaches: deriveWaterReaches(landform),
    placements: [
      { id: 'hall', blueprint: proposal.piece.blueprint, origin: hall, yaw: 0 },
      { id: 'rowing-boat', blueprint: boat.blueprint, origin: [13.5, -ROWING_BOAT.draft * CELL, 5.2], yaw: -0.08, bob: 1 },
      { id: 'upturned-boat', blueprint: upturned.blueprint, origin: at(-15, -12.5, upturned.blueprint), yaw: 0.4 },
      { id: 'reeds-0', blueprint: reeds[0]!.blueprint, origin: at(20.5, 9.6, reeds[0]!.blueprint), yaw: 0 },
      { id: 'reeds-1', blueprint: reeds[1]!.blueprint, origin: at(-13, 8.4, reeds[1]!.blueprint), yaw: 1.1 },
      { id: 'reeds-2', blueprint: reeds[2]!.blueprint, origin: at(11, -8.6, reeds[2]!.blueprint), yaw: 2.2 },
      { id: 'reeds-3', blueprint: reeds[3]!.blueprint, origin: at(27, 12.6, reeds[3]!.blueprint), yaw: 0.5 },
      { id: 'pebbles', blueprint: pebbles.blueprint, origin: at(16.5, 8.2, pebbles.blueprint), yaw: 0 },
      { id: 'tree-0', blueprint: trees[0]!, origin: at(-19, -21, trees[0]!), yaw: 0.3 },
      { id: 'tree-1', blueprint: trees[1]!, origin: at(14, -22, trees[1]!), yaw: 1.2 },
      { id: 'tree-2', blueprint: trees[2]!, origin: at(-26, 15, trees[2]!), yaw: 2.4 },
      { id: 'tree-3', blueprint: trees[3]!, origin: at(-8, 30, trees[3]!), yaw: 0.9 },
    ],
    floats: ([[-3, 1.2, 0.09, 0.004], [6.5, -2.6, 0.1, -0.003], [12, 2.4, 0.08, 0.006], [20, 4.4, 0.07, 0.01], [-11, -1.8, 0.09, 0]] as const)
      .map(([x, z, dx, dz], i) => ({ id: `float-${i}`, critter: createCritter('floater', (i % 3) as 0 | 1 | 2), at: [x, z] as const, drift: [dx, dz] as const, yaw: i * 1.7 })),
    chimneys: [[2.625, 16.3, 9.5], [2.625, 16.3, -9.5]],
    views: {
      // From the town bank downstream, over the shingle: the river leading in under the arches, the town front turned
      // towards the eye.
      wide: { eye: [31, 6.4, 25.5], target: [-1, 6.6, 0], fov: 46 },
      tall: { eye: [24, 6.4, 27.5], target: [-1, 9, 0], fov: 66 },
    },
    shadowBounds: { min: [-36, -3, -34], max: [36, 26, 36] },
  };
}

// ── The mountain pass ────────────────────────────────────────────────────────────────────────────────────────────

export interface MountainBench {
  readonly proposal: MountainLandmarkProposal;
  /** The city's reserved cathedral site, set out on the meadow below the terrace (SIMULATED arrangement). */
  readonly site: CathedralSiteProposal;
  readonly ground: HarbourBench['ground'];
  /** A still tarn below the terrace. */
  readonly tarn: HarbourBench['sea'];
  /** The tower's local origin in bench metres. */
  readonly tower: Vec3;
  readonly placements: readonly BenchPlacement[];
  readonly floats: readonly BenchFloat[];
  readonly views: { readonly wide: BenchView; readonly tall: BenchView };
  readonly shadowBounds: { readonly min: Vec3; readonly max: Vec3 };
}

const PASS = 2;
const TARN = { x: 21, z: -4, radiusX: 7.5, radiusZ: 5, level: PASS - 0.3 } as const;
/** The reserve's corner on the meadow (bench metres); unturned, so its west front faces the town and the eye. */
const SITE = { x: -36, z: -2, width: 24, depth: 32 } as const;

export function mountainLand(x: number, z: number): number {
  // The pass climbs gently from the town (+Z) to the saddle behind the tower, then falls away; the ridges rise
  // steeply either side, with a broken skyline of crags and two far peaks beyond the saddle.
  // The town side settles a little below the terrace but never under the tarn's water line.
  const along = z > 20 ? -0.4 * smooth(20, 60, z) : z < -26 ? 0.05 * (z + 26) : 0;
  const d = Math.abs(x + 0.08 * z);
  const ridge = 32 * smooth(16, 74, d) + 8 * smooth(60, 120, d) + 3.5 * Math.sin(z * 0.045 + x * 0.02) * smooth(20, 60, d);
  let h = PASS + along + ridge + 0.12 * Math.sin(x * 0.27 + z * 0.19) + 0.1 * Math.sin(z * 0.31 - x * 0.17);
  for (const [cx, cz, r, top] of [[-70, -96, 56, 44], [55, -104, 62, 46], [-5, -116, 46, 40]] as const) {
    const e = Math.hypot(x - cx, z - cz) / r;
    if (e < 1) h = Math.max(h, top * Math.pow(1 - e * e, 1.4));
  }
  // The terrace's level pad, and the meadow the cathedral reserve is set out on.
  const pad = Math.max(Math.abs(x) - 9, Math.max(-7 - z, z - 21));
  if (pad < 4) h = h + (PASS - h) * (1 - smooth(0, 4, pad));
  const meadow = Math.max(Math.abs(x - SITE.x - SITE.width / 2) - SITE.width / 2, Math.abs(z - SITE.z - SITE.depth / 2) - SITE.depth / 2);
  if (meadow < 6) h = h + (PASS - 0.2 - h) * (1 - smooth(0, 6, meadow));
  // The tarn's bowl.
  const e = Math.hypot((x - TARN.x) / TARN.radiusX, (z - TARN.z) / TARN.radiusZ);
  // A shallow bowl whose rim meets the water at the outline, so the tarn reads from the town road.
  // Blending into whatever stands round it keeps the bowl's edge soft where the ridge starts to climb.
  if (e < 1.3) h = Math.min(h, TARN.level - 1.2 + (Math.min(h, PASS + 0.6) - TARN.level + 1.2) * smooth(0.5, 1.2, e) + Math.max(0, h - PASS - 0.6) * smooth(1, 1.3, e));
  return h;
}

/** A bench pine: a dark trunk under five stepped tiers of needles. SIMULATED scenery, never content. */
function pine(variant: number): VoxelBlueprint {
  const b = new Boxes(), tall = 72 + variant * 10, c = 14;
  b.add(c - 1, 0, c - 1, c + 1, tall - 6, c + 1, MAT.bark);
  for (let t = 0; t < 5; t++) {
    const y0 = 12 + t * Math.floor((tall - 18) / 5), span = Math.floor((tall - 18) / 5) + 6, wide = 13 - t * 2;
    for (let k = 0; k < span; k += 2) {
      const half = Math.max(1, Math.round(wide * (1 - k / span)));
      b.octagon(c, c, half, Math.round(half * 0.4), y0 + k, y0 + k + 2, (t + k) % 5 === 3 ? MAT.moss : MAT.leaf);
    }
  }
  b.octagon(c, c, 2, 0, tall - 6, tall, MAT.leaf);
  return { version: 1, id: `bench-pine-${variant}`, styleId: 'hearth' as VoxelBlueprint['styleId'], kind: 'flora', lattice: 'build', size: [28, tall, 28], boxes: b.list, windows: [] };
}

/** A bench crag: stacked, overhanging blocks of grey and dark stone with moss on their tops. SIMULATED scenery. */
/** A 3 m × 4 m run of worn flagstones for the road up from the town; grass shows in the joints. */
function flagstones(variant: number): VoxelBlueprint {
  const b = new Boxes();
  for (let z = 0; z < 32;) {
    const d = 5 + Math.floor(hash(z, 1, variant, 96) * 4);
    for (let x = Math.floor(hash(z, 2, variant, 96) * 3); x < 24;) {
      const w = 4 + Math.floor(hash(x, z, variant, 95) * 5), m = hash(x, z, variant, 94) < 0.3 ? MAT.darkStone : MAT.stone;
      if (hash(x, z, variant, 93) > 0.08) b.add(x, 0, z, Math.min(24, x + w), 2, Math.min(32, z + d - 1), m);
      x += w + 1;
    }
    z += d;
  }
  return { version: 1, id: `bench-flagstones-${variant}`, styleId: 'hearth' as VoxelBlueprint['styleId'], kind: 'flora', lattice: 'build', size: [24, 2, 32], boxes: b.list, windows: [] };
}

function crag(variant: number): VoxelBlueprint {
  const b = new Boxes(), size = 48;
  for (let i = 0; i < 16; i++) {
    const w = 10 + Math.floor(hash(i, 1, variant, 97) * 16), d = 10 + Math.floor(hash(i, 2, variant, 97) * 16);
    const x = Math.floor(hash(i, 3, variant, 97) * (size - w)), z = Math.floor(hash(i, 4, variant, 97) * (size - d));
    const y = Math.floor(i / 5) * 4, h = 6 + Math.floor(hash(i, 5, variant, 97) * 8);
    const m = i % 4 ? MAT.darkStone : MAT.stone;
    b.add(x, 0, z, x + w, y + h, z + d, m);
    b.add(x + 1, y + h, z + 1, x + w - 1, y + h + 1, z + d - 1, i % 3 ? MAT.moss : MAT.grass);
  }
  return { version: 1, id: `bench-crag-${variant}`, styleId: 'hearth' as VoxelBlueprint['styleId'], kind: 'flora', lattice: 'build', size: [size, 32, size], boxes: b.list, windows: [] };
}

export function mountainBench(): MountainBench {
  const { recipe, landscape } = showcaseFixture(MOUNTAIN_TARGET);
  const proposals = proposeGenesisLandmarks(recipe, landscape);
  const proposal = proposals.find(p => p.showcase === 'crown-tower') as MountainLandmarkProposal;
  const site = proposals.find(p => p.showcase === 'cathedral-site') as CathedralSiteProposal;
  const tower: Vec3 = [-CROWN_TOWER_AXIS.x * CELL, PASS, -CROWN_TOWER_AXIS.z * CELL];
  // The ground mesher's volume budget bounds the grid's reach and its height range together.
  const width = 361, depth = 371, origin: [number, number] = [-100, -125], step = 0.5;
  const data = new Float32Array(width * depth);
  for (let k = 0; k < depth; k++) for (let i = 0; i < width; i++) data[i + width * k] = mountainLand(origin[0] + i * step, origin[1] + k * step);
  const at = (x: number, z: number, blueprint: VoxelBlueprint): Vec3 => [x - (blueprint.size[0] * CELL) / 2, mountainLand(x, z) - 0.15, z - (blueprint.size[2] * CELL) / 2];
  const pines = [pine(0), pine(1), pine(2)], crags = [crag(0), crag(1), crag(2)];
  const placements: BenchPlacement[] = [{ id: 'tower', blueprint: proposal.piece.blueprint, origin: tower, yaw: 0 }];
  placements.push({ id: 'cathedral-site', blueprint: site.piece.blueprint, origin: [SITE.x, PASS - 0.2, SITE.z], yaw: 0 });
  // Pines climbing both flanks of the pass in loose stands, kept off the terrace, the reserve and the tarn.
  const clear = (x: number, z: number) => (Math.abs(x) < 13 && z > -12 && z < 26)
    || (x > SITE.x - 3 && x < SITE.x + SITE.width + 3 && z > SITE.z - 3 && z < SITE.z + SITE.depth + 3)
    || Math.hypot((x - TARN.x) / (TARN.radiusX + 3), (z - TARN.z) / (TARN.radiusZ + 3)) < 1 || z > 52
    // and out of the line from the town road to the tarn, so the water stays in view.
    || (x > 6 && x < 30 && z > TARN.z && z < 52);
  for (let i = 0, n = 0; i < 140 && n < 46; i++) {
    const side = i % 2 ? 1 : -1, x = side * (15 + hash(i, 1, 0, 98) * 60), z = -70 + hash(i, 2, 0, 98) * 118;
    if (clear(x, z) || hash(i, 3, 0, 98) > 0.35 + 0.65 * smooth(70, 18, Math.abs(x))) continue;
    const v = Math.floor(hash(i, 4, 0, 98) * 3);
    placements.push({ id: `pine-${n++}`, blueprint: pines[v]!, origin: at(x, z, pines[v]!), yaw: hash(i, 5, 0, 98) * 6.28 });
  }
  for (const [i, [x, z, v, yawed]] of ([[-40, -14, 0, 0.4], [33, 2, 1, 1.3], [-44, -46, 2, 2.2], [46, -36, 0, 0.9], [24, -50, 1, 2.8], [-58, -4, 2, 0.2], [52, 14, 1, 1.9], [-24, -40, 0, 0.7]] as const).entries()) {
    // Seat each outcrop on the lowest ground under it, so the downhill face never hangs over the slope.
    const [ox, , oz] = at(x, z, crags[v]!), span = crags[v]!.size[0] * CELL;
    let low = Infinity;
    for (let u = 0; u <= 4; u++) for (let w = 0; w <= 4; w++) low = Math.min(low, mountainLand(ox + (span * u) / 4, oz + (span * w) / 4));
    placements.push({ id: `crag-${i}`, blueprint: crags[v]!, origin: [ox, low - 0.3, oz], yaw: yawed });
  }
  // The road up from the town: flagstone runs from the foot of the steps down the meadow towards the eye.
  const flags = [flagstones(0), flagstones(1), flagstones(2)];
  for (let i = 0; i < 7; i++) {
    const z = 28 + i * 4, x = -1.5 + Math.sin(i * 0.7) * 1.2;
    placements.push({ id: `road-${i}`, blueprint: flags[i % 3]!, origin: [x, mountainLand(x + 1.5, z + 2) - 0.12, z], yaw: 0 });
  }
  // Boulders and a few small outcrops either side of the road give the near meadow its scale.
  for (const [i, [x, z, v, yawed]] of ([[-50, 44, 1, 0.3], [9, 46, 2, 1.1], [-46, 34, 0, 2.4], [12, 36, 0, 0.6]] as const).entries()) {
    placements.push({ id: `boulder-${i}`, blueprint: crags[v]!, origin: at(x, z, crags[v]!), yaw: yawed });
  }
  const style = proposal.piece.blueprint.styleId as 'hearth';
  const reeds = [createReeds(style, 0), createReeds(style, 1), createReeds(style, 2)], pebbles = createPebbles(style, 0);
  for (const [i, [x, z]] of ([[TARN.x - 9.5, TARN.z - 1], [TARN.x + 8, TARN.z + 3.5], [TARN.x - 4, TARN.z + 5.6]] as const).entries()) placements.push({ id: `reeds-${i}`, blueprint: reeds[i]!.blueprint, origin: at(x, z, reeds[i]!.blueprint), yaw: i * 1.4 });
  placements.push({ id: 'pebbles', blueprint: pebbles.blueprint, origin: at(TARN.x - 8, TARN.z + 3.5, pebbles.blueprint), yaw: 0.6 });
  placements.push({ id: 'pebbles-road', blueprint: pebbles.blueprint, origin: at(-5.5, 30.5, pebbles.blueprint), yaw: 2.1 });
  return {
    proposal, site, tower, placements,
    floats: ([[TARN.x - 4, TARN.z - 1, 0.012, 0.004], [TARN.x + 2, TARN.z + 1.5, -0.01, 0.003], [TARN.x + 5, TARN.z - 1.4, 0.008, -0.004]] as const)
      .map(([x, z, dx, dz], i) => ({ id: `float-${i}`, critter: createCritter('floater', i as 0 | 1 | 2), at: [x, z] as const, drift: [dx, dz] as const, yaw: i * 1.9 })),
    ground: { origin, step, width, depth, data },
    tarn: { id: 'tarn', x: TARN.x, z: TARN.z, radiusX: TARN.radiusX, radiusZ: TARN.radiusZ, level: TARN.level, depth: 1.6 },
    views: {
      // From the town side of the pass, low across the tarn: the board and its rook lanterns leading to the door,
      // the king rising against the saddle, the reserve's foundation stone and lantern at the left.
      wide: { eye: [17, 14, 54], target: [-6, 13.5, 4], fov: 46 },
      tall: { eye: [8, 12, 50], target: [-4, 15, 2], fov: 66 },
    },
    shadowBounds: { min: [-64, -4, -48], max: [68, 40, 60] },
  };
}

