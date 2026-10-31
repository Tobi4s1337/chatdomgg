import { randomUnit } from '../layout';
import { polygonDistance, segmentProjection } from '../settlement/geometry';
import type { PlotReservation, PublicSquare, StreetEdge, XZ } from '../settlement/types';
import { LAND_FRAME, signedArea, type KingdomGeography } from './geography';
import { naturalLandHeight, sampleLandWater } from './surface';
import type { LandmarkTree, TreeZone, TreeZoneKind } from './types';

/**
 * Where the woods stand. Zones are trunk regions: any trunk planted inside one keeps its whole crown clear of
 * every full future lot, street, square, site and place, and its trunk clear of water and trails. Ground-dressing
 * plants them; this module grows nothing. Everything derives from founded geography and the founded town's
 * complete reservations, so a hamlet's woods are already the town's woods.
 */

/** The broadest crown a zone may receive, plus a 0.25 m margin: old oak and beech 6 m, alder and birch 3.5 m. */
export const CROWN_REACH: Readonly<Record<TreeZoneKind, number>> = {
  ridge: 6.25, 'forest-wall': 6.25, 'clearing-ring': 6.25, grove: 6.25, 'stream-alders': 3.75, 'lake-alders': 3.75,
};
/** Trunks stand this far from a wet edge or a trail's edge; crowns may lean over water and arch over trails. */
export const TRUNK_CLEARANCE = 3;
/** Crowns stay outside the clearing's radius plus this margin. */
export const CLEARING_CROWN_MARGIN = 1.4;
/** The campfire's own envelope at the clearing's heart (spec 21 seats and fire). */
export const CAMPFIRE_ENVELOPE = 9.6;
/** Crown-to-crown width of the gap that frames the beacon from the clearing. */
export const CLEARING_GAP = 8;
/** Landmark crown radii: the 16 m elder oak and the 9 m wind-bent pine. */
export const LANDMARK_CROWN: Readonly<Record<LandmarkTree['id'], number>> = { 'elder-oak': 8, 'summit-pine': 4.5 };
/** Steepest ground a trunk may stand on (30°). */
const MAX_SLOPE = Math.tan(Math.PI / 6);
/** Raster step and the allowance that covers it plus outline simplification. */
const CELL = 1;
const SAFETY = 1;
const SIMPLIFY = .3;
/** Neighbouring zones stay this far apart, so simplified outlines can never overlap. */
const GUTTER = 1;
/** Planting priority: a cell belongs to the first zone that claims it, so zones never overlap. */
const ORDER: readonly TreeZoneKind[] = ['clearing-ring', 'forest-wall', 'lake-alders', 'stream-alders', 'ridge', 'grove'];

/** The founded town as planting sees it. */
export interface PlantingTown {
  /** The founding revision's complete reservations: every lot its town will ever hold, not today's homes. */
  reservations: readonly PlotReservation[];
  streets: readonly StreetEdge[];
  market: PublicSquare;
  courts: readonly PublicSquare[];
  /** Earth trails beyond the streets; crowns may arch over them while trunks keep off. */
  trails?: readonly (readonly XZ[])[];
}
/** A view kept open through the woods: crowns stay outside its corridor, which widens from `from` to `to`. */
export interface PlantingSightline { id: string; from: XZ; to: XZ; halfWidth: readonly [number, number] }
export interface PlantingPlan {
  treeZones: readonly TreeZone[];
  landmarks: readonly LandmarkTree[];
  sightlines: readonly PlantingSightline[];
  /** How far crowns from each zone can reach: drawn on the plan map, never a planting region. */
  crownReach: readonly { kind: TreeZoneKind; outline: readonly XZ[] }[];
  clearing: { centre: XZ; radius: number; campfire: number; crownLimit: number };
}

interface Grid { minX: number; minZ: number; w: number; h: number }
const round8 = (value: number) => Math.round(value * 8) / 8;
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const along = (from: XZ, bearing: number, distance: number): XZ => [from[0] + Math.sin(bearing) * distance, from[1] + Math.cos(bearing) * distance];

export function foundPlantingZones(geography: KingdomGeography, town: PlantingTown): PlantingPlan {
  const { landform, places, sites, castle } = geography, seed = landform.seed;
  const unit = (key: string) => randomUnit(seed ^ hashText(`plant:${key}`));
  const grid: Grid = { minX: LAND_FRAME.minX, minZ: LAND_FRAME.minZ, w: (LAND_FRAME.maxX - LAND_FRAME.minX) / CELL + 1, h: (LAND_FRAME.maxZ - LAND_FRAME.minZ) / CELL + 1 };
  const count = grid.w * grid.h, wx = (i: number) => grid.minX + (i % grid.w) * CELL, wz = (i: number) => grid.minZ + Math.floor(i / grid.w) * CELL;

  // Landmarks. The elder oak stands on its place anchor, its root seat facing the meadow it marks. The pine
  // grips the summit's rim beside the view, away from the arriving trail, and leans (its local +X) into the view.
  const { forest, lookout } = places;
  const oak: LandmarkTree = { id: 'elder-oak', position: [forest.oak[0], forest.oak[1], forest.oak[2]], yaw: wrap(forest.entryBearing + Math.PI) };
  const summit: XZ = [lookout.summit[0], lookout.summit[2]], arrival = lookout.trail.at(-1)!;
  const pineAt = [1, -1].map(side => along(summit, lookout.viewBearing + side * 1.75, 5.5))
    .sort((a, b) => Math.hypot(b[0] - arrival[0], b[1] - arrival[2]) - Math.hypot(a[0] - arrival[0], a[1] - arrival[2]))[0]!;
  const pine: LandmarkTree = { id: 'summit-pine', position: [round8(pineAt[0]), round8(naturalLandHeight(landform, ...pineAt)), round8(pineAt[1])],
    yaw: wrap(lookout.viewBearing - Math.PI / 2) };
  const landmarks = [oak, pine];

  // Views the woods keep open. Each destination shows the next: clearing to beacon, parapet to lake, pier to
  // pine, summit over the town and back to the oak.
  const clearing: XZ = [forest.clearing.centre[0], forest.clearing.centre[2]];
  const beacon = castle.modules.find(module => module.id === castle.beaconModuleId)!;
  const beaconAt: XZ = [beacon.position[0] + beacon.size[0] / 2, beacon.position[2] + beacon.size[2] / 2];
  const pier = sites.find(site => site.id === 'water:pier'), lake = landform.lake;
  const pierHead = pier ? pier.footprint.reduce((far, p) => Math.hypot(p[0] - summit[0], p[1] - summit[1]) > Math.hypot(far[0] - summit[0], far[1] - summit[1]) ? p : far) : undefined;
  const parapet = places.court.parapet.flat(), parapetMid: XZ = [parapet.reduce((s, p) => s + p[0], 0) / parapet.length, parapet.reduce((s, p) => s + p[1], 0) / parapet.length];
  const toOak = Math.hypot(oak.position[0] - summit[0], oak.position[2] - summit[1]);
  const sightlines: PlantingSightline[] = [
    { id: 'clearing-beacon', from: clearing, to: beaconAt, halfWidth: [CLEARING_GAP / 2, CLEARING_GAP / 2 + 10] },
    { id: 'parapet-lake', from: parapetMid, to: [lake.x, lake.z], halfWidth: [8, Math.min(lake.radiusX, lake.radiusZ) * .8] },
    { id: 'summit-view', from: summit, to: along(summit, lookout.viewBearing, 150), halfWidth: [6, 34] },
    { id: 'summit-oak', from: summit, to: along(summit, Math.atan2(oak.position[0] - summit[0], oak.position[2] - summit[1]), toOak - LANDMARK_CROWN['elder-oak'] - 4), halfWidth: [5, 9] },
    ...(pierHead ? [{ id: 'pier-pine', from: pierHead, to: pineAt, halfWidth: [5, 8] as const }] : []),
  ];

  // Keep-outs, rasterised once. Crowns clear `crown`; trunks clear `trunk` (trails) and the water's wet edge.
  const crown = new Uint8Array(count), trunk = new Uint8Array(count), lots = new Uint8Array(count);
  const mark = (mask: Uint8Array, minX: number, maxX: number, minZ: number, maxZ: number, inside: (x: number, z: number) => boolean) => {
    const x0 = Math.max(0, Math.floor((minX - grid.minX) / CELL)), x1 = Math.min(grid.w - 1, Math.ceil((maxX - grid.minX) / CELL));
    const z0 = Math.max(0, Math.floor((minZ - grid.minZ) / CELL)), z1 = Math.min(grid.h - 1, Math.ceil((maxZ - grid.minZ) / CELL));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const i = ix + iz * grid.w;
      if (!mask[i] && inside(grid.minX + ix * CELL, grid.minZ + iz * CELL)) mask[i] = 1;
    }
  };
  const disc = (mask: Uint8Array, [cx, cz]: XZ, r: number) => mark(mask, cx - r, cx + r, cz - r, cz + r, (x, z) => Math.hypot(x - cx, z - cz) <= r);
  const polygon = (mask: Uint8Array, outline: readonly XZ[], grow = 0) => {
    const xs = outline.map(p => p[0]), zs = outline.map(p => p[1]);
    mark(mask, Math.min(...xs) - grow, Math.max(...xs) + grow, Math.min(...zs) - grow, Math.max(...zs) + grow, (x, z) => polygonDistance(outline, x, z) <= grow);
  };
  const line = (mask: Uint8Array, points: readonly XZ[], r: number) => {
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1]!, b = points[k]!;
      mark(mask, Math.min(a[0], b[0]) - r, Math.max(a[0], b[0]) + r, Math.min(a[1], b[1]) - r, Math.max(a[1], b[1]) + r, (x, z) => segmentProjection(a, b, x, z).distance <= r);
    }
  };
  for (const plot of town.reservations) { const l = plot.lot; for (const mask of [crown, lots]) mark(mask, l.minX, l.maxX, l.minZ, l.maxZ, () => true); }
  for (const street of town.streets) {
    const points = street.points.map(p => [p[0], p[2]] as XZ);
    if (street.kind === 'trail') line(trunk, points, street.width / 2); else line(crown, points, street.width / 2 + street.verge);
  }
  for (const trail of town.trails ?? []) line(trunk, trail, 1.25);
  for (const square of [town.market, ...town.courts, places.court]) polygon(crown, square.boundary);
  // The castle compound and its 12 m apron hold nothing tall.
  const b = castle.bounds;
  mark(crown, b.minX - 12, b.maxX + 12, b.minZ - 12, b.maxZ + 12, () => true);
  for (const site of sites) polygon(crown, site.footprint);
  const lookoutHill = landform.hills.find(hill => hill.id === 'lookout');
  if (lookoutHill) disc(crown, lookoutHill.centre, lookoutHill.plateau);
  line(trunk, lookout.trail.map(p => [p[0], p[2]] as XZ), 1.25);
  line(trunk, forest.path.map(p => [p[0], p[2]] as XZ), 1.25);
  disc(crown, clearing, forest.clearing.radius + CLEARING_CROWN_MARGIN);
  for (const tree of landmarks) disc(crown, [tree.position[0], tree.position[2]], LANDMARK_CROWN[tree.id]);
  for (const view of sightlines) {
    const [a, c] = [view.from, view.to], reach = Math.max(...view.halfWidth);
    mark(crown, Math.min(a[0], c[0]) - reach, Math.max(a[0], c[0]) + reach, Math.min(a[1], c[1]) - reach, Math.max(a[1], c[1]) + reach, (x, z) => {
      const { distance, t } = segmentProjection(a, c, x, z), half = view.halfWidth[0] + (view.halfWidth[1] - view.halfWidth[0]) * t;
      return distance <= half;
    });
  }
  const crownDistance = distanceField(crown, grid), trunkDistance = distanceField(trunk, grid), lotDistance = distanceField(lots, grid);

  // Ground: steepness, and the distance to water (signed by the wet edge, so channels count from their banks).
  // Both are smooth, so they are sampled every 2 m and interpolated; SAFETY covers the difference.
  const coarse = { w: (grid.w - 1) / 2 + 1, h: (grid.h - 1) / 2 + 1 }, far = 60;
  const coarseHeight = new Float32Array(coarse.w * coarse.h), coarseWater = new Float32Array(coarse.w * coarse.h), coarseLake = new Float32Array(coarse.w * coarse.h);
  for (let j = 0; j < coarse.h; j++) for (let k = 0; k < coarse.w; k++) {
    const x = grid.minX + k * 2 * CELL, z = grid.minZ + j * 2 * CELL, sample = sampleLandWater(landform, x, z), c = k + j * coarse.w;
    coarseHeight[c] = naturalLandHeight(landform, x, z);
    coarseWater[c] = sample ? Math.min(far, sample.shoreDistance) : far;
    coarseLake[c] = sample?.id === 'lake' ? Math.min(far, sample.shoreDistance) : far;
  }
  const coarseSlope = new Float32Array(coarse.w * coarse.h);
  for (let j = 0; j < coarse.h; j++) for (let k = 0; k < coarse.w; k++) {
    const at = (kk: number, jj: number) => coarseHeight[Math.max(0, Math.min(coarse.w - 1, kk)) + Math.max(0, Math.min(coarse.h - 1, jj)) * coarse.w]!;
    coarseSlope[k + j * coarse.w] = Math.hypot(at(k + 1, j) - at(k - 1, j), at(k, j + 1) - at(k, j - 1)) / (4 * CELL);
  }
  const fine = (source: Float32Array, i: number) => {
    const fx = (i % grid.w) / 2, fz = Math.floor(i / grid.w) / 2, k = Math.min(coarse.w - 2, Math.floor(fx)), j = Math.min(coarse.h - 2, Math.floor(fz)), u = fx - k, v = fz - j;
    const c = k + j * coarse.w;
    return (source[c]! * (1 - u) + source[c + 1]! * u) * (1 - v) + (source[c + coarse.w]! * (1 - u) + source[c + coarse.w + 1]! * u) * v;
  };
  const water = new Float32Array(count), lakeDistance = new Float32Array(count);
  for (let i = 0; i < count; i++) { water[i] = fine(coarseWater, i); const lakeAt = fine(coarseLake, i); lakeDistance[i] = lakeAt >= far - 1e-3 ? Infinity : lakeAt; }
  const steep = (i: number) => fine(coarseSlope, i) > MAX_SLOPE;
  const clearance = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = wx(i), z = wz(i);
    const frame = Math.min(x - LAND_FRAME.minX, LAND_FRAME.maxX - x, z - LAND_FRAME.minZ, LAND_FRAME.maxZ - z) - CELL;
    clearance[i] = Math.min(frame, trunkDistance[i]! - TRUNK_CLEARANCE - SAFETY, water[i]! - TRUNK_CLEARANCE - SAFETY, steep(i) ? -CELL : Infinity);
  }

  // Where each kind of wood would grow on open land, in metres (positive inside).
  const regions = new Map<TreeZoneKind, Float32Array>();
  const region = (kind: TreeZoneKind, value: (x: number, z: number, i: number) => number) => {
    const field = new Float32Array(count);
    for (let i = 0; i < count; i++) field[i] = value(wx(i), wz(i), i);
    regions.set(kind, field);
  };
  // Forest wall: everything west of the founded treeline, its edge breathing in and out by a few metres.
  const treeline = [...forest.treeline].sort((p, q) => p[1] - q[1]), edgePhase = unit('edge') * 6.283;
  const treelineX = (z: number) => {
    let k = 1;
    while (k < treeline.length - 1 && treeline[k]![1] < z) k++;
    const a = treeline[k - 1]!, c = treeline[k]!, t = Math.max(0, Math.min(1, (z - a[1]) / (c[1] - a[1] || 1)));
    return a[0] + (c[0] - a[0]) * t + 3.5 * Math.sin(z * .083 + edgePhase) + 2 * Math.sin(z * .21 + edgePhase * 2);
  };
  const ringOuter = forest.clearing.radius + CLEARING_CROWN_MARGIN + CROWN_REACH['clearing-ring'] + SAFETY + 13;
  region('clearing-ring', (x, z) => {
    const angle = Math.atan2(z - clearing[1], x - clearing[0]);
    return ringOuter * (1 + .07 * Math.sin(angle * 3 + edgePhase) + .04 * Math.sin(angle * 5 - edgePhase)) - Math.hypot(x - clearing[0], z - clearing[1]);
  });
  region('forest-wall', (x, z) => treelineX(z) - x);
  // Lake alders on the far shores: west round to the south-east, leaving the town's shore and the pier open.
  const windows = [[-2.55 + unit('lake:a') * .2, -.42 + unit('lake:b') * .15], [.08 + unit('lake:c') * .12, 1.2 + unit('lake:d') * .15]] as const;
  region('lake-alders', (x, z, i) => {
    const d = lakeDistance[i]!;
    if (!Number.isFinite(d)) return -Infinity;
    const bearing = Math.atan2(x - lake.x, z - lake.z), r = Math.hypot(x - lake.x, z - lake.z);
    const sector = Math.max(...windows.map(([from, to]) => Math.min(wrap(bearing - from), wrap(to - bearing)) * r));
    return Math.min(TRUNK_CLEARANCE + 8 + 2.5 * Math.sin(bearing * 4 + edgePhase) - d, sector);
  });
  // Stream alders in runs along alternating banks: a few trees, then open bank where the water shows.
  const streamField = new Float32Array(count).fill(-Infinity);
  for (const course of landform.streams.filter(item => item.kind === 'stream')) {
    let arc = 0, side = unit(`${course.id}:side`) < .5 ? 1 : -1;
    const runs: { from: number; to: number; side: number }[] = [];
    const total = course.points.slice(1).reduce((sum, p, k) => sum + Math.hypot(p.position[0] - course.points[k]!.position[0], p.position[1] - course.points[k]!.position[1]), 0);
    for (let s = 6 + unit(`${course.id}:start`) * 8, n = 0; s < total - 8; n++) {
      const length = 16 + unit(`${course.id}:run:${n}`) * 20;
      runs.push({ from: s, to: Math.min(total - 4, s + length), side });
      s += length + 10 + unit(`${course.id}:gap:${n}`) * 18;
      if (unit(`${course.id}:turn:${n}`) < .72) side = -side;
    }
    for (let k = 1; k < course.points.length; k++) {
      const a = course.points[k - 1]!, c = course.points[k]!, length = Math.hypot(c.position[0] - a.position[0], c.position[1] - a.position[1]);
      const reach = Math.max(a.width, c.width) / 2 + TRUNK_CLEARANCE + 11;
      const x0 = Math.max(0, Math.floor((Math.min(a.position[0], c.position[0]) - reach - grid.minX) / CELL)), x1 = Math.min(grid.w - 1, Math.ceil((Math.max(a.position[0], c.position[0]) + reach - grid.minX) / CELL));
      const z0 = Math.max(0, Math.floor((Math.min(a.position[1], c.position[1]) - reach - grid.minZ) / CELL)), z1 = Math.min(grid.h - 1, Math.ceil((Math.max(a.position[1], c.position[1]) + reach - grid.minZ) / CELL));
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
        const i = ix + iz * grid.w, x = grid.minX + ix * CELL, z = grid.minZ + iz * CELL;
        const p = segmentProjection(a.position, c.position, x, z), at = arc + p.t * length;
        const bank = Math.sign((c.position[0] - a.position[0]) * (z - a.position[1]) - (c.position[1] - a.position[1]) * (x - a.position[0])) || 1;
        const width = a.width + (c.width - a.width) * p.t, band = width / 2 + TRUNK_CLEARANCE + 7 + 2 * Math.sin(at * .09 + edgePhase) - p.distance;
        let run = -Infinity;
        for (const item of runs) if (item.side === bank) run = Math.max(run, Math.min(at - item.from, item.to - at));
        streamField[i] = Math.max(streamField[i]!, Math.min(band, run));
      }
      arc += length;
    }
  }
  regions.set('stream-alders', streamField);
  // Ridge stands: belts that follow a brow and break the skyline in groups, with sky left between them.
  // Each is a spine with a ragged half-width; a single round clump is only used to crown a hilltop.
  const stands: { id: string; spine: XZ[]; width: number }[] = [];
  const hill = (id: string) => landform.hills.find(item => item.id === id);
  const arc = (centre: XZ, radius: number, from: number, to: number): XZ[] => {
    const steps = Math.max(2, Math.ceil(Math.abs(to - from) * radius / 4));
    return Array.from({ length: steps + 1 }, (_, k) => along(centre, from + (to - from) * k / steps, radius));
  };
  const castleHill = hill('castle-rise');
  // The castle rise's back flanks: two brows framing the keep, leaving the sky directly behind it clear.
  if (castleHill) for (const side of [-1, 1]) {
    const from = Math.PI + side * (.42 + unit(`castle:${side}:a`) * .12), to = Math.PI + side * (1.2 + unit(`castle:${side}:b`) * .2);
    stands.push({ id: `castle:${side}`, spine: arc(castleHill.centre, castleHill.plateau + 12 + unit(`castle:${side}:r`) * 4, from, to), width: 8 + unit(`castle:${side}:w`) * 3 });
  }
  // The spring wold wears a crown of trees on its top, with one stand trailing down its southern brow.
  const spring = hill('spring-wold');
  if (spring) {
    stands.push({ id: 'spring:crown', spine: [along(spring.centre, unit('spring:c') * 6.283, 4), along(spring.centre, unit('spring:c') * 6.283 + Math.PI, 4)], width: spring.plateau * .85 });
    const brow = unit('spring:brow') * .6 - .3;
    stands.push({ id: 'spring:brow', spine: arc(spring.centre, spring.plateau + 20, brow - .5, brow + .45), width: 7 + unit('spring:w') * 3 });
  }
  // The east wood: three belts along the far upland, wandering a little, with open sky between them.
  let z = LAND_FRAME.minZ + 8 + unit('east:start') * 10;
  for (let n = 0; n < 3 && z < 120; n++) {
    const length = 62 + unit(`east:len:${n}`) * 30, spine: XZ[] = [], phase = unit(`east:phase:${n}`) * 6.283;
    for (let k = 0; k <= 8; k++) { const zz = z + length * k / 8; spine.push([214 + 8 * Math.sin(zz * .03 + phase) + (unit(`east:x:${n}`) - .5) * 10, zz]); }
    stands.push({ id: `east:${n}`, spine, width: 11 + unit(`east:w:${n}`) * 5 });
    z += length + 26 + unit(`east:gap:${n}`) * 18;
  }
  // The lookout's back shoulder, behind whoever sits looking at the town.
  if (lookoutHill) {
    const back = lookout.viewBearing + Math.PI;
    stands.push({ id: 'lookout', spine: arc(lookoutHill.centre, lookoutHill.plateau + 21, back - .85, back + .85), width: 7 + unit('lookout:w') * 3 });
  }
  const belt = (spine: readonly XZ[], width: number, key: string) => {
    const a = unit(`${key}:a`) * 6.283, c = unit(`${key}:c`) * 6.283, xs = spine.map(p => p[0]), zs = spine.map(p => p[1]), pad = width * 1.4 + 2;
    const box = { minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minZ: Math.min(...zs) - pad, maxZ: Math.max(...zs) + pad };
    const lengths = spine.slice(1).map((p, k) => Math.hypot(p[0] - spine[k]![0], p[1] - spine[k]![1])), total = lengths.reduce((sum, l) => sum + l, 0);
    return (x: number, z: number) => {
      if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) return -Infinity;
      let best = Infinity, at = 0, run = 0;
      for (let k = 1; k < spine.length; k++) {
        const p = segmentProjection(spine[k - 1]!, spine[k]!, x, z);
        if (p.distance < best) { best = p.distance; at = run + p.t * lengths[k - 1]!; }
        run += lengths[k - 1]!;
      }
      // Ends taper so a belt never stops square; the edge breathes along its length and around its ends.
      const taper = total > 1 ? Math.min(1, .45 + Math.min(at, total - at) / (width * 1.6)) : 1;
      const angle = Math.atan2(z - spine[0]![1], x - spine[0]![0]);
      return width * taper * (1 + .2 * Math.sin(at * .19 + a) + .12 * Math.sin(at * .47 + c) + .08 * Math.sin(angle * 5 + c)) - best;
    };
  };
  const lobes = (centre: XZ, radius: number, key: string) => {
    const a = unit(`${key}:3`) * 6.283, c = unit(`${key}:5`) * 6.283;
    return (x: number, z: number) => {
      const angle = Math.atan2(z - centre[1], x - centre[0]);
      return radius * (1 + .2 * Math.sin(angle * 3 + a) + .1 * Math.sin(angle * 5 + c)) - Math.hypot(x - centre[0], z - centre[1]);
    };
  };
  const standFields = stands.map(stand => belt(stand.spine, stand.width, stand.id));
  region('ridge', (x, z) => {
    let best = -100;
    for (const field of standFields) best = Math.max(best, field(x, z));
    return best;
  });

  // Claim cells in order: neighbouring zones meet across a narrow gutter and never overlap.
  const zoneFields = new Map<TreeZoneKind, Float32Array>(), claimed = new Float32Array(count).fill(-Infinity);
  const claim = (kind: TreeZoneKind, source: Float32Array) => {
    const field = new Float32Array(count), reach = CROWN_REACH[kind];
    for (let i = 0; i < count; i++) {
      const own = Math.min(source[i]!, clearance[i]!, crownDistance[i]! - reach - SAFETY);
      field[i] = Math.min(own, -claimed[i]! - GUTTER);
    }
    for (let i = 0; i < count; i++) claimed[i] = Math.max(claimed[i]!, field[i]!);
    zoneFields.set(kind, field);
  };
  for (const kind of ORDER.filter(kind => kind !== 'grove')) claim(kind, regions.get(kind)!);

  // Groves on the greens: small clumps near the town's edges, spaced apart, clear of every view and wood.
  const groves: { centre: XZ; radius: number }[] = [];
  const candidates: { centre: XZ; radius: number; score: number }[] = [];
  for (let z = LAND_FRAME.minZ + 24; z <= LAND_FRAME.maxZ - 24; z += 9) for (let x = LAND_FRAME.minX + 24; x <= LAND_FRAME.maxX - 24; x += 9) {
    const key = `grove:${x}:${z}`, cx = Math.round(x + (unit(`${key}:x`) - .5) * 6), cz = Math.round(z + (unit(`${key}:z`) - .5) * 6);
    const i = (cx - grid.minX) / CELL + (cz - grid.minZ) / CELL * grid.w, radius = 4.5 + unit(`${key}:r`) ** 1.6 * 7;
    const open = Math.min(clearance[i]!, crownDistance[i]! - CROWN_REACH.grove - SAFETY);
    if (open < radius || claimed[i]! > -26 || lotDistance[i]! > 64 || lotDistance[i]! < 14) continue;
    candidates.push({ centre: [cx, cz], radius, score: Math.min(open - radius, 12) + unit(`${key}:s`) * 10 - Math.abs(lotDistance[i]! - 30) * .15 });
  }
  candidates.sort((p, q) => q.score - p.score || p.centre[1] - q.centre[1] || p.centre[0] - q.centre[0]);
  for (const candidate of candidates) {
    if (groves.length >= 6) break;
    if (groves.every(grove => Math.hypot(grove.centre[0] - candidate.centre[0], grove.centre[1] - candidate.centre[1]) >= 60)) groves.push(candidate);
  }
  const groveFields = groves.map((grove, n) => ({ ...grove, field: lobes(grove.centre, grove.radius, `grove:${n}`) }));
  const groveRegion = new Float32Array(count).fill(-100);
  for (let i = 0; i < count; i++) for (const grove of groveFields) {
    const x = wx(i), z = wz(i);
    if (Math.abs(x - grove.centre[0]) < grove.radius * 1.4 + 2 && Math.abs(z - grove.centre[1]) < grove.radius * 1.4 + 2) groveRegion[i] = Math.max(groveRegion[i]!, grove.field(x, z));
  }
  claim('grove', groveRegion);

  // Outlines. Each zone is a simple CCW polygon; a keep-out enclosed by a wood is opened to the wood's edge.
  const treeZones: TreeZone[] = [], crownReach: PlantingPlan['crownReach'][number][] = [];
  for (const kind of ORDER) {
    const field = zoneFields.get(kind)!;
    const outlines = simpleOutlines(field, grid).filter(outline => signedArea(outline) >= 12);
    outlines.sort((p, q) => Math.min(...p.map(v => v[1])) - Math.min(...q.map(v => v[1])) || Math.min(...p.map(v => v[0])) - Math.min(...q.map(v => v[0])));
    outlines.forEach((outline, n) => treeZones.push({ id: `${kind}:${n}`, kind, outline }));
    const reachField = new Float32Array(count), reach = CROWN_REACH[kind];
    for (let i = 0; i < count; i++) reachField[i] = field[i]! + reach;
    for (const outline of contourLoops(reachField, grid)) if (Math.abs(signedArea(outline)) >= 12) crownReach.push({ kind, outline: simplify(outline, .6) });
  }
  return { treeZones, landmarks, sightlines, crownReach,
    clearing: { centre: clearing, radius: forest.clearing.radius, campfire: CAMPFIRE_ENVELOPE, crownLimit: forest.clearing.radius + CLEARING_CROWN_MARGIN } };
}

function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Euclidean distance (metres) from each node to the nearest marked node: Felzenszwalb–Huttenlocher, two passes. */
function distanceField(mask: Uint8Array, grid: Grid): Float32Array {
  const { w, h } = grid, big = 1e12, squared = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) squared[i] = mask[i] ? 0 : big;
  const pass = (read: (k: number) => number, write: (k: number, value: number) => void, n: number) => {
    const f = new Float64Array(n), v = new Int32Array(n), boundary = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) f[k] = read(k);
    let j = 0; v[0] = 0; boundary[0] = -Infinity; boundary[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = ((f[q]! + q * q) - (f[v[j]!]! + v[j]! * v[j]!)) / (2 * q - 2 * v[j]!);
      while (s <= boundary[j]!) { j--; s = ((f[q]! + q * q) - (f[v[j]!]! + v[j]! * v[j]!)) / (2 * q - 2 * v[j]!); }
      j++; v[j] = q; boundary[j] = s; boundary[j + 1] = Infinity;
    }
    j = 0;
    for (let q = 0; q < n; q++) { while (boundary[j + 1]! < q) j++; write(q, (q - v[j]!) ** 2 + f[v[j]!]!); }
  };
  for (let x = 0; x < w; x++) pass(k => squared[x + k * w]!, (k, value) => { squared[x + k * w] = value; }, h);
  for (let z = 0; z < h; z++) pass(k => squared[k + z * w]!, (k, value) => { squared[k + z * w] = value; }, w);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = squared[i]! >= big ? Infinity : Math.sqrt(squared[i]!) * CELL;
  return out;
}

/** Closed iso-loops where the field crosses zero (inside > 0); the grid's border always counts as outside. */
export function contourLoops(field: Float32Array, grid: Grid): XZ[][] {
  const { w, h } = grid;
  const value = (ix: number, iz: number) => ix <= 0 || iz <= 0 || ix >= w - 1 || iz >= h - 1 ? -1 : field[ix + iz * w]!;
  const points = new Map<number, XZ>(), links = new Map<number, number[]>();
  const edgePoint = (key: number, ax: number, az: number, bx: number, bz: number) => {
    if (!points.has(key)) {
      const fa = value(ax, az), fb = value(bx, bz), t = fa / (fa - fb);
      points.set(key, [grid.minX + (ax + (bx - ax) * t) * CELL, grid.minZ + (az + (bz - az) * t) * CELL]);
    }
    return key;
  };
  const link = (a: number, b: number) => { (links.get(a) ?? links.set(a, []).get(a)!).push(b); (links.get(b) ?? links.set(b, []).get(b)!).push(a); };
  for (let iz = 0; iz < h - 1; iz++) for (let ix = 0; ix < w - 1; ix++) {
    const a = value(ix, iz) > 0, b = value(ix + 1, iz) > 0, c = value(ix + 1, iz + 1) > 0, d = value(ix, iz + 1) > 0;
    const code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
    if (code === 0 || code === 15) continue;
    // Edges: bottom (a–b), right (b–c), top (d–c), left (a–d).
    const base = (ix + iz * w) * 2, bottom = () => edgePoint(base, ix, iz, ix + 1, iz), left = () => edgePoint(base + 1, ix, iz, ix, iz + 1);
    const top = () => edgePoint((ix + (iz + 1) * w) * 2, ix, iz + 1, ix + 1, iz + 1), right = () => edgePoint((ix + 1 + iz * w) * 2 + 1, ix + 1, iz, ix + 1, iz + 1);
    const centre = (value(ix, iz) + value(ix + 1, iz) + value(ix + 1, iz + 1) + value(ix, iz + 1)) / 4 > 0;
    switch (code) {
      case 1: case 14: link(bottom(), left()); break;
      case 2: case 13: link(bottom(), right()); break;
      case 4: case 11: link(right(), top()); break;
      case 8: case 7: link(left(), top()); break;
      case 3: case 12: link(left(), right()); break;
      case 6: case 9: link(bottom(), top()); break;
      case 5: if (centre) { link(bottom(), right()); link(left(), top()); } else { link(bottom(), left()); link(right(), top()); } break;
      case 10: if (centre) { link(bottom(), left()); link(right(), top()); } else { link(bottom(), right()); link(left(), top()); } break;
    }
  }
  const loops: XZ[][] = [], seen = new Set<number>();
  for (const start of [...links.keys()].sort((p, q) => p - q)) {
    if (seen.has(start)) continue;
    const loop: XZ[] = [];
    let previous = -1, current = start;
    while (!seen.has(current)) {
      seen.add(current); loop.push(points.get(current)!);
      const next = links.get(current)!.find(key => key !== previous && !seen.has(key)) ?? links.get(current)!.find(key => key !== previous);
      if (next === undefined) break;
      previous = current; current = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

const contains = (outline: readonly XZ[], [x, z]: XZ) => polygonDistance(outline, x, z) < 0;

/** Outer loops of a field as simple CCW polygons. Holes are opened by a slit to the outside, then re-traced. */
function simpleOutlines(source: Float32Array, grid: Grid): XZ[][] {
  const field = source.slice();
  for (let attempt = 0; attempt < 40; attempt++) {
    const loops = contourLoops(field, grid);
    const hole = loops.find(loop => loops.filter(other => other !== loop && contains(other, loop[0]!)).length % 2 === 1);
    if (!hole) {
      return loops.map(loop => {
        const ccw = signedArea(loop) > 0 ? loop : [...loop].reverse();
        let out = simplify(ccw, SIMPLIFY).map(([x, z]) => [round8(x), round8(z)] as XZ);
        out = out.filter((p, k) => { const q = out[(k + 1) % out.length]!; return p[0] !== q[0] || p[1] !== q[1]; });
        return isSimple(out) ? out : ccw.map(([x, z]) => [round8(x), round8(z)] as XZ);
      });
    }
    // Cut two rows westward from the hole's western tip until the cut leaves the wood.
    const tip = hole.reduce((west, p) => p[0] < west[0] ? p : west);
    const iz = Math.floor((tip[1] - grid.minZ) / CELL);
    for (const row of [iz, iz + 1]) {
      if (row < 0 || row >= grid.h) continue;
      let entered = false;
      for (let ix = Math.min(grid.w - 1, Math.ceil((tip[0] - grid.minX) / CELL)); ix >= 0; ix--) {
        const i = ix + row * grid.w;
        if (field[i]! > 0) { entered = true; field[i] = -CELL; } else if (entered) break;
      }
    }
  }
  throw new Error('Planting outlines could not be opened into simple polygons');
}

/** Douglas–Peucker on a closed loop, anchored at its two most distant vertices. */
function simplify(loop: readonly XZ[], tolerance: number): XZ[] {
  if (loop.length < 8) return [...loop];
  let far = 0;
  for (let k = 1; k < loop.length; k++) if (Math.hypot(loop[k]![0] - loop[0]![0], loop[k]![1] - loop[0]![1]) > Math.hypot(loop[far]![0] - loop[0]![0], loop[far]![1] - loop[0]![1])) far = k;
  const keep = new Uint8Array(loop.length); keep[0] = 1; keep[far] = 1;
  const run = (from: number, to: number) => {
    const stack: [number, number][] = [[from, to]];
    while (stack.length) {
      const [a, c] = stack.pop()!;
      let best = -1, worst = tolerance;
      for (let k = a + 1; k < c; k++) {
        const d = segmentProjection(loop[a]!, loop[c % loop.length]!, loop[k]![0], loop[k]![1]).distance;
        if (d > worst) { worst = d; best = k; }
      }
      if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, c]); }
    }
  };
  run(0, far); run(far, loop.length);
  return loop.filter((_, k) => keep[k]);
}

function isSimple(outline: readonly XZ[]): boolean {
  const n = outline.length;
  if (n < 3) return false;
  const cross = (o: XZ, a: XZ, c: XZ) => (a[0] - o[0]) * (c[1] - o[1]) - (a[1] - o[1]) * (c[0] - o[0]);
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const a = outline[i]!, b = outline[(i + 1) % n]!, c = outline[j]!, d = outline[(j + 1) % n]!;
    if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0])
      || Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) continue;
    if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return false;
  }
  return true;
}

