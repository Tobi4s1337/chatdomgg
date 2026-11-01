import { HOME_DEPTH_METRES, type HomeTier, type Vec3 } from '@chatdom/shared';
import { randomUnit, seedHash, type KingdomConfig } from '../layout';
import { boundsOverlap, currentFootprint, expandBounds, pointBounds, polygonDistance, rectangleDistance,
  segmentProjection, SpatialIndex, transformCardinalPoint } from '../settlement/geometry';
import { frontagePath } from '../settlement/routing';
import type { BoundsXZ, CardinalTurn, PlotReservation, PublicSquare, SettlementHome, SettlementPlan, SettlementQuarter,
  StreetEdge, StreetNode, XZ } from '../settlement/types';
import { foundKingdomGeography, LAND_FRAME, reservedByGeography, signedArea, type KingdomGeography } from './geography';
import { naturalLandHeight, waterKeepOut } from './surface';
import type { KingdomLandform, LandSite } from './types';

/**
 * The founded town on version 2 land: streets that settle onto the ground between the castle rise, the
 * millstream, the woods and the lake, gathering at an irregular market square at the castle's foot.
 *
 * Everything is founded at once from the seed and the land, never from population or year: the junctions, the
 * streets between them, the greens and every lot the streets can hold. Quarters then claim those lots in order:
 * the oldest around the square, the second on the lake shore, each later quarter a neighbourhood grown from the
 * nearest unclaimed street front. A hamlet is therefore an exact prefix of its town, and a later year only appends.
 * The land holds a bounded number of full lots (about 145–190 by seed); a town needing more is refused with a
 * `TownCapacityError` rather than shrunk, since larger founded layouts belong to realm streaming.
 *
 * Streets: junctions are scattered over usable ground (denser near the square) and joined by their Gabriel
 * graph, which yields T and Y junctions and blocks of differing size. Edges that cross water or the woods, climb
 * too steeply, meet another street at a sliver angle or crowd a neighbour are dropped; a few more are dropped for
 * larger blocks. Each street bends gently, a few run straight, and its surface follows the smoothed ground at a
 * gentle grade. Shortest walks from the square to the lake shore, the mill and the woods become the main streets.
 *
 * Orientation follows geography: -Z is north (the castle), +X is east, bearings are atan2(dx, dz).
 */

export const TOWN_STREETS = { main: { width: 6, verge: 1 }, lane: { width: 4, verge: 1 } } as const;
export const LOTS_PER_QUARTER = 48;
/** The market's clear heart: no site stands within this radius of its centre. */
export const MARKET_HEART_RADIUS = 6;
/** Market site sizes in metres (local X × local Z, +Z faces the heart). */
export const MARKET_SITE_SIZE = {
  forge: [7, 5], statue: [6, 6], pad: [3, 3], well: [4, 4], stall: [5, 3], bench: [4, 2],
} as const;

export interface KingdomTown {
  /** The complete town on the founded land: lots, streets, square, greens and quarters, with the castle. */
  plan: SettlementPlan & { landform: KingdomLandform };
  /** The square's sites: the Forge yard, the focal emote statue pad and two smaller pads, the well, stalls, benches. */
  sites: readonly LandSite[];
  /** Every lot the founded streets hold; quarters claim them in order and a town of more quarters cannot fit. */
  capacity: number;
}

const QUARTER_NAMES = ['Hearthward', 'Bellflower', 'Copperleaf', 'Willowbend', 'Meadowgate', 'Lanternrow', 'Thistledown', 'Rookhollow'];
const LANE_NAMES = ['Wren Lane', 'Tanner Row', 'Candle Lane', 'Thatch Lane', 'Weaver Lane', 'Cooper Row', 'Lark Lane', 'Bramble Lane',
  'Rook Lane', 'Hollow Lane', 'Barley Row', 'Fern Lane', 'Kiln Lane', 'Honey Lane', 'Quill Lane', 'Sorrel Lane', 'Ember Row',
  'Dove Lane', 'Hazel Row', 'Ivy Lane', 'Juniper Row', 'Lantern Lane', 'Marigold Lane', 'Nettle Row', 'Otter Lane', 'Pebble Lane',
  'Rowan Row', 'Saffron Lane', 'Tinker Lane', 'Vine Row', 'Yarrow Lane', 'Acorn Row', 'Badger Lane', 'Chapel Row', 'Daisy Lane',
  'Elder Row', 'Gosling Lane', 'Bell Lane', 'Clover Row', 'Pippin Lane', 'Swallow Row', 'Thimble Lane', 'Copper Lane', 'Mallow Row'];
/** Gentlest public grade the surface profile holds; the settlement audit allows 0.12. */
const STREET_GRADE = .105;
/** Most the natural ground may stand off a home's level under its footprint, and across its back garden. */
const LOT_FLATNESS = 1.5, GARDEN_FLATNESS = 2.5;
const OUTWARD: readonly XZ[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

const round8 = (value: number) => Math.round(value * 8) / 8;
const round32 = (value: number) => Math.round(value * 32) / 32;
const distance = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const xz = (p: Vec3): XZ => [p[0], p[2]];
const facing = (dx: number, dz: number): CardinalTurn => Math.abs(dx) > Math.abs(dz) ? dx > 0 ? 1 : 3 : dz > 0 ? 0 : 2;
const facingTurn = (bearing: number): CardinalTurn => ((Math.round(bearing / (Math.PI / 2)) % 4 + 4) % 4) as CardinalTurn;
const cumulative = (points: readonly XZ[]) => points.map((p, k) => k ? distance(points[k - 1]!, p) : 0).map((sum => (d: number) => sum += d)(0));

interface Junction { id: string; at: XZ; anchor?: string }
interface Street {
  id: string; name: string; kind: 'main' | 'lane'; from: string; to: string; points: Vec3[]; width: number; verge: number;
}
interface Candidate { street: number; side: 1 | -1; index: number; walk: number }
interface FoundedLot {
  centre: XZ; front: XZ; y: number; rotation: CardinalTurn; lot: PlotReservation['lot'];
  street: number; join: number; walk: number; approach: XZ[];
}

/** Segment against an axis-aligned rectangle: 0 when they touch, else their gap (v1's road clearance test). */
function segmentRectangleDistance(a: XZ, b: XZ, box: BoundsXZ): number {
  let low = 0, high = 1;
  for (const [start, end, min, max] of [[a[0], b[0], box.minX, box.maxX], [a[1], b[1], box.minZ, box.maxZ]] as const) {
    const delta = end - start;
    if (!delta) { if (start < min || start > max) { low = 2; break; } continue; }
    const t0 = (min - start) / delta, t1 = (max - start) / delta;
    low = Math.max(low, Math.min(t0, t1)); high = Math.min(high, Math.max(t0, t1));
  }
  if (low <= high) return 0;
  let value = Math.min(Math.max(0, rectangleDistance(box, ...a)), Math.max(0, rectangleDistance(box, ...b)));
  for (const x of [box.minX, box.maxX]) for (const z of [box.minZ, box.maxZ]) value = Math.min(value, segmentProjection(a, b, x, z).distance);
  return value;
}
function segmentsCross(a: XZ, b: XZ, c: XZ, d: XZ): boolean {
  const cross = (ox: number, oz: number, px: number, pz: number) => ox * pz - oz * px;
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1], den = cross(rx, rz, sx, sz);
  if (Math.abs(den) < 1e-12) return false;
  const t = cross(c[0] - a[0], c[1] - a[1], sx, sz) / den, u = cross(c[0] - a[0], c[1] - a[1], rx, rz) / den;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9;
}
/** Distance between two segments (zero when they cross). */
function segmentDistance(a: XZ, b: XZ, c: XZ, d: XZ): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(segmentProjection(c, d, ...a).distance, segmentProjection(c, d, ...b).distance,
    segmentProjection(a, b, ...c).distance, segmentProjection(a, b, ...d).distance);
}
/** Counter-clockwise rectangle in (x, z) for a cardinal blueprint placed at `origin`. */
function footprintOf(origin: Vec3, turn: CardinalTurn, width: number, depth: number): XZ[] {
  const corners = ([[0, 0], [0, depth], [width, depth], [width, 0]] as const).map(([x, z]) => {
    const p = transformCardinalPoint(origin, turn, [x, 0, z]); return [p[0], p[2]] as XZ;
  });
  return signedArea(corners) > 0 ? corners : corners.reverse();
}
/** Points every metre along a polygon's edges, for clearance tests against it. */
function ring(polygon: readonly XZ[], step = 1): XZ[] {
  const out: XZ[] = [];
  for (let k = 0; k < polygon.length; k++) {
    const a = polygon[k]!, b = polygon[(k + 1) % polygon.length]!, n = Math.max(1, Math.ceil(distance(a, b) / step));
    for (let j = 0; j < n; j++) out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
  }
  return out;
}
/** Evenly spaced points along a polyline, about `step` metres apart, ends kept. */
function resample(points: readonly XZ[], step = 1): XZ[] {
  const run = cumulative(points), total = run.at(-1)!, n = Math.max(1, Math.round(total / step)), out: XZ[] = [];
  let k = 1;
  for (let j = 0; j <= n; j++) {
    const at = total * j / n;
    while (k < points.length - 1 && run[k]! < at) k++;
    const a = points[k - 1]!, b = points[k]!, span = run[k]! - run[k - 1]!, t = span > 0 ? (at - run[k - 1]!) / span : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out[0] = points[0]!; out[out.length - 1] = points.at(-1)!;
  return out;
}
/** Quadratic Bezier from a to b through a control point, resampled every metre. */
function bend(a: XZ, control: XZ, b: XZ): XZ[] {
  const fine: XZ[] = [];
  for (let k = 0; k <= 160; k++) {
    const t = k / 160, s = 1 - t;
    fine.push([s * s * a[0] + 2 * s * t * control[0] + t * t * b[0], s * s * a[1] + 2 * s * t * control[1] + t * t * b[1]]);
  }
  return resample(fine);
}

/** The founded land holds fewer full lots than the configured years of quarters need. */
export class TownCapacityError extends Error {}

/**
 * Founds the town on the kingdom's land: streets traced along the ground from a square at the castle foot, every
 * full lot those streets can front, claimed quarter by quarter nearest the square first, and the square's sites.
 * The founded layout depends on the seed alone; the years only decide how many quarters are claimed. When a
 * seed's first layout cannot close (no climb for Crown Road, no room for the square's sites), the next founding
 * draw is tried, so every seed gets its own town and keeps it.
 */
export function foundKingdomTown(config: KingdomConfig, geography: KingdomGeography = foundKingdomGeography(config)): KingdomTown {
  if (!Number.isInteger(config.firstYear) || !Number.isInteger(config.year) || config.year < config.firstYear)
    throw new Error('Invalid founding years');
  if (config.tier !== 'hamlet' && config.tier !== 'town') throw new Error('Invalid settlement tier');
  const failures: string[] = [];
  for (let draw = 0; draw < 12; draw++) {
    try { return foundDraw(config, geography, draw); }
    catch (error) { if (error instanceof TownCapacityError) throw error; failures.push((error as Error).message); }
  }
  throw new Error(`The land of ${config.seed} holds no town: ${failures.join('; ')}`);
}

function foundDraw(config: KingdomConfig, geography: KingdomGeography, draw: number): KingdomTown {
  const { landform, castle, places } = geography;
  const rand = (key: string) => randomUnit(seedHash(draw ? `${config.seed}:town:${draw}:${key}` : `${config.seed}:town:${key}`));
  const signed = (key: string) => rand(key) * 2 - 1;

  // Natural ground and the founded keep-outs, cached on the frame's metre lattice.
  const width = LAND_FRAME.maxX - LAND_FRAME.minX + 1, depth = LAND_FRAME.maxZ - LAND_FRAME.minZ + 1;
  const heights = new Float64Array(width * depth).fill(NaN), keepOut = new Uint8Array(width * depth);
  const cell = (x: number, z: number) => x >= LAND_FRAME.minX && x <= LAND_FRAME.maxX && z >= LAND_FRAME.minZ && z <= LAND_FRAME.maxZ
    ? (x - LAND_FRAME.minX) + (z - LAND_FRAME.minZ) * width : -1;
  const ground = (x: number, z: number): number => {
    if (!Number.isInteger(x) || !Number.isInteger(z)) return naturalLandHeight(landform, x, z);
    const k = cell(x, z);
    if (k < 0) return naturalLandHeight(landform, x, z);
    if (Number.isNaN(heights[k]!)) heights[k] = naturalLandHeight(landform, x, z);
    return heights[k]!;
  };
  const treeline = [...places.forest.treeline].sort((a, b) => a[1] - b[1]);
  const treelineX = (z: number): number => {
    if (z <= treeline[0]![1]) return treeline[0]![0];
    for (let k = 1; k < treeline.length; k++) {
      const a = treeline[k - 1]!, b = treeline[k]!;
      if (z <= b[1]) return a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]);
    }
    return treeline.at(-1)![0];
  };
  /** Lots keep 2.5 m from every founded feature and 8 m inside the treeline, on the metre lattice. */
  const lotBlocked = (x: number, z: number): boolean => {
    const k = cell(Math.round(x), Math.round(z));
    if (k < 0) return true;
    if (!keepOut[k]) keepOut[k] = reservedByGeography(geography, Math.round(x), Math.round(z), 2.5) || Math.round(x) < treelineX(Math.round(z)) + 8 ? 2 : 1;
    return keepOut[k] === 2;
  };
  const slope = (x: number, z: number) => Math.max(Math.abs(ground(x + 3, z) - ground(x - 3, z)), Math.abs(ground(x, z + 3) - ground(x, z - 3))) / 6;
  const inFrame = (x: number, z: number, inset: number) => x > LAND_FRAME.minX + inset && x < LAND_FRAME.maxX - inset
    && z > LAND_FRAME.minZ + inset && z < LAND_FRAME.maxZ - inset;

  // ── The market square at the castle's foot: irregular, about 37 × 30 m, one level civic floor. ──
  const rise = landform.hills.find(hill => hill.id === 'castle-rise')!;
  const centre: XZ = [round8(2 + signed('market:x') * 5), round8(rise.centre[1] + rise.radius + 10 + signed('market:z') * 2)];
  const boundary: XZ[] = [];
  for (let k = 0; k < 9; k++) {
    const angle = (k + .5 + signed(`market:a${k}`) * .2) * Math.PI * 2 / 9, scale = 1 + signed(`market:r${k}`) * .12;
    boundary.push([Math.round((centre[0] + Math.cos(angle) * 18.5 * scale) * 4) / 4, Math.round((centre[1] + Math.sin(angle) * 15 * scale) * 4) / 4]);
  }
  if (signedArea(boundary) <= 0) boundary.reverse();
  let floor = 0, samples = 0;
  for (let z = Math.floor(centre[1] - 17); z <= centre[1] + 17; z += 2) for (let x = Math.floor(centre[0] - 21); x <= centre[0] + 21; x += 2)
    if (polygonDistance(boundary, x, z) < 0) { floor += ground(x, z); samples++; }
  const elevation = round8(floor / samples);
  const market: PublicSquare = { id: 'market', boundary, elevation, nodeId: 'market' };
  const marketNode: Vec3 = [centre[0], elevation, centre[1]];
  const insideMarket = (p: XZ, margin = 0) => polygonDistance(boundary, p[0], p[1]) < margin;

  /**
   * A street's surface: flat on the square, then the smoothed ground held to a gentle grade between its pinned
   * ends. Undefined when the ground cannot be met within the grade or would need deep cuts.
   */
  const profile = (path: readonly XZ[], start: number, end: number, cut: number): number[] | undefined => {
    const run = cumulative(path), total = run.at(-1)!;
    if (Math.abs(end - start) > STREET_GRADE * total * .92) return undefined;
    const raw = path.map(p => ground(p[0], p[1]));
    const smooth = raw.map((_, k) => {
      let sum = 0, n = 0;
      for (let j = Math.max(0, k - 6); j <= Math.min(raw.length - 1, k + 6); j++) { sum += raw[j]!; n++; }
      return sum / n;
    });
    const h = smooth.map((value, k) => Math.min(Math.max(value, start - STREET_GRADE * run[k]!, end - STREET_GRADE * (total - run[k]!)),
      start + STREET_GRADE * run[k]!, end + STREET_GRADE * (total - run[k]!)));
    h[0] = start; h[h.length - 1] = end;
    for (let k = 1; k < h.length; k++) { const g = STREET_GRADE * (run[k]! - run[k - 1]!); h[k] = Math.min(Math.max(h[k]!, h[k - 1]! - g), h[k - 1]! + g); }
    for (let k = h.length - 2; k >= 0; k--) { const g = STREET_GRADE * (run[k + 1]! - run[k]!); h[k] = Math.min(Math.max(h[k]!, h[k + 1]! - g), h[k + 1]! + g); }
    if (h.some((value, k) => Math.abs(value - raw[k]!) > cut)) return undefined;
    return h;
  };
  /** Path points with the market floor inside the square and the profile beyond it. */
  const surface = (path: readonly XZ[], start: number, end: number, cut: number, fromMarket: boolean): Vec3[] | undefined => {
    let flat = 0;
    if (fromMarket) while (flat < path.length - 1 && insideMarket(path[flat + 1]!, 1)) flat++;
    const rest = profile(path.slice(flat), start, end, cut);
    if (!rest) return undefined;
    const levels = [...path.slice(0, flat).map(() => start), ...rest];
    return path.map((p, k) => [round32(p[0]), Math.round(levels[k]! * 256) / 256, round32(p[1])] as Vec3);
  };

  // ── Crown Road: out of the square's north side, one long leg across the rise's face, a hairpin, a second leg
  // back along the brow, then a turn into the forecourt so the gate shows itself square-on at the last bend. ──
  const gate = places.court.gate, gateXZ: XZ = [gate[0], gate[2]];
  const polar = (bearing: number, r: number): XZ => [rise.centre[0] + Math.sin(bearing) * r, rise.centre[1] + Math.cos(bearing) * r];
  const bearingOf = (p: XZ) => Math.atan2(p[0] - rise.centre[0], p[1] - rise.centre[1]);
  const radiusOf = (p: XZ) => distance(p, rise.centre);
  // Away from its final run into the gate, the road keeps off the castle's level compound so the graded ground
  // between them eases rather than steps.
  const crownClear = (p: XZ, fromMarket: boolean) => inFrame(p[0], p[1], 12) && !reservedByGeography(geography, p[0], p[1], 5)
    && (fromMarket || !insideMarket(p, 5)) && rectangleDistance(castle.bounds, p[0], p[1]) > 9;
  const crownRoad = (): Vec3[] => {
    const towardRise = Math.atan2(rise.centre[0] - centre[0], rise.centre[1] - centre[1]);
    const stub: XZ[] = [centre];
    while (insideMarket(stub.at(-1)!, 3)) stub.push([centre[0] + Math.sin(towardRise) * stub.length, centre[1] + Math.cos(towardRise) * stub.length]);
    const exit = stub.at(-1)!, r0 = radiusOf(exit), b0 = bearingOf(exit), bGate = bearingOf(gateXZ);
    const forecourt: XZ = [gateXZ[0] + Math.sin(bGate) * 9, gateXZ[1] + Math.cos(bGate) * 9];
    const first = rand('crown:side') < .5 ? -1 : 1;
    for (const side of [first, -first]) for (const span of [.95, .82, 1.08]) for (const turnAt of [r0 - 20, r0 - 16, r0 - 24]) {
      const leg1: XZ[] = [];
      const leg1Length = Math.ceil(span * (r0 + turnAt) / 2);
      for (let k = 1; k <= leg1Length; k++) { const t = k / leg1Length; leg1.push(polar(b0 + side * span * t, r0 + (turnAt - r0) * t * t * (3 - 2 * t))); }
      // The hairpin: a half turn of 8 m radius, bulging on in the direction of travel.
      const a = leg1.at(-1)!, before = leg1.at(-2)!, hub = polar(b0 + side * span, turnAt - 8), out: XZ = [(a[0] - hub[0]) / 8, (a[1] - hub[1]) / 8];
      const step = distance(a, before), along: XZ = [(a[0] - before[0]) / step, (a[1] - before[1]) / step];
      const hairpin: XZ[] = [];
      for (let k = 1; k <= 24; k++) { const t = k / 24 * Math.PI; hairpin.push([hub[0] + 8 * (Math.cos(t) * out[0] + Math.sin(t) * along[0]), hub[1] + 8 * (Math.cos(t) * out[1] + Math.sin(t) * along[1])]); }
      const back = hairpin.at(-1)!, rBack = radiusOf(back), bBack = bearingOf(back), rBrow = radiusOf(forecourt) + 9, bEnd = bGate + side * .26;
      const leg2: XZ[] = [], leg2Length = Math.ceil(Math.abs(bBack - bEnd) * (rBack + rBrow) / 2);
      for (let k = 1; k <= leg2Length; k++) { const t = k / leg2Length; leg2.push(polar(bBack + (bEnd - bBack) * t, rBack + (rBrow - rBack) * t)); }
      // Into the forecourt: the brow's tangent meets the gate's axis; a smooth turn there, then straight in.
      const end = leg2.at(-1)!, corner = polar(bGate, rBrow / Math.cos(bEnd - bGate));
      const turn = bend(end, corner, forecourt).slice(1), inGate = resample([forecourt, gateXZ]).slice(1);
      const path = resample([...stub, ...leg1, ...hairpin, ...leg2, ...turn, ...inGate]);
      if (path.some((p, k) => !(k > path.length - 12 || crownClear(p, k < stub.length + 14)))) continue;
      // Legs stay apart: no point of the road comes near an earlier stretch except its own neighbours.
      const index = new SpatialIndex<number>(8);
      path.forEach((p, k) => index.add(pointBounds([p]), k));
      if (path.some((p, k) => index.within(expandBounds(pointBounds([p]), 13)).some(j => Math.abs(j - k) > 26 && distance(path[j]!, p) < 13))) continue;
      const road = surface(path, elevation, gate[1], 4.5, true);
      // Beside the compound the road may sit below its level only as far as an easy bank between them allows.
      if (!road || road.some(p => { const d = rectangleDistance(castle.bounds, p[0], p[2]); return d > 0 && d < 12 && gate[1] - p[1] > .35 * d + 1.2; })) continue;
      road[0] = marketNode; road[road.length - 1] = [gate[0], gate[1], gate[2]];
      return road;
    }
    throw new Error('Crown Road finds no climb from the square to the gate');
  };
  const crown = crownRoad();
  const crownXZ = crown.map(xz);

  // ── Junctions: anchors where streets should arrive, then darts over usable ground, denser near the square. ──
  const lake = landform.waters.find(body => body.id === 'lake')!;
  const usable = (x: number, z: number, margin: number, crownGap = 24) => inFrame(x, z, 28) && !reservedByGeography(geography, x, z, margin)
    && x > treelineX(z) + 26 && radiusOf([x, z]) > rise.radius + 6 && slope(x, z) < .1 && !insideMarket([x, z], 20)
    && Math.min(...crownXZ.map(p => distance(p, [x, z]))) > crownGap;
  const reach = (from: XZ, toward: XZ, margin: number): XZ | undefined => {
    const length = distance(from, toward);
    for (let d = 0; d <= length; d += 2) {
      const p: XZ = [round8(from[0] + (toward[0] - from[0]) * d / length), round8(from[1] + (toward[1] - from[1]) * d / length)];
      if (usable(p[0], p[1], margin)) return p;
    }
    return undefined;
  };
  const mill = geography.sites.find(site => site.id === 'water:mill')!;
  const millFront = xz(transformCardinalPoint(mill.position, mill.turn, [5.5, 0, 13]));
  const oak = xz(places.forest.oak);
  const anchors: { id: string; at: XZ | undefined }[] = [
    // The lake's north shore, where the main street arrives at the water, and its west shore beside it.
    { id: 'lake', at: reach([lake.x - 10, lake.z], [lake.x - 18, centre[1]], 16) },
    { id: 'shore', at: reach([lake.x - lake.radiusX * .4, lake.z + 6], [centre[0] - 60, lake.z - 10], 16) },
    // The mill's lane end, west of its door, and the woods' edge below the elder oak.
    { id: 'mill', at: reach([millFront[0] - 10, millFront[1]], [centre[0], millFront[1] - 20], 12) },
    { id: 'woods', at: reach([oak[0] + 30, oak[1] - 6], [centre[0], centre[1] + 40], 12) },
  ];
  const junctions: Junction[] = [];
  for (const anchor of anchors) if (anchor.at && junctions.every(j => distance(j.at, anchor.at!) > 30))
    junctions.push({ id: `town:${anchor.id}`, at: anchor.at, anchor: anchor.id });
  // The square's own approaches: junctions a short street from it, spread around its open sides.
  for (const [k, base] of [-1.8, -.9, 0, .9, 1.8].entries()) {
    const bearing = base + signed(`approach:${k}`) * .12, length = 40 + signed(`approach:${k}:d`) * 4;
    for (let d = length; d < length + 18; d += 2) {
      const p: XZ = [round8(centre[0] + Math.sin(bearing) * d), round8(centre[1] + Math.cos(bearing) * d)];
      if (!usable(p[0], p[1], 14, 16) || junctions.some(j => distance(j.at, p) < 30)) continue;
      junctions.push({ id: `town:square-${k}`, at: p });
      break;
    }
  }
  const spacing = (p: XZ) => 36 + distance(p, centre) * .06;
  const darts: { at: XZ; order: number }[] = [];
  for (let z = Math.ceil((centre[1] - 30) / 6) * 6; z < LAND_FRAME.maxZ - 28; z += 6)
    for (let x = Math.ceil((LAND_FRAME.minX + 28) / 6) * 6; x < LAND_FRAME.maxX - 28; x += 6) {
      const key = `dart:${x}:${z}`, at: XZ = [round8(x + signed(`${key}:x`) * 2.5), round8(z + signed(`${key}:z`) * 2.5)];
      if (distance(at, centre) < 270) darts.push({ at, order: rand(key) });
    }
  darts.sort((a, b) => a.order - b.order);
  for (const { at } of darts) {
    if (distance(at, centre) < 34 || !usable(at[0], at[1], 14)) continue;
    if (junctions.some(j => distance(j.at, at) < Math.min(spacing(at), spacing(j.at)))) continue;
    junctions.push({ id: `town:${junctions.length}`, at });
  }
  // Trailheads the land's walks leave the town by stay open: the mill's door yard, the meadow below the elder oak
  // and the beacon gap's foot, each with a clear way back to its street end.
  const along = (from: XZ, bearing: number, metres: number): XZ => [from[0] + Math.sin(bearing) * metres, from[1] + Math.cos(bearing) * metres];
  const { clearing } = places.forest, clearingAt = xz(clearing.centre);
  const meadow = along(oak, places.forest.entryBearing + Math.PI, 9), gapFoot = along(clearingAt, clearing.gapBearing, clearing.radius + 22);
  const anchorAt = (id: string) => junctions.find(j => j.anchor === id)?.at;
  const trailheads: { a: XZ; b: XZ; radius: number }[] = [
    { a: millFront, b: millFront, radius: 9 }, { a: meadow, b: meadow, radius: 12 }, { a: gapFoot, b: gapFoot, radius: 9 },
    ...([[millFront, anchorAt('mill')], [meadow, anchorAt('woods')], [gapFoot, anchorAt('woods')]] as const)
      .flatMap(([a, b]) => b ? [{ a, b, radius: 5 }] : []),
  ];
  const nearTrailhead = (box: BoundsXZ) => trailheads.some(head => segmentRectangleDistance(head.a, head.b, box) < head.radius);
  const points: XZ[] = [centre, ...junctions.map(j => j.at)];
  const ids = ['market', ...junctions.map(j => j.id)];

  const nodeHeight = (n: number) => n === 0 ? elevation : round8(ground(Math.round(points[n]![0]), Math.round(points[n]![1])));

  // ── Gabriel graph: neighbours with no third junction inside the circle on their span. ──
  interface Link { a: number; b: number; path: XZ[]; length: number; box: BoundsXZ }
  const links: Link[] = [];
  const streetClear = (p: XZ, a: number, b: number, radius: number): boolean => {
    if (!inFrame(p[0], p[1], radius + 6) || reservedByGeography(geography, p[0], p[1], radius + 2.5) || p[0] < treelineX(p[1]) + radius + 10) return false;
    const nearMarket = a === 0 || b === 0;
    if (!nearMarket && insideMarket(p, radius + 3)) return false;
    if (radiusOf(p) < rise.radius - 4 && !(nearMarket && insideMarket(p, 6))) return false;
    if (trailheads.some(head => head.a === head.b && distance(head.a, p) < head.radius + radius)) return false;
    // Clear of Crown Road beyond the square.
    for (const q of crownXZ) if (distance(p, q) < radius + 4 + 3 && !(nearMarket && insideMarket(q, 2))) return false;
    return true;
  };
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
    const pa = points[a]!, pb = points[b]!, mid: XZ = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], r = distance(pa, pb) / 2;
    if (r * 2 > 92 || points.some((p, k) => k !== a && k !== b && distance(p, mid) < r)) continue;
    const key = `${ids[a]}~${ids[b]}`, length = r * 2;
    const straightOnly = length < 46 && rand(`${key}:straight`) < .3;
    const amount = straightOnly ? 0 : signed(`${key}:bend`) * Math.min(length * .16, 10);
    const normal: XZ = [-(pb[1] - pa[1]) / length, (pb[0] - pa[0]) / length];
    for (const offset of amount ? [amount, amount * .5, -amount * .5, 0] : [0]) {
      const path = bend(pa, [mid[0] + normal[0] * offset, mid[1] + normal[1] * offset], pb);
      if (!path.every(p => streetClear(p, a, b, 4)) || !surface(path, nodeHeight(a), nodeHeight(b), 2.5, a === 0)) continue;
      links.push({ a, b, path, length: cumulative(path).at(-1)!, box: expandBounds(pointBounds(path), 8) }); break;
    }
  }
  // Where two streets leave a junction at a sliver angle, keep the shorter; where streets would crowd or cross
  // away from a shared junction, keep the shorter too.
  const alive = new Set(links.map((_, k) => k));
  const connected = (without: number): boolean => {
    const adjacency = new Map<number, number[]>();
    for (const k of alive) if (k !== without) for (const [u, v] of [[links[k]!.a, links[k]!.b], [links[k]!.b, links[k]!.a]] as const)
      (adjacency.get(u) ?? adjacency.set(u, []).get(u)!).push(v);
    const before = new Set<number>([0]), queue = [0];
    for (let i = 0; i < queue.length; i++) for (const v of adjacency.get(queue[i]!) ?? []) if (!before.has(v)) { before.add(v); queue.push(v); }
    const all = new Set<number>([0]), queue2 = [0], full = new Map<number, number[]>();
    for (const k of alive) for (const [u, v] of [[links[k]!.a, links[k]!.b], [links[k]!.b, links[k]!.a]] as const) (full.get(u) ?? full.set(u, []).get(u)!).push(v);
    for (let i = 0; i < queue2.length; i++) for (const v of full.get(queue2[i]!) ?? []) if (!all.has(v)) { all.add(v); queue2.push(v); }
    return before.size === all.size;
  };
  // Crowding: the square's own streets first, then shortest first; a later street that comes too close to an
  // earlier kept one is dropped.
  const byLength = [...alive].sort((x, y) => Number(links[x]!.a !== 0) - Number(links[y]!.a !== 0) || links[x]!.length - links[y]!.length || x - y);
  const rank = new Map(byLength.map((k, i) => [k, i]));
  for (const k of byLength) {
    const link = links[k]!;
    for (const j of byLength) {
      if (j === k || !alive.has(j) || rank.get(j)! > rank.get(k)!) continue;
      if (!boundsOverlap(link.box, links[j]!.box)) continue;
      const other = links[j]!, shared = [link.a, link.b].filter(n => n === other.a || n === other.b);
      // Streets fan out of a shared junction; out of the square they fan wider before they count as crowding.
      const sharedAt = shared.map(n => points[n]!), apart = shared.includes(0) ? 30 : 16;
      let crowd = false;
      for (let p = 1; p < link.path.length && !crowd; p++) {
        const s0 = link.path[p - 1]!, s1 = link.path[p]!;
        if (sharedAt.some(q => distance(q, s0) < apart || distance(q, s1) < apart)) continue;
        for (let q = 1; q < other.path.length; q++) {
          const t0 = other.path[q - 1]!, t1 = other.path[q]!;
          if (sharedAt.some(at => distance(at, t0) < apart || distance(at, t1) < apart)) continue;
          if (segmentDistance(s0, s1, t0, t1) < 15) { crowd = true; break; }
        }
      }
      if (crowd) { alive.delete(k); break; }
    }
  }
  const direction = (link: Link, node: number): number => {
    const path = node === link.a ? link.path : [...link.path].reverse(), p = path[Math.min(path.length - 1, 10)]!;
    return Math.atan2(p[0] - points[node]![0], p[1] - points[node]![1]);
  };
  for (let changed = true; changed;) {
    changed = false;
    for (let n = 0; n < points.length && !changed; n++) {
      const incident = [...alive].filter(k => links[k]!.a === n || links[k]!.b === n).map(k => ({ k, angle: direction(links[k]!, n) }))
        .sort((x, y) => x.angle - y.angle);
      for (let i = 0; i < incident.length && incident.length > 1; i++) {
        const p = incident[i]!, q = incident[(i + 1) % incident.length]!;
        let gap = q.angle - p.angle; if (gap <= 0) gap += Math.PI * 2;
        if (gap >= (n === 0 ? .45 : .72)) continue;
        const drop = links[p.k]!.length >= links[q.k]!.length ? p.k : q.k;
        alive.delete(drop); changed = true; break;
      }
    }
  }
  // Three streets and Crown Road open the square: where more arrive, the one in the tightest pair gives way.
  for (;;) {
    const incident = [...alive].filter(k => links[k]!.a === 0).map(k => ({ k, angle: direction(links[k]!, 0) })).sort((x, y) => x.angle - y.angle);
    if (incident.length <= 3) break;
    let tightest = -1, gap = Infinity;
    for (let i = 0; i < incident.length; i++) {
      const p = incident[i]!, q = incident[(i + 1) % incident.length]!;
      let g = q.angle - p.angle; if (g <= 0) g += Math.PI * 2;
      if (g < gap) { gap = g; tightest = links[p.k]!.length >= links[q.k]!.length ? p.k : q.k; }
    }
    alive.delete(tightest);
  }
  // A few more fall away so blocks differ in size; the town stays connected and no junction is left stranded.
  const degree = (n: number) => [...alive].filter(k => links[k]!.a === n || links[k]!.b === n).length;
  for (const k of [...alive].sort((x, y) => rand(`prune:${x}`) - rand(`prune:${y}`))) {
    const link = links[k]!;
    if (rand(`prune:${k}:keep`) > .16 || link.a === 0 || link.b === 0 || degree(link.a) < 3 || degree(link.b) < 3 || !connected(k)) continue;
    alive.delete(k);
  }
  // Keep the market's component only.
  const reached = new Set<number>([0]);
  for (let grew = true; grew;) {
    grew = false;
    for (const k of alive) { const { a, b } = links[k]!; if (reached.has(a) !== reached.has(b)) { reached.add(a); reached.add(b); grew = true; } }
  }
  const kept = [...alive].filter(k => reached.has(links[k]!.a)).sort((x, y) => x - y);
  if (kept.filter(k => links[k]!.a === 0 || links[k]!.b === 0).length < 3) throw new Error('The square needs at least three streets besides Crown Road');

  // Walking distances from the square along the kept links, for street direction, mains and claim order.
  const walkTo = new Map<number, { metres: number; via?: number }>([[0, { metres: 0 }]]);
  for (const open = new Set([0]); open.size;) {
    let n = -1, best = Infinity;
    for (const m of open) { const metres = walkTo.get(m)!.metres; if (metres < best || (metres === best && m < n)) { best = metres; n = m; } }
    open.delete(n);
    for (const k of kept) {
      const link = links[k]!; if (link.a !== n && link.b !== n) continue;
      const other = link.a === n ? link.b : link.a, metres = best + link.length;
      if (metres < (walkTo.get(other)?.metres ?? Infinity) - 1e-9) { walkTo.set(other, { metres, via: k }); open.add(other); }
    }
  }
  // Main streets: the walks from the square to the lake, the shore, the mill and the woods.
  const mainName = new Map<number, string>();
  for (const [anchor, name] of [['lake', 'High Street'], ['mill', 'Mill Street'], ['woods', 'Westgate'], ['shore', 'High Street']] as const) {
    const n = junctions.findIndex(j => j.anchor === anchor) + 1;
    if (n <= 0 || !walkTo.has(n)) continue;
    for (let at = n; ;) {
      const step = walkTo.get(at);
      if (step?.via === undefined) break;
      if (!mainName.has(step.via)) mainName.set(step.via, name);
      at = links[step.via]!.a === at ? links[step.via]!.b : links[step.via]!.a;
    }
  }
  const laneNames = [...LANE_NAMES].sort((a, b) => rand(`name:${a}`) - rand(`name:${b}`));
  const streets: Street[] = [];
  for (const k of kept) {
    const link = links[k]!, forward = walkTo.get(link.a)!.metres <= walkTo.get(link.b)!.metres;
    const [from, to] = forward ? [link.a, link.b] : [link.b, link.a], path = forward ? link.path : [...link.path].reverse();
    const main = mainName.has(k), kind = main ? 'main' : 'lane', size = TOWN_STREETS[kind];
    const surfaced = surface(path, nodeHeight(from), nodeHeight(to), 2.5, from === 0);
    if (!surfaced) throw new Error(`Street ${ids[from]}–${ids[to]} lost its grade when reversed`);
    surfaced[0] = from === 0 ? marketNode : [points[from]![0], nodeHeight(from), points[from]![1]];
    surfaced[surfaced.length - 1] = [points[to]![0], nodeHeight(to), points[to]![1]];
    const name = mainName.get(k) ?? laneNames[streets.filter(s => s.kind === 'lane').length % laneNames.length]!;
    streets.push({ id: `street:${ids[from]!.replace('town:', '')}-${ids[to]!.replace('town:', '')}`, name, kind, from: ids[from]!, to: ids[to]!,
      points: surfaced, width: size.width, verge: size.verge });
  }
  streets.push({ id: 'road:castle', name: 'Crown Road', kind: 'main', from: 'market', to: castle.gateNodeId, points: crown,
    width: TOWN_STREETS.main.width, verge: TOWN_STREETS.main.verge });
  const usedNodes = new Set(streets.flatMap(s => [s.from, s.to]));
  const junctionNodes: StreetNode[] = [{ id: 'market', kind: 'market', position: marketNode },
    { id: castle.gateNodeId, kind: 'castle-gate', position: [gate[0], gate[1], gate[2]] },
    ...junctions.filter(j => usedNodes.has(j.id)).map(j => {
      const n = ids.indexOf(j.id);
      return { id: j.id, kind: 'junction' as const, position: [j.at[0], nodeHeight(n), j.at[1]] as Vec3 };
    })];
  const nodeAt = new Map(junctionNodes.map(node => [node.id, node.position]));
  const marketWalk = new Map<string, number>();
  for (const [n, step] of walkTo) marketWalk.set(ids[n]!, step.metres);
  marketWalk.set(castle.gateNodeId, cumulative(crownXZ).at(-1)!);

  // ── Greens: small irregular squares at quiet junctions, one for each quarter as it is claimed. ──
  const greens: PublicSquare[] = [];
  for (const node of [...junctionNodes].filter(node => node.kind === 'junction').sort((a, b) => marketWalk.get(a.id)! - marketWalk.get(b.id)! || a.id.localeCompare(b.id))) {
    const incident = streets.filter(s => s.from === node.id || s.to === node.id);
    if (incident.length < 3 || distance(xz(node.position), centre) < 55 || greens.some(g => distance(xz(nodeAt.get(g.nodeId)!), xz(node.position)) < 58)) continue;
    // Lean the green into the widest opening between its streets.
    const angles = incident.map(s => { const path = s.from === node.id ? s.points : [...s.points].reverse(), p = path[Math.min(path.length - 1, 8)]!; return Math.atan2(p[0] - node.position[0], p[2] - node.position[2]); }).sort((a, b) => a - b);
    let widest = 0, lean = 0;
    angles.forEach((angle, i) => { let gap = (angles[(i + 1) % angles.length]! - angle); if (gap <= 0) gap += Math.PI * 2; if (gap > widest) { widest = gap; lean = angle + gap / 2; } });
    const hub: XZ = [node.position[0] + Math.sin(lean) * 3, node.position[2] + Math.cos(lean) * 3], polygon: XZ[] = [];
    for (let k = 0; k < 7; k++) {
      const a = (k + .5 + signed(`green:${node.id}:a${k}`) * .25) * Math.PI * 2 / 7, r = 6.5 + signed(`green:${node.id}:r${k}`) * 1.25;
      polygon.push([Math.round((hub[0] + Math.sin(a) * r) * 4) / 4, Math.round((hub[1] + Math.cos(a) * r) * 4) / 4]);
    }
    if (signedArea(polygon) <= 0) polygon.reverse();
    const level = node.position[1];
    if (!ring(polygon, 2).every(p => Math.abs(ground(p[0], p[1]) - level) < .9 && !reservedByGeography(geography, p[0], p[1], 1))) continue;
    greens.push({ id: `green:${node.id.replace('town:', '')}`, boundary: polygon, elevation: level, nodeId: node.id });
  }

  // ── Street fronts: every lot the streets can hold, claimed nearest the square first. ──
  interface Segment { a: XZ; b: XZ; reach: number; street: number }
  const segments = new SpatialIndex<Segment>(16), runs: number[][] = [], walks: ((i: number) => number)[] = [];
  const indexStreet = (s: number) => {
    const street = streets[s]!;
    for (let k = 1; k < street.points.length; k++) {
      const a = xz(street.points[k - 1]!), b = xz(street.points[k]!);
      segments.add(expandBounds(pointBounds([a, b]), street.width / 2 + street.verge + 1), { a, b, reach: street.width / 2 + street.verge, street: s });
    }
  };
  streets.forEach((street, s) => {
    const run = cumulative(street.points.map(xz)), total = run.at(-1)!, fromWalk = marketWalk.get(street.from) ?? 0, toWalk = marketWalk.get(street.to) ?? Infinity;
    runs.push(run); walks.push(i => Math.min(fromWalk + run[i]!, toWalk + total - run[i]!)); indexStreet(s);
  });
  const founded: FoundedLot[] = [], lots = new SpatialIndex<FoundedLot>(16);
  const apronOf = (front: XZ, rotation: CardinalTurn): BoundsXZ => {
    const out = OUTWARD[rotation]!, right: XZ = [out[1], -out[0]], corners: XZ[] = [];
    for (const side of [-4, 4]) for (const d of [0, 3]) corners.push([front[0] + side * right[0] + d * out[0], front[1] + side * right[1] + d * out[1]]);
    return pointBounds(corners);
  };
  const separation = (a: BoundsXZ, b: BoundsXZ) => Math.hypot(Math.max(a.minX - b.maxX, 0, b.minX - a.maxX), Math.max(a.minZ - b.maxZ, 0, b.minZ - a.maxZ));
  const squares = [boundary, ...greens.map(g => g.boundary)], squareBoxes = squares.map(polygon => pointBounds(polygon));
  const squareClash = (box: BoundsXZ, margin: number) => squares.some((polygon, k) => {
    const pad = k ? margin : margin + 1;
    if (!boundsOverlap(box, expandBounds(squareBoxes[k]!, pad + 1))) return false;
    if (polygon.some(p => rectangleDistance(box, p[0], p[1]) < pad)) return true;
    for (let x = box.minX; x <= box.maxX; x += 1) for (const z of [box.minZ, box.maxZ]) if (polygonDistance(polygon, x, z) < pad) return true;
    for (let z = box.minZ; z <= box.maxZ; z += 1) for (const x of [box.minX, box.maxX]) if (polygonDistance(polygon, x, z) < pad) return true;
    return false;
  });
  // Each trailhead is met by its nearest street at a node of its own, with a lot-free way between them.
  const feet: { street: number; index: number }[] = [];
  for (const head of [millFront, meadow, gapFoot]) {
    let best: { street: number; index: number; metres: number } | undefined;
    streets.forEach((street, s) => {
      if (street.id === 'road:castle') return;
      for (let i = 4; i < street.points.length - 4; i++) {
        const metres = distance(xz(street.points[i]!), head);
        if (!best || metres < best.metres) best = { street: s, index: i, metres };
      }
    });
    if (!best) continue;
    feet.push(best);
    trailheads.push({ a: head, b: xz(streets[best.street]!.points[best.index]!), radius: 4.5 });
  }
  const nodePositions = [...junctionNodes.map(node => xz(node.position)), ...feet.map(foot => xz(streets[foot.street]!.points[foot.index]!))];

  /** A lot on one side of a street at one of its samples, clear of everything founded before it. */
  const fitAt = (s: number, i: number, side: 1 | -1, walk: number): FoundedLot | undefined => {
    const street = streets[s]!, p = street.points[i]!, a = street.points[Math.max(0, i - 4)]!, b = street.points[Math.min(street.points.length - 1, i + 4)]!;
    const dx = b[0] - a[0], dz = b[2] - a[2], span = Math.hypot(dx, dz);
    if (span < 1e-6) return undefined;
    const rotation = facing(dz * side, -dx * side), out = OUTWARD[rotation]!;
    const alignment = Math.abs((-dz * out[0] + dx * out[1]) / span), radius = street.width / 2 + street.verge;
    const extras = [0, .5, 1, 1.5, 2.5].sort((u, v) => rand(`setback:${street.id}:${side}:${i}:${u}`) - rand(`setback:${street.id}:${side}:${i}:${v}`)).slice(0, 3);
    for (const extra of extras) {
      const offset = (radius + .25 + 3 * alignment + 4 * Math.sqrt(Math.max(0, 1 - alignment * alignment))) / alignment + extra;
      const front: XZ = [Math.round(p[0] - out[0] * offset), Math.round(p[2] - out[1] * offset)];
      const middle: XZ = [front[0] - out[0] * 8, front[1] - out[1] * 8];
      // The home stands on its own ground, as near the street's level as its entrance ramp allows.
      let mean = 0;
      for (const d of [1, 4, 7, 10]) for (const r of [-3, 0, 3]) mean += ground(front[0] - out[0] * d + out[1] * r, front[1] - out[1] * d - out[0] * r) / 12;
      const ramp = Math.max(0, Math.min(.75, (distance(front, xz(p)) - 3.5) * .1));
      const y = round8(Math.min(Math.max(mean, p[1] - ramp), p[1] + ramp));
      const lot = { ...currentFootprint({ position: [middle[0], y, middle[1]], rotation, allowedDepth: 16 }), height: 20 as const, depth: 16 as const, frontage: 8 as const };
      const fore = apronOf(front, rotation);
      if (!inFrame(lot.minX, lot.minZ, 8) || !inFrame(lot.maxX, lot.maxZ, 8)) continue;
      if (boundsOverlap(lot, expandBounds(castle.bounds, 6)) || squareClash(lot, 1.5) || squareClash(fore, .5) || nearTrailhead(lot) || nearTrailhead(fore)) continue;
      let clear = true;
      // Terrain levels only the home's own footprint (its allowed depth from the front); the back garden may slope.
      for (let z = lot.minZ; z <= lot.maxZ && clear; z += 2) for (let x = lot.minX; x <= lot.maxX && clear; x += 2) {
        const back = (x - front[0]) * -out[0] + (z - front[1]) * -out[1];
        if (lotBlocked(x, z) || Math.abs(ground(x, z) - y) > (back <= 14 ? LOT_FLATNESS : GARDEN_FLATNESS)) clear = false;
      }
      for (const [x, z] of [[fore.minX, fore.maxZ], [fore.maxX, fore.minZ], [fore.minX, fore.minZ], [fore.maxX, fore.maxZ]] as const) if (lotBlocked(x, z)) clear = false;
      if (!clear) continue;
      for (const other of lots.within(expandBounds(lot, 8)))
        if (separation(lot, other.lot) < 1 || boundsOverlap(fore, other.lot, 1) || boundsOverlap(lot, apronOf(other.front, other.rotation), 1)) { clear = false; break; }
      if (!clear) continue;
      for (const segment of segments.within(expandBounds(lot, 4)))
        if (segmentRectangleDistance(segment.a, segment.b, lot) < segment.reach + .125 || segmentRectangleDistance(segment.a, segment.b, fore) < segment.reach + .125) { clear = false; break; }
      if (!clear || nodePositions.some(n => rectangleDistance(lot, n[0], n[1]) < 6 || rectangleDistance(fore, n[0], n[1]) < 4)) continue;
      // The whole 1.5 m entrance ribbon reaches its own street without meeting another lot or crossing a street.
      const approach = frontagePath([front[0], y, front[1]], [out[0], 0, out[1]], p);
      for (let k = 1; k < approach.length && clear; k++) {
        const s0 = approach[k - 1]!, s1 = approach[k]!;
        for (const other of lots.within(expandBounds(pointBounds([s0, s1]), 6))) {
          if (segmentRectangleDistance(s0, s1, other.lot) < 1) { clear = false; break; }
          // Entrance paths never cross: each reaches its street on its own.
          for (let j = 1; j < other.approach.length && clear; j++) if (segmentsCross(s0, s1, other.approach[j - 1]!, other.approach[j]!)) clear = false;
          if (!clear) break;
        }
        for (const segment of segments.within(expandBounds(pointBounds([s0, s1]), 1)))
          if (segment.street !== s && segmentsCross(s0, s1, segment.a, segment.b)) { clear = false; break; }
      }
      if (clear) return { centre: middle, front, y, rotation, lot, street: s, join: i, walk, approach };
    }
    return undefined;
  };
  // Every lot the streets can front, nearest the square first; none on Crown Road's climb up the rise.
  const candidates: Candidate[] = [], last = new Map<string, number>();
  streets.forEach((street, s) => {
    for (let i = 3; i < street.points.length - 3; i++) {
      if (street.id === 'road:castle' && radiusOf(xz(street.points[i]!)) < rise.radius) continue;
      for (const side of [1, -1] as const) candidates.push({ street: s, side, index: i, walk: walks[s]!(i) });
    }
  });
  candidates.sort((a, b) => a.walk - b.walk || a.street - b.street || a.side - b.side || a.index - b.index);
  for (const { street: s, side, index: i, walk } of candidates) {
    const key = `${s}:${side}`, previous = last.get(key), run = runs[s]![i]!;
    if (previous !== undefined && Math.abs(run - previous) < 8.5) continue;
    const item = fitAt(s, i, side, walk);
    if (!item) continue;
    last.set(key, run); founded.push(item); lots.add(expandBounds(item.lot, 8), item);
  }
  founded.sort((a, b) => a.walk - b.walk || a.street - b.street || a.join - b.join || a.front[0] - b.front[0] || a.front[1] - b.front[1]);

  // Street parts split at every founded front's join, so later quarters never re-cut an older street.
  const joins = streets.map(() => new Set<number>());
  for (const item of founded) joins[item.street]!.add(item.join);
  for (const foot of feet) joins[foot.street]!.add(foot.index);
  const nodes: StreetNode[] = [...junctionNodes], edges: StreetEdge[] = [], joinNode = new Map<string, string>(), partOf = new Map<string, string>();
  streets.forEach((street, s) => {
    const cuts = [0, ...[...joins[s]!].sort((a, b) => a - b), street.points.length - 1];
    let part = 0;
    for (let c = 1; c < cuts.length; c++) {
      const begin = cuts[c - 1]!, end = cuts[c]!;
      const fromId = begin === 0 ? street.from : joinNode.get(`${s}:${begin}`)!;
      const toId = end === street.points.length - 1 ? street.to : `${street.id}:j${end}`;
      if (end !== street.points.length - 1) { nodes.push({ id: toId, kind: 'junction', position: street.points[end]! }); joinNode.set(`${s}:${end}`, toId); }
      const id = `${street.id}:${part++}`;
      edges.push({ id, from: fromId, to: toId, kind: street.kind, name: street.name, points: street.points.slice(begin, end + 1), width: street.width, verge: street.verge });
      partOf.set(`${s}:${end}`, id);
    }
  });

  const sites = marketSites();

  // ── Quarters claim the founded lots: the oldest around the square; the second on the lake shore, where the
  // town's waterside homes look over the water; each later one a neighbourhood grown from the nearest unclaimed
  // front. Ordinals run outward from each quarter's first home. ──
  const quarterCount = config.year - config.firstYear + 1;
  if (quarterCount * LOTS_PER_QUARTER > founded.length)
    throw new TownCapacityError(`The founded land holds ${founded.length} lots; ${quarterCount} quarters need ${quarterCount * LOTS_PER_QUARTER}. Larger towns need realm streaming.`);
  const lakeCentre: XZ = [lake.x, lake.z];
  const claimed = new Set<FoundedLot>(), quarterLots: FoundedLot[][] = [];
  for (let q = 0; q < quarterCount; q++) {
    const open = founded.filter(item => !claimed.has(item));
    const seed = q === 1 ? open.reduce((best, item) => distance(item.centre, lakeCentre) < distance(best.centre, lakeCentre) ? item : best) : open[0]!;
    const score = (item: FoundedLot) => q === 0 ? item.walk : distance(item.centre, seed.centre) + .35 * Math.abs(item.walk - seed.walk);
    const chosen = open.map((item, order) => ({ item, order, score: score(item) })).sort((a, b) => a.score - b.score || a.order - b.order)
      .slice(0, LOTS_PER_QUARTER).map(entry => entry.item);
    for (const item of chosen) claimed.add(item);
    quarterLots.push(chosen);
  }

  const courts: PublicSquare[] = [], quarters: SettlementQuarter[] = [], reservations: PlotReservation[] = [], homes: SettlementHome[] = [];
  const usedGreens = new Set<string>();
  // The lake frontage: homes on the open shore meadow, their centres within 48 m of the water.
  const lakeShore = (item: FoundedLot) => waterKeepOut({ ...landform, streams: [], waters: [lake] }, item.centre[0], item.centre[1], 48);
  const waterside = (item: FoundedLot) => waterKeepOut(landform, item.centre[0], item.centre[1], 30);
  quarterLots.forEach((chosen, q) => {
    const year = config.firstYear + q, name = QUARTER_NAMES[q % QUARTER_NAMES.length]!;
    const mean: XZ = [chosen.reduce((sum, item) => sum + item.centre[0], 0) / chosen.length, chosen.reduce((sum, item) => sum + item.centre[1], 0) / chosen.length];
    const green = greens.filter(g => !usedGreens.has(g.id)).sort((a, b) => distance(xz(nodeAt.get(a.nodeId)!), mean) - distance(xz(nodeAt.get(b.nodeId)!), mean) || a.id.localeCompare(b.id))[0];
    if (!green) throw new TownCapacityError(`Quarter ${year} finds no green of its own`);
    usedGreens.add(green.id);
    const court: PublicSquare = { ...green, id: `green:${year}` };
    courts.push(court);
    const frontier = new Set<string>();
    chosen.forEach((item, ordinal) => {
      const street = streets[item.street]!, id = `plot:${year}:${ordinal}`, joinId = joinNode.get(`${item.street}:${item.join}`)!;
      const plot: PlotReservation = { id, quarterYear: year, ordinal, street: street.name, streetId: partOf.get(`${item.street}:${item.join}`)!,
        courtId: court.id, approachId: `${id}:approach`, position: [item.centre[0], item.y, item.centre[1]], rotation: item.rotation, lot: item.lot };
      reservations.push(plot);
      for (const end of [street.from, street.to]) if (end !== 'market' && end !== castle.gateNodeId) frontier.add(end);
      const frontId = `${id}:front`, join = street.points[item.join]!;
      nodes.push({ id: frontId, kind: 'frontage', position: [item.front[0], item.y, item.front[1]] });
      const run = cumulative(item.approach), length = run.at(-1)!;
      edges.push({ id: plot.approachId, from: frontId, to: joinId, kind: 'approach', name: street.name, width: 2, verge: 0, quarterYear: year,
        points: item.approach.map((p, k) => [p[0], item.y + (join[1] - item.y) * Math.max(0, (run[k]! - 3) / Math.max(1e-6, length - 3)), p[1]] as Vec3) });
      if (ordinal < (config.tier === 'hamlet' ? 12 : LOTS_PER_QUARTER)) {
        const hash = seedHash(config.seed + id), r = randomUnit(hash);
        const tier: HomeTier = q === 0 && ordinal % 7 === 0 ? 'manor' : r > .78 ? 'house' : r > .2 ? 'cottage' : 'hut';
        // Waterside homes are Tide, homes at the woods' edge are Grove, the old core around the square is Hearth.
        const style = lakeShore(item) || (waterside(item) && hash % 2 === 0) ? 'tide' : item.centre[0] < treelineX(item.centre[1]) + 56 ? 'grove'
          : item.walk < 110 ? 'hearth' : (['hearth', 'tide', 'grove'] as const)[hash % 3]!;
        homes.push({ ...plot, slot: q * 1024 + ordinal, tier, allowedDepth: HOME_DEPTH_METRES[tier], style, variant: Math.floor(r * 3) });
      }
    });
    quarters.push({ year, name, rootNodeId: court.nodeId, courtIds: [court.id], growthNodeIds: [...frontier].sort() });
  });

  // Active ways: every main street and Crown Road, each home's approach and the lanes that carry it to the square.
  const active = new Set<string>(edges.filter(edge => edge.kind === 'main').map(edge => edge.id));
  const adjacency = new Map<string, StreetEdge[]>();
  for (const edge of edges) if (edge.kind !== 'approach') for (const id of [edge.from, edge.to]) (adjacency.get(id) ?? adjacency.set(id, []).get(id)!).push(edge);
  const parent = new Map<string, StreetEdge>(), seen = new Set(['market']), queue = ['market'];
  for (let i = 0; i < queue.length; i++) for (const edge of (adjacency.get(queue[i]!) ?? []).sort((a, b) => a.id.localeCompare(b.id))) {
    const other = edge.from === queue[i] ? edge.to : edge.from;
    if (!seen.has(other)) { seen.add(other); parent.set(other, edge); queue.push(other); }
  }
  for (const home of homes) {
    active.add(home.approachId);
    for (let at = edges.find(edge => edge.id === home.approachId)!.to, via = parent.get(at); via; at = via.from === at ? via.to : via.from, via = parent.get(at)) active.add(via.id);
  }

  const body = {
    version: 2 as const, config: { ...config }, landform, homes, reservations, quarters, nodes, streets: edges,
    activeStreetIds: [...active].sort(), market, courts, castle,
    // One 512 m terrain request: the founded frame and the plan's 16 m margin.
    bounds: { minX: LAND_FRAME.minX - 16, maxX: LAND_FRAME.maxX + 16, minZ: LAND_FRAME.minZ - 16, maxZ: LAND_FRAME.maxZ + 16 },
    lake: landform.lake,
  };
  return { plan: { ...body, revision: `kingdom-land:1:${seedHash(JSON.stringify(body)).toString(16)}` }, sites, capacity: founded.length };

  /**
   * The square's sites, each a real footprint on its floor: the Forge yard on a quiet stretch of rim with homes
   * behind it, the focal statue pad off-centre where the main street arrives, the well beside the heart, two small
   * pads, stalls along the rim and benches facing the heart. Ways across the square to its streets stay open.
   */
  function marketSites(): LandSite[] {
    const marketEdges = edges.filter(edge => edge.from === 'market' || edge.to === 'market');
    const corridors = marketEdges.map(edge => {
      const path = (edge.from === 'market' ? edge.points : [...edge.points].reverse()).map(xz), inside: XZ[] = [path[0]!];
      for (let k = 1; k < path.length && insideMarket(path[k - 1]!, 2); k++) inside.push(path[k]!);
      return { path: inside, half: edge.width / 2 };
    });
    const mouths = corridors.map(c => c.path.find(p => !insideMarket(p, 0)) ?? c.path.at(-1)!);
    const highMouth = mouths[marketEdges.findIndex(edge => edge.name === 'High Street')];
    // Clearance from the ways across the square, rastered every quarter metre over it.
    const box = expandBounds(pointBounds(boundary), 2), cols = Math.ceil((box.maxX - box.minX) * 4) + 1, rows = Math.ceil((box.maxZ - box.minZ) * 4) + 1;
    const clearance = new Float32Array(cols * rows).fill(NaN);
    const corridorDistance = (p: XZ) => {
      const i = Math.round((p[0] - box.minX) * 4), j = Math.round((p[1] - box.minZ) * 4);
      if (i < 0 || j < 0 || i >= cols || j >= rows) return Infinity;
      const k = i + j * cols;
      if (Number.isNaN(clearance[k]!)) {
        const at: XZ = [box.minX + i / 4, box.minZ + j / 4];
        let value = Infinity;
        for (const c of corridors) for (let q = 1; q < c.path.length; q++) value = Math.min(value, segmentProjection(c.path[q - 1]!, c.path[q]!, ...at).distance - c.half);
        clearance[k] = value;
      }
      return clearance[k]!;
    };
    const nearLots = founded.filter(item => distance(item.centre, centre) < 60);
    const placed: LandSite[] = [];
    // Homes behind a stretch of rim: lots just outside the square on the far side of a point from the heart.
    const roofsBehind = (c: XZ) => nearLots.filter(item => distance(item.centre, c) < 24 && distance(item.centre, centre) > distance(c, centre) + 8).length;
    const spec: { id: string; kind: LandSite['kind']; name: string; size: readonly [number, number]; score: (c: XZ, r: number) => number }[] = [
      { id: 'market:forge', kind: 'forge', name: 'Forge yard', size: MARKET_SITE_SIZE.forge,
        score: (c, r) => -r * 2 - Math.min(...mouths.map(m => distance(m, c))) * .8 - roofsBehind(c) * 2.5 - Math.abs(c[0] - centre[0]) * .25 },
      { id: 'market:statue', kind: 'statue', name: 'Emote statue', size: MARKET_SITE_SIZE.statue,
        score: (c, r) => Math.abs(r - 9.5) * 2 + (highMouth ? Math.abs(distance(c, highMouth) - 12) * .5 : 0) },
      { id: 'market:well', kind: 'well', name: 'Market well', size: MARKET_SITE_SIZE.well, score: (c, r) => Math.abs(r - 8.5) * 2 },
      ...[0, 1].map(k => ({ id: `market:pad:${k}`, kind: 'statue' as const, name: 'Small statue pad', size: MARKET_SITE_SIZE.pad,
        score: (_: XZ, r: number) => Math.abs(r - 10) })),
      ...[0, 1].map(k => ({ id: `market:stall:${k}`, kind: 'stall' as const, name: 'Market stall', size: MARKET_SITE_SIZE.stall,
        score: (_: XZ, r: number) => -r })),
      ...[0, 1].map(k => ({ id: `market:bench:${k}`, kind: 'bench' as const, name: 'Bench', size: MARKET_SITE_SIZE.bench,
        score: (_: XZ, r: number) => -r })),
    ];
    // The first arrangement, trying each site's best few distinct spots, in which every site finds room: the yard
    // and the focal pad choose first, stalls take the rim, the small things fill in around them.
    const order = ['market:forge', 'market:statue', 'market:stall', 'market:well', 'market:pad', 'market:bench'];
    const rankOf = (id: string) => order.findIndex(prefix => id === prefix || id.startsWith(`${prefix}:`));
    const sorted = [...spec].sort((x, y) => rankOf(x.id) - rankOf(y.id) || (x.id < y.id ? -1 : 1));
    let deepest = 0;
    // Every spot a site could take on its own, best first: inside the rim, off the heart and the ways across.
    const spots = sorted.map(item => {
      const [w, d] = item.size, reachOut = Math.hypot(w, d) / 2, faces = item.kind === 'forge' || item.kind === 'statue';
      const options: { c: XZ; score: number; turn: CardinalTurn }[] = [];
      for (let z = Math.floor(centre[1]) - 17; z <= centre[1] + 17; z += .5) for (let x = Math.floor(centre[0]) - 21; x <= centre[0] + 21; x += .5) {
        const c: XZ = [x, z], r = distance(c, centre);
        if (r < MARKET_HEART_RADIUS + Math.min(w, d) / 2 || !insideMarket(c, -Math.min(w, d) / 2 - .75) || corridorDistance(c) < Math.min(w, d) / 2) continue;
        const toward = facingTurn(Math.atan2(centre[0] - c[0], centre[1] - c[1])), score = item.score(c, r);
        options.push({ c, score, turn: toward });
        if (!faces) for (const quarter of [1, 3]) options.push({ c, score: score + 1.5, turn: ((toward + quarter) % 4) as CardinalTurn });
      }
      options.sort((a, b) => a.score - b.score || a.c[0] - b.c[0] || a.c[1] - b.c[1] || a.turn - b.turn);
      const fits: { c: XZ; site: LandSite; box: BoundsXZ }[] = [];
      for (const { c, turn } of options) {
        const local = transformCardinalPoint([0, 0, 0], turn, [w / 2, 0, d / 2]), origin: Vec3 = [c[0] - local[0], elevation, c[1] - local[2]];
        const footprint = footprintOf(origin, turn, w, d), edge = ring(footprint, .5);
        if (corridorDistance(c) < reachOut && edge.some(p => corridorDistance(p) < 0)) continue;
        if (edge.some(p => !insideMarket(p, item.kind === 'bench' ? -.5 : -.75) || distance(p, centre) < MARKET_HEART_RADIUS)) continue;
        fits.push({ c, site: { id: item.id, kind: item.kind, name: item.name, position: origin, turn, footprint }, box: pointBounds(footprint) });
      }
      return fits;
    });
    let budget = 20000;
    const boxes: BoundsXZ[] = [];
    const choose = (k: number): boolean => {
      deepest = Math.max(deepest, k);
      if (k === sorted.length) return true;
      if (--budget < 0) return false;
      const tried: XZ[] = [];
      for (const { c, site, box } of spots[k]!) {
        if (tried.length >= 5) break;
        if (tried.some(t => distance(t, c) < 2)) continue;
        // Cardinal footprints are axis-aligned rectangles, so their bounds are exact.
        if (boxes.some((other, j) => separation(other, box) < (site.kind === 'bench' || placed[j]!.kind === 'bench' ? .75 : 1.25))) continue;
        tried.push(c); placed.push(site); boxes.push(box);
        if (choose(k + 1)) return true;
        placed.pop(); boxes.pop();
      }
      return false;
    };
    if (!choose(0)) throw new Error(`The square at ${centre.join(', ')} has no room for ${sorted[deepest]!.id}`);
    placed.sort((a, b) => spec.findIndex(item => item.id === a.id) - spec.findIndex(item => item.id === b.id));
    return placed;
  }
}
