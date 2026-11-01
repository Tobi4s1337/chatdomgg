import { STYLES, MAT } from '@chatdom/content';
import type { LandmarkPiece } from '@chatdom/content/genesis-landmarks';
import { VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { sampleLandWater, terrainHeight, transformCardinalPoint, type CardinalTurn, type SettlementPlan } from '@chatdom/world';
import { bankTop, batterTop, createAbutmentRevetment } from '../../../../../../packages/content/src/genesis-kingdoms/pinkkitty/abutment/index';
import { createGlassScreen, createHallLanding } from '../../../../../../packages/content/src/genesis-kingdoms/pinkkitty/landing/index';
import { createRiverCresset, createRoseArch, createRoseBush, createRosePlanter, roseArchFrame, ROSE_ARCH_WIDTHS, ROSE_PLANTER, type RoseBushVariant } from '../../../../../../packages/content/src/genesis-kingdoms/pinkkitty/roses/index';
import type { GenesisHeraldry } from '../../../../../../packages/content/src/genesis-heraldry/index';
import type { GenesisEmoteArt } from '../../../../../../packages/content/src/genesis-emotes/index';
import { createCastleContent, createCastleCourtContent } from '../../../kingdom/castle-content';
import { placeMarketContent, type Dressing } from '../../../kingdom/settlement-content';
import type { RoyalBrazier } from '../../../kingdom/royal-life';
import type { GenesisSeatContent } from '../../seat-content';
import { createKeeperLampPost, KEEPER_PROP_ANCHORS } from '../../../../../../packages/content/src/genesis-keepers/props';
import type { KeeperFixture } from '../../../../../../packages/content/src/genesis-keepers/routine';
import { LANTERN_AND_OAR, type LanternAndOar } from '../../../../../../packages/content/src/genesis-kingdoms/pinkkitty/tavern/index';
import { createTavernSteps, TAVERN_STEPS, tavernStepsPlan } from '../../../../../../packages/content/src/genesis-kingdoms/pinkkitty/tavern/steps';
import type { BuiltPlace } from './keepers';
import { riverAt, type RiverTown } from './town';

const CELL = VOXEL_METRES.build;

/** A piece set down at a corner origin and turned by whole quarter turns, as the renderer places blueprints. */
export interface Placement { readonly origin: Vec3; readonly turn: CardinalTurn }
export const placeAt = (placement: Placement, local: readonly [number, number, number]): Vec3 =>
  transformCardinalPoint(placement.origin, placement.turn, [local[0] * CELL, local[1] * CELL, local[2] * CELL]);
const dressing = (blueprint: VoxelBlueprint, placement: Placement): Dressing => ({ blueprint, position: placement.origin, yaw: placement.turn * Math.PI / 2 });

/**
 * The origin that puts a piece's local point `anchor` (cells, y ignored) on `world`, with the piece standing on
 * `level`. Used to centre a piece on a site rather than reasoning about corners for every turn.
 */
export function centredOn(anchor: readonly [number, number, number], world: readonly [number, number], level: number, turn: CardinalTurn): Placement {
  const offset = transformCardinalPoint([0, 0, 0], turn, [anchor[0] * CELL, 0, anchor[2] * CELL]);
  return { origin: [world[0] - offset[0], level, world[1] - offset[2]], turn };
}

/** The highest occupied cell over a local column of a blueprint, for setting a vane or finial on a roof. */
export function topAt(blueprint: VoxelBlueprint, x: number, z: number): number {
  const column = blueprint.boxes.filter(box => x >= box.from[0] && x < box.to[0] && z >= box.from[2] && z < box.to[2]);
  for (let y = blueprint.size[1] - 1; y >= 0; y--) {
    let material: number = MAT.air;
    for (const box of column) if (y >= box.from[1] && y < box.to[1]) material = box.material;
    if (material !== MAT.air) return y;
  }
  return -1;
}

/**
 * Stone footings under a placed piece wherever the displayed ground falls away below its y = 0: each 4 × 4 cell
 * column of every footing reaches down to the lowest ground under its corners. Grading never fills the river, so
 * the hall's piers are carried to the real bed rather than floating over it.
 */
export function footings(plan: SettlementPlan, piece: { readonly footings: readonly { readonly box: Pick<LandmarkPiece['footings'][number]['box'], 'from' | 'to'> }[] }, placement: Placement, id: string): Dressing | undefined {
  const columns: { x: number; z: number; bottom: number }[] = [];
  for (const footing of piece.footings) {
    for (let x = footing.box.from[0]; x < footing.box.to[0]; x += 4) for (let z = footing.box.from[2]; z < footing.box.to[2]; z += 4) {
      const x1 = Math.min(x + 4, footing.box.to[0]), z1 = Math.min(z + 4, footing.box.to[2]);
      const lowest = Math.min(...[[x, z], [x1, z], [x, z1], [x1, z1]].map(([a, b]) => { const p = placeAt(placement, [a!, 0, b!]); return terrainHeight(plan, p[0], p[2]); }));
      const bottom = Math.floor((lowest - placement.origin[1]) / CELL) - 1;
      if (bottom < 0) columns.push({ x, z, bottom: Math.max(bottom, -96) });
    }
  }
  if (!columns.length) return undefined;
  const depth = -Math.min(...columns.map(column => column.bottom));
  let hash = 2166136261;
  for (const column of columns) hash = Math.imul(hash ^ (column.bottom * 311 + column.x * 17 + column.z), 16777619);
  const size: [number, number, number] = [Math.max(...columns.map(c => c.x)) + 4, depth, Math.max(...columns.map(c => c.z)) + 4];
  const blueprint: VoxelBlueprint = { version: 1, id: `${id}-footings-${(hash >>> 0).toString(16)}`, styleId: STYLES.hearth.id, kind: 'civic', lattice: 'build', size, windows: [],
    boxes: columns.map(column => ({ from: [column.x, depth + column.bottom, column.z], to: [column.x + 4, depth, column.z + 4], material: MAT.darkStone })) };
  return dressing(blueprint, { origin: placeAt(placement, [0, -depth, 0]), turn: placement.turn });
}

interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
const overlaps = (a: Rect, b: Rect, gap = 0) => a.minX < b.maxX + gap && b.minX < a.maxX + gap && a.minZ < b.maxZ + gap && b.minZ < a.maxZ + gap;
/** The ground a placed piece covers, in world metres. */
function footprint(size: readonly number[], placement: Placement): Rect {
  const a = placeAt(placement, [0, 0, 0]), b = placeAt(placement, [size[0]!, 0, size[2]!]);
  return { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[2], b[2]), maxZ: Math.max(a[2], b[2]) };
}
/** The point of `area` (quarter-metre grid) whose farthest fixture is nearest: where a keeper's round is centred. */
function nearestAll(area: Rect, fixtures: readonly KeeperFixture[]): [number, number] {
  const far = (x: number, z: number) => Math.max(...fixtures.map(f => Math.hypot(f.position[0] - x, f.position[2] - z)));
  let centre: [number, number] = [(area.minX + area.maxX) / 2, (area.minZ + area.maxZ) / 2], best = far(...centre);
  for (let x = area.minX; x <= area.maxX; x += .25) for (let z = area.minZ; z <= area.maxZ; z += .25) {
    const d = far(x, z);
    if (d < best - 1e-9) { best = d; centre = [x, z]; }
  }
  return centre;
}
const boundsOfSquare = (points: readonly (readonly [number, number])[]): Rect => ({
  minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minZ: Math.min(...points.map(p => p[1])), maxZ: Math.max(...points.map(p => p[1])) });
const segmentDistance = (x: number, z: number, a: readonly number[], b: readonly number[]) => {
  const dx = b[0]! - a[0]!, dz = b[2]! - a[2]!, t = Math.max(0, Math.min(1, ((x - a[0]!) * dx + (z - a[2]!) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0]! - dx * t, z - a[2]! - dz * t);
};
const rectRoadDistance = (r: Rect, a: readonly number[], b: readonly number[]) => {
  const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
  return segmentDistance(cx, cz, a, b) - Math.hypot(r.maxX - r.minX, r.maxZ - r.minZ) / 2;
};

export interface SeatPieces {
  readonly hall: LandmarkPiece;
  readonly tavern: LanternAndOar;
  readonly heraldry: GenesisHeraldry;
  readonly emotes: GenesisEmoteArt;
}

/** The seat's pieces, and the places it built with the fixtures their keepers work at. */
export interface PinkKittySeat {
  readonly seat: GenesisSeatContent;
  readonly places: Readonly<Record<string, BuiltPlace>>;
}

/** The keeper convention for a fixture's front: rotation about +Y, zero facing +Z, for a piece turned `turn`. */
const facingOf = (turn: CardinalTurn): number => [0, Math.PI / 2, Math.PI, -Math.PI / 2][turn]!;

/**
 * Everything PinkKittyRose's kingdom raises beyond its homes: the castle on Crown Hill, the river hall over the
 * water, the arms at the gate and in the square, and the emote statue and vane. All of it is scenery on potential
 * land; no piece is a deed, a person or a light that stands for one.
 */
export function createPinkKittySeat(town: RiverTown, pieces: SeatPieces): PinkKittySeat {
  const { plan, hall: site, market } = town;
  const props: Dressing[] = [], braziers: RoyalBrazier[] = [];
  const castle = createCastleContent(plan.castle, 'hearth');
  const court = createCastleCourtContent(plan.castle, 'hearth');
  props.push(...court.props);
  braziers.push(...court.braziers);

  // The river hall, on the reach the town chose for it, with its flag at rest and its piers carried to the bed.
  const hall: Placement = { origin: site.origin, turn: site.turn };
  props.push(dressing(pieces.hall.blueprint, hall));
  for (const part of pieces.hall.parts) props.push({ blueprint: part.blueprint, position: placeAt(hall, [part.offset[0], part.offset[1], part.offset[2]]), yaw: site.turn * Math.PI / 2 });
  const piers = footings(plan, pieces.hall, hall, pieces.hall.blueprint.id);
  if (piers) props.push(piers);
  // The lamps under the arches burn as open flames over the water; the gallery's marquee stays dark glass until
  // people are inside, as no light stands in for a person.
  for (const emitter of pieces.hall.emitters) if (/arch|door/.test(emitter.id)) braziers.push({ position: placeAt(hall, [emitter.position[0], emitter.position[1], emitter.position[2]]), normal: [0, 1, 0] });
  // Where the abutments stand above the levee and the meadow, a battered revetment wraps them down to the ground;
  // the far end's balcony lights the far bank from its corner piers.
  const hallGround = (x: number, z: number) => { const p = placeAt(hall, [x, 0, z]); return (terrainHeight(plan, p[0], p[2]) - hall.origin[1]) / CELL; };
  const revetments: Rect[] = [];
  for (const end of ['far', 'near'] as const) {
    const revetment = createAbutmentRevetment({ end, ground: hallGround });
    const at: Placement = { origin: placeAt(hall, revetment.offset), turn: hall.turn };
    props.push(dressing(revetment.blueprint, at));
    for (const fire of revetment.fires) braziers.push({ position: placeAt(hall, fire), normal: [0, 1, 0] });
    revetments.push(footprint(revetment.size, at));
  }
  // Roses on the far meadow below the balcony: a border along the foot of the approach bank, where the ground lies
  // flat enough to stand a bush, the nearest such ground to the bank's toe.
  for (let x = 14, beat = 0; x <= 98; x += 12, beat++) {
    const variant = ((beat * 3) % 4) as RoseBushVariant, bush = createRoseBush(variant), size = bush.size, half = size[0] * CELL / 2;
    let z = -10;
    while (z > -80 && Math.max(batterTop(-z), bankTop(-z)) > hallGround(x, z)) z -= 1;
    for (let zc = z - size[2] / 2 - 1; zc > -100; zc -= 2) {
      const centre = placeAt(hall, [x, 0, zc]);
      const ground = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => terrainHeight(plan, centre[0] + a! * half, centre[2] + b! * half));
      if (Math.max(...ground) - Math.min(...ground) > .4) continue;
      const bushAt = centredOn([size[0] / 2, 0, size[2] / 2], [centre[0], centre[2]], Math.min(...ground), (beat % 4) as CardinalTurn);
      props.push(dressing(bush, bushAt));
      revetments.push(footprint(size, bushAt));
      break;
    }
  }

  // The landing: a stone platform at the bank and a grand stair down to the square, its foot flush with the paving.
  const rise = Math.round(town.landing.drop / CELL);
  const landing = createHallLanding({ riseCells: rise - rise % 2, widthCells: 96 });
  const landingAt: Placement = { origin: [site.bounds.maxX, market[1] - 1, site.centre[1] - landing.size[2] * CELL / 2], turn: 0 };
  props.push(dressing(landing.blueprint, landingAt));
  for (const fire of landing.fires) braziers.push({ position: placeAt(landingAt, [fire[0], fire[1], fire[2]]), normal: [0, 1, 0] });
  const taken: Rect[] = [footprint(pieces.hall.blueprint.size, hall), footprint(landing.size, landingAt), ...revetments, ...plan.homes.map(home => home.lot)];
  // The scene sets the market's well, stalls and stores around the market node; keep clear of them too.
  const node = plan.nodes.find(item => item.id === plan.market.nodeId)!.position;
  for (const prop of placeMarketContent(plan.market)) {
    const at: Placement = { origin: [prop.position[0] + node[0], prop.position[1], prop.position[2] + node[2] - 10], turn: 0 };
    taken.push(footprint(prop.blueprint.size, at));
  }

  // The glass screen closes the square's north side, its window turned south to the statue and the stair.
  const glass = createGlassScreen(pieces.emotes.glass);
  const screenAt = centredOn([glass.size[0] / 2, 0, glass.size[2] / 2], [market[0] + 1, market[2] + 30], market[1], 2);
  props.push(dressing(glass.blueprint, screenAt));
  const glassAt = placeAt(screenAt, [glass.glassOffset[0], glass.glassOffset[1], glass.glassOffset[2]]);
  props.push({ blueprint: pieces.emotes.glass.blueprint, position: glassAt, yaw: Math.PI });
  for (const fire of glass.fires) braziers.push({ position: placeAt(screenAt, [fire[0], fire[1], fire[2]]), normal: [0, 1, 0] });
  taken.push(footprint(glass.size, screenAt));

  // The Lantern and Oar on its reach of the bank: its back wall and jetty to the river, its door to the lane. Its
  // lanterns burn as the place's own fire; its windows stay dark glass until real people are inside.
  const fixtures: KeeperFixture[] = [];
  if (town.tavern) {
    const t = pieces.tavern, site = town.tavern;
    const at = centredOn([(t.footprint[0] + t.footprint[2]) / 2, 0, t.footprint[1]], site.back, site.ground - t.ground * CELL, site.turn);
    const point = (local: readonly number[]): Vec3 => placeAt(at, [local[0]!, local[1]!, local[2]!]);
    props.push(dressing(t.blueprint, at));
    // Its masonry is founded a metre under the floor; where the levee falls away below that, stone carries it down.
    // The steps' terrace holds the front, so the inn's own footing stops at the apron there.
    const front = site.steps ? LANTERN_AND_OAR.jettyFront + 1 : t.footprint[3];
    const founded: Placement = { origin: point([0, LANTERN_AND_OAR.found, 0]), turn: at.turn };
    const base = footings(plan, { footings: [{ box: { from: [t.footprint[0], 0, t.footprint[1]], to: [t.footprint[2], 1, front] } }] }, founded, t.blueprint.id);
    if (base) props.push(base);
    for (const fire of t.fires) braziers.push({ position: point(fire), normal: [0, 1, 0] });
    taken.push(footprint(t.blueprint.size, at));
    if (site.steps) {
      // The town graded the meadow by every road near the foot, so the ground there is not quite the ground the
      // steps were drawn for; where it lies lower, the flight runs on a tread or two to meet it.
      let rise = site.steps.rise;
      for (let pass = 0; pass < 3; pass++) {
        const foot = point(tavernStepsPlan({ riseCells: rise, toward: site.steps.toward }).foot);
        const below = 2 * Math.round((foot[1] - terrainHeight(plan, foot[0], foot[2])) / CELL / 2);
        const next = Math.min(TAVERN_STEPS.rise.max, rise + Math.max(0, below));
        if (next === rise) break;
        rise = next;
      }
      const steps = createTavernSteps({ riseCells: rise, toward: site.steps.toward });
      const stepsAt: Placement = { origin: point(steps.offset), turn: at.turn };
      props.push(dressing(steps.blueprint, stepsAt));
      const [x0, z0, x1, z1] = steps.footprint;
      const under = footings(plan, { footings: [{ box: { from: [x0 - steps.offset[0], 0, z0 - steps.offset[2]], to: [x1 - steps.offset[0], 1, z1 - steps.offset[2]] } }] }, stepsAt, steps.blueprint.id);
      if (under) props.push(under);
      for (const fire of steps.fires) braziers.push({ position: point(fire), normal: [0, 1, 0] });
      taken.push(footprint(steps.size, stepsAt));
    }
    // The keeper works on the inn's own floor: the door, sign, bench and barrels stand on its paving, the moorings
    // on its jetty deck.
    const facing = facingOf(site.turn);
    fixtures.push({ id: 'lantern-and-oar-door', kind: 'door', position: point(t.door), facing });
    fixtures.push({ id: 'lantern-and-oar-bench', kind: 'bench', position: point([t.bench[0], t.ground, t.bench[2]]), facing });
    fixtures.push({ id: 'lantern-and-oar-barrels', kind: 'barrel', position: point([t.barrel[0], t.ground, t.barrel[2]]), facing });
    for (const [i, post] of t.moorings.entries()) fixtures.push({ id: `lantern-and-oar-mooring-${i}`, kind: 'mooring', position: point([post[0], t.ground, post[2]]), facing: facing + Math.PI });
  }

  // Long rose planters along the square's south and east edges, wherever no lane opens through them.
  const clearOfRoads = (r: Rect, margin: number) => plan.streets.every(street => street.points.every((p, i) => i === 0 || rectRoadDistance(r, street.points[i - 1]!, p) > street.width / 2 + margin));
  const planterEdges: { from: readonly [number, number]; turn: CardinalTurn; count: number }[] = [
    { from: [market[0] - 10, market[2] - 14.5], turn: 0, count: 4 },
    { from: [market[0] + 14.5, market[2] - 8], turn: 1, count: 6 },
  ];
  for (const edge of planterEdges) for (let i = 0; i < edge.count; i++) {
    const along = i * 6.5, centre: [number, number] = edge.turn === 0 ? [edge.from[0] + along + 3, edge.from[1]] : [edge.from[0], edge.from[1] + along + 3];
    const at = centredOn([24, 0, ROSE_PLANTER.depth / 2], centre, market[1], edge.turn);
    const r = footprint([48, 0, ROSE_PLANTER.depth], at);
    if (!clearOfRoads(r, .75) || taken.some(t => overlaps(r, t, .5))) continue;
    props.push(dressing(createRosePlanter(48), at));
    taken.push(r);
  }

  // Bell Court's lamp posts: the lamplighter's round. They stand inside the square's south and east edges, fronts
  // turned in to the paving where the lamplighter works. Their glass stays dark: a lamp here burns only with the
  // kingdom's own presence, never for an empty potential town.
  const lampPost = createKeeperLampPost('hearth'), lampFixtures: KeeperFixture[] = [];
  // The links from the market node out to the lane mouths cross the paving itself; only the lanes beyond count.
  const paved = boundsOfSquare(plan.market.boundary);
  const inSquare = (a: readonly number[], b: readonly number[]) => {
    const x = (a[0]! + b[0]!) / 2, z = (a[2]! + b[2]!) / 2;
    return x > paved.minX && x < paved.maxX && z > paved.minZ && z < paved.maxZ;
  };
  const clearOfLanes = (r: Rect, margin: number) => plan.streets.every(street => street.points.every((p, i) => i === 0 || inSquare(street.points[i - 1]!, p) || rectRoadDistance(r, street.points[i - 1]!, p) > street.width / 2 + margin));
  const lampAnchor = KEEPER_PROP_ANCHORS.lamp.origin;
  const lampSites: { at: readonly [number, number]; turn: CardinalTurn }[] = [
    { at: [market[0] + 7, market[2] - 11.5], turn: 0 }, { at: [market[0] - 12, market[2] - 11.5], turn: 0 },
    { at: [market[0] + 12.5, market[2] - 3], turn: 3 }, { at: [market[0] + 12.5, market[2] + 9.5], turn: 3 },
    { at: [market[0] + 12.5, market[2] + 22], turn: 3 },
  ];
  for (const [i, lamp] of lampSites.entries()) {
    const at = centredOn([lampAnchor[0], 0, lampAnchor[2]], lamp.at, market[1], lamp.turn);
    const r = footprint(lampPost.size, at);
    if (!clearOfLanes(r, 1) || taken.some(t => overlaps(r, t, .5))) continue;
    props.push(dressing(lampPost, at));
    taken.push(r);
    lampFixtures.push({ id: `bell-court-lamp-${i}`, kind: 'lamp', position: [lamp.at[0], market[1], lamp.at[1]], facing: facingOf(lamp.turn) });
  }

  // Rose arches over the lane mouths, square to lanes that leave on a cardinal line.
  for (const lane of town.lanes) {
    const clear = Math.round(lane.width / CELL) + 10;
    if (clear > ROSE_ARCH_WIDTHS.max || lane.points.length < 14) continue;
    const p = lane.points[7]!, a = lane.points[4]!, b = lane.points[10]!, dx = b[0] - a[0], dz = b[2] - a[2];
    const along = Math.abs(dz) >= Math.abs(dx), skew = Math.atan2(along ? Math.abs(dx) : Math.abs(dz), along ? Math.abs(dz) : Math.abs(dx));
    if (skew > .26) continue;
    const width = Math.max(ROSE_ARCH_WIDTHS.min, clear + clear % 2), frame = roseArchFrame(width);
    const at = centredOn([frame.size[0] / 2, 0, frame.size[2] / 2], [p[0], p[2]], terrainHeight(plan, p[0], p[2]), along ? 0 : 1);
    const r = footprint(frame.size, at);
    if (taken.some(t => overlaps(r, t, .25))) continue;
    props.push(dressing(createRoseArch(width), at));
    taken.push(r);
  }

  // The town bank of the river, up and down stream of the hall: fire cressets two and a half metres from the water,
  // with roses between them, wherever the bank is level enough to stand a post on.
  const land = plan.genesisSurface!;
  const shore = (x: number, z: number) => sampleLandWater(land.terrainCore as never, x, z)?.shoreDistance ?? Infinity;
  const cresset = createRiverCresset();
  let beat = 0;
  for (const [from, step] of [[site.bounds.maxZ + 6, 6], [site.bounds.minZ - 6, -6]] as const) {
    for (let z = from, n = 0; n < 12; z += step, n++) {
      const river = riverAt(land, z);
      let x = river.x;
      while (x < river.x + 30 && shore(x, z) < 2.5) x += .25;
      if (x >= river.x + 30) continue;
      const isFire = beat % 3 === 0, piece = isFire ? cresset.blueprint : createRoseBush((beat % 4) as RoseBushVariant), size = piece.size;
      const half = size[0] * CELL / 2, cx = x + half, ground = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => terrainHeight(plan, cx + a! * half, z + b! * half));
      if (Math.max(...ground) - Math.min(...ground) > .5) continue;
      const at = centredOn([size[0] / 2, 0, size[2] / 2], [cx, z], Math.min(...ground), 0);
      const r = footprint(size, at);
      if (taken.some(t => overlaps(r, t, .25)) || !clearOfRoads(r, .25)) continue;
      props.push(dressing(piece, at));
      if (isFire) braziers.push({ position: placeAt(at, [cresset.fire[0], cresset.fire[1], cresset.fire[2]]), normal: [0, 1, 0] });
      taken.push(r);
      beat++;
    }
  }

  // The arms: the crest before the castle gate facing down Crown Way, the standard in the square facing the hall.
  const gate = plan.nodes.find(node => node.id === plan.castle.gateNodeId)!;
  const crestSize = pieces.heraldry.crest.blueprint.size;
  const crest = centredOn([crestSize[0] / 2, 0, crestSize[2] / 2], [gate.position[0] - 9, gate.position[2] - 7], terrainHeight(plan, gate.position[0] - 9, gate.position[2] - 7), 0);
  props.push(dressing(pieces.heraldry.crest.blueprint, crest));
  const standardSize = pieces.heraldry.standard.blueprint.size;
  for (const dz of [-9, 9]) {
    // Turn 3 faces the cloth's +Z west, toward the hall door across the square.
    const standard = centredOn([standardSize[0] / 2, 0, standardSize[2] / 2], [market[0] - 11, market[2] + dz], market[1], 3);
    props.push(dressing(pieces.heraldry.standard.blueprint, standard));
  }

  // The statue stands on the stair's axis in the square, facing the hall it greets.
  const monument = pieces.emotes.monument;
  if (monument) {
    const frame = monument.frames[0]!.blueprint;
    const statue = centredOn([monument.footprint[0] / 2, 0, monument.footprint[1] / 2], [market[0] + 1, market[2]], market[1], 3);
    props.push(dressing(frame, statue));
  }
  // The vane turns over the hall's far gable, above the river.
  const vane = pieces.emotes.vane;
  if (vane) {
    const apex = [56, 0, 28] as const, top = topAt(pieces.hall.blueprint, apex[0], apex[2]);
    const mount = placeAt(hall, [apex[0], top + 1, apex[2]]);
    const mast = centredOn([vane.mount[0], 0, vane.mount[2]], [mount[0], mount[2]], mount[1], 0);
    props.push(dressing(vane.mast, mast));
    const pivot = placeAt(mast, [vane.mastPivot[0], vane.mastPivot[1], vane.mastPivot[2]]);
    const rotor = centredOn([vane.rotorPivot[0], 0, vane.rotorPivot[2]], [pivot[0], pivot[2]], pivot[1] - vane.rotorPivot[1] * CELL, 1);
    props.push(dressing(vane.rotor, rotor));
  }
  const places: Record<string, BuiltPlace> = {};
  const square = boundsOfSquare(plan.market.boundary);
  if (lampFixtures.length) places.plaza = { centre: nearestAll(square, lampFixtures), fixtures: lampFixtures };
  // The inn's place is centred where its keeper is nearest every fixture: in the taproom, not on the doorstep.
  if (town.tavern && fixtures.length) places.tavern = { centre: nearestAll(town.tavern.bounds, fixtures), fixtures };
  return { seat: { buildings: castle.buildings, props, braziers, beaconPosition: castle.beaconPosition, crossing: true }, places };
}
