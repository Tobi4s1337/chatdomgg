import { describe, expect, it } from 'vitest';
import { StyleIdSchema, type VoxelBlueprint } from '@chatdom/shared';
import { WORLD_FIXTURE_KINGDOM } from '@chatdom/shared/world-fixtures';
import type { CollisionWorld, SolidBox } from '@chatdom/shared/realm';
import { compileCollisionWorld } from '@chatdom/voxel/collision';
import { MATERIALS } from '../../../content/src/materials';
import { createKingdomLandInterface } from '../land-interface';
import { transformCardinalPoint } from '../settlement/geometry';
import type { BoundsXZ, CardinalTurn, PlotReservation, SettlementPlan } from '../settlement/types';
import { localPierBounds } from './pier-sites-geometry';
import { PIER_SITE_BUDGET, pierSiteBounds, planPierSites, validatePierSite,
  type LandWaterSource, type PierPlanningDimensions, type PierSiteCandidate, type PierSiteContext } from './pier-sites';

const dimensions: PierPlanningDimensions = { width: 2, length: 8, landingDepth: 1, waterStart: 1, minDepth: 1, minFreeboard: .5 };
const candidate: PierSiteCandidate = { id: 'pier:lake', root: [20, 2, 20], turn: 0 };
const overlaps = (a: SolidBox, b: SolidBox) => a.min.every((n, i) => n < b.max[i]! && a.max[i]! > b.min[i]!);
function world(boxes: readonly SolidBox[], revision = 1): CollisionWorld { return { revision, query: b => boxes.filter(v => overlaps(v, b)) }; }
function fixture(turn: CardinalTurn = 0): PierSiteContext {
  const square = { id: 'market', boundary: [[-6, -6], [-2, -6], [-2, -2], [-6, -2]] as const, elevation: 2, nodeId: 'market' };
  const lake = { x: 20, z: 30, radiusX: 10, radiusZ: 10, level: 1 };
  const plan: SettlementPlan = { version: 2, revision: 'pier-layout-v1', config: { seed: 'pier-tests', tier: 'hamlet', firstYear: 2025, year: 2026 },
    landform: { version: 1, seed: 1, ridge: { origin: [0, 0], bearing: 0, length: 10, width: 5, height: 2 },
      castleRise: { centre: [0, 0], radius: 4, height: 2 }, lake }, lake,
    homes: [], reservations: [], quarters: [], nodes: [], streets: [], activeStreetIds: [], market: square, courts: [],
    castle: { centre: [0, 2, 0], bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, modules: [], court: square, gateNodeId: 'gate', beaconModuleId: 'beacon' },
    bounds: { minX: -64, maxX: 64, minZ: -64, maxZ: 64 } };
  const site = { ...candidate, turn };
  const localZ = (x: number, z: number) => transformCardinalPoint([0, 0, 0], ((4 - turn) % 4) as CardinalTurn, [x - 20, 0, z - 20])[2];
  const terrain = localPierBounds(site, 200, -100, .75);
  const floor: SolidBox = { min: [-128, -10, -128], max: [128, -2, 128] };
  const dry: SolidBox = { min: [terrain.minX, -2, terrain.minZ], max: [terrain.maxX, 2, terrain.maxZ] };
  const water: LandWaterSource = { layoutRevision: plan.revision, collisionRevision: 1,
    sample: (x, z) => localZ(x, z) <= .75 ? { state: 'dry' } : { state: 'wet', level: 1, depth: 3, kind: 'lake', biome: 'temperate' },
    coverage: bounds => {
      const zs = [bounds.minX, bounds.maxX].flatMap(x => [bounds.minZ, bounds.maxZ].map(z => localZ(x, z)));
      return Math.max(...zs) <= .75 ? { state: 'dry' } : Math.min(...zs) > .75
        ? { state: 'wet', level: 1, minDepth: 3, kind: 'lake', biome: 'temperate' }
        : { state: 'shore', level: 1, minDepth: 0, kind: 'lake', biome: 'temperate' };
    } };
  return { scene: { version: 1, kingdomId: WORLD_FIXTURE_KINGDOM, origin: 'simulated', layoutRevision: plan.revision,
    collisionRevision: 1, plan, materials: MATERIALS, assets: [], placements: [] }, water,
  groundAt: (x, z) => [x, localZ(x, z) <= .75 ? 2 : -2, z], collision: world([floor, dry]) };
}
const options = { dimensions, candidates: [candidate] };
const withPlan = (input: PierSiteContext, changes: Partial<SettlementPlan>): PierSiteContext => ({ ...input, scene: { ...input.scene, plan: { ...input.scene.plan, ...changes } } });
const withWater = (input: PierSiteContext, changes: Partial<LandWaterSource>): PierSiteContext => ({ ...input, water: { ...input.water!, ...changes } });
const reject = (input: PierSiteContext, reason: string, site = candidate, size = dimensions) => expect(validatePierSite(input, site, size)).toEqual({ ok: false, reason });
function plot(lot: BoundsXZ): PlotReservation {
  return { id: 'future-home', quarterYear: 2026, ordinal: 1, street: 'Future street', streetId: 'future-street', courtId: 'court', approachId: 'approach',
    position: [lot.minX, 2, lot.minZ], rotation: 0, lot: { ...lot, height: 20, depth: 16, frontage: 8 } };
}

describe('authoritative pier sites', () => {
  it('derives exact depth stations from actual water and physical bed, without changing the scene', () => {
    const input = fixture(), before = JSON.stringify(input.scene), result = planPierSites(input, options);
    expect(result.piers).toEqual([{ ...candidate, waterY: 1, water: 'lake', biome: 'temperate', depth: [0, 3, 3, 3, 3, 3, 3, 3, 3] }]);
    expect(result.diagnostics).toEqual([]);
    expect(JSON.stringify(input.scene)).toBe(before);
    expect(planPierSites(input, options)).toEqual(result);
    expect(Object.isFrozen(result.piers[0]?.root)).toBe(true);
    expect(Object.isFrozen(result.piers[0]?.depth)).toBe(true);
  });

  it('requires explicit renderer evidence, distinguishes dry from unknown, and refuses stale sources', () => {
    const input = fixture(), bare = { scene: input.scene, groundAt: input.groundAt };
    reject({ ...bare, collision: input.collision! }, 'no-water-source');
    reject({ ...bare, water: input.water! }, 'no-collision');
    reject(withWater(input, { sample: () => null }), 'unknown-water');
    reject(withWater(input, { coverage: () => null }), 'unknown-water');
    reject(withWater(input, { coverage: () => ({ state: 'dry' }) }), 'dry-deck');
    reject(withWater(input, { collisionRevision: 2 }), 'revision-mismatch');
    reject(withWater(input, { layoutRevision: 'another-land' }), 'revision-mismatch');
    reject({ ...input, collision: world([], 2) }, 'revision-mismatch');
    reject(withPlan(input, { revision: 'another-plan' }), 'revision-mismatch');
    // A future plan's label is not a fallback for missing rendered water or Genesis metadata.
    reject(withWater(input, { sample: () => ({ state: 'wet', level: 1, depth: 3, kind: 'lake', biome: '' }) }), 'invalid-water');
  });

  it('requires continuous actual support under the whole dry landing, including millimetre holes', () => {
    const input = fixture();
    reject({ ...input, collision: world([]) }, 'no-physical-support');
    const holes = [{ min: [19, -2, 19.5], max: [20.123, 2, 20.5] }, { min: [20.124, -2, 19.5], max: [21, 2, 20.5] }] as const;
    reject({ ...input, collision: world(holes) }, 'no-physical-support');
    reject({ ...input, groundAt: () => null }, 'unknown-ground');
    reject({ ...input, groundAt: (x, z) => [x, 2.5, z] }, 'uneven-ground');
    reject(withWater(input, { coverage: () => ({ state: 'wet', level: 1, minDepth: 3, kind: 'lake', biome: 'temperate' }) }), 'wet-root');
    reject(withWater(input, { sample: () => ({ state: 'wet', level: 1, depth: 3, kind: 'lake', biome: 'temperate' }) }), 'wet-root');
  });

  it('checks the complete deck inside the physical region, including thin unknown barriers off the centreline', () => {
    const input = fixture();
    reject(withPlan(input, { bounds: { minX: -64, maxX: 20.9, minZ: -64, maxZ: 64 } }), 'outside-plan');
    const original = input.collision!;
    const unknown: SolidBox = { min: [20.8, -100, 25.111], max: [20.801, 100, 25.112] };
    reject({ ...input, collision: { revision: 1, query: bounds => [...original.query(bounds), ...world([unknown]).query(bounds)] } }, 'solid-overlap');
    const heights = new Float32Array(16 * 16);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) heights[x + z * 16] = 16 + (z + .5) / 2 <= 20.75 ? 2 : -2;
    const compiled = compileCollisionWorld({ revision: 1, materials: MATERIALS, assets: [], placements: [],
      terrain: { origin: [16, -10, 16], columns: 16, rows: 16, heights, ceilingY: 20 } });
    reject({ ...input, collision: compiled }, 'solid-overlap');
    reject({ ...input, groundAt: (x, z) => z > 27 ? null : input.groundAt(x, z) }, 'unknown-ground');
  });

  it('refuses nonflat water, missing footprint certificates, shallow water and contradictory beds', () => {
    const input = fixture(), original = input.water!;
    const changeStation = (patch: Partial<Extract<ReturnType<LandWaterSource['sample']>, { state: 'wet' }>>) => withWater(input, {
      sample: (x, z) => z === 22 ? { state: 'wet', level: 1, depth: 3, kind: 'lake', biome: 'temperate', ...patch } : original.sample(x, z),
    });
    reject(changeStation({ level: 1.2 }), 'nonflat-water');
    reject(changeStation({ kind: 'river' }), 'mixed-water');
    reject(changeStation({ biome: 'alpine' }), 'mixed-water');
    reject(changeStation({ depth: 2 }), 'bed-mismatch');
    reject(changeStation({ depth: .1 }), 'shallow-water');
    for (const depth of [0, -1, NaN, Infinity]) reject(changeStation({ depth }), 'invalid-water');
    reject(withWater(input, { coverage: bounds => bounds.minZ >= 21 ? null : original.coverage(bounds) }), 'unknown-water');
    reject(withWater(input, { coverage: bounds => bounds.minZ < 21 && bounds.maxZ > 21 ? null : original.coverage(bounds) }), 'unknown-water');
    reject(withWater(input, { coverage: bounds => bounds.minZ < 21 && bounds.maxZ > 21
      ? { state: 'shore', level: 1.1, minDepth: 0, kind: 'lake', biome: 'temperate' } : original.coverage(bounds) }), 'nonflat-water');
    reject(withWater(input, { coverage: bounds => bounds.minZ < 21 && bounds.maxZ > 21
      ? { state: 'shore', level: 1, minDepth: 0, kind: 'river', biome: 'temperate' } : original.coverage(bounds) }), 'mixed-water');
    reject(withWater(input, { coverage: bounds => bounds.minZ >= 21
      ? { state: 'wet', level: 1, minDepth: .5, kind: 'lake', biome: 'temperate' } : original.coverage(bounds) }), 'shallow-water');
    reject(input, 'insufficient-freeboard', candidate, { ...dimensions, minFreeboard: 2 });
  });

  it('reserves future lots, inactive roads and their verges, civic places and transformed solid placements', () => {
    const input = fixture();
    reject(withPlan(input, { reservations: [plot(pierSiteBounds(candidate, dimensions))] }), 'reserved-lot');
    const road = { id: 'future-street', from: 'a', to: 'b', kind: 'lane' as const, name: 'Future street', points: [[22, 2, 21], [22, 2, 30]] as const, width: 1, verge: 1 };
    reject(withPlan(input, { streets: [road], activeStreetIds: [] }), 'road-overlap');
    reject(withPlan(input, { courts: [{ id: 'future-court', nodeId: 'court', elevation: 2, boundary: [[19, 25], [21, 25], [21, 27], [19, 27]] }] }), 'civic-overlap');
    const bp: VoxelBlueprint = { version: 1, id: 'stone', styleId: StyleIdSchema.parse('hearth'), kind: 'prop', lattice: 'build', size: [8, 8, 8],
      boxes: [{ from: [0, 0, 0], to: [8, 8, 8], material: 3 }], windows: [] };
    reject({ ...input, scene: { ...input.scene, assets: [{ assetHash: 'stone', blueprint: bp }],
      placements: [{ id: 'stone', assetHash: 'stone', position: [20, -2, 25], rotation: 1 }] } }, 'placement-overlap');
  });

  it('rotates the whole landing and deck in every cardinal direction and validates explicit dimensions', () => {
    const expected = [
      { minX: 19, maxX: 21, minZ: 19.5, maxZ: 28 }, { minX: 19.5, maxX: 28, minZ: 19, maxZ: 21 },
      { minX: 19, maxX: 21, minZ: 12, maxZ: 20.5 }, { minX: 12, maxX: 20.5, minZ: 19, maxZ: 21 },
    ];
    for (const turn of [0, 1, 2, 3] as const) {
      const site = { ...candidate, turn };
      expect(pierSiteBounds(site, dimensions)).toEqual(expected[turn]);
      expect(validatePierSite(fixture(turn), site, dimensions).ok).toBe(true);
    }
    for (const patch of [{ width: .1 }, { width: Infinity }, { length: 8.5 }, { length: 65 }, { landingDepth: .1 },
      { waterStart: .1 }, { waterStart: 8 }, { minDepth: 0 }, { minFreeboard: -1 }]) reject(fixture(), 'invalid-dimensions', candidate, { ...dimensions, ...patch });
    reject(fixture(), 'invalid-site', { ...candidate, root: [NaN, 2, 20] });
    reject(fixture(), 'invalid-site', { ...candidate, turn: 4 as CardinalTurn });
  });

  it('keeps saved identity through reserved growth and never replaces a pinned or installed pier', () => {
    const input = fixture(), reserved = plot({ minX: 40, maxX: 48, minZ: 40, maxZ: 56 });
    const base = withPlan(input, { reservations: [reserved] }), anchor = planPierSites(base, options).piers[0]!;
    const home = { ...reserved, slot: 0, tier: 'cottage' as const, allowedDepth: 8, style: 'hearth' as const, variant: 0 };
    const revision = 'pier-layout-v2', grownPlan = withPlan(base, { homes: [home], revision });
    const grown = { ...grownPlan, scene: { ...grownPlan.scene, layoutRevision: revision, collisionRevision: 2 },
      collision: { ...input.collision!, revision: 2 }, water: { ...input.water!, layoutRevision: revision, collisionRevision: 2 } };
    expect(planPierSites(grown, options).piers).toEqual([anchor]);
    expect(planPierSites(grown, { ...options, pinned: anchor }).piers).toEqual([anchor]);
    const blocked = withWater(grown, { sample: () => null });
    expect(planPierSites(blocked, { ...options, pinned: anchor })).toMatchObject({ piers: [], work: { candidates: 1 }, diagnostics: [{ reason: 'pinned-invalid' }] });
    const changed = { ...anchor, depth: [0, 3, 3, 3, 3, 3, 3, 3, 4] };
    expect(planPierSites(grown, { ...options, pinned: changed }).diagnostics[0]?.rejected).toEqual({ 'pinned-mismatch': 1 });
    const installed = { ...grown, scene: { ...grown.scene, placements: [{ id: 'pier:lake:deck', assetHash: 'deck', position: anchor.root, rotation: anchor.turn }] } };
    for (const pinned of [undefined, anchor]) {
      const result = planPierSites(installed, { ...options, ...(pinned ? { pinned } : {}) });
      expect(result.work.candidates).toBe(0);
      expect(result.diagnostics[0]?.rejected).toEqual({ 'installed-pier': 1 });
    }
  });

  it('bounds installation work and exposes the same fail-closed result through the land facade', () => {
    const input = fixture(), denied = withWater(input, { sample: () => null });
    const limited = planPierSites(denied, { ...options, candidates: [candidate, candidate, candidate], maxCandidates: 2 });
    expect(limited.work.candidates).toBe(2);
    expect(limited.diagnostics[0]?.reason).toBe('budget-exceeded');
    expect(limited.work.groundSamples).toBeLessThanOrEqual(PIER_SITE_BUDGET.groundSamples);
    const sampledOut = planPierSites(denied, { dimensions: { ...dimensions, width: 32, length: 32 }, candidates: Array.from({ length: 17 }, () => candidate) });
    expect(sampledOut.work.groundSamples).toBe(PIER_SITE_BUDGET.groundSamples);
    expect(sampledOut.diagnostics[0]?.rejected['budget-exceeded']).toBe(1);
    expect(sampledOut.diagnostics[0]?.reason).toBe('budget-exceeded');
    expect(() => planPierSites(input, { ...options, maxCandidates: 513 })).toThrow('budget');
    const facade = createKingdomLandInterface({ scene: input.scene, ground: { ...input.scene, sample: input.groundAt }, collision: input.collision!,
      water: input.water!, pierSites: options });
    expect(facade.piers).toEqual(planPierSites(input, options).piers);
    expect(createKingdomLandInterface({ scene: input.scene, ground: { ...input.scene, sample: input.groundAt }, collision: input.collision!, pierSites: options }).piers).toEqual([]);
    expect(createKingdomLandInterface({ scene: input.scene, ground: { ...input.scene, sample: input.groundAt }, collision: input.collision! }).piers).toBeUndefined();
  });

  it('classifies large decorative assets with bounded early-exit scans, while preserving their solid exclusions', () => {
    const input = fixture();
    const solidBox: VoxelBlueprint['boxes'][number] = { from: [0, 0, 0], to: [1, 1, 1], material: 3 };
    const airBox = { ...solidBox, material: 0 };
    const bp: VoxelBlueprint = { version: 1, id: 'detailed-prop', styleId: StyleIdSchema.parse('hearth'), kind: 'prop', lattice: 'build', size: [8, 8, 8],
      boxes: [solidBox, ...Array.from({ length: PIER_SITE_BUDGET.primitives }, () => airBox)], windows: [] };
    const detailed = { ...input, scene: { ...input.scene, assets: [{ assetHash: 'detailed', blueprint: bp }] } };
    const accepted = planPierSites(detailed, options);
    expect(accepted.piers).toHaveLength(1);
    expect(accepted.work.preparationChecks).toBeLessThan(100);
    // Classification still marks a solid placement; the optimization cannot accidentally discard its envelope.
    reject({ ...detailed, scene: { ...detailed.scene, placements: [
      { id: 'detailed-prop', assetHash: 'detailed', position: [20, -2, 25], rotation: 0 },
    ] } }, 'placement-overlap');
    const delayedSolid = { ...detailed, scene: { ...detailed.scene, assets: [{ assetHash: 'detailed', blueprint: {
      ...bp, boxes: [...bp.boxes.slice(1), solidBox],
    } }] } };
    const exhausted = planPierSites(delayedSolid, options);
    expect(exhausted.piers).toEqual([]);
    expect(exhausted.work.candidates).toBe(0);
    expect(exhausted.work.preparationChecks).toBe(PIER_SITE_BUDGET.primitives);
    expect(exhausted.diagnostics[0]?.rejected).toEqual({ 'budget-exceeded': 1 });
  });
});
