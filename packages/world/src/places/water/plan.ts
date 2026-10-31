import type { Vec3 } from '@chatdom/shared';
import { PIER_DECK_HEIGHT } from '../../kingdom-land/routes';
import { naturalLandHeight, sampleLandWater, waterKeepOut, waterSurfaceAt } from '../../kingdom-land/surface';
import type { KingdomLandform, LandSite, WaterBody } from '../../kingdom-land/types';
import { polygonDistance } from '../../settlement/geometry';
import type { XZ } from '../../settlement/types';
import {
  CELL, cellToWorld, directionToWorld, localBounds, rectangleSamples, rectangleToWorld, toLocal, toWorld, type CardinalFrame,
} from './frame';
import { deriveWaterReaches, LEVEL_TOLERANCE, nearestOnReach, type WaterReach } from './reaches';
import type {
  BoathousePlan, BridgePlan, FingerpostArmPlan, FingerpostTarget, FoundationGrid, LakePlace, MillPlace, MillPlan, PierPlan,
  RockPlan, SignPlan, SiteRef, WaterNeed, WaterPieceSpecs, WaterPlacement, WaterPlaceInput, WaterPlacePlan, WeirPlan, WheelPlan,
} from './types';

/**
 * Supplied land into honest water-place metadata. The planner reads the approved landform, its sites and the public
 * path nodes, and derives frames, factory parameters, foundations and flow from them. It never routes a course,
 * chooses or moves a site, carves, or turns a structure off its cardinal turn: anything it cannot honour becomes a
 * `WaterNeed` naming who must act. Pure and deterministic; no clocks, no randomness.
 */

/** A piece may stand this far past its site's footprint (walls, copings) before the land must reserve more. */
export const FOOTPRINT_TOLERANCE = 1;
/** Or this close to the water it stands in: wing walls, abutments and piers bear on the bank beside it. */
const BANK_ALLOWANCE = 1.5;
/** Where a piece may overlap a neighbouring site's footprint without a conflict. */
const NEIGHBOUR_TOLERANCE = .5;
/** A deck end may meet its landing ground with at most a two-cell step. */
const LANDING_STEP = 2 * CELL;
/** The pier meets its bank with at most half a metre: one short ramp. */
const PIER_ROOT_STEP = .5;
/** Rowing boats bob at the pier head and in the boathouse bay: at least this much water. */
const MOORING_DEPTH = .6;
/** Spec 29 R4: the bridge pool's flow is at most 15% of the open reach. */
const POOL_RATIO = .15;
/** Spec 29 R6: the leat lip stands 0.3–0.5 m over the wheel's top. */
const LIP_OVER_WHEEL = [.3, .5] as const;
const FOUNDATION_STEP = .5;
const FINGERPOST_ORDER: readonly FingerpostTarget[] = ['castle', 'market', 'lake', 'road'];

const ref = (site: LandSite): SiteRef => ({ id: site.id, turn: site.turn, footprint: site.footprint });
const frameOf = (site: LandSite): CardinalFrame => ({ origin: site.position, turn: site.turn });
const xz = (p: Vec3): XZ => [p[0], p[2]];
const fmt = (metres: number) => `${metres.toFixed(2)} m`;
const cellsOf = (metres: number) => Math.round(metres / CELL);

function hashText(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The ground or bed under a local point of a frame, world metres. */
export function sampleFoundation(landform: KingdomLandform, frame: CardinalFrame, local: XZ): number {
  const p = toWorld(frame, [local[0], 0, local[1]]);
  return naturalLandHeight(landform, p[0], p[2]);
}

function foundationGrid(landform: KingdomLandform, frame: CardinalFrame, min: XZ, max: XZ): FoundationGrid {
  const columns = Math.floor((max[0] - min[0]) / FOUNDATION_STEP) + 1, rows = Math.floor((max[1] - min[1]) / FOUNDATION_STEP) + 1;
  const heights: number[] = [];
  for (let k = 0; k < rows; k++) for (let i = 0; i < columns; i++)
    heights.push(sampleFoundation(landform, frame, [min[0] + i * FOUNDATION_STEP, min[1] + k * FOUNDATION_STEP]));
  return { frame, min, step: FOUNDATION_STEP, columns, rows, heights };
}

/** Bilinear foundation height at a local point inside a grid. */
export function foundationAt(grid: FoundationGrid, local: XZ): number {
  const u = Math.max(0, Math.min(grid.columns - 1, (local[0] - grid.min[0]) / grid.step));
  const v = Math.max(0, Math.min(grid.rows - 1, (local[1] - grid.min[1]) / grid.step));
  const i = Math.min(grid.columns - 2, Math.floor(u)), k = Math.min(grid.rows - 2, Math.floor(v));
  const at = (c: number, r: number) => grid.heights[Math.max(0, Math.min(grid.rows - 1, r)) * grid.columns + Math.max(0, Math.min(grid.columns - 1, c))]!;
  if (grid.columns < 2 || grid.rows < 2) return at(0, 0);
  const fu = u - i, fv = v - k;
  return (at(i, k) * (1 - fu) + at(i + 1, k) * fu) * (1 - fv) + (at(i, k + 1) * (1 - fu) + at(i + 1, k + 1) * fu) * fv;
}

/** The origin that centres a piece of `size` cells inside a site's local extent, at height `y`. */
export function centredOrigin(frame: CardinalFrame, local: { x: readonly [number, number]; z: readonly [number, number] }, size: Vec3, y: number): Vec3 {
  const ox = (local.x[0] + local.x[1]) / 2 - size[0] * CELL / 2, oz = (local.z[0] + local.z[1]) / 2 - size[2] * CELL / 2;
  const p = toWorld(frame, [ox, 0, oz]);
  return [p[0], y, p[2]];
}

function placement(siteId: string, origin: Vec3, turn: CardinalFrame['turn'], size: Vec3): WaterPlacement {
  const frame = { origin, turn };
  return { siteId, origin, turn, size, outline: rectangleToWorld(frame, [0, 0], [size[0] * CELL, size[2] * CELL]) };
}

class Needs {
  readonly list: WaterNeed[] = [];
  add(code: WaterNeed['code'], owner: WaterNeed['owner'], subject: string, message: string): void { this.list.push({ code, owner, subject, message }); }
  /** Runs a content frame function; its RangeError becomes a need instead of a clamped value. */
  attempt<T>(code: WaterNeed['code'], subject: string, run: () => T): T | undefined {
    try { return run(); } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      this.add(code, 'land', subject, error.message); return undefined;
    }
  }
}

export function planWaterPlaces(input: WaterPlaceInput): WaterPlacePlan {
  const { landform, sites, specs } = input;
  const revision = `water-places:1:${hashText(JSON.stringify({ landform, sites, nodes: input.nodes ?? null, destinations: input.destinations ?? null,
    specs: JSON.stringify(specs, (_, value: unknown) => typeof value === 'function' ? String(value) : value) }))}`;
  const needs = new Needs();
  const emptyLake: LakePlace = { water: null, pier: null, boathouse: null, rock: null };
  const emptyMill: MillPlace = { pond: null, weir: null, wheel: null, mill: null, bridge: null, sign: null };
  if (landform.version !== 2) {
    needs.add('land-version', 'land', 'landform', 'The water places need the version 2 landform with its waters, streams and sites; version 1 has none.');
    return { revision, reaches: [], lake: emptyLake, mill: emptyMill, needs: needs.list };
  }
  const reaches = deriveWaterReaches(landform);
  const site = (kind: LandSite['kind']): LandSite | null => {
    const found = sites.filter(item => item.kind === kind);
    if (found.length === 0) { needs.add('site-missing', 'land', kind, `No ${kind} site was supplied.`); return null; }
    if (found.length > 1) { needs.add('site-duplicate', 'land', kind, `${found.length} ${kind} sites were supplied (${found.map(s => s.id).join(', ')}); the place has one.`); return null; }
    return found[0]!;
  };
  const sitesByKind = {
    pier: site('pier'), boathouse: site('boathouse'), rock: site('rock'),
    weir: site('weir'), wheel: site('wheel'), mill: site('mill'), bridge: site('bridge'), sign: site('sign'),
  };
  const nodes = new Map((input.nodes ?? []).map(node => [node.id, node]));
  const ctx: Context = { landform, sites, reaches, specs, needs, nodes, destinations: input.destinations ?? {} };

  // Reach joins: every mouth must arrive at its water's level; a dangling end is judged with its place below.
  for (const reach of reaches) {
    if (reach.mouth.kind === 'water' && Math.abs(reach.mouth.step) > LEVEL_TOLERANCE)
      needs.add('reach-join', 'land', reach.id, `${reach.id} ends ${fmt(reach.mouth.step)} ${reach.mouth.step > 0 ? 'above' : 'below'} the ${reach.mouth.id} it joins: a water step.`);
    if (reach.source.kind === 'water' && Math.abs(reach.source.step) > LEVEL_TOLERANCE)
      needs.add('reach-join', 'land', reach.id, `${reach.id} leaves ${reach.source.id} ${fmt(Math.abs(reach.source.step))} off its level.`);
  }

  const lake = lakePlace(ctx, sitesByKind);
  const mill = millPlace(ctx, sitesByKind);
  return { revision, reaches, lake, mill, needs: needs.list };
}

/** Throws with every need listed, for production mounts that must never draw contradictory land. */
export class WaterPlaceError extends Error {
  constructor(readonly needs: readonly WaterNeed[]) {
    super(`The water places cannot be mounted:\n${needs.map(need => `needs: [${need.owner}] ${need.subject}: ${need.message}`).join('\n')}`);
    this.name = 'WaterPlaceError';
  }
}
export function assertWaterPlaces(plan: WaterPlacePlan): WaterPlacePlan {
  if (plan.needs.length) throw new WaterPlaceError(plan.needs);
  return plan;
}

interface Context {
  landform: KingdomLandform; sites: readonly LandSite[]; reaches: readonly WaterReach[]; specs: WaterPieceSpecs; needs: Needs;
  nodes: ReadonlyMap<string, { id: string; position: Vec3 }>;
  destinations: NonNullable<WaterPlaceInput['destinations']>;
}
type SitesByKind = Readonly<Record<'pier' | 'boathouse' | 'rock' | 'weir' | 'wheel' | 'mill' | 'bridge' | 'sign', LandSite | null>>;

/** Pieces stay on their site (plus walls' tolerance) or on the bank beside the water they stand in, and off every other site. */
function checkFootprint(ctx: Context, owner: LandSite, outline: readonly XZ[], label: string): void {
  const frame = { origin: [outline[0]![0], 0, outline[0]![1]] as Vec3, turn: 0 as const };
  const b = localBounds(frame, outline);
  let worst = 0, intrudes: string | undefined;
  for (const [x, z] of rectangleSamples(frame, [b.minX, b.minZ], [b.maxX, b.maxZ], .5)) {
    const off = polygonDistance(owner.footprint, x, z);
    if (off > FOOTPRINT_TOLERANCE && !waterKeepOut(ctx.landform, x, z, BANK_ALLOWANCE)) worst = Math.max(worst, off);
    for (const other of ctx.sites) if (other !== owner && polygonDistance(other.footprint, x, z) < -NEIGHBOUR_TOLERANCE) intrudes = other.id;
  }
  const ob = localBounds({ origin: [0, 0, 0], turn: owner.turn }, owner.footprint);
  if (worst > 0) ctx.needs.add('footprint', 'land', owner.id,
    `${label} (${fmt(b.maxX - b.minX)} × ${fmt(b.maxZ - b.minZ)} in plan) reaches ${fmt(worst)} past the ${fmt(ob.maxX - ob.minX)} × ${fmt(ob.maxZ - ob.minZ)} site over dry ground; the land must reserve it.`);
  if (intrudes) ctx.needs.add('footprint', 'land', owner.id, `${label} stands on the ${intrudes} site.`);
}

function checkDatum(ctx: Context, site: LandSite, expected: number, what: string): void {
  if (Math.abs(site.position[1] - expected) > LEVEL_TOLERANCE)
    ctx.needs.add('site-datum', 'land', site.id, `${site.id} has its datum at ${fmt(site.position[1])}, not at ${what} (${fmt(expected)}).`);
}

function bodyById(landform: KingdomLandform, id: string): WaterBody | undefined { return landform.waters.find(body => body.id === id); }

/** Local x spans of a footprint's rows: its walk strip at z = 0 and its widest extent. */
function siteLocal(site: LandSite): { frame: CardinalFrame; x: readonly [number, number]; z: readonly [number, number]; points: Vec3[] } {
  const frame = frameOf(site), points = site.footprint.map(([x, z]) => toLocal(frame, [x, 0, z]));
  const b = localBounds(frame, site.footprint);
  return { frame, x: [b.minX, b.maxX], z: [b.minZ, b.maxZ], points };
}

/** Local z where a centreline from z0 to z1 at local x first stands over wet ground (or null). */
function shoreAlong(landform: KingdomLandform, frame: CardinalFrame, x: number, z0: number, z1: number): number | null {
  for (let z = z0; z <= z1 + 1e-9; z += .25) {
    const p = toWorld(frame, [x, 0, z]);
    if (waterSurfaceAt(landform, p[0], p[2]) !== null) return z;
  }
  return null;
}

function lakePlace(ctx: Context, s: SitesByKind): LakePlace {
  const { landform, needs } = ctx;
  // The lake is the water under the pier's head; without a pier, under the boathouse or rock.
  const anchor = s.pier ?? s.boathouse ?? s.rock;
  let water: WaterBody | null = null;
  if (anchor) {
    const local = siteLocal(anchor), far = toWorld(local.frame, [(local.x[0] + local.x[1]) / 2, 0, local.z[1] - .5]);
    const sample = sampleLandWater(landform, far[0], far[2]);
    water = sample && sample.shoreDistance < 0 ? bodyById(landform, sample.id) ?? null : null;
    if (!water) needs.add('water-missing', 'land', anchor.id, `No lake lies under the far end of ${anchor.id}.`);
  }
  if (!water) return { water: null, pier: null, boathouse: null, rock: null };
  return { water, pier: s.pier && pierPlan(ctx, s.pier, water), boathouse: s.boathouse && boathousePlan(ctx, s.boathouse, water),
    rock: s.rock && rockPlan(ctx, s.rock, water) };
}

function pierPlan(ctx: Context, site: LandSite, lake: WaterBody): PierPlan {
  const { landform, needs } = ctx, { frame, points, x, z } = siteLocal(site);
  checkDatum(ctx, site, lake.level, `the ${lake.id} surface`);
  // The walk strip is the footprint's row at its root (z = 0); the head is where it widens.
  const root = points.filter(p => Math.abs(p[2] - z[0]) < 1e-6).map(p => p[0]);
  const walkX: [number, number] = [Math.min(...root), Math.max(...root)];
  const wide = points.filter(p => p[0] < walkX[0] - 1e-6 || p[0] > walkX[1] + 1e-6).map(p => p[2]);
  const headZ: [number, number] = [wide.length ? Math.min(...wide) : z[1], z[1]];
  const mid = (walkX[0] + walkX[1]) / 2, deck = lake.level + PIER_DECK_HEIGHT;
  const shore = shoreAlong(landform, frame, mid, z[0], z[1]);
  const headCentre: XZ = [(x[0] + x[1]) / 2, (headZ[0] + headZ[1]) / 2];
  const headDepth = lake.level - sampleFoundation(landform, frame, headCentre);
  const rootGround = sampleFoundation(landform, frame, [mid, z[0]]);
  if (shore === null) needs.add('pier', 'land', site.id, 'The pier never reaches the water.');
  for (const [cx, cz] of [[x[0] + .25, headZ[0] + .25], [x[1] - .25, headZ[0] + .25], [x[0] + .25, headZ[1] - .25], [x[1] - .25, headZ[1] - .25]] as const) {
    const p = toWorld(frame, [cx, 0, cz]);
    if (waterSurfaceAt(landform, p[0], p[2]) === null) { needs.add('pier', 'land', site.id, 'The pier head is not wholly over the lake.'); break; }
  }
  if (headDepth < MOORING_DEPTH) needs.add('pier', 'land', site.id, `Only ${fmt(headDepth)} of water under the head; boats need ${fmt(MOORING_DEPTH)}.`);
  if (Math.abs(deck - rootGround) > PIER_ROOT_STEP)
    needs.add('pier', 'land', site.id, `The deck (${fmt(deck)}) meets its bank (${fmt(rootGround)}) with a ${fmt(Math.abs(deck - rootGround))} step.`);
  const landing = ctx.nodes.get('land:pier:landing'), head = ctx.nodes.get('land:pier:head');
  if (landing) {
    const l = toLocal(frame, landing.position);
    if (l[2] > z[0] + 1e-6 || l[0] < walkX[0] - .25 || l[0] > walkX[1] + .25)
      needs.add('path-join', 'integrator', 'land:pier:landing', 'The pier landing node does not sit on the bank in line with the walk strip.');
  }
  if (head) {
    const l = toLocal(frame, head.position);
    if (l[2] < headZ[0] || l[2] > headZ[1] || l[0] < x[0] || l[0] > x[1] || Math.abs(head.position[1] - deck) > CELL)
      needs.add('path-join', 'integrator', 'land:pier:head', `The pier head node is not on the head deck at ${fmt(deck)}.`);
  }
  return { site: ref(site), frame, deck, deckAboveWater: deck - lake.level, walk: { x: walkX, length: headZ[0] }, head: { x, z: headZ },
    shore: shore ?? z[1], headDepth, rootGround, foundation: foundationGrid(landform, frame, [x[0], z[0]], [x[1], z[1]]) };
}

function boathousePlan(ctx: Context, site: LandSite, lake: WaterBody): BoathousePlan {
  const { landform, needs } = ctx, { frame, x, z } = siteLocal(site);
  checkDatum(ctx, site, lake.level, `the ${lake.id} surface`);
  const mid = (x[0] + x[1]) / 2, shore = shoreAlong(landform, frame, mid, z[0], z[1]);
  const bayDepth = lake.level - sampleFoundation(landform, frame, [mid, z[1] - .5]);
  const backDepth = lake.level - sampleFoundation(landform, frame, [mid, z[0] + .5]);
  if (shore === null || bayDepth < MOORING_DEPTH)
    needs.add('boathouse', 'land', site.id, `The boathouse's open end has ${fmt(Math.max(0, bayDepth))} of water; a boat bay needs ${fmt(MOORING_DEPTH)}.`);
  if (backDepth > .25) needs.add('boathouse', 'land', site.id, `The boathouse's back stands in ${fmt(backDepth)} of water; it must stand on the shore.`);
  return { site: ref(site), frame, shore: shore ?? z[1], bayDepth, foundation: foundationGrid(landform, frame, [x[0], z[0]], [x[1], z[1]]) };
}

function rockPlan(ctx: Context, site: LandSite, lake: WaterBody): RockPlan {
  const { landform, needs, specs } = ctx, { frame, x, z } = siteLocal(site);
  checkDatum(ctx, site, lake.level, `the ${lake.id} surface`);
  let bed = Infinity;
  for (const [px, pz] of rectangleSamples(frame, [x[0], z[0]], [x[1], z[1]], .5)) bed = Math.min(bed, naturalLandHeight(landform, px, pz));
  // Whole cells, rounded up: the rock's flat base sits at or below every bed sample, never floating.
  const water = Math.max(1, Math.ceil((lake.level - bed) / CELL - 1e-9));
  needs.attempt('rock', site.id, () => specs.rock.top(0, water));
  const front = toWorld(frame, [(x[0] + x[1]) / 2, 0, z[1] + 1]);
  if (waterSurfaceAt(landform, front[0], front[2]) === null) needs.add('rock', 'land', site.id, "The fishing rock's lip (+Z) does not face open water.");
  return { site: ref(site), frame, water, base: lake.level - water * CELL, local: { x, z } };
}

function millPlace(ctx: Context, s: SitesByKind): MillPlace {
  const { landform, reaches, needs } = ctx;
  // The pond is the water the weir's crest holds: a body at the weir's datum level beside it.
  let pond: WaterBody | null = null;
  if (s.weir) {
    const weir = s.weir, centre = siteLocal(weir);
    const c = toWorld(centre.frame, [(centre.x[0] + centre.x[1]) / 2, 0, (centre.z[0] + centre.z[1]) / 2]);
    const candidates = landform.waters.filter(body => Math.abs(body.level - weir.position[1]) <= LEVEL_TOLERANCE)
      .map(body => ({ body, d: Math.hypot(body.x - c[0], body.z - c[2]) - Math.max(body.radiusX, body.radiusZ) }))
      .sort((a, b) => a.d - b.d);
    pond = candidates[0] && candidates[0].d < 6 ? candidates[0].body : null;
    if (!pond) needs.add('water-missing', 'land', weir.id, `No pond at the weir crest's level (${fmt(weir.position[1])}) lies beside it.`);
  }
  const lower = pond ? reaches.find(r => r.source.kind === 'fall' && r.source.id === pond.id) : undefined;
  if (pond && !lower) needs.add('reach-missing', 'land', pond.id, `No course falls out of ${pond.id} over its weir.`);
  const leats = reaches.filter(r => r.kind === 'leat'), tails = reaches.filter(r => r.kind === 'tailrace');
  if (leats.length !== 1) needs.add('reach-missing', 'land', 'leat', `The mill needs one earth leat, not ${leats.length}.`);
  if (tails.length !== 1) needs.add('reach-missing', 'land', 'tailrace', `The mill needs one tailrace, not ${tails.length}.`);
  const leat = leats.length === 1 ? leats[0] : undefined, tail = tails.length === 1 ? tails[0] : undefined;
  if (leat && pond && !(leat.source.kind === 'water' && leat.source.id === pond.id))
    needs.add('reach-join', 'land', leat.id, `${leat.id} does not leave ${pond.id}.`);
  if (tail && tail.mouth.kind !== 'water') needs.add('reach-join', 'land', tail.id, `${tail.id} does not end in another water.`);

  const weir = s.weir && pond && lower ? weirPlan(ctx, s.weir, pond, lower) : null;
  const wheel = s.wheel && leat && tail ? wheelPlan(ctx, s.wheel, leat, tail) : null;
  const mill = s.mill && wheel && s.wheel ? millPlan(ctx, s.mill, s.wheel, wheel) : null;
  const bridge = s.bridge ? bridgePlan(ctx, s.bridge) : null;
  const sign = s.sign ? signPlan(ctx, s.sign) : null;
  return { pond, weir, wheel, mill, bridge, sign };
}

function weirPlan(ctx: Context, site: LandSite, pond: WaterBody, lower: WaterReach): WeirPlan | null {
  const { needs, specs } = ctx, frame = frameOf(site);
  checkDatum(ctx, site, pond.level, `the ${pond.id} surface`);
  const first = lower.points[0]!, forward = directionToWorld(site.turn, [0, 0, 1]);
  if (forward[0] * first.tangent[0] + forward[2] * first.tangent[1] < .9)
    needs.add('site-turn', 'land', site.id, `The weir's turn ${site.turn} does not face down ${lower.id}; its local +Z must run with the flow.`);
  const drop = cellsOf(pond.level - first.level), width = cellsOf(first.width);
  const wf = needs.attempt('weir', site.id, () => specs.weir.frame(width, drop));
  if (!wf) return null;
  // The clear channel centres on the course's first point, and the crest capping stands across it.
  const p = toLocal(frame, [first.position[0], 0, first.position[1]]);
  const capMid = (specs.weir.cap[0] + specs.weir.cap[1]) / 2, channelMid = (wf.channel[0] + wf.channel[1]) / 2;
  const corner = toWorld(frame, [p[0] - channelMid * CELL, 0, p[2] - capMid * CELL]);
  const origin: Vec3 = [corner[0], pond.level - wf.upstream * CELL, corner[2]];
  const placed = placement(site.id, origin, site.turn, wf.size), pf = { origin, turn: site.turn };
  const tailLevel = origin[1] + wf.downstream * CELL;
  if (Math.abs(tailLevel - first.level) > LEVEL_TOLERANCE)
    needs.add('weir', 'land', site.id, `A ${drop}-cell weir leaves tail water at ${fmt(tailLevel)}, not ${lower.id}'s ${fmt(first.level)}.`);
  checkFootprint(ctx, site, placed.outline, 'The weir');
  const crest: [Vec3, Vec3] = [cellToWorld(pf, [wf.channel[0], wf.upstream, capMid]), cellToWorld(pf, [wf.channel[1], wf.upstream, capMid])];
  return { site: ref(site), placement: placed, factory: { width, drop }, crest, pondLevel: pond.level, tailLevel };
}

function wheelPlan(ctx: Context, site: LandSite, leat: WaterReach, tail: WaterReach): WheelPlan | null {
  const { landform, needs, specs } = ctx, local = siteLocal(site), frame = local.frame;
  const end = leat.points.at(-1)!, start = tail.points[0]!;
  checkDatum(ctx, site, start.level, `${tail.id}'s surface`);
  // The land's hub: the site's centre line across (x) and along (z). Water arrives from local -Z.
  const hubX = (local.x[0] + local.x[1]) / 2, hubZ = (local.z[0] + local.z[1]) / 2;
  const le = toLocal(frame, [end.position[0], 0, end.position[1]]);
  const pit = specs.wheelPit, probe = pit.frame(pit.run[0]), hubPastRun = probe.hub[2] - pit.run[0];
  const run = cellsOf(hubZ - le[2]) - hubPastRun;
  const pf = needs.attempt('trough', site.id, () => pit.frame(run));
  if (!pf) return null;
  if (Math.abs(le[0] - hubX) > CELL * 4)
    needs.add('trough', 'land', leat.id, `${leat.id} ends ${fmt(Math.abs(le[0] - hubX))} off the wheel's line; the trough runs straight from the leat to the lip.`);
  const floor = site.position[1];
  const corner = toWorld(frame, [hubX - pf.hub[0] * CELL, 0, hubZ - pf.hub[2] * CELL]);
  const origin: Vec3 = [corner[0], floor, corner[2]];
  const pitFrame = { origin, turn: site.turn };
  const hub = cellToWorld(pitFrame, pf.hub), axis = directionToWorld(site.turn, [1, 0, 0]);
  const descending = directionToWorld(site.turn, [0, 0, 1]);
  const troughFloor = floor + pf.troughFloor * CELL, head = end.level - floor, troughDepth = end.level - troughFloor;
  const lipOverWheel = (pf.troughFloor - (pf.hub[1] + specs.wheel.radius)) * CELL;
  if (Math.abs(end.bed - troughFloor) > CELL / 2)
    needs.add('head', 'land', leat.id, `${leat.id}'s bed arrives at ${fmt(end.bed)} but the trough floor is ${fmt(troughFloor)} (pit floor ${fmt(floor)} + ${fmt(pf.troughFloor * CELL)}): a ${fmt(Math.abs(end.bed - troughFloor))} bed step.`);
  if (troughDepth <= 0 || troughDepth > pit.troughWalls * CELL)
    needs.add('head', 'land', leat.id, `${leat.id} arrives ${fmt(troughDepth)} over the trough floor; the trough holds 0–${fmt(pit.troughWalls * CELL)}. Head ${fmt(head)} over the pit floor; the wheel wants ${fmt(pf.troughFloor * CELL)}–${fmt((pf.troughFloor + pit.troughWalls) * CELL)}.`);
  if (lipOverWheel < LIP_OVER_WHEEL[0] - 1e-9 || lipOverWheel > LIP_OVER_WHEEL[1] + 1e-9)
    needs.add('trough', 'content', site.id, `The lip stands ${fmt(lipOverWheel)} over the wheel; spec 29 asks 0.3–0.5 m.`);
  // Trestle feet stand on the land's real ground under the channel.
  const mid = pf.leatEnd[0];
  const feet = pf.trestles.map((tz, i) => {
    const p = cellToWorld(pitFrame, [mid, 0, tz + .5]), ground = naturalLandHeight(landform, p[0], p[2]);
    const foot = Math.round((ground - floor) / CELL);
    if (foot > pf.troughFloor - 2) needs.add('trestle', 'land', site.id, `Trestle ${i} stands where the ground (${fmt(ground)}) reaches the trough floor (${fmt(troughFloor)}); the trough would be buried in the bank.`);
    else if (foot < pit.foot[0] || foot > pit.foot[1]) needs.add('trestle', 'land', site.id, `Trestle ${i}'s foot is ${foot} cells over the pit floor; the launder stands on ${pit.foot[0]}–${pit.foot[1]}.`);
    return foot;
  });
  // The tailrace leaves the pit's floor, between its walls.
  const ts = toLocal(pitFrame, [start.position[0], floor, start.position[1]]);
  if (ts[0] < 0 || ts[0] > pit.width * CELL || ts[2] < pf.pitStart * CELL || ts[2] > (pf.pitStart + pit.length) * CELL)
    needs.add('reach-join', 'land', tail.id, `${tail.id} does not begin inside the wheel pit.`);
  const pitPlacement = placement(site.id, origin, site.turn, pf.size);
  const stone = { origin: cellToWorld(pitFrame, [0, 0, pf.pitStart]), turn: site.turn };
  checkFootprint(ctx, site, rectangleToWorld(stone, [0, 0], [pit.width * CELL, pit.length * CELL]), 'The wheel pit');
  return {
    site: ref(site), pit: pitPlacement, wheel: placement(site.id, cellToWorld(pitFrame, pf.wheelOffset), site.turn, specs.wheel.size),
    factory: { run, feet }, hub, axis, descending, floor, troughFloor, head, troughDepth, lipOverWheel,
    lip: cellToWorld(pitFrame, pf.lip), leatEnd: cellToWorld(pitFrame, pf.leatEnd),
  };
}

function millPlan(ctx: Context, site: LandSite, wheelSite: LandSite, wheel: WheelPlan): MillPlan | null {
  const { landform, needs, specs } = ctx;
  const wheelFrame = frameOf(wheelSite), m = siteLocal(site);
  const centre = toWorld(m.frame, [(m.x[0] + m.x[1]) / 2, 0, (m.z[0] + m.z[1]) / 2]);
  const c = toLocal(wheelFrame, centre), wl = siteLocal(wheelSite), west = c[0] < (wl.x[0] + wl.x[1]) / 2;
  // The shaft is on the mill's +X face: a mill on the wheel's -X side shares its turn, on the +X side it turns half.
  const turn = ((wheelSite.turn + (west ? 0 : 2)) % 4) as LandSite['turn'];
  if (site.turn !== turn) {
    needs.add('site-turn', 'land', site.id, `The mill's shaft face must face the wheel: turn ${turn}, not ${site.turn}.`);
    return null;
  }
  // The shaft collar lands on the axle line at the pit's outer wall on the mill's side.
  const pitLocal = toLocal(wheelFrame, wheel.pit.origin), hubLocal = toLocal(wheelFrame, wheel.hub);
  const wallX = west ? pitLocal[0] : pitLocal[0] + ctx.specs.wheelPit.width * CELL;
  const shaft = toWorld(wheelFrame, [wallX, hubLocal[1], hubLocal[2]]);
  const offset = directionToWorld(turn, [specs.mill.shaft[0] * CELL, 0, specs.mill.shaft[2] * CELL]);
  const origin: Vec3 = [shaft[0] - offset[0], shaft[1] - specs.mill.shaft[1] * CELL, shaft[2] - offset[2]];
  const placed = placement(site.id, origin, turn, specs.mill.size);
  const frame = { origin, turn };
  const ground = rectangleSamples(frame, [.5, .5], [specs.mill.size[0] * CELL - .5, specs.mill.size[2] * CELL - .5], 1)
    .map(([x, z]) => naturalLandHeight(landform, x, z)).sort((a, b) => a - b);
  const median = ground[Math.floor(ground.length / 2)]!;
  if (Math.abs(origin[1] - median) > 2 * CELL)
    needs.add('mill-shaft', 'land', site.id, `The shaft meets the axle only with the mill's floor at ${fmt(origin[1])} (hub ${fmt(wheel.hub[1])} − ${fmt(specs.mill.shaft[1] * CELL)}); its ground is ${fmt(median)}.`);
  checkFootprint(ctx, site, placed.outline, 'The mill');
  return { site: ref(site), placement: placed, shaft };
}

function bridgePlan(ctx: Context, site: LandSite): BridgePlan | null {
  const { landform, reaches, needs, specs } = ctx, local = siteLocal(site), frame = local.frame, b = specs.bridge;
  const cx = (local.x[0] + local.x[1]) / 2, cz = (local.z[0] + local.z[1]) / 2, centre = toWorld(frame, [cx, 0, cz]);
  const found = reaches.map(reach => ({ reach, ...nearestOnReach(reach, xz(centre)) }))
    .filter(item => item.distance <= item.reach.points[item.index]!.width / 2 + 1).sort((p, q) => p.distance - q.distance)[0];
  if (!found) { needs.add('bridge', 'land', site.id, 'No course runs under the bridge site.'); return null; }
  const { reach, index } = found, at = reach.points[index]!, span = directionToWorld(site.turn, [1, 0, 0]);
  if (Math.abs(span[0] * at.tangent[0] + span[2] * at.tangent[1]) > .1)
    needs.add('bridge', 'land', site.id, `${reach.id} does not cross square under the span (turn ${site.turn}).`);
  const p = toLocal(frame, [at.position[0], 0, at.position[1]]);
  const under = reach.points.filter(q => Math.hypot(q.position[0] - at.position[0], q.position[1] - at.position[1]) <= b.size[2] * CELL / 2 + .5);
  const bed = Math.min(...under.map(q => q.bed)), level = at.level;
  const water = cellsOf(level - bed);
  // The arch axis over the course, the deck centred on the site across.
  const corner = toWorld(frame, [p[0] - b.centre * CELL, 0, cz - b.size[2] * CELL / 2]);
  const origin: Vec3 = [corner[0], bed, corner[2]];
  const bf = { origin, turn: site.turn }, walkMid = (b.walk[0] + b.walk[1]) / 2;
  const landingAt = (x: number) => { const q = cellToWorld(bf, [x, 0, walkMid]); return naturalLandHeight(landform, q[0], q[2]); };
  const landings: [number, number] = [landingAt(-2), landingAt(b.size[0] + 2)];
  const bank = cellsOf((landings[0] + landings[1]) / 2 - bed);
  const placed = placement(site.id, origin, site.turn, b.size);
  const deck = needs.attempt('bridge', site.id, () => [b.deckTop(0, water, bank), b.deckTop(b.size[0] - 1, water, bank)] as const);
  for (const [i, ground] of landings.entries()) {
    const step = ground - (bed + bank * CELL);
    if (Math.abs(step) > LANDING_STEP)
      needs.add('bridge', 'land', site.id, `The ${i ? 'east' : 'west'} landing ground stands ${fmt(Math.abs(step))} ${step > 0 ? 'above' : 'below'} the deck end.`);
  }
  if (at.width / 2 > b.radius * CELL)
    needs.add('bridge', 'land', site.id, `${reach.id} is ${fmt(at.width)} wide under the bridge; the arch springs ${fmt(2 * b.radius * CELL)} apart.`);
  if (at.speed > POOL_RATIO * reach.openSpeed + 1e-9)
    needs.add('bridge', 'land', site.id, `The pool under the bridge flows at ${at.speed.toFixed(2)} m/s, over 15% of ${reach.id}'s open ${reach.openSpeed.toFixed(2)} m/s.`);
  checkFootprint(ctx, site, placed.outline, 'The humpback bridge');
  if (deck) for (const id of ['land:bridge:west', 'land:bridge:east']) {
    const node = ctx.nodes.get(id);
    if (!node) continue;
    const l = toLocal(bf, node.position), col = Math.floor(l[0] / CELL), across = l[2] / CELL;
    const top = col >= 0 && col < b.size[0] ? bed + b.deckTop(col, water, bank) * CELL : undefined;
    if (top === undefined || across < b.walk[0] || across > b.walk[1] || Math.abs(node.position[1] - top) > CELL)
      needs.add('path-join', 'integrator', id, `The ${id} node (${fmt(node.position[1])}) is not on the humpback deck${top === undefined ? '' : ` (${fmt(top)} there)`}; the walk graph must be rebound to the deck ends.`);
  }
  return {
    site: ref(site), placement: placed, factory: { water, bank },
    pool: { reach: reach.id, level, bed, width: at.width, speed: at.speed, openSpeed: reach.openSpeed },
    ends: [cellToWorld(bf, [0, bank, walkMid]), cellToWorld(bf, [b.size[0], bank, walkMid])], landings,
  };
}

function signPlan(ctx: Context, site: LandSite): SignPlan {
  const { landform, needs, specs } = ctx, local = siteLocal(site), frame = local.frame, plan = specs.fingerpost.plan;
  const corner = centredOrigin(frame, local, [plan, 0, plan], 0);
  const pf = { origin: corner, turn: site.turn };
  const ground = Math.min(...rectangleSamples(pf, [0, 0], [plan * CELL, plan * CELL], plan * CELL / 2).map(([x, z]) => naturalLandHeight(landform, x, z)));
  const origin: Vec3 = [corner[0], ground, corner[2]];
  const axis = cellToWorld({ origin, turn: site.turn }, [plan / 2, 0, plan / 2]);
  const arms: FingerpostArmPlan[] = [];
  for (const destination of FINGERPOST_ORDER) {
    const target = ctx.destinations[destination];
    if (!target) continue;
    if (!target.every(Number.isFinite)) { needs.add('sign', 'integrator', site.id, `The ${destination} anchor is not finite.`); continue; }
    const bearing = Math.atan2(target[0] - axis[0], target[1] - axis[2]);
    arms.push({ destination, target, bearing, yaw: bearing - Math.PI / 2 });
  }
  if (!arms.length) needs.add('sign', 'integrator', site.id, 'The fingerpost has no supplied destination to point at.');
  const placed = placement(site.id, origin, site.turn, [plan, 0, plan]);
  checkFootprint(ctx, site, placed.outline, 'The fingerpost');
  return { site: ref(site), placement: placed, axis, arms };
}
