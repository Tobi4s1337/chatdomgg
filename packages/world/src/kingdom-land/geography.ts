import type { Vec3 } from '@chatdom/shared';
import { randomUnit, seedHash, type KingdomConfig } from '../layout';
import { pointBounds, polygonDistance, segmentProjection, transformCardinalPoint } from '../settlement/geometry';
import type { BoundsXZ, CardinalTurn, CastleModulePlacement, CastlePlan, XZ } from '../settlement/types';
import { landBeforeWater, naturalLandHeight, waterKeepOut } from './surface';
import type { KingdomLandform, LandHill, LandPlaces, LandSite, LandStream, WaterBody } from './types';

/**
 * Founded geography for a version 2 kingdom: the land, its one water system, the castle court and the
 * fixed places people walk to. Everything derives from the seed alone, never from population or year,
 * so a hamlet and the town it becomes stand on exactly the same ground.
 *
 * Orientation: -Z is north (the castle), +X is east. Bearings are atan2(dx, dz): 0 faces +Z (south).
 */

/** Every founded feature lies inside this frame; with the plan's 16 m margin it is one 512 m terrain request. */
export const LAND_FRAME: BoundsXZ = { minX: -240, maxX: 240, minZ: -160, maxZ: 320 };
/** The keep's inner door sill, measured from its blueprint (front wall opening at cells 116..140, sill 13, face 169). */
export const KEEP_DOOR_LOCAL_METRES: Vec3 = [16, 1.625, 21.125];
export const COURT_ELEVATION = 20;
/** The interim civic footbridge: 8 m long along its local X, 4 m wide, a 4.5 m clear span between its piers. */
export const BRIDGE_SPAN = { length: 8, width: 4, clear: 4.5 } as const;
export const WHEEL_HEAD_METRES = 5.5;

export interface KingdomGeography {
  landform: KingdomLandform;
  castle: CastlePlan;
  sites: readonly LandSite[];
  places: LandPlaces;
}

type Point = { position: XZ; bed: number; level: number; width: number };
const round8 = (value: number) => Math.round(value * 8) / 8;
const bearing = (from: XZ, to: XZ) => Math.atan2(to[0] - from[0], to[1] - from[1]);

/** The court is 40×24 m: the keep and rear range stand 12 m further back, the sides closed with stock curtains. */
export function createKingdomCastle(): CastlePlan {
  const y = COURT_ELEVATION, modules: CastleModulePlacement[] = [
    { id: 'castle:keep', kind: 'keep', position: [-16, y, -92], rotation: 0, size: [32, 31, 32] }];
  for (const [i, position] of ([[-32, y, -96], [20, y, -96], [-32, y, -48], [20, y, -48]] as const).entries())
    modules.push({ id: `castle:tower:${i}`, kind: 'tower', position: [...position], rotation: 0, size: [12, 24, 12] });
  modules.push({ id: 'castle:gatehouse', kind: 'gatehouse', position: [-8, y, -46], rotation: 0, size: [16, 18, 10] });
  // Front curtains keep their accepted identity and footprint for the replacement parapets.
  for (const [i, x] of [-20, 8].entries()) modules.push({ id: `castle:front:${i}`, kind: 'curtain', position: [x, y, -39], rotation: 0, size: [12, 10, 3] });
  for (const [i, x] of [-20, 0].entries()) modules.push({ id: `castle:rear:${i}`, kind: 'curtain', position: [x, y, -96], rotation: 0, size: [20, 10, 3] });
  // Turn 1 runs a curtain's length toward -Z: 24 m from the front towers, then 12 m to the rear towers.
  for (const [i, [x, z, length]] of ([[-32, -48, 24], [29, -48, 24], [-32, -72, 12], [29, -72, 12]] as const).entries())
    modules.push({ id: `castle:side:${i}`, kind: 'curtain', position: [x, y, z], rotation: 1, size: [length, 10, 3] });
  return { centre: [0, y, -66], bounds: { minX: -32, maxX: 32, minZ: -96, maxZ: -36 }, modules,
    court: { id: 'castle:court', boundary: [[-20, -60], [20, -60], [20, -36], [-20, -36]], elevation: y, nodeId: 'castle:gate' },
    gateNodeId: 'castle:gate', beaconModuleId: 'castle:keep' };
}

/** Uniform Catmull-Rom through control points, resampled at roughly `step` metres. */
function smoothCourse(controls: readonly XZ[], step: number): XZ[] {
  const out: XZ[] = [controls[0]!];
  for (let i = 0; i < controls.length - 1; i++) {
    const p0 = controls[Math.max(0, i - 1)]!, p1 = controls[i]!, p2 = controls[i + 1]!, p3 = controls[Math.min(controls.length - 1, i + 2)]!;
    const count = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 1; k <= count; k++) {
      const t = k / count, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

/**
 * Surface levels that follow the land downhill: each point sits `incision` below its ground where it can,
 * never rises, and arrives exactly at the receiving water's level.
 */
function courseLevels(path: readonly XZ[], ground: (x: number, z: number) => number, start: number, end: number, incision: number): number[] {
  const levels: number[] = [];
  for (const [i, [x, z]] of path.entries()) levels.push(i ? Math.min(levels[i - 1]!, ground(x, z) - incision) : start);
  levels[levels.length - 1] = end;
  for (let i = levels.length - 2; i >= 0; i--) levels[i] = Math.max(levels[i]!, end);
  return levels.map(round8);
}

function stream(id: string, kind: LandStream['kind'], bank: number, path: readonly XZ[], levels: readonly number[],
  width: (i: number) => number, depth: (i: number) => number): LandStream {
  const points: Point[] = path.map((position, i) => ({ position: [round8(position[0]), round8(position[1])], level: levels[i]!,
    width: round8(width(i)), bed: round8(levels[i]! - depth(i)) }));
  return { id, kind, bank, points };
}

function rectangle(origin: Vec3, turn: CardinalTurn, width: number, depth: number): XZ[] {
  // Counter-clockwise in (x, z) for every turn: positive shoelace area.
  const corners = ([[0, 0], [0, depth], [width, depth], [width, 0]] as const).map(([x, z]) => {
    const p = transformCardinalPoint(origin, turn, [x, 0, z]); return [p[0], p[2]] as XZ;
  });
  return signedArea(corners) > 0 ? corners : corners.reverse();
}
export function signedArea(polygon: readonly XZ[]): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) { const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!; area += a[0] * b[1] - b[0] * a[1]; }
  return area / 2;
}

export function foundKingdomGeography(config: KingdomConfig): KingdomGeography {
  if (typeof config.seed !== 'string') throw new Error('Land needs a seed');
  const seed = seedHash(config.seed), phase = (seed % 6283) / 1000;
  const jitter = (key: string, amount: number) => (randomUnit(seedHash(`${config.seed}:land:${key}`)) * 2 - 1) * amount;
  const at = (x: number, z: number, key: string, amount = 3): XZ => [round8(x + jitter(`${key}:x`, amount)), round8(z + jitter(`${key}:z`, amount))];
  const ridge = { origin: [0, 70] as XZ, bearing: .03 * Math.sin(phase), length: 230, width: 145, height: 7 };

  // Rises are level-topped: each plateau sits exactly at its height, later ones shaping earlier ones.
  // The east shelf is the millstream's upland: its scarp edge faces the lake meadow, where the mill sits.
  const castleHill: LandHill = { id: 'castle-rise', centre: [0, -66], radius: 92, height: COURT_ELEVATION, plateau: 44 };
  const shelfHeight = round8(10.5 + jitter('shelf:h', .5));
  const lookoutCentre = at(200, 264, 'lookout', 2);
  const hills: LandHill[] = [
    { id: 'west-wold', centre: at(-238, 10, 'west-wold', 8), radius: 125, height: 12, plateau: 36 },
    { id: 'east-shelf', centre: at(238, 60, 'east-shelf', 2), radius: 152, height: shelfHeight, plateau: 132 },
    { id: 'east-wold', centre: at(234, -34, 'east-wold', 3), radius: 146, height: shelfHeight + 2, plateau: 118 },
    { id: 'spring-wold', centre: at(130, -148, 'spring-wold', 4), radius: 90, height: 17, plateau: 22 },
    castleHill,
    { id: 'lookout', centre: lookoutCentre, radius: 68, height: round8(27.5 + jitter('lookout:h', .75)), plateau: 8 },
  ];
  const lakeCentre = at(86, 262, 'lake', 2);
  const lake: WaterBody = { id: 'lake', x: lakeCentre[0], z: lakeCentre[1], radiusX: 35, radiusZ: 30, level: -.5, depth: 2.9 };
  const draft = (extra: { waters?: WaterBody[]; streams?: LandStream[] }): KingdomLandform => ({
    version: 2, seed, ridge, castleRise: { centre: castleHill.centre, radius: castleHill.radius, height: castleHill.height },
    lake: { x: lake.x, z: lake.z, radiusX: lake.radiusX, radiusZ: lake.radiusZ, level: lake.level },
    hills: [...hills], waters: extra.waters ?? [], streams: extra.streams ?? [] });

  // The mill turns under the shelf's scarp: the leat arrives along the brow, a timber trough carries the
  // last 11 m over the bank to the wheel, and the mill stands west of its wheel in a dell cut into the slope.
  const wheel = at(146, 161, 'wheel', 1.5);
  const leatEnd: XZ = [wheel[0], wheel[1] - 11];
  const millCentre: XZ = [wheel[0] - 7.25, wheel[1]];
  const millGround = round8(3.5 + jitter('mill:h', .25));
  // The dell opens south of the mill so the leat's end stays on the brow and the trough spans the scarp;
  // its 11 m falloff keeps that bank near 1 m per metre, a slope the terrain skin follows without a cliff.
  hills.push({ id: 'mill-dell', centre: [millCentre[0], millCentre[1] + 4], radius: 20, height: millGround, plateau: 9 });
  // The campfire clearing is a level terrace in the west woods: 9.6 m fire envelope, furniture, egress, crowns.
  const clearingCentre = at(-196, 72, 'clearing', 3), clearingRadius = 18;
  const clearingLevel = round8(landBeforeWater(draft({}), clearingCentre[0], clearingCentre[1]));
  hills.push({ id: 'clearing', centre: clearingCentre, radius: clearingRadius + 16, height: clearingLevel, plateau: clearingRadius + 2 });
  const dry = draft({}), ground = (x: number, z: number) => landBeforeWater(dry, x, z);

  // Mill pond on the shelf, 0.625 m below its banks, held by the weir at its south end.
  const pondCentre = at(165, 139, 'pond', 2);
  const pondLevel = round8(shelfHeight - .625);
  const pond: WaterBody = { id: 'pond', x: pondCentre[0], z: pondCentre[1], radiusX: 9.5, radiusZ: 12.5, level: pondLevel, depth: 1.6 };
  const tailraceStart = round8(millGround - 1);
  if (pondLevel - tailraceStart < WHEEL_HEAD_METRES) throw new Error('The mill wheel needs its full head');

  // Upper millstream: from a spring north-east of the castle, along the upland east of the town, into the pond.
  const spring = at(100, -118, 'spring', 3);
  const upperPath = smoothCourse([spring, at(118, -88, 'upper:1'), at(130, -50, 'upper:2'), at(138, -8, 'upper:3'),
    at(147, 34, 'upper:4'), at(156, 74, 'upper:5'), at(161, 106, 'upper:6', 2), [pond.x, pond.z - pond.radiusZ * .55]], 3);
  const upperLevels = courseLevels(upperPath, ground, round8(ground(spring[0], spring[1]) - .5), pondLevel, .9);
  const poolCentres = [Math.floor(upperPath.length * (.32 + jitter('pool:a', .05))), Math.floor(upperPath.length * (.64 + jitter('pool:b', .05)))];
  const poolOffset = (i: number) => Math.min(...poolCentres.map(p => Math.abs(i - p)));
  const upper = stream('stream:upper', 'stream', 10, upperPath, upperLevels,
    i => i < 6 ? 1.75 + i * .3 : poolOffset(i) <= 2 ? 5.5 - poolOffset(i) * .6 : 3.4 + .6 * Math.sin(i * .37 + phase),
    i => poolOffset(i) <= 2 ? 1.25 : .7);

  // Lower millstream: over the weir, down the scarp, joined by the tailrace, level beneath the bridge, into the lake.
  const weirAt = shorePoint(draft({ waters: [pond] }), [pond.x, pond.z], 0).map(round8) as unknown as XZ;
  const crossing = at(141, 207, 'crossing', 1.5);
  const mouth: XZ = [lake.x + lake.radiusX * .6, lake.z - lake.radiusZ * .62];
  const lowerPath = smoothCourse([weirAt, [weirAt[0], weirAt[1] + 7], at(160, 172, 'lower:1', 2), at(153, 186, 'lower:2', 1.5),
    [crossing[0] + 1.5, crossing[1] - 14], [crossing[0], crossing[1] - 7], [crossing[0], crossing[1] + 7], [crossing[0] - 2, crossing[1] + 15],
    at(124, 234, 'lower:3', 2), mouth], 3);
  // The bridge pool runs straight north–south beneath the deck and is level; its landings stand on dry bank.
  for (let i = 0; i < lowerPath.length; i++) if (Math.abs(lowerPath[i]![1] - crossing[1]) <= 7) lowerPath[i] = [crossing[0], lowerPath[i]![1]];
  const weirDrop = round8(.75 + jitter('weir', .125));
  // Traced over the lake's own shore, so the stream eases down its apron instead of falling in at the mouth.
  const shore = draft({ waters: [lake] });
  const lowerLevels = courseLevels(lowerPath, (x, z) => naturalLandHeight(shore, x, z), pondLevel - weirDrop, lake.level, 1);
  const poolIndices = lowerPath.flatMap((p, i) => Math.abs(p[1] - crossing[1]) <= 7 ? [i] : []);
  const poolLevel = lowerLevels[poolIndices[0]!]!;
  for (const i of poolIndices) lowerLevels[i] = poolLevel;
  const lower = stream('stream:lower', 'stream', 9, lowerPath, lowerLevels,
    i => poolIndices.includes(i) ? 3.75 : i < 3 ? 4.5 : 3.5 + .8 * Math.sin(i * .41 + phase),
    i => poolIndices.includes(i) ? 1.1 : .8);

  // Earth leat: out of the pond's west side and along the brow, ending 11 m short of the wheel.
  const leatPath = smoothCourse([[pond.x - pond.radiusX * .4, pond.z + 3], [pond.x - pond.radiusX - 5, pond.z + 7], leatEnd], 2.5);
  const leatLevels = leatPath.map((_, i) => round8(pondLevel - .25 * i / (leatPath.length - 1)));
  // Its end is embanked over the dell's upper slope; a 9 m bank lets that embankment settle into the slope.
  const leat = stream('leat', 'leat', 9, leatPath, leatLevels, () => 1.75, () => .6);

  // Tailrace: out of the wheel pit, south, joining the lower stream above the bridge at that stream's level.
  const joinIndex = lowerLevels.findIndex((level, i) => i > 2 && level <= tailraceStart - .25 && lowerPath[i]![1] < crossing[1] - 9);
  if (joinIndex < 0) throw new Error('The tailrace has no lower water to join above the bridge');
  const join = lowerPath[joinIndex]!;
  const tailracePath = smoothCourse([[wheel[0], wheel[1] - 1.5], [wheel[0], wheel[1] + 6], [(wheel[0] + join[0]) / 2 - 2, (wheel[1] + 6 + join[1]) / 2], join], 2.5);
  const tailraceLevels = courseLevels(tailracePath, ground, tailraceStart, lowerLevels[joinIndex]!, .9);
  // Its bank reaches 11 m: the race is cut along the foot of the shelf and needs room to climb back to it.
  const tailrace = stream('tailrace', 'tailrace', 11, tailracePath, tailraceLevels, () => 2.25, () => .75);

  const landform: KingdomLandform = draft({ waters: [lake, pond], streams: [upper, lower, leat, tailrace] });
  const height = (x: number, z: number) => round8(naturalLandHeight(landform, x, z));
  const groundAt = (p: XZ): Vec3 => [round8(p[0]), height(p[0], p[1]), round8(p[1])];

  // Sites. Each origin is its blueprint corner; footprint is CCW; turn is the structure's cardinal yaw.
  const sites: LandSite[] = [];
  const site = (id: string, kind: LandSite['kind'], name: string, origin: Vec3, turn: CardinalTurn, width: number, depth: number) =>
    sites.push({ id, kind, name, position: origin, turn, footprint: rectangle(origin, turn, width, depth) });
  // Weir: across the outlet on the pond's rim, crest at the pond's level, forward downstream (+Z).
  site('water:weir', 'weir', 'Weir', [weirAt[0] - 4, pondLevel, weirAt[1] - 1.5], 0, 8, 3);
  // Wheel pit at the head of the tailrace, origin at its floor (the tailrace surface); water arrives from -Z.
  site('water:wheel', 'wheel', 'Mill wheel', [wheel[0] - 1.25, tailraceStart, wheel[1] - 3.5], 0, 2.5, 7);
  site('water:mill', 'mill', 'The mill', [millCentre[0] - 5.5, millGround, millCentre[1] - 4.5], 0, 11, 9);
  // The footbridge walks along its local X; turn 0 spans east–west across the north–south pool.
  const landing = Math.max(height(crossing[0] - 3.75, crossing[1]), height(crossing[0] + 3.75, crossing[1]));
  site('water:bridge', 'bridge', 'Millstream bridge', [crossing[0] - BRIDGE_SPAN.length / 2, landing, crossing[1] - BRIDGE_SPAN.width / 2], 0, BRIDGE_SPAN.length, BRIDGE_SPAN.width);
  const signAt: XZ = [crossing[0] - BRIDGE_SPAN.length / 2 - 2.5, crossing[1] - 3.5];
  site('water:sign', 'sign', 'Fingerpost', [signAt[0] - .5, height(signAt[0], signAt[1]), signAt[1] - .5], 0, 1, 1);
  // Pier from the east shore, running west over the water (turn 3: local +Z faces -X), deck datum at lake level.
  const pierRoot = shorePoint(landform, [lake.x, lake.z + jitter('pier', 2)], 1);
  const pierOrigin: Vec3 = [round8(pierRoot[0] + 1.5), lake.level, round8(pierRoot[1] - 1.25)];
  sites.push({ id: 'water:pier', kind: 'pier', name: 'Pier', position: pierOrigin, turn: 3, footprint: pierFootprint(pierOrigin, 3) });
  const boatRoot = shorePoint(landform, [lake.x, lake.z + 15], 1);
  site('water:boathouse', 'boathouse', 'Boathouse', [round8(boatRoot[0] + 5), lake.level, round8(boatRoot[1] - 4)], 3, 8, 11);
  const rockRoot = shorePoint(landform, [lake.x - 8, lake.z], 0, -.5);
  site('water:rock', 'rock', 'Fishing rock', [round8(rockRoot[0] + 2), lake.level, round8(rockRoot[1] + 1.5)], 2, 4, 3);

  // Lookout: an earth trail from the pier's landing to the knoll's foot, then winding up its north face at a
  // steady grade, the town and castle opening on the left as it climbs.
  const lookout = hills.find(hill => hill.id === 'lookout')!;
  const trailStart: XZ = [round8(pierRoot[0] + 4), round8(pierRoot[1] - 4)];
  const climb = windingTrail(lookout.centre, lookout.plateau, trailStart, (x, z) => naturalLandHeight(landform, x, z), .17, 1);
  const trail = climb.filter((_, i, all) => i % 2 === 0 || i === all.length - 1).map(groundAt);
  const summit: Vec3 = [lookout.centre[0], lookout.height, lookout.centre[1]];

  // Forest: the treeline runs down the west; an elder oak stands at its edge where the path enters.
  const oakAt = at(-170, 96, 'oak', 3);
  const treeline: XZ[] = ([[-138, -160], [-146, -118], [-166, -72], [-176, -24], [-170, 30], [oakAt[0] - 4, oakAt[1] - 18],
    [oakAt[0] - 6, oakAt[1] + 16], [-182, 150], [-170, 214], [-150, 268], [-140, 320]] as const).map(p => [round8(p[0]), round8(p[1])] as XZ);
  const towardOak = Math.atan2(oakAt[1] - clearingCentre[1], oakAt[0] - clearingCentre[0]);
  const clearingEdge: XZ = [clearingCentre[0] + Math.cos(towardOak) * clearingRadius, clearingCentre[1] + Math.sin(towardOak) * clearingRadius];
  const forestPath = smoothCourse([[oakAt[0] + 6, oakAt[1] + 3], [oakAt[0] - 9, oakAt[1] - 3], clearingEdge], 2).map(groundAt);
  const beacon: XZ = [0, -76];
  const places: LandPlaces = {
    court: { boundary: [[-20, -60], [20, -60], [20, -36], [-20, -36]], elevation: COURT_ELEVATION,
      keepDoor: transformCardinalPoint([-16, COURT_ELEVATION, -92], 0, KEEP_DOOR_LOCAL_METRES), gate: [0, COURT_ELEVATION, -36],
      // Wall-walk centrelines of the two front curtains (8.75 m up, 1.5 m in from the field face).
      parapet: [[[-20, -37.5], [-8, -37.5]], [[8, -37.5], [20, -37.5]]] },
    lookout: { summit, viewBearing: bearing(lookout.centre, [-10, 70]), trail },
    forest: { oak: groundAt(oakAt), entryBearing: bearing(oakAt, clearingCentre), path: forestPath,
      clearing: { centre: [clearingCentre[0], clearingLevel, clearingCentre[1]], radius: clearingRadius,
        gapBearing: bearing(clearingCentre, beacon) }, treeline },
  };
  return { landform, castle: createKingdomCastle(), sites, places };
}

/** A path rising at a steady grade, winding around a level-topped hill until it reaches the plateau. */
function windingTrail(centre: XZ, plateau: number, start: XZ, ground: (x: number, z: number) => number, grade: number, turn: 1 | -1): XZ[] {
  let radius = Math.hypot(start[0] - centre[0], start[1] - centre[1]), angle = Math.atan2(start[1] - centre[1], start[0] - centre[0]);
  const trail: XZ[] = [start], step = 1;
  for (let guard = 0; guard < 900 && radius > plateau + .5; guard++) {
    const here = ground(trail.at(-1)![0], trail.at(-1)![1]);
    let best: { radius: number; angle: number; error: number } | undefined;
    // Mostly inward, but free to step outward where the lake shore climbs faster than the knoll.
    for (let k = -12; k <= 24; k++) {
      const dr = -step * k / 24, next = radius + dr, sweep = Math.sqrt(Math.max(0, step * step - dr * dr)) / Math.max(next, 1);
      const nextAngle = angle + turn * sweep, x = centre[0] + Math.cos(nextAngle) * next, z = centre[1] + Math.sin(nextAngle) * next;
      const error = Math.abs((ground(x, z) - here) / step - grade);
      if (!best || error < best.error - 1e-9) best = { radius: next, angle: nextAngle, error };
    }
    radius = best!.radius; angle = best!.angle;
    trail.push([centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius]);
  }
  return trail;
}

/** The first dry point walking from inside the water toward +X (side 1) or +Z (side 0), offset `inset` metres. */
function shorePoint(landform: KingdomLandform, from: XZ, side: 0 | 1, inset = 0): XZ {
  for (let d = 0; d < 80; d += .25) {
    const x = from[0] + (side ? d : 0), z = from[1] + (side ? 0 : d);
    if (!waterKeepOut(landform, x, z, 0)) return [x + (side ? inset : 0), z + (side ? 0 : inset)];
  }
  throw new Error('No shore found from the water');
}

/** 24 m walk 2.5 m wide, ending in an 8×4 m head: 28 m from landing to the head's far edge. */
function pierFootprint(origin: Vec3, turn: CardinalTurn): XZ[] {
  const local: XZ[] = [[0, 0], [2.5, 0], [2.5, 24], [5.25, 24], [5.25, 28], [-2.75, 28], [-2.75, 24], [0, 24]];
  const polygon = local.map(([x, z]) => { const p = transformCardinalPoint(origin, turn, [x, 0, z]); return [p[0], p[2]] as XZ; });
  return signedArea(polygon) > 0 ? polygon : polygon.reverse();
}

/** True where founded geography is spoken for: water and its margin, sites, the court, lookout and clearing. */
export function reservedByGeography(geography: KingdomGeography, x: number, z: number, margin: number): boolean {
  if (waterKeepOut(geography.landform, x, z, margin)) return true;
  for (const site of geography.sites) if (polygonDistance(site.footprint, x, z) < margin) return true;
  const { court, lookout, forest } = geography.places;
  if (polygonDistance(court.boundary, x, z) < margin) return true;
  const castle = geography.castle.bounds;
  if (x > castle.minX - margin && x < castle.maxX + margin && z > castle.minZ - margin && z < castle.maxZ + margin) return true;
  const hill = geography.landform.hills.find(item => item.id === 'lookout')!;
  if (Math.hypot(x - hill.centre[0], z - hill.centre[1]) < hill.plateau + margin) return true;
  for (let i = 1; i < lookout.trail.length; i++) {
    const a = lookout.trail[i - 1]!, b = lookout.trail[i]!;
    if (segmentProjection([a[0], a[2]], [b[0], b[2]], x, z).distance < 1.5 + margin) return true;
  }
  const clearing = forest.clearing;
  return Math.hypot(x - clearing.centre[0], z - clearing.centre[2]) < clearing.radius + margin;
}

/** Bounds of every founded feature, for checking the single-request fit. */
export function geographyBounds(geography: KingdomGeography): BoundsXZ {
  const points: XZ[] = [];
  for (const body of geography.landform.waters) points.push([body.x - body.radiusX * 1.2, body.z - body.radiusZ * 1.2], [body.x + body.radiusX * 1.2, body.z + body.radiusZ * 1.2]);
  for (const course of geography.landform.streams) for (const p of course.points) points.push(p.position);
  for (const site of geography.sites) points.push(...site.footprint);
  const { lookout, forest } = geography.places;
  for (const p of [...lookout.trail, ...forest.path]) points.push([p[0], p[2]]);
  const c = forest.clearing;
  points.push([c.centre[0] - c.radius, c.centre[2] - c.radius], [c.centre[0] + c.radius, c.centre[2] + c.radius]);
  const castle = geography.castle.bounds;
  points.push([castle.minX, castle.minZ], [castle.maxX, castle.maxZ]);
  return pointBounds(points);
}
