import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { StyleIdSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { WORLD_FIXTURE_KINGDOM } from '@chatdom/shared/world-fixtures';
import { RealmFoundedManifestSchema, type CollisionWorld, type SolidBox } from '@chatdom/shared/realm';
import { compileCollisionWorld } from '@chatdom/voxel/collision';
import { createGrowthCivicForm } from '../../../content/src/growth-civic';
import { MATERIALS } from '../../../content/src/materials';
import { createKingdomLandInterface, type PlaceSite } from '../land-interface';
import { generateSettlementPlan } from '../settlement/generator';
import { transformCardinalPoint } from '../settlement/geometry';
import type { CardinalTurn, SettlementPlan } from '../settlement/types';
import { compileFoundedScene, foundedGroundAt } from '../founded-world/collision';
import { decodeFoundedScene } from '../founded-world/validate';
import { grandKingdomLand } from '../grand/kingdom/ground';
import { findTavernDoor } from './place-sites-tavern';
import { pinnedCampfireSite } from './pinned-places';
import { CAMPFIRE_SITE_FOOTPRINT, PLACE_SITE_BUDGET, placeSiteBounds, planPlaceSites, validatePlaceSite, type PlaceSiteContext } from './place-sites';

const clearing: PlaceSite = { origin: [30, 0, 20], turn: 0, footprint: CAMPFIRE_SITE_FOOTPRINT };
const floor: SolidBox = { min: [-128, -1, -128], max: [128, 0, 128] };
const overlap = (a: SolidBox, b: SolidBox) => a.min.every((n, i) => n < b.max[i]! && a.max[i]! > b.min[i]!);
function world(boxes: readonly SolidBox[]): CollisionWorld { return { revision: 1, query: b => boxes.filter(v => overlap(v, b)) }; }
let generatedFixture: SettlementPlan | undefined;
function fixture(): PlaceSiteContext {
  const generated = generatedFixture ??= generateSettlementPlan({ seed: 'place-sites-tests', tier: 'hamlet', firstYear: 2025, year: 2026 });
  const square = { id: 'market', boundary: [[-2, -2], [2, -2], [2, 2], [-2, 2]] as const, elevation: 0, nodeId: 'market' };
  const plan: SettlementPlan = { ...generated, homes: [], reservations: [], streets: [], activeStreetIds: [], courts: [], market: square,
    nodes: [{ id: 'market', position: [0, 0, 0], kind: 'market' }], bounds: { minX: -128, maxX: 128, minZ: -128, maxZ: 128 },
    castle: { ...generated.castle, bounds: { minX: -100, maxX: -90, minZ: -100, maxZ: -90 }, court: { ...square, boundary: [[-100, -100], [-90, -100], [-90, -90], [-100, -90]] } } };
  return { scene: { version: 1, kingdomId: WORLD_FIXTURE_KINGDOM, origin: 'simulated', layoutRevision: plan.revision, collisionRevision: 1,
    plan, assets: [], placements: [], materials: MATERIALS }, groundAt: (x, z) => [x, 0, z], collision: world([floor]) };
}
const withPlan = (input: PlaceSiteContext, changes: Partial<SettlementPlan>): PlaceSiteContext => ({ ...input, scene: { ...input.scene, plan: { ...input.scene.plan, ...changes } } });

describe('physical campfire sites', () => {
  it('accepts only a continuous flat physical footprint; samples alone cannot hide a tiny unsupported hole', () => {
    const input = fixture();
    expect(validatePlaceSite(input, clearing)).toEqual({ ok: true });
    expect(validatePlaceSite({ ...input, collision: world([]) }, clearing)).toEqual({ ok: false, reason: 'no-physical-support' });
    const gap = world([{ min: [30, -1, 20], max: [35.123, 0, 38] }, { min: [35.124, -1, 20], max: [48, 0, 38] }]);
    expect(validatePlaceSite({ ...input, collision: gap }, clearing)).toEqual({ ok: false, reason: 'no-physical-support' });
    expect(validatePlaceSite({ ...input, groundAt: () => null }, clearing)).toEqual({ ok: false, reason: 'unknown-ground' });
    expect(validatePlaceSite({ ...input, groundAt: (x, z) => [x, x > 47 ? .5 : 0, z] }, clearing)).toEqual({ ok: false, reason: 'uneven-ground' });
    expect(validatePlaceSite({ ...input, collision: world([floor, { min: [31, 0, 21], max: [32, 30, 22] }]) }, clearing)).toEqual({ ok: false, reason: 'solid-overlap' });
  });

  it('rejects unknown physical volume even if a ground sampler extrapolates into it', () => {
    const input = fixture(), collision = compileCollisionWorld({ revision: 1, materials: MATERIALS, assets: [], placements: [],
      terrain: { origin: [-32, -16, -32], columns: 128, rows: 128, heights: new Float32Array(128 * 128), ceilingY: 32 } });
    expect(validatePlaceSite({ ...input, collision }, clearing)).toEqual({ ok: false, reason: 'solid-overlap' });
    expect(validatePlaceSite({ scene: input.scene, groundAt: input.groundAt }, clearing)).toEqual({ ok: false, reason: 'no-collision' });
    expect(validatePlaceSite({ ...input, collision: { revision: 2, query: () => [] } }, clearing)).toEqual({ ok: false, reason: 'revision-mismatch' });
  });

  it('preserves future lots, every planned road, civic squares and installed trees', () => {
    const input = fixture(), generated = generateSettlementPlan({ seed: 'plot-test', tier: 'hamlet', firstYear: 2025, year: 2026 });
    const plot = { ...generated.reservations[0]!, lot: { ...generated.reservations[0]!.lot, ...placeSiteBounds(clearing) } };
    expect(validatePlaceSite(withPlan(input, { reservations: [plot] }), clearing)).toEqual({ ok: false, reason: 'reserved-lot' });
    const road = { id: 'future-road', from: 'a', to: 'b', kind: 'lane' as const, name: 'Fixture road', points: [[29, 0, 19], [49, 0, 39]] as const, width: 2, verge: 1 };
    expect(validatePlaceSite(withPlan(input, { streets: [road], activeStreetIds: [] }), clearing)).toEqual({ ok: false, reason: 'road-overlap' });
    const tree: VoxelBlueprint = { version: 1, id: 'tree-test', styleId: StyleIdSchema.parse('hearth'), kind: 'prop', lattice: 'build', size: [8, 16, 8],
      boxes: [{ from: [0, 0, 0], to: [8, 16, 8], material: 3 }], windows: [] };
    expect(validatePlaceSite({ ...input, scene: { ...input.scene, assets: [{ assetHash: 'tree', blueprint: tree }],
      placements: [{ id: 'tree:one', assetHash: 'tree', position: [31, 0, 21], rotation: 0 }] } }, clearing)).toEqual({ ok: false, reason: 'placement-overlap' });
  });

  it('transforms origin corners and footprints in every cardinal turn; rejects malformed and undersized clearings', () => {
    const expected = [
      { minX: 10, maxX: 24, minZ: 20, maxZ: 30 }, { minX: 10, maxX: 20, minZ: 6, maxZ: 20 },
      { minX: -4, maxX: 10, minZ: 10, maxZ: 20 }, { minX: 0, maxX: 10, minZ: 20, maxZ: 34 },
    ];
    for (const turn of [0, 1, 2, 3] as const) expect(placeSiteBounds({ origin: [10, 0, 20], turn, footprint: [14, 10] })).toEqual(expected[turn]);
    expect(validatePlaceSite(fixture(), { ...clearing, footprint: [17, 18] })).toEqual({ ok: false, reason: 'footprint-mismatch' });
    for (const x of [NaN, Infinity, 1e30]) expect(validatePlaceSite(fixture(), { ...clearing, origin: [x, 0, 20] })).toEqual({ ok: false, reason: 'invalid-site' });
  });

  it('stays deterministic through reserved growth and refuses to relocate a pinned clearing', () => {
    const base = fixture(), template = generatedFixture!.homes[0]!;
    const home = { ...template, position: [80, 0, 80] as Vec3, lot: { ...template.lot, minX: 76, maxX: 84, minZ: 64, maxZ: 88 } };
    const input = withPlan(base, { reservations: [home] }), before = JSON.stringify(input.scene), first = planPlaceSites(input);
    expect(first.places.campfire).toBeDefined();
    expect(planPlaceSites(input)).toEqual(first);
    const site = first.places.campfire!;
    const grown = { ...input, scene: { ...input.scene, collisionRevision: 2, plan: { ...input.scene.plan, homes: [home] } },
      collision: { ...world([floor, { min: [76, 0, 72], max: [84, 3, 80] }]), revision: 2 } };
    expect(planPlaceSites(grown).places.campfire).toEqual(site);
    expect(planPlaceSites(grown, { pinned: site }).places.campfire).toEqual(site);
    const blocked = { ...grown, groundAt: () => null };
    const denied = planPlaceSites(blocked, { pinned: site, candidates: [clearing] });
    expect(denied.places.campfire).toBeUndefined();
    expect(denied.diagnostics[0]?.reason).toBe('pinned-invalid');
    expect(denied.work.candidates).toBe(1);
    expect(JSON.stringify(input.scene)).toBe(before);
  });

  it('bounds candidate and sample work and reports absence without modifying the scene', () => {
    const input = fixture(), result = planPlaceSites({ ...input, groundAt: () => null }, { maxCandidates: 3 });
    expect(result.work.candidates).toBe(3);
    expect(result.work.groundSamples).toBeLessThanOrEqual(PLACE_SITE_BUDGET.groundSamples);
    expect(result.diagnostics[0]?.reason).toBe('budget-exceeded');
    expect(() => planPlaceSites(input, { maxCandidates: 513 })).toThrow('budget');
    const facade = createKingdomLandInterface({ scene: input.scene, ground: { ...input.scene, sample: input.groundAt },
      collision: input.collision!, placeSites: { candidates: [clearing] } });
    expect(facade.places?.campfire).toEqual(clearing);
    expect(facade.scene).toBe(input.scene);
  });

  it('never searches for another clearing after gather installs the campfire', () => {
    const input = fixture(), installed = { ...input, scene: { ...input.scene, placements: [
      { id: 'gather:campfire:v1', assetHash: 'gather-fire', position: clearing.origin, rotation: clearing.turn },
    ] } };
    for (const options of [{}, { pinned: clearing }]) {
      const result = planPlaceSites(installed, options);
      expect(result.places.campfire).toBeUndefined();
      expect(result.work.candidates).toBe(0);
      expect(result.diagnostics[0]?.rejected).toEqual({ 'installed-campfire': 1 });
    }
  });
});

function tavernFixture(turn: CardinalTurn, level = 1): PlaceSiteContext {
  const input = fixture(), bp = createGrowthCivicForm('tavern', 'hearth', level);
  const placements = [{ id: 'civic:growth:v1:tavern', assetHash: 'tavern', position: [10, 0, 10] as Vec3, rotation: turn }];
  const scene = { ...input.scene, assets: [{ assetHash: 'tavern', blueprint: bp }], placements };
  const collision = compileCollisionWorld({ ...scene, revision: 1,
    terrain: { origin: [-32, -16, -32], columns: 128, rows: 128, heights: new Float32Array(128 * 128), ceilingY: 32 } });
  return { ...input, scene, collision };
}
describe('existing tavern portal', () => {
  it('derives the authored exterior doorway in every turn and keeps the anchor through all growth stages', () => {
    for (const turn of [0, 1, 2, 3] as const) {
      const anchor = findTavernDoor(tavernFixture(turn)).anchor!;
      expect(anchor.position).toEqual(transformCardinalPoint([10, 0, 10], turn, [4, 0, 4.375]));
      const outward = transformCardinalPoint([0, 0, 0], turn, [0, 0, 1]);
      expect(Math.sin(anchor.facing)).toBeCloseTo(-outward[0]);
      expect(Math.cos(anchor.facing)).toBeCloseTo(-outward[2]);
      for (const level of [2, 3, 4, 9]) expect(findTavernDoor(tavernFixture(turn, level)).anchor?.position).toEqual(anchor.position);
    }
  });

  it('offers the portal automatically through the common facade without a planning request', () => {
    const input = tavernFixture(1), before = JSON.stringify(input.scene);
    const facade = createKingdomLandInterface({ scene: input.scene, ground: { ...input.scene, sample: input.groundAt }, collision: input.collision! });
    expect(facade.places?.tavern).toEqual(findTavernDoor(input).anchor);
    expect(facade.places?.campfire).toBeUndefined();
    expect(JSON.stringify(input.scene)).toBe(before);
  });

  it('rejects fake support, unknown geometry, a filled doorway and an obstructed exterior approach', () => {
    const input = tavernFixture(0), bp = input.scene.assets[0]!.blueprint;
    expect(findTavernDoor({ ...input, collision: world([]) }).anchor).toBeUndefined();
    expect(findTavernDoor({ ...input, groundAt: () => null }).anchor).toBeUndefined();
    expect(findTavernDoor({ ...input, scene: { ...input.scene, assets: [{ assetHash: 'tavern', blueprint: { ...bp, id: 'unknown-tavern' } }] } }).anchor).toBeUndefined();
    const filled: VoxelBlueprint = { ...bp, boxes: [...bp.boxes, { from: [28, 3, 22], to: [36, 17, 24], material: 3 }] };
    expect(findTavernDoor({ ...input, scene: { ...input.scene, assets: [{ assetHash: 'tavern', blueprint: filled }] } }).anchor).toBeUndefined();
    expect(findTavernDoor({ ...input, collision: world([floor, { min: [13, 0, 13], max: [15, 3, 16] }]) }).anchor).toBeUndefined();
  });
});

it.runIf(Boolean(process.env.CHATDOM_PLACE_SITE_SCENE && process.env.CHATDOM_PLACE_SITE_MANIFEST))('checks private real geometry without storing names or changing the installed scene', async () => {
  const bytes = await readFile(process.env.CHATDOM_PLACE_SITE_SCENE!);
  const receipt = RealmFoundedManifestSchema.parse(JSON.parse(await readFile(process.env.CHATDOM_PLACE_SITE_MANIFEST!, 'utf8')) as unknown);
  const scene = await decodeFoundedScene(bytes, receipt);
  const before = JSON.stringify(scene), collision = compileFoundedScene(scene), groundAt = (x: number, z: number) => foundedGroundAt(scene.plan, x, z);
  const started = performance.now(), tavern = findTavernDoor({ scene, collision, groundAt }), doorMs = performance.now() - started;
  const planning = performance.now(), campfire = planPlaceSites({ scene, collision, groundAt }), campfireMs = performance.now() - planning;
  expect(tavern.anchor).toBeDefined();
  const common = createKingdomLandInterface({ scene, ground: { layoutRevision: scene.layoutRevision, collisionRevision: scene.collisionRevision, sample: groundAt }, collision });
  expect(grandKingdomLand(scene, collision).places?.tavern).toEqual(common.places?.tavern);
  expect(common.places?.tavern).toEqual(tavern.anchor);
  // The pinned Willowmere clearing is the planner's own first Wilds-edge answer and still validates as a pin.
  if (scene.kingdomId === '129634568') {
    expect(campfire.places.campfire).toEqual(pinnedCampfireSite(scene.kingdomId));
    const pinned = planPlaceSites({ scene, collision, groundAt }, { pinned: pinnedCampfireSite(scene.kingdomId)! });
    expect(pinned.places.campfire).toEqual(pinnedCampfireSite(scene.kingdomId));
    expect(pinned.diagnostics).toEqual([]);
  }
  expect(JSON.stringify(scene)).toBe(before);
  console.info(JSON.stringify({ doorMs, campfireMs, tavern: tavern.anchor?.position, campfire: campfire.places.campfire ?? null, diagnostics: campfire.diagnostics, work: campfire.work }));
}, 60_000);
