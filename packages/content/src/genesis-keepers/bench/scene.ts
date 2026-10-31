// SIMULATED places for the keepers bench, from the coastal showcase recipe (The_AGGman, Tide kit): its Bell Court at dusk
// with the recipe's lamplighter on the round, and its inn door with the recipe's innkeeper. The ground, every placement,
// which lamps burn and which windows are lit are bench fixtures, never land, presence or placement decisions. The keepers
// stand where the real round planner puts them at the bench's fixtures. Production code never imports this module.
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '../../materials';
import { createTree } from '../../core/index';
import { createMarketWell } from '../../core/market';
import { HOME_REVIEW, createTideHome } from '../../homes/tide/index';
import { createStreetProp } from '../../props/street/index';
import { createCivicProp } from '../../civic/index';
import { createDoorLantern } from '../../arrival-lights/index';
import { draw } from '../../../../world/src/genesis/landscape';
import { HARBOUR_TARGET, showcaseFixture } from '../../genesis-landmarks/showcase-fixtures';
import { proposeGenesisKeepers, type KeeperProposal } from '../adapter';
import { KEEPER_PROP_ANCHORS, createAleBarrel, createInnSign, createKeeperLampPost } from '../props';
import { keeperRole } from '../roles/index';
import { planKeeperRound, type KeeperFixture, type KeeperPlaceSite, type KeeperVisit } from '../routine';
import { keeperPresenceIntent, type KeeperPresenceIntent } from '../presence';
import { keeperGreeting, type KeeperGreeting } from '../greetings';

export const CELL = 0.125;
export interface BenchPlacement { readonly id: string; readonly blueprint: VoxelBlueprint; readonly origin: Vec3; readonly yaw: number }
export interface BenchView { readonly eye: Vec3; readonly target: Vec3; readonly fov: number }
export interface BenchKeeper {
  readonly proposal: KeeperProposal;
  readonly visit: KeeperVisit;
  readonly intent: KeeperPresenceIntent;
  /** What the keeper would say to a SIMULATED passer-by with these facts; shown nowhere in the frame. */
  readonly greeting: KeeperGreeting;
}
export interface PlaceBench {
  readonly scene: 'court' | 'tavern';
  readonly placements: readonly BenchPlacement[];
  readonly keepers: readonly BenchKeeper[];
  readonly site: KeeperPlaceSite;
  /** Glass centres of the lamps that burn (SIMULATED host lighting) and of those left dark. */
  readonly lamps: { readonly lit: readonly Vec3[]; readonly dark: readonly Vec3[] };
  /** Homes whose windows are lit by SIMULATED presence, by placement id. */
  readonly litHomes: readonly string[];
  readonly homes: readonly string[];
  readonly chimneys: readonly Vec3[];
  readonly views: { readonly wide: BenchView; readonly tall: BenchView };
  readonly shadowBounds: { readonly min: Vec3; readonly max: Vec3 };
  readonly lightBounds: { readonly origin: Vec3; readonly size: Vec3 };
  /** SIMULATED realm presence used for the keepers' retreat intent. */
  readonly presence: { readonly atPlace: number; readonly inTown: number };
}

/** Bench metres → the world position of a blueprint-local cell point under a placement's yaw. */
export function placed(p: Pick<BenchPlacement, 'origin' | 'yaw'>, cells: Vec3): Vec3 {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), x = cells[0] * CELL, y = cells[1] * CELL, z = cells[2] * CELL;
  return [p.origin[0] + x * c + z * s, p.origin[1] + y, p.origin[2] - x * s + z * c];
}

/** Placement origin that puts a blueprint-local cell point at a world point. */
function originFor(at: Vec3, cells: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw), s = Math.sin(yaw), x = cells[0] * CELL, z = cells[2] * CELL;
  return [at[0] - (x * c + z * s), at[1] - cells[1] * CELL, at[2] - (-x * s + z * c)];
}

/**
 * Cobbled setts: three-cell stones over a sunken joint, in running bond, the odd stone limestone or stone, and grass,
 * moss and flowers taking the margins at the court's edge.
 */
function courtPaving(id: string, width: number, depth: number, salt: string): VoxelBlueprint {
  const boxes: VoxelBlueprint['boxes'] = [{ from: [0, 0, 0], to: [width, 2, depth], material: MAT.stone }];
  for (let z = 0; z + 3 <= depth; z += 4) {
    const shift = (z / 4) % 2 ? 2 : 0;
    for (let x = -shift; x < width; x += 4) {
      const x0 = Math.max(0, x), x1 = Math.min(width, x + 3);
      if (x1 - x0 < 2) continue;
      const r = draw(salt, `sett/${x}/${z}`), edge = Math.min(x0, z, width - x1, depth - z - 3);
      let material: number = MAT.paving;
      if (edge < 6 + Math.floor(draw(salt, `edge/${x}/${z}`) * 8)) material = r < 0.08 ? MAT.petal : r < 0.14 ? MAT.blueFlower : r < 0.5 ? MAT.moss : MAT.grass;
      else if (r < 0.34) material = MAT.stone;
      else if (r < 0.52) material = MAT.limestone;
      else if (r < 0.57) material = MAT.moss;
      boxes.push({ from: [x0, 2, z], to: [x1, 3, z + 3], material });
    }
  }
  return { version: 1, id, styleId: 'tide' as VoxelBlueprint['styleId'], kind: 'prop', lattice: 'build', size: [width, 3, depth], boxes, windows: [] };
}

const SIMULATED_PRESENCE = { atPlace: 2, inTown: 5 } as const;

function lampAt(id: string, at: Vec3, facing: number): { placement: BenchPlacement; fixture: KeeperFixture; glass: Vec3 } {
  const blueprint = createKeeperLampPost('tide'), origin = KEEPER_PROP_ANCHORS.lamp.origin;
  const placement = { id, blueprint, origin: originFor(at, origin, facing), yaw: facing };
  const g = KEEPER_PROP_ANCHORS.lamp.points.glass;
  const glass = placed(placement, [origin[0] + g[0] / CELL, g[1] / CELL, origin[2] + g[2] / CELL]);
  return { placement, fixture: { id, kind: 'lamp', position: at, facing }, glass };
}

function keeperFor(proposal: KeeperProposal, site: KeeperPlaceSite, hour: number, fixtureId: string, actId: string, seedKey: string): BenchKeeper {
  const round = planKeeperRound(keeperRole(proposal.keeper.role), site, hour, seedKey);
  const visit = round.visits.find(v => v.fixtureId === fixtureId && v.act.id === actId);
  if (!visit) throw new Error(`The ${proposal.keeper.role}'s round at ${hour} has no ${actId} at ${fixtureId}.`);
  const intent = keeperPresenceIntent(proposal.retreat, { source: 'simulated', label: 'SIMULATED', ...SIMULATED_PRESENCE });
  if (intent.kind !== 'at-work') throw new Error('The bench town is quiet; its keepers should be at work.');
  const greeting = keeperGreeting(proposal.speaker, { citizen: { publicName: 'Simulated passer-by', nameCheck: 'passed' }, visit: 'returning-witnessed', realmHour: hour, home: null }, 'bench');
  return { proposal, visit, intent, greeting };
}

function coastal() {
  const { recipe, landscape } = showcaseFixture(HARBOUR_TARGET);
  return { recipe, keepers: proposeGenesisKeepers(recipe, landscape) };
}

/** Bell Court at dusk: Tide homes round a paved court, a well, four lamp posts, and the lamplighter trimming a lamp. */
export function courtBench(hour: number, actId = 'trim-wick'): PlaceBench {
  const { recipe, keepers } = coastal();
  const lamplighter = keepers.find(k => k.keeper.role === 'lamplighter');
  if (!lamplighter) throw new Error('The coastal recipe has no lamplighter.');
  const paving = courtPaving('bench-court-paving', 224, 192, recipe.seedKey);
  const placements: BenchPlacement[] = [{ id: 'paving', blueprint: paving, origin: [-14, -3 * CELL + 1 * CELL, -14], yaw: 0 }];
  // Homes along the back of the court, fronts on z = -10, and one down the left side facing in.
  const homes: { id: string; tier: Parameters<typeof createTideHome>[0]; variant: 0 | 1 | 2; at: Vec3; yaw: number }[] = [
    { id: 'home-a', tier: 'house', variant: 0, at: [-13.5, 0, -26], yaw: 0 },
    { id: 'home-b', tier: 'cottage', variant: 1, at: [-4.2, 0, -26.5], yaw: 0 },
    { id: 'home-c', tier: 'manor', variant: 2, at: [5.2, 0, -26], yaw: 0 },
    { id: 'home-d', tier: 'cottage', variant: 2, at: [-30, 0, -3], yaw: Math.PI / 2 },
  ];
  for (const h of homes) placements.push({ id: h.id, blueprint: createTideHome(h.tier, h.variant), origin: h.at, yaw: h.yaw });
  const lamps = [
    lampAt('lamp-hero', [2.0, 0, 0.5], -2.12),
    lampAt('lamp-west', [-7.5, 0, -5.5], 0.35),
    lampAt('lamp-east', [9, 0, -6.5], -0.2),
    lampAt('lamp-south', [-5.5, 0, 6.5], 2.6),
  ];
  for (const lamp of lamps) placements.push(lamp.placement);
  const well = createMarketWell();
  placements.push({ id: 'well', blueprint: well, origin: [-4.4 - (well.size[0] * CELL) / 2, 0, -3.2 - (well.size[2] * CELL) / 2], yaw: 0.2 });
  placements.push({ id: 'stores', blueprint: createCivicProp('market-stores', 'tide'), origin: [4.6, 0, -8.6], yaw: 0.15 });
  for (const [i, at] of ([[-11.5, -9.6], [-2.5, -9.8], [7.8, -9.4], [12.5, -3]] as const).entries()) {
    placements.push({ id: `trough-${i}`, blueprint: createStreetProp(i % 2 ? 'flower-pot' : 'flower-trough', 'tide'), origin: [at[0], 0, at[1]], yaw: i === 3 ? -Math.PI / 2 : 0 });
  }
  placements.push({ id: 'tree-0', blueprint: createTree(0), origin: [12, 0, -14], yaw: 0.4 });
  placements.push({ id: 'tree-1', blueprint: createTree(2), origin: [-20, 0, -14], yaw: 1.1 });
  placements.push({ id: 'tree-2', blueprint: createTree(1), origin: [15, 0, 4], yaw: 2.2 });
  const site: KeeperPlaceSite = {
    placeId: lamplighter.place.id, centre: [0, -2], radius: lamplighter.routine.radius,
    fixtures: lamps.map(l => l.fixture), provenance: 'simulated',
  };
  const keeper = keeperFor(lamplighter, site, hour, 'lamp-hero', actId, recipe.seedKey);
  // Frame the keeper nearly in profile from the court's south side, so the raised pole meets the lantern against the dusk
  // sky, with the lit homes of the court behind; a shrub and stones frame the near corners.
  const lamp = lamps[0]!.fixture.position, at = keeper.visit.position;
  const middle: Vec3 = [(lamp[0] + at[0]) / 2, 1.7, (lamp[2] + at[2]) / 2];
  const reach = Math.hypot(lamp[0] - at[0], lamp[2] - at[2]);
  const along = [(at[0] - lamp[0]) / reach, (at[2] - lamp[2]) / reach] as const;
  const across = -along[0] > 0 ? [along[1], -along[0]] as const : [-along[1], along[0]] as const;
  const near = (side: number, front: number, y = 0): Vec3 => [middle[0] + across[0] * side - along[0] * front, y, middle[2] + across[1] * side - along[1] * front];
  placements.push({ id: 'fore-shrub', blueprint: createStreetProp('leafy-shrub', 'tide'), origin: near(2.3, -3.1), yaw: 0.6 });
  placements.push({ id: 'fore-rocks', blueprint: createStreetProp('rock-cluster', 'tide'), origin: near(2.0, 2.6), yaw: 1.9 });
  return {
    scene: 'court', placements, site,
    keepers: [keeper],
    lamps: { lit: [lamps[0]!.glass, lamps[1]!.glass, lamps[3]!.glass], dark: [lamps[2]!.glass] },
    litHomes: ['home-b', 'home-d'], homes: homes.map(h => h.id),
    chimneys: [],
    views: {
      wide: { eye: near(4.2, 1.3, 0.95), target: middle, fov: 44 },
      tall: { eye: near(4.8, 1.0, 1.0), target: middle, fov: 64 },
    },
    shadowBounds: { min: [-32, -1, -30], max: [20, 16, 12] },
    lightBounds: { origin: [-32, -1, -30], size: [52, 16, 42] },
    presence: SIMULATED_PRESENCE,
  };
}

/** The inn door: a Tide house standing in for the inn (no tavern building exists yet), its sign, a barrel and the innkeeper. */
export function tavernBench(hour: number, actId = 'wipe-tankard'): PlaceBench {
  const { recipe, keepers } = coastal();
  const innkeeper = keepers.find(k => k.keeper.role === 'innkeeper');
  if (!innkeeper) throw new Error('The coastal recipe has no innkeeper.');
  const paving = courtPaving('bench-inn-paving', 192, 160, `${recipe.seedKey}/inn`);
  const placements: BenchPlacement[] = [{ id: 'paving', blueprint: paving, origin: [-12, -2 * CELL, -10], yaw: 0 }];
  const inn = createTideHome('hall', 1);
  const innOrigin: Vec3 = [-4, 0, -20];
  placements.push({ id: 'inn', blueprint: inn, origin: innOrigin, yaw: 0 });
  placements.push({ id: 'home-left', blueprint: createTideHome('cottage', 0), origin: [-14.5, 0, -21], yaw: 0 });
  placements.push({ id: 'home-right', blueprint: createTideHome('house', 2), origin: [6.2, 0, -20.5], yaw: 0 });
  const doorCells = innDoor(inn);
  const door = placed({ origin: innOrigin, yaw: 0 }, doorCells);
  const doorFixture: KeeperFixture = { id: 'inn-door', kind: 'door', position: [door[0], 0, door[2]], facing: 0 };
  placements.push({ id: 'sign', blueprint: createInnSign('tide'), origin: [door[0] - 2.6, 0, door[2] + 0.6], yaw: 0 });
  placements.push({ id: 'barrel-0', blueprint: createAleBarrel('tide'), origin: [door[0] + 1.7, 0, door[2] + 0.1], yaw: 0.3 });
  placements.push({ id: 'barrel-1', blueprint: createAleBarrel('tide'), origin: [door[0] + 2.4, 0, door[2] - 0.2], yaw: -0.5 });
  placements.push({ id: 'stores', blueprint: createCivicProp('market-stores', 'tide'), origin: [door[0] - 4.6, 0, door[2] + 0.4], yaw: 0 });
  placements.push({ id: 'lantern-l', blueprint: createDoorLantern('tide'), origin: [door[0] - 1.05, 2.0, door[2] - 0.15], yaw: 0 });
  placements.push({ id: 'lantern-r', blueprint: createDoorLantern('tide'), origin: [door[0] + 0.45, 2.0, door[2] - 0.15], yaw: 0 });
  placements.push({ id: 'trough', blueprint: createStreetProp('flower-trough', 'tide'), origin: [door[0] + 3.4, 0, door[2] + 1.2], yaw: 0 });
  placements.push({ id: 'tree', blueprint: createTree(1), origin: [-11, 0, -4], yaw: 0.7 });
  const site: KeeperPlaceSite = { placeId: innkeeper.place.id, centre: [door[0], door[2] + 2], radius: innkeeper.routine.radius, fixtures: [doorFixture], provenance: 'simulated' };
  const glass = (dx: number): Vec3 => [door[0] + dx + 0.31, 2.0 + 0.44, door[2] + 0.22];
  return {
    scene: 'tavern', placements, site,
    keepers: [keeperFor(innkeeper, site, hour, 'inn-door', actId, recipe.seedKey)],
    lamps: { lit: [glass(-1.05), glass(0.45)], dark: [] },
    litHomes: ['inn', 'home-right'], homes: ['inn', 'home-left', 'home-right'],
    chimneys: [],
    views: {
      wide: { eye: [door[0] + 4.6, 1.7, door[2] + 6.2], target: [door[0] + 0.2, 1.45, door[2] + 0.4], fov: 42 },
      tall: { eye: [door[0] + 2.8, 1.6, door[2] + 5.6], target: [door[0] + 0.4, 1.5, door[2] + 0.5], fov: 64 },
    },
    shadowBounds: { min: [-26, -1, -26], max: [20, 18, 12] },
    lightBounds: { origin: [-26, -1, -26], size: [46, 18, 38] },
    presence: SIMULATED_PRESENCE,
  };
}

/** The inn's door in build cells at ground level, from the home lane's own doorway focus. */
function innDoor(inn: VoxelBlueprint): Vec3 {
  const entrance = HOME_REVIEW[inn.id]?.entrance;
  if (!entrance) throw new Error(`No doorway is recorded for ${inn.id}.`);
  return [entrance[0], 0, entrance[2]];
}
