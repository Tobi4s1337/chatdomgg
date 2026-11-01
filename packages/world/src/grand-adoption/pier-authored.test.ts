import { describe, expect, it } from 'vitest';
import { StyleIdSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { WORLD_FIXTURE_KINGDOM } from '@chatdom/shared/world-fixtures';
import { compileCollisionWorld } from '@chatdom/voxel/collision';
import { MATERIALS } from '../../../content/src/materials';
import type { SettlementPlan } from '../settlement/types';
import { AUTHORED_PIER_BUDGET, type AuthoredPierContext, type AuthoredPierProposal } from './pier-authored-types';
import { validateAuthoredPier } from './pier-authored';
import type { LandWaterSample } from './pier-sites-types';

const square = { id: 'market', boundary: [[-6, -6], [-2, -6], [-2, -2], [-6, -2]] as const, elevation: 2, nodeId: 'market' };
const lake = { x: 20, z: 30, radiusX: 10, radiusZ: 10, level: 1 };
const plan: SettlementPlan = { version: 2, revision: 'authored-layout', config: { seed: 'pier-tests', tier: 'hamlet', firstYear: 2025, year: 2026 },
  landform: { version: 1, seed: 1, ridge: { origin: [0, 0], bearing: 0, length: 10, width: 5, height: 2 },
    castleRise: { centre: [0, 0], radius: 4, height: 2 }, lake }, lake,
  homes: [], reservations: [], quarters: [], nodes: [], streets: [], activeStreetIds: [], market: square, courts: [],
  castle: { centre: [0, 2, 0], bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, modules: [], court: square, gateNodeId: 'gate', beaconModuleId: 'beacon' },
  bounds: { minX: -64, maxX: 64, minZ: -64, maxZ: 64 } };
function context(unknownColumn = false): AuthoredPierContext {
  const heights: (number | null)[] = Array.from({ length: 64 * 64 }, (_, i) => 16 + (Math.floor(i / 64) + .5) / 2 <= 20.5 ? 2 : -2);
  if (unknownColumn) heights[34 * 64 + 26] = null; // x=17, z=33: inside the head, away from the centreline.
  const collision = compileCollisionWorld({ revision: 1, materials: MATERIALS, assets: [], placements: [],
    terrain: { origin: [4, -10, 16], columns: 64, rows: 64, heights, ceilingY: 20 } });
  return { scene: { version: 1, kingdomId: WORLD_FIXTURE_KINGDOM, origin: 'simulated', layoutRevision: plan.revision,
    collisionRevision: 1, plan, materials: MATERIALS, assets: [], placements: [] }, collision,
  groundAt: (x, z) => [x, z <= 20.5 ? 2 : -2, z], water: { layoutRevision: plan.revision, collisionRevision: 1,
    sample: (_x, z) => z <= 20.5 ? { state: 'dry' } : { state: 'wet', level: 1.75, depth: 3.75, kind: 'lake', biome: 'temperate' },
    coverage: b => b.maxZ <= 20.5 ? { state: 'dry' } : b.minZ >= 20.5
      ? { state: 'wet', level: 1.75, minDepth: 3.75, kind: 'lake', biome: 'temperate' }
      : { state: 'shore', level: 1.75, minDepth: 0, kind: 'lake', biome: 'temperate' } } };
}
const blueprint = (id: string, size: Vec3, boxes: VoxelBlueprint['boxes']): VoxelBlueprint => ({ version: 1, id,
  styleId: StyleIdSchema.parse('hearth'), kind: 'prop', lattice: 'build', size: [...size], boxes, windows: [] });
const box = (from: Vec3, to: Vec3): VoxelBlueprint['boxes'][number] => ({ from: [...from], to: [...to], material: 3 });
function proposal(): AuthoredPierProposal {
  return { version: 1, anchor: { id: 'pier:authored', root: [20, 2, 20], turn: 0, waterY: 1.75, water: 'lake', biome: 'temperate' },
    deckY: 2.5, walkLength: 12, head: { pieceId: 'pier:authored:head', width: 6, depth: 2 }, entry: [20, 2, 19.5],
    pieces: [
      { id: 'pier:authored:ramp', position: [19, 2, 20], rotation: 0, blueprint: blueprint('ramp', [16, 4, 16], [box([0, 0, 4], [16, 2, 10]), box([0, 0, 10], [16, 4, 16])]) },
      { id: 'pier:authored:walk', position: [19, 2.25, 22], rotation: 0, blueprint: blueprint('walk', [16, 2, 80], [box([0, 0, 0], [16, 2, 80])]) },
      { id: 'pier:authored:head', position: [17, 2.25, 32], rotation: 0, blueprint: blueprint('head', [48, 2, 16], [box([0, 0, 0], [48, 2, 16])]) },
    ], route: [[20, 2, 19.5], [20, 2, 20], [20, 2.5, 22], [20, 2.5, 33]],
    fishing: [{ id: 'east', position: [22, 2.5, 33], route: [[20, 2.5, 33], [22, 2.5, 33]],
      castArea: { minX: 23.5, maxX: 25, minZ: 32, maxZ: 34 } }] };
}

describe('authored pier proof', () => {
  it('certifies a multi-piece raised T-head and its there-and-back fishing route without changing inputs', () => {
    const ctx = context(), p = proposal(), before = JSON.stringify(p), result = validateAuthoredPier(ctx, p);
    expect(result).toMatchObject({ ok: true, certificate: { proposal: p, layoutRevision: plan.revision, collisionRevision: 1 } });
    expect(JSON.stringify(p)).toBe(before);
    if (!result.ok) return;
    expect(result.certificate.geometryKey.length).toBeGreaterThan(0);
    expect(result.work.movementTicks).toBeGreaterThan(0);
    expect(Object.isFrozen(result.certificate.proposal.pieces[0]!.blueprint.boxes)).toBe(true);
    expect(validateAuthoredPier(ctx, p)).toEqual(result);
  });
  it('fails closed on stale physical or water revisions', () => {
    const ctx = context(), p = proposal();
    expect(validateAuthoredPier({ ...ctx, collision: { ...ctx.collision!, revision: 2 } }, p)).toMatchObject({ ok: false, reason: 'revision-mismatch' });
    expect(validateAuthoredPier({ ...ctx, water: { ...ctx.water!, layoutRevision: 'stale' } }, p)).toMatchObject({ ok: false, reason: 'revision-mismatch' });
  });
  it('bounds untrusted proposal sizes before compiling', () => {
    const p = proposal();
    const tooMany = { ...p, pieces: Array.from({ length: AUTHORED_PIER_BUDGET.pieces + 1 }, (_, i) => ({ ...p.pieces[0]!, id: `piece-${i}` })) };
    expect(validateAuthoredPier(context(), tooMany)).toMatchObject({ ok: false });
    const tooManyRoutes = { ...p, fishing: Array.from({ length: AUTHORED_PIER_BUDGET.routes + 1 }, (_, i) => ({ ...p.fishing[0]!, id: `fish-${i}` })) };
    expect(validateAuthoredPier(context(), tooManyRoutes)).toMatchObject({ ok: false });
  });
  it('walks over a narrow plank gap but rejects a gap wider than the body', () => {
    const p = proposal(), walk = p.pieces[1]!;
    const withWalk = (blueprint: VoxelBlueprint): AuthoredPierProposal => ({ ...p, pieces: [p.pieces[0]!, { ...walk, blueprint }, p.pieces[2]!] });
    const gap = { ...walk.blueprint, boxes: [...walk.blueprint.boxes, { ...box([0, 0, 16], [16, 2, 17]), material: 0 }] };
    expect(validateAuthoredPier(context(), withWalk(gap))).toMatchObject({ ok: true });
    const unsupported = { ...walk.blueprint, boxes: [...walk.blueprint.boxes, { ...box([0, 0, 16], [16, 2, 23]), material: 0 }] };
    expect(validateAuthoredPier(context(), withWalk(unsupported))).toMatchObject({ ok: false, reason: 'route-unsupported' });
  });
  it('rejects gateway, furnishing and rail obstructions', () => {
    const p = proposal();
    for (const [id, pos] of [['gateway', [19, 2.5, 23]], ['furnishing', [19, 2.5, 25]], ['rail', [19, 2.5, 27]]] as const) {
      const blocker = { id: `pier:authored:${id}`, position: pos, rotation: 0 as const, blueprint: blueprint(id, [16, 12, 1], [box([0, 0, 0], [16, 12, 1])]) };
      expect(validateAuthoredPier(context(), { ...p, pieces: [...p.pieces, blocker] })).toMatchObject({ ok: false });
    }
  });
  it('rejects unknown physical terrain inside the head even when the ground sampler extrapolates', () => {
    expect(validateAuthoredPier(context(true), proposal())).toMatchObject({ ok: false });
  });
  it('requires continuous water evidence across the whole head and cast area', () => {
    const p = proposal(), ctx = context(), original = ctx.water!;
    for (const region of [{ minX: 17.1, maxX: 17.2, minZ: 32.1, maxZ: 32.2 }, p.fishing[0]!.castArea]) {
      const water = { ...original, coverage: (b: typeof region) => b.minX < region.maxX && b.maxX > region.minX
        && b.minZ < region.maxZ && b.maxZ > region.minZ ? null : original.coverage(b) };
      expect(validateAuthoredPier({ ...ctx, water }, p)).toMatchObject({ ok: false });
    }
  });
  it('pins exact authored geometry and snapshots mutable input without silently replacing it', () => {
    const ctx = context(), p = proposal(), result = validateAuthoredPier(ctx, p);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = JSON.stringify(result.certificate.proposal);
    const unchanged = structuredClone(p);
    (p.pieces[1]!.blueprint.boxes as { material: number }[])[0]!.material = 4;
    expect(validateAuthoredPier(ctx, p, { pinned: result.certificate })).toMatchObject({ ok: false });
    expect(JSON.stringify(result.certificate.proposal)).toBe(saved);
    expect(validateAuthoredPier(ctx, unchanged, { pinned: result.certificate })).toMatchObject({ ok: true });
  });

  it('rejects pieces whose lattice uses a different physical voxel size', () => {
    const p = proposal(), ramp = p.pieces[0]!;
    for (const lattice of ['terrain', 'avatar'] as const) {
      const invalid = { ...p, pieces: [{ ...ramp, blueprint: { ...ramp.blueprint, lattice } }, ...p.pieces.slice(1)] };
      expect(validateAuthoredPier(context(), invalid as unknown as AuthoredPierProposal)).toMatchObject({ ok: false });
    }
  });
  it('pins material solidity even when a rail remains outside the walking route', () => {
    const ctx = context(), base = proposal();
    const rail = { id: 'pier:authored:side-rail', position: [19, 2.5, 23] as Vec3, rotation: 0 as const,
      blueprint: blueprint('rail', [1, 12, 32], [{ ...box([0, 0, 0], [1, 12, 32]), material: 4 }]) };
    const p = { ...base, pieces: [...base.pieces, rail] }, first = validateAuthoredPier(ctx, p);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const materials = { ...ctx.scene.materials, materials: ctx.scene.materials.materials.map(m => m.id === 4 ? { ...m, solid: false } : m) };
    const changed = { ...ctx, scene: { ...ctx.scene, materials } };
    expect(validateAuthoredPier(changed, p)).toMatchObject({ ok: true });
    expect(validateAuthoredPier(changed, p, { pinned: first.certificate })).toMatchObject({ ok: false, reason: 'pinned-mismatch' });
  });
  it.each(['sample', 'coverage'] as const)('validates the detached proposal when water %s mutates the caller input', method => {
    const ctx = context(), p = proposal(), original = structuredClone(p), source = ctx.water!;
    let called = false;
    const mutate = () => { called = true; (p.pieces[1]!.blueprint.boxes as { material: number }[])[0]!.material = 0; };
    const water = { ...source, sample: (x: number, z: number) => { if (method === 'sample') mutate(); return source.sample(x, z); },
      coverage: (bounds: Parameters<typeof source.coverage>[0]) => { if (method === 'coverage') mutate(); return source.coverage(bounds); } };
    const result = validateAuthoredPier({ ...ctx, water }, p);
    expect(called).toBe(true);
    expect(result).toMatchObject({ ok: true, certificate: { proposal: original } });
    expect(p.pieces[1]!.blueprint.boxes[0]!.material).toBe(0);
  });
  it('rejects a non-enumerable getter without executing it', () => {
    const p = proposal(); let calls = 0;
    Object.defineProperty(p.pieces[0]!.blueprint, 'lattice', { enumerable: false, get: () => { calls++; return 'build'; } });
    expect(validateAuthoredPier(context(), p)).toMatchObject({ ok: false });
    expect(calls).toBe(0);
  });

  it('accepts zero-depth shore points only where the actual bed meets the water in the transition', () => {
    const ctx = context(), source = ctx.water!;
    const shore = { state: 'shore', level: 1.75, depth: 0, kind: 'lake', biome: 'temperate' } as const;
    const point = (x: number, z: number) => x === 20 && Number.isInteger(z) && z >= 21 && z <= 24;
    const water = { ...source, sample: (x: number, z: number) => point(x, z) ? shore : source.sample(x, z) };
    const result = validateAuthoredPier({ ...ctx, water, groundAt: (x, z) => point(x, z) ? [x, 1.75, z] : ctx.groundAt(x, z) }, proposal());
    expect(result).toMatchObject({ ok: true, certificate: { anchor: { depth: [0, 0, 0, 0, 0, 3.75, 3.75, 3.75, 3.75, 3.75, 3.75, 3.75, 3.75, 3.75, 3.75] } } });
  });
  it('rejects shoreline at the dry root and beyond the transition', () => {
    const ctx = context(), source = ctx.water!;
    const shore = { state: 'shore', level: 1.75, depth: 0, kind: 'lake', biome: 'temperate' } as const;
    for (const [z, reason] of [[20, 'wet-root'], [25, 'shallow-water']] as const) {
      const water = { ...source, sample: (x: number, atZ: number) => x === 20 && atZ === z ? shore : source.sample(x, atZ) };
      expect(validateAuthoredPier({ ...ctx, water }, proposal())).toMatchObject({ ok: false, reason });
    }
  });
  it('rejects forged shore depth and a zero-depth shore above the physical bed', () => {
    const ctx = context(), source = ctx.water!;
    const shore = { state: 'shore', level: 1.75, depth: 0, kind: 'lake', biome: 'temperate' } as const;
    for (const [sample, reason] of [[shore, 'bed-mismatch'], [{ ...shore, depth: 1 } as unknown as LandWaterSample, 'invalid-water']] as const) {
      const water = { ...source, sample: (x: number, z: number) => x === 20 && z === 21 ? sample : source.sample(x, z) };
      expect(validateAuthoredPier({ ...ctx, water }, proposal())).toMatchObject({ ok: false, reason });
    }
  });

});
