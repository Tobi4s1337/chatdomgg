/**
 * Dev stills only (never a route): a founded town or hamlet built the way the walk fixture builds Willowmere, its
 * complete production collision, and the spots the PL10 stills stand on, found in that collision rather than
 * guessed: an open street, a slope where the drawn ground and the half-metre physics differ most, a stair tread and a
 * raised floor. Runs in Node (stills.mjs loads it through Vite's SSR loader).
 */
import { createHash } from 'node:crypto';
import { MATERIALS } from '@chatdom/content';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import type { CollisionWorld, RealmFoundedManifest } from '@chatdom/shared/realm';
import { compileFoundedScene, foundedGroundAt } from '@chatdom/world/founded-collision';
import { embeddedSolids, supported } from '@chatdom/world/movement';
import { generateSettlementPlan, terrainHeight, type RealmFoundedPlacement, type RealmFoundedScene, type SettlementPlan } from '@chatdom/world';
import { createCastleContent } from '../../kingdom/castle-content';
import { placeMarketContent, placeSettlementContent } from '../../kingdom/settlement-content';

/** `grand`: the grand land's founding (tobi4s_'s Willowmere, town; first year 2019, or 2022 where the generator refuses it). */
export type StillsLand = 'town' | 'hamlet' | 'grand';

/** Where a still stands: the walker's feet, the way the walk faces, and a close camera for the sole shots. */
export interface StillSpot {
  readonly feet: Vec3;
  readonly heading: number;
  /** Physics top minus drawn terrain at the feet, in metres (what F07 hides). */
  readonly gap: number;
  readonly close?: { readonly eye: Vec3; readonly target: Vec3; readonly fov: number };
}

export interface StillsFixture {
  readonly land: StillsLand;
  readonly scene: RealmFoundedScene;
  readonly sceneBytes: string;
  readonly manifest: RealmFoundedManifest;
  readonly world: CollisionWorld;
  readonly spots: Readonly<Record<'street' | 'slope' | 'stairs' | 'floor', StillSpot | null>>;
  /** Free spots beside the street spot for the other walkers, nearest first. */
  readonly beside: readonly Vec3[];
  /** Home slots nearest the street spot: whose lit windows speak in the dusk still. */
  readonly speakers: readonly number[];
  /**
   * The crowd still's walkers: open, nearly flat standing spots at least 2.5 m apart, nearest the street spot first
   * (the town only; empty for the hamlet). Enough of them that the nearest 64 draw in full and the rest as figures.
   */
  readonly crowd: readonly Vec3[];
  readonly homes: number;
}

/** Standing spots kept for the crowd still: more than the 64 drawn in full, and under the room's 300 seats. */
export const CROWD_SPOTS = 160;

const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

function grandFounding(): SettlementPlan {
  const config = { seed: 'tobi4s_', tier: 'town', firstYear: 2019, year: 2026 } as const;
  try { return generateSettlementPlan(config); } catch { return generateSettlementPlan({ ...config, firstYear: 2022 }); }
}

function buildScene(land: StillsLand) {
  const plan = land === 'grand' ? grandFounding() : generateSettlementPlan({ seed: land === 'hamlet' ? 'brackenfold' : 'willowmere', tier: land, firstYear: 2022, year: 2026 });
  const { houses, props } = placeSettlementContent(plan.homes, (x, z) => terrainHeight(plan, x, z));
  props.push(...placeMarketContent(plan.market));
  const assets = new Map<string, { assetHash: string; blueprint: VoxelBlueprint }>();
  const placements: RealmFoundedPlacement[] = [];
  const add = (id: string, content: { blueprint: VoxelBlueprint; position: Vec3; yaw: number }, plotId?: string) => {
    const assetHash = digest(JSON.stringify(content.blueprint));
    assets.set(assetHash, { assetHash, blueprint: content.blueprint });
    const turn = content.yaw / (Math.PI / 2);
    if (Math.abs(turn - Math.round(turn)) > 1e-9) throw new Error('The stills fixture needs native cardinal transforms');
    placements.push({ id, assetHash, position: content.position, rotation: ((Math.round(turn) % 4 + 4) % 4) as 0 | 1 | 2 | 3, ...(plotId ? { plotId } : {}) });
  };
  for (const house of houses) {
    const plot = plan.homes.find(home => home.slot === house.slot);
    if (!plot) throw new Error('A native home lacks its plot');
    add(`stills:home:${plot.id}`, house, plot.id);
  }
  props.forEach((prop, index) => add(`stills:prop:${index}`, prop));
  createCastleContent(plan.castle).buildings.forEach(castle => add(`stills:castle:${castle.id}`, castle));
  // Both lands are the reference realm's one kingdom: its sign-in, writer and sessions only know that id.
  const scene: RealmFoundedScene = { version: 1, kingdomId: '999000001' as RealmFoundedScene['kingdomId'], origin: 'simulated',
    layoutRevision: plan.revision, collisionRevision: 1, plan, materials: MATERIALS, assets: [...assets.values()], placements };
  return { plan, scene };
}

/** The lowest top a walker can stand on in this column, or null. */
function standAt(world: CollisionWorld, x: number, z: number, near: number): number | null {
  const boxes = world.query({ min: [x - .02, near - 4, z - .02], max: [x + .02, near + 4, z + .02] });
  const tops = [...new Set(boxes.map(box => box.max[1]))].sort((a, b) => b - a);
  for (const y of tops) {
    const feet = { x, y, z };
    if (supported(feet, world) && !embeddedSolids(feet, world).length) return y;
  }
  return null;
}

const clearAround = (world: CollisionWorld, x: number, y: number, z: number, r: number) =>
  [[r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dz]) => !embeddedSolids({ x: x + dx!, y: y + .05, z: z + dz! }, world).length);

/** True when nothing solid stands on the line from the eye most of the way to the feet. */
function sightClear(world: CollisionWorld, eye: Vec3, target: Vec3): boolean {
  for (let t = 0; t <= .9; t += .03) {
    const p = [0, 1, 2].map(i => eye[i]! + (target[i]! - eye[i]!) * t);
    if (world.query({ min: [p[0]! - .01, p[1]! - .01, p[2]! - .01], max: [p[0]! + .01, p[1]! + .01, p[2]! + .01] }).length) return false;
  }
  return true;
}

/**
 * A low camera beside the feet, across the slope or the step edge, looking at the soles. It tries the two sides
 * across first (so a slope or a run of steps reads in profile), then along, and takes the first with a clear line.
 */
function closeCamera(world: CollisionWorld, feet: Vec3, across: number, rise = .85, d = 2.1): NonNullable<StillSpot['close']> {
  const target: Vec3 = [feet[0], feet[1] + .12, feet[2]];
  const at = (side: number): Vec3 => [feet[0] + Math.sin(side) * d, feet[1] + rise, feet[2] + Math.cos(side) * d];
  const sides = [across + Math.PI / 2, across - Math.PI / 2, across + Math.PI, across];
  const side = sides.find(side => sightClear(world, at(side), target)) ?? sides[0]!;
  return { eye: at(side), target, fov: 32 };
}

export function createStillsFixture(land: StillsLand = 'town'): StillsFixture {
  const { plan, scene } = buildScene(land);
  const world = compileFoundedScene(scene);
  const sceneBytes = JSON.stringify(scene);
  const manifest: RealmFoundedManifest = { version: scene.version, kingdomId: scene.kingdomId, origin: scene.origin,
    layoutRevision: scene.layoutRevision, collisionRevision: scene.collisionRevision, sceneHash: digest(sceneBytes) };
  const corners = plan.market.boundary;
  const cx = corners.reduce((sum, [x]) => sum + x, 0) / corners.length, cz = corners.reduce((sum, [, z]) => sum + z, 0) / corners.length;
  const spots: Record<'street' | 'slope' | 'stairs' | 'floor', StillSpot | null> = { street: null, slope: null, stairs: null, floor: null };
  let slopeScore = 0, stairScore = 0, floorScore = 0, streetScore = Infinity;
  const standing: { x: number; y: number; z: number }[] = [];
  const reach = land === 'hamlet' ? 70 : 60;
  // The town's street stands near its market. A hamlet's homes sit far out from its market, beyond bubble range, so
  // its street stands in the open nearest a cluster of six homes, whose lit windows and bubbles the dusk still shows.
  const homesAt = plan.homes.map(home => [home.position[0], home.position[2]] as const);
  const nearHomes = (px: number, pz: number) => homesAt.map(([hx, hz]) => Math.hypot(hx - px, hz - pz)).sort((a, b) => a - b);
  for (let z = cz - reach; z <= cz + reach; z += .5) for (let x = cx - reach; x <= cx + reach; x += .5) {
    const px = x + .25, pz = z + .25, drawn = terrainHeight(plan, px, pz);
    const y = standAt(world, px, pz, drawn);
    if (y === null) continue;
    const lift = y - drawn, distance = Math.hypot(px - cx, pz - cz);
    if (Math.abs(lift) <= .3) {
      // The slope: steep drawn ground in the open, where the physics' half-metre rounding shows most.
      const gx = (terrainHeight(plan, px + 1, pz) - terrainHeight(plan, px - 1, pz)) / 2;
      const gz = (terrainHeight(plan, px, pz + 1) - terrainHeight(plan, px, pz - 1)) / 2;
      const grade = Math.hypot(gx, gz);
      if (land !== 'hamlet' && grade < .2) standing.push({ x: px, y, z: pz });
      const score = grade < .55 && clearAround(world, px, y, pz, 1.5) ? grade * (.1 + Math.abs(lift)) : 0;
      if (score > slopeScore) { slopeScore = score; spots.slope = { feet: [px, y, pz], heading: Math.atan2(gx, gz), gap: lift, close: closeCamera(world, [px, drawn, pz], Math.atan2(gx, gz)) }; }
      // The street: flat open ground near the market with room around it for the others.
      const homes = land === 'hamlet' && grade < .08 ? nearHomes(px, pz) : null;
      const measure = homes ? homes[5]! : distance, open = homes ? homes[0]! > 8 : distance > 6;
      if (grade < .08 && open && measure < streetScore && clearAround(world, px, y, pz, 3)) {
        streetScore = measure;
        spots.street = { feet: [px, y, pz], heading: Math.atan2(cx - px, cz - pz) + Math.PI, gap: lift };
      }
    }
    if (lift < -.5 || lift > 2.5) continue;
    // A stair tread: a step up or down of a stair's rise half a metre away in exactly one axis direction.
    for (const [dx, dz] of [[.5, 0], [-.5, 0], [0, .5], [0, -.5]] as const) {
      const next = standAt(world, px + dx, pz + dz, y);
      const back = standAt(world, px - dx, pz - dz, y);
      if (next === null || back === null) continue;
      const up = next - y, down = y - back;
      if (up >= .12 && up <= .55 && down >= .12 && down <= .55) {
        const score = 1 / (1 + distance);
        if (score > stairScore) { stairScore = score; const across = Math.atan2(dx, dz); spots.stairs = { feet: [px, y, pz], heading: across, gap: lift, close: closeCamera(world, [px, y, pz], across, .35, 2.2) }; }
      }
    }
    // A raised floor: flat around the feet, well above the drawn ground, with room to stand.
    const flat = [[.5, 0], [-.5, 0], [0, .5], [0, -.5]].every(([dx, dz]) => standAt(world, px + dx!, pz + dz!, y) === y);
    if (flat && lift >= .35 && clearAround(world, px, y, pz, .6)) {
      const score = 1 / (1 + distance);
      if (score > floorScore) { floorScore = score; spots.floor = { feet: [px, y, pz], heading: 0, gap: lift, close: closeCamera(world, [px, y, pz], 0, .5, 2) }; }
    }
  }
  if (!spots.street) throw new Error(`The ${land} has no open street spot near its market`);
  const street = spots.street;
  const beside: Vec3[] = [];
  for (let ring = 2; ring <= 9 && beside.length < 12; ring += 1.5) for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2 + ring, x = street.feet[0] + Math.sin(a) * ring, z = street.feet[2] + Math.cos(a) * ring;
    const y = standAt(world, x, z, terrainHeight(plan, x, z));
    if (y !== null && clearAround(world, x, y, z, .6)) beside.push([x, y, z]);
  }
  const speakers = [...plan.homes].sort((a, b) => Math.hypot(a.position[0] - street.feet[0], a.position[2] - street.feet[2])
    - Math.hypot(b.position[0] - street.feet[0], b.position[2] - street.feet[2])).slice(0, 6);
  // Face the speakers' homes, so their lit windows and bubbles are in front of the walk's camera.
  const sx = speakers.reduce((sum, home) => sum + home.position[0], 0) / speakers.length;
  const sz = speakers.reduce((sum, home) => sum + home.position[2], 0) / speakers.length;
  spots.street = { ...street, heading: Math.atan2(sx - street.feet[0], sz - street.feet[2]) };
  // The crowd: greedy from the street spot outward, keeping clear of the three walkers' own places.
  const crowd: Vec3[] = [], taken = [street.feet, ...beside.slice(0, 9)];
  const [fx, , fz] = street.feet;
  standing.sort((a, b) => Math.hypot(a.x - fx, a.z - fz) - Math.hypot(b.x - fx, b.z - fz));
  for (const at of standing) {
    if (crowd.length >= CROWD_SPOTS) break;
    if (taken.some(([x, , z]) => Math.hypot(x - at.x, z - at.z) < 2.5)) continue;
    if (!clearAround(world, at.x, at.y, at.z, .6)) continue;
    const spot: Vec3 = [at.x, at.y, at.z];
    crowd.push(spot); taken.push(spot);
  }
  return { land, scene, sceneBytes, manifest, world, spots, beside, speakers: speakers.map(home => home.slot), crowd, homes: plan.homes.length };
}

/** The physics ground (half-metre cells) at a point, for the notes: what the realm stands a walker on. */
export const physicsGroundAt = (plan: SettlementPlan, x: number, z: number) => foundedGroundAt(plan, x, z);
