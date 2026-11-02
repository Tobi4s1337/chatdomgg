import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, VoxelBlueprintSchema } from '@chatdom/shared';
import type { RealmFoundedManifest } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '../../../../packages/world/src/settlement/generator';
import { assetHashOf, canonicalSceneJson, sha256Hex, utf8 } from '../../../../packages/world/src/founded-world/codec';
import { encodeFoundedScene, validateFoundedScene } from '../../../../packages/world/src/founded-world/validate';
import type { RealmFoundedScene } from '../../../../packages/world/src/founded-world/types';
import { encodeBakedMetadata, encodeBakedRegion, encodeBakedSurface } from '../../../../packages/world/src/grand/baked/codec';
import { BAKED_COMPILERS, type BakedMetadata } from '../../../../packages/world/src/grand/baked/types';
import { LandArtifactStore } from './store';
import { withLandPublication } from './publication-store';

let directory: string;
let store: LandArtifactStore;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'chatdom-land-publication-')); store = new LandArtifactStore(directory); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

const plan = { ...generateSettlementPlan({ seed: 'publication-test', tier: 'hamlet', firstYear: 2025, year: 2026 }), homes: [] };
const materials = { version: 1, revision: 1, materials: [
  { id: 0, name: 'Air', solid: false, occludesFaces: false, occludesAo: false, blocksLight: false, colour: '#000000', surface: 'air' },
  { id: 3, name: 'Stone', solid: true, occludesFaces: true, occludesAo: true, blocksLight: true, colour: '#777777', surface: 'stone' },
] };
async function scene(variant = 0, options: { origin?: 'live' | 'simulated'; kingdomId?: string; changedPlan?: boolean } = {}) {
  const blueprint = VoxelBlueprintSchema.parse({ version: 1, id: `prop:${variant}`, styleId: 'hearth', kind: 'prop', lattice: 'build',
    size: [2, 2, 2], boxes: [{ from: [0, 0, 0], to: [2, 2, 2], material: 3 }], windows: [] });
  const assetHash = await assetHashOf(blueprint);
  const value = await validateFoundedScene({ version: 1, kingdomId: KingdomIdSchema.parse(options.kingdomId ?? '123'),
    origin: options.origin ?? 'live', layoutRevision: plan.revision, collisionRevision: variant + 1,
    plan: options.changedPlan ? { ...plan, config: { ...plan.config, seed: 'different-plan' } } : plan,
    materials, assets: [{ assetHash, blueprint }], placements: [{ id: 'prop:one', assetHash, position: [0, 0, 0], rotation: 0 }] });
  return { scene: value, ...(await encodeFoundedScene(value)) };
}
async function artifact(value: RealmFoundedScene, groundHeight = 8) {
  const recipeHash = await store.pinRecipe('123', { version: 1 });
  const sourcePlanHash = await sha256Hex(utf8(canonicalSceneJson(value.plan)));
  const surface = await store.put(encodeBakedSurface({ size: 256, height: 256, seaLevel: 0,
    ground: new Uint16Array(256 ** 2).fill(groundHeight), water: new Uint16Array(256 ** 2) }));
  const mesh = await store.put(encodeBakedRegion({ rx: 0, rz: 0, level: 0, minY: 0, maxY: 32,
    quads: new Uint32Array([0, 126]), offsets: new Int32Array([0, 1, 1, 1, 1, 1, 1]) }));
  const metadata: BakedMetadata = { version: 2, kingdomId: '123', recipeHash, sourcePlanHash, sourcePlanRevision: value.layoutRevision,
    compilers: BAKED_COMPILERS, size: 256, height: 256, seaLevel: 0,
    seat: { offset: [16, 5, 32], columns: { x0: 32, z0: 64, x1: 64, z1: 96 }, band: 96 },
    physicalRegion: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 }, bounds: { min: [-16, -5, -32], max: [112, 123, 96] },
    palette: [{ id: 126, colour: '#aaaaaa', kind: 0 }], surface,
    regions: [{ rx: 0, rz: 0, exact: true, bounds: { min: [-16, -5, -32], max: [112, 11, 96] },
      meshes: [{ ...mesh, level: 0, rx: 0, rz: 0, minY: 0, maxY: 32, quadCount: 1 }] }] };
  const manifest = await store.put(encodeBakedMetadata(metadata));
  const encoded = await encodeFoundedScene(value);
  const binding = { version: 1 as const, kingdomId: '123', sceneHash: encoded.manifest.sceneHash,
    layoutRevision: value.layoutRevision, collisionRevision: value.collisionRevision, sourcePlanHash, recipeHash, manifest };
  await store.bind(binding);
  return { binding, surface, mesh, recipeHash };
}

describe('publication of founded land', () => {
  it('reuses verified artifact hashes for new scene assets and revisions, then uses the plan catalogue idempotently', async () => {
    const original = await scene(), grown = await scene(1), next = await scene(2), { binding, recipeHash } = await artifact(original.scene);
    const { publishFoundedLand } = await import('./publication');
    const args = { store, recipeHash, sceneBytes: grown.bytes, receipt: grown.manifest, sourceSceneHash: original.manifest.sceneHash };
    const first = await publishFoundedLand(args);
    expect(first.disposition).toBe('rebound');
    expect(first.binding).toEqual({ ...binding, sceneHash: grown.manifest.sceneHash, collisionRevision: grown.manifest.collisionRevision });
    expect(first.reused).toEqual({ regions: 1, meshes: 1, blobs: 3 });
    expect(await store.binding('123', grown.manifest.sceneHash)).toEqual(first.binding);
    expect(await store.plan('123', recipeHash, binding.sourcePlanHash)).toMatchObject({ manifest: binding.manifest });
    const again = await publishFoundedLand(args);
    expect(again.disposition).toBe('existing');
    expect(again.binding).toEqual(first.binding);
    const catalogued = await publishFoundedLand({ store, recipeHash, sceneBytes: next.bytes, receipt: next.manifest });
    expect(catalogued.binding.manifest).toEqual(binding.manifest);
    expect(catalogued.binding.sceneHash).toBe(next.manifest.sceneHash);
  });

  it('does not infer a source when a plan catalogue is absent; exact binding and explicit source can seed it', async () => {
    const original = await scene(), grown = await scene(1), { binding, recipeHash } = await artifact(original.scene);
    const { publishFoundedLand } = await import('./publication');
    expect(await store.plan('123', recipeHash, binding.sourcePlanHash)).toBeNull();
    await expect(publishFoundedLand({ store, recipeHash, sceneBytes: grown.bytes, receipt: grown.manifest }))
      .rejects.toMatchObject({ code: 'land.needs-bake', kingdomId: '123', recipeHash, sourcePlanHash: binding.sourcePlanHash });
    expect(await store.binding('123', grown.manifest.sceneHash)).toBeNull();
    expect((await publishFoundedLand({ store, recipeHash, sceneBytes: original.bytes, receipt: original.manifest })).disposition).toBe('existing');
    expect(await store.plan('123', recipeHash, binding.sourcePlanHash)).not.toBeNull();
  });

  it('requires the canonical plan hash even when the layout revision is unchanged', async () => {
    const original = await scene(), changed = await scene(1, { changedPlan: true }), { recipeHash } = await artifact(original.scene);
    const { publishFoundedLand } = await import('./publication');
    expect(changed.scene.layoutRevision).toBe(original.scene.layoutRevision);
    await expect(publishFoundedLand({ store, recipeHash, sceneBytes: changed.bytes, receipt: changed.manifest }))
      .rejects.toMatchObject({ code: 'land.needs-bake' });
    await expect(publishFoundedLand({ store, recipeHash, sceneBytes: changed.bytes, receipt: changed.manifest,
      sourceSceneHash: original.manifest.sceneHash })).rejects.toThrow();
    expect(await store.binding('123', changed.manifest.sceneHash)).toBeNull();
  });

  it('fails closed for wrong recipe, kingdom, origin and scene hash without publishing a target', async () => {
    const original = await scene(), grown = await scene(1), simulated = await scene(2, { origin: 'simulated' }),
      foreign = await scene(3, { kingdomId: '124' }), { recipeHash } = await artifact(original.scene);
    const { publishFoundedLand } = await import('./publication');
    const sourceSceneHash = original.manifest.sceneHash;
    for (const args of [
      { sceneBytes: grown.bytes, receipt: grown.manifest, recipeHash: 'c'.repeat(64) },
      { sceneBytes: simulated.bytes, receipt: simulated.manifest, recipeHash },
      { sceneBytes: foreign.bytes, receipt: foreign.manifest, recipeHash },
      { sceneBytes: grown.bytes, receipt: { ...grown.manifest, sceneHash: 'd'.repeat(64) }, recipeHash },
    ]) await expect(publishFoundedLand({ store, sourceSceneHash, ...args })).rejects.toThrow();
    for (const target of [grown, simulated]) expect(await store.binding('123', target.manifest.sceneHash)).toBeNull();
    expect(await store.binding('124', foreign.manifest.sceneHash)).toBeNull();
    expect(await store.binding('123', 'd'.repeat(64))).toBeNull();
  });

  it.each(['missing', 'corrupt'] as const)('does not publish or catalogue a source with a %s mesh', async damage => {
    const original = await scene(), grown = await scene(1), { binding, mesh, recipeHash } = await artifact(original.scene);
    const file = join(directory, 'blobs', `${mesh.hash}.gz`);
    if (damage === 'missing') await unlink(file); else await writeFile(file, Buffer.alloc(mesh.gzipBytes));
    const { publishFoundedLand } = await import('./publication');
    await expect(publishFoundedLand({ store, recipeHash, sceneBytes: grown.bytes, receipt: grown.manifest,
      sourceSceneHash: original.manifest.sceneHash })).rejects.toThrow();
    expect(await store.binding('123', grown.manifest.sceneHash)).toBeNull();
    expect(await store.plan('123', recipeHash, binding.sourcePlanHash)).toBeNull();
  });

  it('owns a Buffer snapshot when the caller mutates the original during validation', async () => {
    const original = await scene(), grown = await scene(1), { recipeHash } = await artifact(original.scene);
    const { publishFoundedLand } = await import('./publication');
    const bytes = Buffer.from(grown.bytes);
    const publishing = publishFoundedLand({ store, recipeHash, sceneBytes: bytes, receipt: grown.manifest,
      sourceSceneHash: original.manifest.sceneHash });
    bytes.fill(0);
    const result = await publishing;
    expect(result.binding.sceneHash).toBe(grown.manifest.sceneHash);
    expect(await store.binding('123', grown.manifest.sceneHash)).toEqual(result.binding);
  });

  it('rejects a literal null catalogue file instead of treating it as absent', async () => {
    const original = await scene(), grown = await scene(1), { binding, recipeHash } = await artifact(original.scene);
    const catalogDir = join(directory, 'plans', '123', recipeHash);
    await mkdir(catalogDir, { recursive: true });
    await writeFile(join(catalogDir, `${binding.sourcePlanHash}.json`), 'null');
    const { publishFoundedLand } = await import('./publication');
    await expect(publishFoundedLand({ store, recipeHash, sceneBytes: grown.bytes, receipt: grown.manifest })).rejects.toThrow();
    await expect(store.plan('123', recipeHash, binding.sourcePlanHash)).rejects.toThrow();
    expect(await store.binding('123', grown.manifest.sceneHash)).toBeNull();
  });

  it('does not publish an already aborted request', async () => {
    const original = await scene(), grown = await scene(1), { binding, recipeHash } = await artifact(original.scene);
    const controller = new AbortController(); controller.abort();
    const { publishFoundedLand } = await import('./publication');
    await expect(publishFoundedLand({ store, recipeHash, sceneBytes: grown.bytes, receipt: grown.manifest,
      sourceSceneHash: original.manifest.sceneHash, signal: controller.signal })).rejects.toThrow();
    expect(await store.binding('123', grown.manifest.sceneHash)).toBeNull();
    expect(await store.plan('123', recipeHash, binding.sourcePlanHash)).toBeNull();
  });

  it('rejects a conflicting catalogue artifact before creating a target binding', async () => {
    const original = await scene(), alternate = await scene(1), target = await scene(2);
    const first = await artifact(original.scene), second = await artifact(alternate.scene, 9);
    const { publishFoundedLand } = await import('./publication');
    await publishFoundedLand({ store, recipeHash: first.recipeHash, sceneBytes: original.bytes, receipt: original.manifest });
    await expect(publishFoundedLand({ store, recipeHash: first.recipeHash, sceneBytes: target.bytes, receipt: target.manifest,
      sourceSceneHash: alternate.manifest.sceneHash })).rejects.toThrow();
    expect(await store.binding('123', target.manifest.sceneHash)).toBeNull();
    expect((await store.plan('123', first.recipeHash, first.binding.sourcePlanHash))?.manifest).toEqual(first.binding.manifest);
    expect(second.binding.manifest).not.toEqual(first.binding.manifest);
  });

  it('publishes concurrent identical requests idempotently and preserves an existing conflicting binding', async () => {
    const original = await scene(), grown = await scene(1), { binding, recipeHash } = await artifact(original.scene);
    const { publishFoundedLand } = await import('./publication');
    const args = { store, recipeHash, sceneBytes: grown.bytes, receipt: grown.manifest, sourceSceneHash: original.manifest.sceneHash };
    const results = await Promise.all(Array.from({ length: 4 }, () => publishFoundedLand(args)));
    for (const result of results) expect(result.binding.manifest).toEqual(binding.manifest);
    const published = await store.binding('123', grown.manifest.sceneHash);
    expect(published?.collisionRevision).toBe(grown.manifest.collisionRevision);
    await expect(store.bind({ ...published!, collisionRevision: 99 })).rejects.toThrow();
    expect(await store.binding('123', grown.manifest.sceneHash)).toEqual(published);
  });

  it('passes non-adopted kingdoms through and applies publication checks to adopted ones', async () => {
    const original = await scene(), grown = await scene(1), { recipeHash } = await artifact(original.scene);
    const { createLandPublicationGuard } = await import('./publication');
    const unadopted = createLandPublicationGuard({ store, recipeFor: () => null });
    expect(await unadopted(grown.bytes, grown.manifest)).toBeNull();
    expect(await store.binding('123', grown.manifest.sceneHash)).toBeNull();
    const adopted = createLandPublicationGuard({ store, recipeFor: () => recipeHash });
    await expect(adopted(grown.bytes, grown.manifest)).rejects.toMatchObject({ code: 'land.needs-bake' });
    await adopted(original.bytes, original.manifest);
    expect((await adopted(grown.bytes, grown.manifest))?.binding.sceneHash).toBe(grown.manifest.sceneHash);
  });
});


describe('founded store publication boundary', () => {
  it('waits for the guard with exact bytes and receipt before calling the underlying store', async () => {
    const value = await scene();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const underlying = { revision: vi.fn(), native: vi.fn(), put: vi.fn(async () => {}) };
    const guard = vi.fn(async () => gate);
    const wrapped = withLandPublication(underlying, guard);
    const pending = wrapped.put(value.bytes, value.manifest);
    expect(guard).toHaveBeenCalledWith(value.bytes, value.manifest, undefined);
    expect(underlying.put).not.toHaveBeenCalled();
    release(); await pending;
    expect(underlying.put).toHaveBeenCalledOnce();
    expect(underlying.put).toHaveBeenCalledWith(value.bytes, value.manifest);
  }, 60_000);

  it('preserves one owned byte and receipt snapshot across guard and write while the caller mutates both', async () => {
    const value = await scene(), bytes = Buffer.from(value.bytes), original = Uint8Array.from(bytes);
    const receipt = { ...value.manifest }, originalReceipt = { ...receipt };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const underlying = { revision: vi.fn(), native: vi.fn(), put: vi.fn<(bytes: Uint8Array, receipt: RealmFoundedManifest) => Promise<void>>().mockResolvedValue(undefined) };
    const guard = vi.fn<(bytes: Uint8Array, receipt: RealmFoundedManifest) => Promise<void>>().mockImplementation(() => gate);
    const pending = withLandPublication(underlying, guard).put(bytes, receipt);
    bytes.fill(0);
    receipt.collisionRevision++;
    release(); await pending;
    const guarded = guard.mock.calls[0]!;
    const written = underlying.put.mock.calls[0]!;
    expect(guarded[0]).toEqual(original);
    expect(guarded[1]).toEqual(originalReceipt);
    expect(written[0]).toBe(guarded[0]);
    expect(written[1]).toBe(guarded[1]);
  }, 15_000);

  it('leaves the store untouched when the guard rejects or cancellation arrives before writing', async () => {
    const value = await scene();
    const underlying = { revision: vi.fn(), native: vi.fn(), put: vi.fn(async () => {}) };
    await expect(withLandPublication(underlying, async () => { throw new Error('land blocked'); })
      .put(value.bytes, value.manifest)).rejects.toThrow('land blocked');
    const controller = new AbortController();
    await expect(withLandPublication(underlying, async () => { controller.abort(); }, controller.signal)
      .put(value.bytes, value.manifest)).rejects.toThrow();
    expect(underlying.put).not.toHaveBeenCalled();
  });

  it('preserves the original receiver for revision and native methods', async () => {
    const kingdomId = KingdomIdSchema.parse('123');
    const underlying = { marker: 23,
      async revision() { return this.marker; },
      async native() { return this.marker as unknown as Awaited<ReturnType<import('../founded/provider').FoundedWorldStore['native']>>; },
      async put() {} };
    const wrapped = withLandPublication(underlying, async () => {});
    expect(await wrapped.revision(kingdomId, 'digest')).toBe(23);
    expect(await wrapped.native(kingdomId, plan, 'live')).toBe(23);
  });
});
