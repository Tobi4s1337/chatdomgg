import { HOME_DEPTH_METRES, type HomeTier, type Vec3 } from '@chatdom/shared';
import { currentFootprint, homeFrame, seedHash, transformCardinalPoint, type CardinalTurn, type SettlementHome, type SettlementPlan, type XZ } from '@chatdom/world';
import { sampleGenesisSurface, type ChannelKingdomRecipe, type DeepReadonly, type GenesisLandscape } from '@chatdom/world/genesis';
import { RIVER_HALL, RIVER_HALL_AXIS, RIVER_HALL_SIZE } from '@chatdom/content/genesis-landmarks';

/**
 * PinkKittyRose's river town: the same land, castle and capacity as every potential town, laid out as a town that
 * grew along its river. The hall carries the road across the water, the market opens at its landing, Old Row climbs
 * to the castle gate and the lanes wind with the river and the meadow rather than running in columns.
 *
 * Slots are technical addresses for potential homes, never people, deeds or follow tenure. Nothing here is adopted.
 */

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
type Street = SettlementPlan['streets'][number];
type Node = SettlementPlan['nodes'][number];
type Square = SettlementPlan['market'];

const CELL = 0.125;
const half = (n: number): number => Math.round(n * 2) / 2;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const overlap = (a: Bounds, b: Bounds, gap = 0): boolean => a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;
const grow = (b: Bounds, d: number): Bounds => ({ minX: b.minX - d, maxX: b.maxX + d, minZ: b.minZ - d, maxZ: b.maxZ + d });
const boundsOf = (points: readonly XZ[]): Bounds => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  return { minX, maxX, minZ, maxZ };
};
const rectDistance = (b: Bounds, x: number, z: number): number => {
  const dx = Math.max(b.minX - x, 0, x - b.maxX), dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return dx || dz ? Math.hypot(dx, dz) : -Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
};

/** Where the river hall stands: the centre of its span on the river's centre line, and the hall's measured planes. */
export interface HallSite {
  /** World metres: the middle of the centre arch on the river's centre line. */
  readonly centre: XZ;
  /** The quarter turn that carries the hall's local +Z (its door) to world +X, the town bank. */
  readonly turn: CardinalTurn;
  /** The hall's y = 0 (the bed its piers stand on), chosen so its drawn water line meets the river's. */
  readonly base: number;
  readonly waterLevel: number;
  /** The hall's corner placement origin in world metres. */
  readonly origin: Vec3;
  /** Occupied ground of the hall and its steps, in world metres. */
  readonly bounds: Bounds;
  /** The bank height at both abutments, in world metres. */
  readonly bank: number;
}

/**
 * The tavern's measured ground, in metres: width across its front, depth from back wall to porch, the jetty's run out
 * from the back wall, and the jetty's span across the front, from the footprint's middle along the tavern's local x.
 */
export interface TavernShape {
  readonly width: number;
  readonly depth: number;
  readonly jetty: number;
  readonly jettyAcross: readonly [number, number];
  /** The inn-frame point (cells, X and Z) that stands on the site's `back`, and the inn frame's floor (cells). */
  readonly anchor: readonly [number, number];
  readonly floor: number;
  /** The levee steps the inn can raise: rise limits (cells) and, per rise and direction, their ground and foot. */
  readonly steps: {
    readonly rise: { readonly min: number; readonly max: number };
    plan(rise: number, toward: -1 | 1): { readonly footprint: readonly [number, number, number, number]; readonly foot: Vec3 };
  };
}

/** The steps down from the inn's terrace to the meadow, as the town chose them. */
export interface TavernStepsSite {
  readonly rise: number;
  readonly toward: -1 | 1;
  /** World metres: the middle of the foot's outer edge on its ground, where the approach starts. */
  readonly foot: Vec3;
  /** World ground the steps and terrace cover. */
  readonly bounds: Bounds;
}

/** Where The Lantern and Oar stands: its back wall on the levee crest, its front facing +X down to the town's lanes. */
export interface TavernSite {
  /** World metres: the middle of the back wall, on the pad. */
  readonly back: XZ;
  /** The pad its street front stands on. */
  readonly ground: number;
  /** Turn 1 carries the tavern's local +Z (its door) to world +X and its local -Z (the river side) to world -X. */
  readonly turn: CardinalTurn;
  /** Occupied ground of the building and porch, and of the jetty over the bank and water. */
  readonly bounds: Bounds;
  readonly jetty: Bounds;
  /** The point on the ground in front of the door, and where its path meets the lane. */
  readonly door: Vec3;
  /** The steps the town chose, when the meadow lies more than a step below the floor. */
  readonly steps?: TavernStepsSite;
}

const CELL_TURN1 = (site: Pick<TavernSite, 'back' | 'ground'>, shape: TavernShape) => (local: Vec3): Vec3 => [
  site.back[0] + (local[2] - shape.anchor[1]) * CELL, site.ground + (local[1] - shape.floor) * CELL, site.back[1] - (local[0] - shape.anchor[0]) * CELL];

/**
 * The levee steps for each direction along the inn's front: the rise is the floor above the ground at the foot,
 * found by walking the foot out as the flight lengthens. A direction whose foot is wet or too deep has none.
 */
export function tavernStepOptions(landscape: DeepReadonly<GenesisLandscape>, site: Pick<TavernSite, 'back' | 'ground'>, shape: TavernShape): TavernStepsSite[] {
  const world = CELL_TURN1(site, shape), options: TavernStepsSite[] = [];
  for (const toward of [-1, 1] as const) {
    let rise = shape.steps.rise.min, ok = true;
    for (let pass = 0; pass < 6; pass++) {
      const foot = world(shape.steps.plan(rise, toward).foot), s = sampleGenesisSurface(landscape, foot[0], foot[2]);
      if ((s.waterLevel !== null && s.ground <= s.waterLevel + .25) || s.shoreDistance < 1) { ok = false; break; }
      const next = 2 * Math.round((site.ground - s.ground) / CELL / 2);
      if (next > shape.steps.rise.max) { ok = false; break; }
      if (next === rise || next < shape.steps.rise.min) { rise = Math.max(next, shape.steps.rise.min); break; }
      rise = next;
    }
    if (!ok) continue;
    const plan = shape.steps.plan(rise, toward), [x0, z0, x1, z1] = plan.footprint;
    const corners = [world([x0, 0, z0]), world([x1, 0, z1])];
    options.push({ rise, toward, foot: world(plan.foot),
      bounds: { minX: Math.min(corners[0]![0], corners[1]![0]), maxX: Math.max(corners[0]![0], corners[1]![0]), minZ: Math.min(corners[0]![2], corners[1]![2]), maxZ: Math.max(corners[0]![2], corners[1]![2]) } });
  }
  return options;
}

export interface RiverTown {
  readonly plan: SettlementPlan;
  readonly hall: HallSite;
  readonly tavern?: TavernSite;
  /** The market's centre at its paved level. */
  readonly market: Vec3;
  /** Ordered centre lines of the named lanes, for dressing them (lamps, roses, planters) after the homes. */
  readonly lanes: readonly { readonly name: string; readonly width: number; readonly points: readonly Vec3[] }[];
  /** The landing: from the foot of the hall's own steps (at the bank) down to the square's level, along +X. */
  readonly landing: { readonly from: Vec3; readonly depth: number; readonly width: number; readonly drop: number };
  /** Draft runs only: why lots were refused, by reason, and the homes each ward holds. */
  readonly rejections?: { readonly reasons: Readonly<Record<string, number>>; readonly wards: readonly number[] };
}

/** The recorded river centre line, level and bed at a given world z (the river runs along z here). */
export function riverAt(landscape: DeepReadonly<GenesisLandscape>, z: number): { x: number; level: number; bed: number; width: number; along: XZ } {
  const points = [...landscape.terrainCore.streams.find(stream => stream.id === 'river')!.points].sort((a, b) => a.position[1] - b.position[1]);
  let i = 0;
  while (i < points.length - 2 && points[i + 1]!.position[1] < z) i++;
  const a = points[i]!, b = points[i + 1]!, t = clamp((z - a.position[1]) / (b.position[1] - a.position[1]), 0, 1);
  const dx = b.position[0] - a.position[0], dz = b.position[1] - a.position[1], length = Math.hypot(dx, dz);
  return { x: lerp(a.position[0], b.position[0], t), level: lerp(a.level, b.level, t), bed: lerp(a.bed, b.bed, t), width: lerp(a.width, b.width, t), along: [dx / length, dz / length] };
}

/**
 * Choose the crossing the hall was drawn for. The hall's water line is 14 cells above its bed and both banks 32;
 * the chosen reach is the one in the town's stretch of river whose natural banks come nearest to that, and whose
 * course runs closest to square across the hall. The search is deterministic and bounded.
 */
export function chooseHallSite(landscape: DeepReadonly<GenesisLandscape>): HallSite {
  const turn: CardinalTurn = 1;
  let best: { score: number; z: number } | undefined;
  for (let z = 5; z <= 60; z += .5) {
    const river = riverAt(landscape, z), base = river.level - RIVER_HALL.water * CELL, bank = base + RIVER_HALL.bank * CELL;
    const skew = Math.abs(Math.atan2(river.along[0], river.along[1]));
    if (skew > .45 || river.width > (RIVER_HALL.deck.z[1] - RIVER_HALL.deck.z[0]) * CELL - 2) continue;
    let score = skew * 8;
    for (const offset of [-11, -9, 9, 11, 14]) score += Math.abs(sampleGenesisSurface(landscape, river.x + offset, z).ground - bank);
    // A lower meadow beside the landing means a longer stair; prefer the reach where the square sits closest under the sill.
    for (const offset of [30, 40]) score += .5 * Math.max(0, bank - sampleGenesisSurface(landscape, river.x + offset, z).ground);
    if (!best || score < best.score - 1e-9) best = { score, z };
  }
  if (!best) throw new Error('No reach of this river fits the river hall.');
  const river = riverAt(landscape, best.z), base = half(river.level - RIVER_HALL.water * CELL);
  const centre: XZ = [half(river.x), best.z];
  // turn 1 carries local (x, z) to world (z, -x): local x runs to world -z, local z to world +x.
  const origin: Vec3 = [centre[0] - RIVER_HALL_AXIS.z * CELL, base, centre[1] + RIVER_HALL_AXIS.x * CELL];
  const corners = [[0, 0], [RIVER_HALL_SIZE[0], 0], [0, RIVER_HALL_SIZE[2]], [RIVER_HALL_SIZE[0], RIVER_HALL_SIZE[2]]] as const;
  const bounds = boundsOf(corners.map(([x, z]) => { const p = transformCardinalPoint(origin, turn, [x * CELL, 0, z * CELL]); return [p[0], p[2]] as XZ; }));
  return { centre, turn, base, waterLevel: river.level, origin, bounds, bank: base + RIVER_HALL.bank * CELL };
}

/**
 * Choose the tavern's reach. This river runs on its own levee: both banks fall away from the water, the crest a few
 * metres above the meadow the town stands on. So the inn is set as a levee house: its floor flush with the crest at
 * its back wall (no ground stands above the floor anywhere under it), its stone plinth carried down the slope to the
 * meadow at its front, its jetty deck a hand above the water and reaching over it, and its approach graded from the
 * door down to the lane. Among the reaches up and down stream of the hall that fit, the lowest plinth near the hall wins.
 * Deterministic and bounded; a river with no such reach gets no tavern rather than a floating one.
 */
export function chooseTavernSite(landscape: DeepReadonly<GenesisLandscape>, hall: HallSite, shape: TavernShape,
  corridors: readonly { readonly p: Vec3; readonly r: number }[] = []): TavernSite | undefined {
  const clear = (b: Bounds) => corridors.every(c => rectDistance(b, c.p[0], c.p[2]) >= c.r);
  /** How far a point is from the nearest lane's edge (its corridor less the clearance kept beside it). */
  const toLane = (p: Vec3) => Math.min(Infinity, ...corridors.map(c => Math.hypot(c.p[0] - p[0], c.p[2] - p[2]) - c.r + 1.5));
  const ground = (x: number, z: number) => sampleGenesisSurface(landscape, x, z);
  const wet = (s: ReturnType<typeof ground>, margin: number) => (s.waterLevel !== null && s.ground <= s.waterLevel + .25) || s.shoreDistance < margin;
  /** The waterline of the town bank at z, east of the river's centre line: the quay is founded on it. */
  const bankAt = (z: number): number => {
    const river = riverAt(landscape, z);
    let x = river.x;
    while (x < river.x + 30 && wet(ground(x, z), 0)) x += .25;
    return x;
  };
  const near = hall.bounds.minZ - 6 - shape.width / 2, reaches: number[] = [];
  for (let z = hall.bounds.minZ - 4 - shape.width / 2; z >= hall.bounds.minZ - 70; z -= .5) reaches.push(z);
  for (let z = hall.bounds.maxZ + 4 + shape.width / 2; z <= hall.bounds.maxZ + 70; z += .5) reaches.push(z);
  let best: { score: number; site: TavernSite } | undefined;
  for (const z of reaches) {
    // The river runs a little askew of the inn's square plan: its back wall stands on the line that is dry along
    // its whole length.
    let back = -Infinity;
    for (let pz = z - shape.width / 2; pz <= z + shape.width / 2; pz += 1) back = Math.max(back, bankAt(pz));
    if (back >= riverAt(landscape, z).x + 30) continue;
    const backX = Math.ceil(back * 2) / 2, bounds: Bounds = { minX: backX, maxX: backX + shape.depth, minZ: z - shape.width / 2, maxZ: z + shape.width / 2 };
    let high = -Infinity, low = Infinity, dry = true;
    for (let px = bounds.minX; px <= bounds.maxX && dry; px += 1) for (let pz = bounds.minZ; pz <= bounds.maxZ && dry; pz += 1) {
      const s = ground(px, pz);
      if (wet(s, 0)) dry = false; else { high = Math.max(high, s.ground); low = Math.min(low, s.ground); }
    }
    if (!dry) continue;
    const pad = Math.ceil(high * 4) / 4, plinth = pad - low;
    if (plinth > 5) continue;
    // The jetty runs back from the wall; its deck is the floor, a little above the river, and its far edge stands
    // over water along its whole width.
    const jetty: Bounds = { minX: backX - shape.jetty, maxX: backX, minZ: z - shape.jettyAcross[1], maxZ: z - shape.jettyAcross[0] };
    const ends = [jetty.minZ + .5, (jetty.minZ + jetty.maxZ) / 2, jetty.maxZ - .5].map(pz => ground(jetty.minX + .5, pz));
    if (ends.some(end => end.waterLevel === null || end.ground > end.waterLevel - .25)) continue;
    const water = ends[1]!.waterLevel!;
    if (pad < water + .15 || pad > water + 2.5) continue;
    if (!clear(grow(bounds, 1))) continue;
    const site: TavernSite = { back: [backX, half(z)], ground: pad, turn: 1, bounds, jetty, door: [backX + shape.depth + 1, pad, half(z)] };
    // Where the meadow lies more than a step below the floor, the steps run down the front toward the nearer lane,
    // clear of every lane; the path then starts at their foot.
    let steps: TavernStepsSite | undefined, start = site.door;
    if (pad - ground(site.door[0], site.door[2]).ground >= shape.steps.rise.min * CELL) {
      steps = tavernStepOptions(landscape, site, shape).filter(option => clear(grow(option.bounds, 1)))
        .sort((p, q) => toLane(p.foot) - toLane(q.foot))[0];
      if (!steps) continue;
      start = steps.foot;
    }
    const path = toLane(start);
    if (path > 40) continue;
    const score = plinth + Math.abs(z - near) * .04 + path * .1;
    if (!best || score < best.score - 1e-9) best = { score, site: steps ? { ...site, steps } : site };
  }
  return best?.site;
}

/** A smooth lane through control points: centripetal Catmull-Rom, resampled every metre. */
function smoothLane(control: readonly XZ[]): XZ[] {
  const pts = [control[0]!, ...control, control.at(-1)!], out: XZ[] = [control[0]!];
  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1]!, pts[i]!, pts[i + 1]!, pts[i + 2]!];
    const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 2));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  // Resample at one-metre arc spacing on the half-metre lattice.
  const result: XZ[] = [[half(out[0]![0]), half(out[0]![1])]];
  let carry = 0;
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1]!, b = out[i]!, d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = 1 - carry;
    while (s <= d) { result.push([half(lerp(a[0], b[0], s / d)), half(lerp(a[1], b[1], s / d))]); s += 1; }
    carry = d - (s - 1);
  }
  const end = control.at(-1)!;
  if (result.at(-1)![0] !== half(end[0]) || result.at(-1)![1] !== half(end[1])) result.push([half(end[0]), half(end[1])]);
  return result.filter((p, i) => i === 0 || p[0] !== result[i - 1]![0] || p[1] !== result[i - 1]![1]);
}

/** Heights that follow the meadow but never pitch more than `grade`, pinned at a start and optionally an end. */
function profile(points: readonly XZ[], ground: (x: number, z: number) => number, start: number, end?: number, grade = .1): number[] {
  const natural = points.map(p => ground(p[0], p[1]));
  // A walking lane eases over hummocks: average the natural surface over a few metres either side first.
  const soft = natural.map((_, i) => { let s = 0, n = 0; for (let k = -5; k <= 5; k++) { const v = natural[i + k]; if (v !== undefined) { s += v; n++; } } return s / n; });
  const run = (i: number) => Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  const forward = [start];
  for (let i = 1; i < points.length; i++) { const r = run(i) * grade; forward.push(forward[i - 1]! + clamp(soft[i]! - forward[i - 1]!, -r, r)); }
  if (end === undefined) return forward.map(h => half(h * 4) / 4);
  const backward = new Array<number>(points.length); backward[points.length - 1] = end;
  for (let i = points.length - 2; i >= 0; i--) { const r = run(i + 1) * grade; backward[i] = backward[i + 1]! + clamp(soft[i]! - backward[i + 1]!, -r, r); }
  return forward.map((f, i) => { const t = i / (points.length - 1), w = t * t * (3 - 2 * t); return half(lerp(f, backward[i]!, w) * 4) / 4; });
}

interface LaneSpec {
  readonly id: string;
  readonly name: string;
  readonly ward: number;
  readonly kind: 'main' | 'lane';
  readonly width: number;
  readonly control: readonly XZ[];
  /** Which sides may hold homes: -1 is the lane's left, 1 its right, walking from the first control point. */
  readonly sides: readonly (-1 | 1)[];
  readonly tier: (ordinal: number, hash: number) => HomeTier;
  /** Heights at the start (and end) come from the street this lane leaves (and joins). */
  readonly from: string;
  readonly to?: string;
  readonly spacing?: number;
  /** How far the lot's own ground may stand from its pad, in metres: Old Row terraces into its hill. */
  readonly tolerance?: number;
}

const WARDS = ['Old Row', 'Millwater', 'Rosewalk'] as const;
/** The stone landing between the hall's steps and the market, in metres along the hall's axis. */
export const LANDING_DEPTH = 9;

/** Compose the town on the recipe's selected river valley. Pure and deterministic. */
export function composeRiverTown(recipe: DeepReadonly<ChannelKingdomRecipe>, landscape: DeepReadonly<GenesisLandscape>, base: SettlementPlan, draft = false, tavernShape?: TavernShape): RiverTown {
  if (landscape.character !== 'river-valley') throw new Error('The river town needs its river valley.');
  const capacity = recipe.size.homeCapacity, wards = recipe.size.wards;
  if (wards !== WARDS.length) throw new Error(`The river town is drawn for ${WARDS.length} wards, not ${wards}.`);
  const ground = (x: number, z: number): number => sampleGenesisSurface(landscape, x, z).ground;
  const wet = (x: number, z: number, margin: number): boolean => {
    const s = sampleGenesisSurface(landscape, x, z);
    return (s.waterLevel !== null && s.ground <= s.waterLevel + .5) || s.shoreDistance < margin;
  };
  const hall = chooseHallSite(landscape);
  const hz = hall.centre[1];
  const castle = base.castle;
  const gate = base.nodes.find(node => node.id === castle.gateNodeId)!;
  const config = { ...base.config, seed: `${recipe.seedKey}/${landscape.id}/river-town-1` };
  const slotYear = config.year;

  // The market opens at the hall's landing, on the bank's own level.
  // The hall's sill is set by the river; the meadow lies lower. The square keeps the meadow's own level and a
  // stone landing with a stair (see `landing`) climbs from it to the hall door, rather than raising a mound.
  const mx = half(hall.bounds.maxX + LANDING_DEPTH + 17), mz = half(hz);
  let meadow = 0, samples = 0;
  for (let x = mx - 17; x <= mx + 15; x += 4) for (let z = mz - 15; z <= mz + 33; z += 4) { meadow += ground(x, z); samples++; }
  const marketLevel = Math.round(clamp(meadow / samples, hall.bank - 5, hall.bank) * 4) / 4;
  // The square runs north from the stair's foot. Its standing furniture is laid out from the market node, so the
  // node sits in the northern half: stalls and stores gather there and the stair's axis stays open.
  // The landing's masonry beds into the natural bank between the hall and the square: grading it away would leave
  // the stair's flanks standing as bare walls.
  const market: Square = { id: 'market', nodeId: 'market', elevation: marketLevel,
    boundary: [[mx - 17, mz - 15], [mx + 15, mz - 15], [mx + 15, mz + 33], [mx - 17, mz + 33]] };
  const marketBounds = boundsOf(market.boundary);
  const nodes: Node[] = [{ id: 'market', kind: 'market', position: [mx + 1, marketLevel, mz + 19] }];
  nodes.push({ ...gate, position: [...gate.position] as Vec3 });
  const streets: Street[] = [], courts: Square[] = [];
  const homes: SettlementHome[] = [];
  const lots: Bounds[] = [];
  const corridors: { p: Vec3; r: number }[] = [];
  const landingBounds: Bounds = { minX: hall.bounds.maxX - 1, maxX: hall.bounds.maxX + LANDING_DEPTH + 1, minZ: hz - 8, maxZ: hz + 8 };
  const keepOut: Bounds[] = [grow(hall.bounds, 3), grow(castle.bounds, 3), grow(marketBounds, 2), grow(landingBounds, 2)];
  const laneLines: { name: string; width: number; points: Vec3[] }[] = [];
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const addNode = (node: Node): Node => { nodes.push(node); nodeById.set(node.id, node); return node; };

  const riverX = (z: number) => riverAt(landscape, z).x;
  const east = (z: number, offset: number): XZ => [riverX(z) + offset, z];
  const g: XZ = [gate.position[0], gate.position[2]];
  const crownBend: XZ = [lerp(mx + 15, g[0], .55) - 6, lerp(mz, g[1], .55) - 9];
  const crownFoot: XZ = [g[0] - 16, g[1] - 12];
  const lanes: LaneSpec[] = [
    { id: 'crown-way', name: 'Crown Way', ward: 0, kind: 'main', width: 6, from: 'market', to: castle.gateNodeId,
      control: [[mx + 15, mz + 3], [mx + 34, mz + 10], crownBend, crownFoot, g], sides: [-1, 1], tier: () => 'house', spacing: 12 },
    // Old Row is the street nearest the castle: it leaves Crown Way below the gate and terraces along the hill's foot.
    { id: 'old-row', name: 'Old Row', ward: 0, kind: 'lane', width: 4, from: 'crown-way', tolerance: 3.5,
      control: [crownFoot, [g[0] + 14, g[1] - 15], [castle.bounds.maxX + 6, castle.bounds.minZ - 13], [castle.bounds.maxX + 22, castle.bounds.minZ + 4]],
      sides: [-1, 1], tier: (_, h) => h % 3 === 0 ? 'house' : 'cottage' },
    { id: 'millwater-north', name: 'Millwater Lane', ward: 1, kind: 'lane', width: 4, from: 'market',
      control: [[mx - 8, mz + 33], east(mz + 48, 30), east(mz + 70, 30), east(mz + 95, 28), east(mz + 125, 30)],
      sides: [-1, 1], tier: (_, h) => h % 3 === 0 ? 'house' : 'cottage' },
    { id: 'millwater-south', name: 'Millwater Lane', ward: 1, kind: 'lane', width: 4, from: 'market',
      control: [[mx - 6, mz - 15], east(mz - 30, 30), east(mz - 65, 30), east(mz - 100, 29), east(mz - 135, 31)],
      sides: [-1, 1], tier: (_, h) => h % 3 === 0 ? 'house' : 'cottage' },
    { id: 'rosewalk', name: 'Rosewalk', ward: 2, kind: 'lane', width: 4, from: 'market',
      control: [[mx + 15, mz - 9], [mx + 34, mz - 26], [mx + 44, mz - 58], [mx + 66, mz - 84], [mx + 104, mz - 96], [mx + 132, mz - 82]],
      sides: [-1, 1], tier: (_, h) => h % 6 === 0 ? 'house' : h % 5 === 0 ? 'hut' : 'cottage' },
    { id: 'lantern-lane', name: 'Lantern Lane', ward: 0, kind: 'lane', width: 4, from: 'crown-way',
      control: [[mx + 34, mz + 10], [mx + 36, mz + 40], [mx + 28, mz + 72], [mx + 40, mz + 104], [mx + 30, mz + 132]],
      sides: [-1, 1], tier: (_, h) => h % 4 === 0 ? 'house' : 'cottage' },
    { id: 'orchard-rise', name: 'Orchard Rise', ward: 0, kind: 'lane', width: 4, from: 'old-row', tolerance: 3,
      control: [[castle.bounds.maxX + 22, castle.bounds.minZ + 4], [castle.bounds.maxX + 28, castle.bounds.maxZ + 8], [castle.bounds.maxX + 8, castle.bounds.maxZ + 30], [castle.bounds.minX - 10, castle.bounds.maxZ + 40]],
      sides: [-1, 1], tier: (_, h) => h % 5 === 0 ? 'hut' : 'cottage' },
    { id: 'wren-lane', name: 'Wren Lane', ward: 2, kind: 'lane', width: 4, from: 'rosewalk',
      control: [[mx + 44, mz - 58], [mx + 72, mz - 44], [mx + 100, mz - 48], [mx + 124, mz - 34], [mx + 150, mz - 40]],
      sides: [-1, 1], tier: (_, h) => h % 5 === 0 ? 'hut' : 'cottage' },
    { id: 'kettle-row', name: 'Kettle Row', ward: 2, kind: 'lane', width: 4, from: 'old-row',
      control: [[g[0] + 14, g[1] - 15], [g[0] + 22, g[1] - 44], [g[0] + 50, g[1] - 60], [g[0] + 84, g[1] - 54], [g[0] + 110, g[1] - 30]],
      sides: [-1, 1], tier: (_, h) => h % 4 === 0 ? 'house' : 'cottage' },
    { id: 'reed-walk', name: 'Reed Walk', ward: 1, kind: 'lane', width: 4, from: 'millwater-south',
      control: [east(mz - 100, 29), [riverX(mz - 104) + 58, mz - 112], [mx + 40, mz - 128], [mx + 70, mz - 140]],
      sides: [-1, 1], tier: (_, h) => h % 5 === 0 ? 'hut' : 'cottage' },
    { id: 'bell-lane', name: 'Bell Lane', ward: 1, kind: 'lane', width: 4, from: 'reed-walk',
      control: [[mx + 40, mz - 128], [mx + 48, mz - 160], [mx + 80, mz - 176], [mx + 116, mz - 166]],
      sides: [-1, 1], tier: (_, h) => h % 5 === 0 ? 'hut' : 'cottage' },
    { id: 'heron-lane', name: 'Heron Lane', ward: 2, kind: 'lane', width: 4, from: 'rosewalk',
      control: [[mx + 104, mz - 96], [mx + 128, mz - 120], [mx + 150, mz - 150], [mx + 176, mz - 160]],
      sides: [-1, 1], tier: (_, h) => h % 6 === 0 ? 'house' : 'cottage' },
    { id: 'fern-row', name: 'Fern Row', ward: 0, kind: 'lane', width: 4, from: 'kettle-row',
      control: [[g[0] + 110, g[1] - 30], [g[0] + 122, g[1] + 6], [g[0] + 112, g[1] + 44], [g[0] + 96, g[1] + 76]],
      sides: [-1, 1], tier: (_, h) => h % 4 === 0 ? 'house' : 'cottage' },
    { id: 'thistle-lane', name: 'Thistle Lane', ward: 2, kind: 'lane', width: 4, from: 'heron-lane',
      control: [[mx + 128, mz - 120], [mx + 160, mz - 104], [mx + 190, mz - 110], [mx + 214, mz - 92]],
      sides: [-1, 1], tier: (_, h) => h % 5 === 0 ? 'hut' : 'cottage' },
  ];

  const wardCounts = [0, 0, 0];
  const wardRoots: (Node | undefined)[] = [undefined, undefined, undefined];
  // Pass 1: every lane's centre line and heights, stopping where a lane would reach the water.
  const drawnLanes = new Map<string, Vec3[]>(), attach = new Map<string, number>();
  for (const spec of lanes) {
    const points = smoothLane(spec.control);
    let startHeight = marketLevel;
    if (spec.from !== 'market') {
      const parent = drawnLanes.get(spec.from);
      if (!parent) continue;
      let best = 0, d = Infinity;
      parent.forEach((q, i) => { const e = Math.hypot(q[0] - points[0]![0], q[2] - points[0]![1]); if (e < d) { d = e; best = i; } });
      attach.set(spec.id, best);
      startHeight = parent[best]![1];
      points[0] = [parent[best]![0], parent[best]![2]];
    }
    const endHeight = spec.to === castle.gateNodeId ? gate.position[1] : undefined;
    const heights = profile(points, ground, startHeight, endHeight, spec.kind === 'main' ? .12 : .1);
    const line: Vec3[] = points.map((p, i) => [p[0], heights[i]!, p[1]]);
    let usable = line.length;
    for (let i = 1; i < line.length; i++) {
      const p = line[i]!;
      if (wet(p[0], p[2], spec.width / 2 + 1.5) || (spec.to !== castle.gateNodeId && rectDistance(grow(castle.bounds, 3), p[0], p[2]) < 1)) { usable = i; break; }
    }
    const drawn = line.slice(0, usable);
    if (drawn.length < 8) continue;
    drawnLanes.set(spec.id, drawn);
    laneLines.push({ name: spec.name, width: spec.width, points: drawn });
    for (const p of drawn) corridors.push({ p, r: spec.width / 2 + 1.5 });
  }
  // The tavern takes its reach of the bank once the lanes are drawn, clear of all of them, and keeps a yard round
  // it: room at its ends for barrels and a bench, and its steps.
  const tavern = tavernShape ? chooseTavernSite(landscape, hall, tavernShape, corridors) : undefined;
  if (tavern) keepOut.push(grow(tavern.bounds, 2.5), tavern.jetty, ...(tavern.steps ? [grow(tavern.steps.bounds, 1.5)] : []));
  // Pass 2: junctions. A branch joins its parent at a node on the parent's own centre line.
  const stops = new Map<string, { index: number; node: Node }[]>();
  for (const spec of lanes) {
    const drawn = drawnLanes.get(spec.id);
    if (!drawn) continue;
    const list = stops.get(spec.id) ?? []; stops.set(spec.id, list);
    if (spec.from === 'market') list.push({ index: 0, node: nodeById.get('market')! });
    else {
      const index = attach.get(spec.id)!, parent = drawnLanes.get(spec.from)!;
      const join = addNode({ id: `pk:${spec.from}:join:${spec.id}`, kind: 'junction', position: parent[index]! });
      const parentStops = stops.get(spec.from)!;
      parentStops.push({ index, node: join });
      list.push({ index: 0, node: join });
    }
    const reachesGate = spec.to === castle.gateNodeId && drawn.length === smoothLane(spec.control).length;
    list.push({ index: drawn.length - 1, node: reachesGate ? nodeById.get(castle.gateNodeId)! : addNode({ id: `pk:${spec.id}:end`, kind: 'junction', position: drawn.at(-1)! }) });
    if (!wardRoots[spec.ward]) {
      const index = Math.min(drawn.length - 2, 14), root = drawn[index]!;
      wardRoots[spec.ward] = addNode({ id: `pk:${spec.id}:root`, kind: 'court', position: root });
      list.push({ index, node: wardRoots[spec.ward]! });
      courts.push({ id: `pk:ward:${spec.ward}:green`, nodeId: wardRoots[spec.ward]!.id, elevation: root[1],
        boundary: [[root[0] - 3, root[2] - 3], [root[0] + 3, root[2] - 3], [root[0] + 3, root[2] + 3], [root[0] - 3, root[2] + 3]] });
    }
  }
  // The tavern's path: from the foot of its steps (or the ground before its door) to the nearest lane, joined at a
  // node on that lane.
  if (tavern) {
    const start = tavern.steps?.foot ?? tavern.door;
    let at = { id: '', index: -1, d: Infinity };
    for (const [id, drawn] of drawnLanes) for (let i = 3; i < drawn.length - 3; i++) {
      const d = Math.hypot(drawn[i]![0] - start[0], drawn[i]![2] - start[2]);
      if (d < at.d - 1e-9) at = { id, index: i, d };
    }
    const lane = drawnLanes.get(at.id)![at.index]!, list = stops.get(at.id)!;
    let junction = list.find(stop => stop.index === at.index)?.node;
    if (!junction) { junction = addNode({ id: `pk:${at.id}:tavern`, kind: 'junction', position: lane }); list.push({ index: at.index, node: junction }); }
    const front = addNode({ id: 'pk:tavern:front', kind: 'frontage', position: start });
    streets.push({ id: 'pk:tavern:approach', from: front.id, to: junction.id, points: [start, lane], kind: 'approach', name: 'The Lantern and Oar', width: 2.5, verge: 0 });
    for (let t = 0; t <= 1; t += 1 / Math.max(1, Math.ceil(at.d))) corridors.push({ p: [lerp(start[0], lane[0], t), 0, lerp(start[2], lane[2], t)], r: 2.5 });
  }
  const tally: Record<string, number> = {};
  // Pass 3: lots along each lane, on its permitted sides, every `spacing` metres, nearest wards first.
  for (const spec of lanes) {
    const drawn = drawnLanes.get(spec.id);
    if (!drawn) continue;
    const list = stops.get(spec.id)!;
    const spacing = spec.spacing ?? 10.5;
    let since = spacing * .6;
    for (let i = 3; i < drawn.length - 3; i++) {
      since += Math.hypot(drawn[i]![0] - drawn[i - 1]![0], drawn[i]![2] - drawn[i - 1]![2]);
      if (since < spacing) continue;
      const a = drawn[i - 3]!, b = drawn[i + 3]!;
      const tx = b[0] - a[0], tz = b[2] - a[2], tl = Math.hypot(tx, tz) || 1;
      let placed = false;
      for (const side of spec.sides) {
        if (homes.length >= capacity) break;
        // The lot lies along the lane's normal on this side; the home faces back to the lane on the nearest cardinal.
        const nx = side * tz / tl, nz = side * -tx / tl;
        const rotation: CardinalTurn = Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? 3 : 1) : (nz > 0 ? 2 : 0);
        const out = transformCardinalPoint([0, 0, 0], rotation, [0, 0, 1]);
        const why = (reason: string) => { if (draft) tally[reason] = (tally[reason] ?? 0) + 1; };
        const lane = drawn[i]!;
        // Square-set homes step back from a lane that runs across the cardinals, so their front corners clear it.
        let centre: Vec3 | undefined, box: ReturnType<typeof currentFootprint> | undefined, failure = 'road';
        for (let back = 0; back <= 6 && !centre; back += 1) {
          const reach = spec.width / 2 + 2.5 + 8 + back;
          const c: Vec3 = [half(lane[0] - out[0] * reach), lane[1], half(lane[2] - out[2] * reach)];
          const b = currentFootprint({ position: c, rotation, allowedDepth: 16 });
          if (keepOut.some(k => overlap(b, k))) { failure = 'keep'; break; }
          if (lots.some(other => overlap(b, other, 1))) { failure = 'lot'; break; }
          if (corridors.some(k => rectDistance(b, k.p[0], k.p[2]) < k.r)) continue;
          const samples: number[] = [];
          let clear = true;
          for (let px = b.minX - 1; px <= b.maxX + 1 && clear; px += 2) for (let pz = b.minZ - 1; pz <= b.maxZ + 1 && clear; pz += 2) {
            if (wet(px, pz, 2)) clear = false; else samples.push(ground(px, pz));
          }
          if (!clear) { failure = 'wet'; break; }
          // The pad sits on the lot's own ground, within a short step of the lane; the approach takes up the rest.
          const pad = Math.round(clamp(samples.reduce((sum, v) => sum + v, 0) / samples.length, lane[1] - (spec.tolerance ? 2 : 1.25), lane[1] + (spec.tolerance ? 2 : 1.25)) * 4) / 4;
          if (samples.some(v => Math.abs(v - pad) > (spec.tolerance ?? 2.25))) { failure = 'slope'; break; }
          centre = [c[0], pad, c[2]]; box = b;
        }
        if (!centre || !box) { why(failure); continue; }
        const hash = seedHash(`${config.seed}/${spec.id}/${i}/${side}`), tier = spec.tier(homes.length, hash);
        const ordinal = homes.length, id = `genesis:plot:${ordinal}`;
        const front = homeFrame({ position: centre, rotation }).front;
        let junction = list.find(stop => stop.index === i)?.node;
        if (!junction) { junction = addNode({ id: `pk:${spec.id}:${i}`, kind: 'junction', position: lane }); list.push({ index: i, node: junction }); }
        const frontage = addNode({ id: `${id}:front`, kind: 'frontage', position: front });
        const approachId = `${id}:approach`;
        streets.push({ id: approachId, from: frontage.id, to: junction.id, points: [front, lane], kind: 'approach', name: spec.name, width: 2, verge: 0 });
        homes.push({ id, quarterYear: slotYear, ordinal, street: spec.name, streetId: `pk:${spec.id}`, courtId: `pk:ward:${spec.ward}:green`, approachId,
          position: centre, rotation, lot: { ...box, height: 20, depth: 16, frontage: 8 },
          slot: ordinal, tier, allowedDepth: HOME_DEPTH_METRES[tier], style: recipe.identity.styleFamily, variant: hash % 3 });
        lots.push(box);
        wardCounts[spec.ward]!++;
        placed = true;
      }
      if (placed) since = 0;
    }
  }
  // Pass 4: lane edges between consecutive stops, so every frontage and branch reaches the street graph. Stops that
  // fall on the same centre-line point become one node: the most lasting of them (the square or gate, a ward green,
  // a junction, a lane end, a frontage) keeps its name and every reference to the others follows it.
  const alias = new Map<string, string>();
  const named = (id: string): string => { let at = id; while (alias.has(at)) at = alias.get(at)!; return at; };
  const rank = (node: Node) => node.id === 'market' || node.id === castle.gateNodeId ? 0 : node.id.endsWith(':root') ? 1 : node.id.includes(':join:') ? 2 : node.id.endsWith(':end') ? 3 : 4;
  for (const spec of lanes) {
    const drawn = drawnLanes.get(spec.id), list = stops.get(spec.id);
    if (!drawn || !list) continue;
    // A lane ends a few metres past its last home or branch: no road runs on into empty meadow.
    const endStop = list.find(stop => stop.node.id === `pk:${spec.id}:end`);
    if (endStop) {
      const last = Math.max(0, ...list.filter(stop => stop !== endStop).map(stop => stop.index));
      const keep = Math.min(drawn.length - 1, last + 6);
      if (keep < endStop.index) { drawn.length = keep + 1; endStop.index = keep; endStop.node.position = drawn[keep]!; }
    }
    list.sort((p, q) => p.index - q.index || rank(p.node) - rank(q.node));
    for (let s = 1; s < list.length; s++) if (list[s]!.index === list[s - 1]!.index) {
      const keep = named(list[s - 1]!.node.id), merged = named(list[s]!.node.id);
      if (keep !== merged) alias.set(merged, keep);
    }
    let edge = 0;
    for (let s = 1; s < list.length; s++) {
      const from = list[s - 1]!, to = list[s]!;
      if (to.index === from.index) continue;
      const segment = drawn.slice(from.index, to.index + 1);
      if (from.index === 0 && (from.node.position[0] !== segment[0]![0] || from.node.position[2] !== segment[0]![2])) segment.unshift(from.node.position);
      if (to.node.id === castle.gateNodeId && (to.node.position[0] !== segment.at(-1)![0] || to.node.position[2] !== segment.at(-1)![2])) segment.push(to.node.position);
      streets.push({ id: edge ? `pk:${spec.id}:${edge}` : `pk:${spec.id}`, from: from.node.id, to: to.node.id, points: segment, kind: spec.kind, name: spec.name, width: spec.width, verge: 1 });
      edge++;
    }
  }
  if (homes.length !== capacity && !draft) throw new Error(`The river town reserves ${homes.length} of its ${capacity} homes.`);
  for (const street of streets) { street.from = named(street.from); street.to = named(street.to); }
  for (let i = nodes.length - 1; i >= 0; i--) if (alias.has(nodes[i]!.id)) nodes.splice(i, 1);
  for (const court of courts) court.nodeId = named(court.nodeId);
  for (const [ward, root] of wardRoots.entries()) if (root) wardRoots[ward] = nodeById.get(named(root.id))!;

  const quarters = WARDS.map((name, ward) => ({ year: slotYear, name, rootNodeId: wardRoots[ward]?.id ?? 'market', courtIds: [`pk:ward:${ward}:green`],
    growthNodeIds: nodes.filter(node => node.id.endsWith(':end') && lanes.find(l => node.id === `pk:${l.id}:end`)?.ward === ward).map(node => node.id) }));
  const extent: XZ[] = [[castle.bounds.minX, castle.bounds.minZ], [castle.bounds.maxX, castle.bounds.maxZ], ...market.boundary,
    ...(tavern ? [[tavern.jetty.minX, tavern.jetty.minZ], [tavern.bounds.maxX, tavern.bounds.maxZ]] as XZ[] : []),
    ...(tavern?.steps ? [[tavern.steps.bounds.minX, tavern.steps.bounds.minZ], [tavern.steps.bounds.maxX, tavern.steps.bounds.maxZ]] as XZ[] : []),
    [hall.bounds.minX, hall.bounds.minZ], [hall.bounds.maxX, hall.bounds.maxZ]];
  for (const lot of lots) extent.push([lot.minX, lot.minZ], [lot.maxX, lot.maxZ]);
  for (const street of streets) for (const p of street.points) extent.push([p[0], p[2]]);
  // The base plan's bounds already hold the river and its valley inside the horizon's 512 m footprint; the town
  // only widens them where its lanes and gardens reach past them.
  extent.push([base.bounds.minX, base.bounds.minZ], [base.bounds.maxX, base.bounds.maxZ]);
  const town = grow(boundsOf(extent.slice(0, -2)), 8), bounds = boundsOf([...extent.slice(-2), [town.minX, town.minZ], [town.maxX, town.maxZ]]);
  // A reservation is the plot alone: what it holds (slot, tier, depth, style, variant) is the home's.
  const reservations = homes.map(home => {
    const plot: Partial<SettlementHome> = { ...home };
    for (const key of ['slot', 'tier', 'allowedDepth', 'style', 'variant'] as const) delete plot[key];
    return plot as SettlementPlan['reservations'][number];
  });
  const body = { version: 2 as const, config, landform: base.landform, ...(base.genesisSurface ? { genesisSurface: base.genesisSurface } : {}), homes, reservations, quarters, nodes, streets,
    activeStreetIds: streets.map(street => street.id), market, courts, castle, bounds, lake: base.lake };
  const plan: SettlementPlan = { ...body, revision: `genesis-river-town:1:${seedHash(JSON.stringify(body)).toString(16)}` };
  return { plan, hall, ...(tavern ? { tavern } : {}), market: [mx, marketLevel, mz], lanes: laneLines,
    landing: { from: [hall.bounds.maxX, hall.bank, hz], depth: LANDING_DEPTH, width: 12, drop: hall.bank - marketLevel },
    ...(draft ? { rejections: { reasons: tally, wards: wardCounts } } : {}) };
}
