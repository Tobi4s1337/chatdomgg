import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeBakedMetadata, encodeBakedRegion, encodeBakedSurface } from '../../../../packages/world/src/grand/baked/codec';
import { BAKED_COMPILERS, type BakedMetadata, type BakedRegion } from '../../../../packages/world/src/grand/baked/types';
import { verifyLandArtifact } from './bake';
import { LandArtifactStore } from './store';

let directory: string;
let store: LandArtifactStore;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'chatdom-land-verify-')); store = new LandArtifactStore(directory); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function artifact(material = 126, meshRx = 0) {
  const recipeHash = await store.pinRecipe('123', { version: 1 });
  const surface = await store.put(encodeBakedSurface({ size: 256, height: 256, seaLevel: 0,
    ground: new Uint16Array(256 ** 2).fill(8), water: new Uint16Array(256 ** 2) }));
  const mesh = await store.put(encodeBakedRegion({ rx: meshRx, rz: 0, level: 0, minY: 0, maxY: 32,
    quads: new Uint32Array([0, material]), offsets: new Int32Array([0, 1, 1, 1, 1, 1, 1]) }));
  const metadata: BakedMetadata = { version: 1, kingdomId: '123', recipeHash, sourcePlanHash: 'b'.repeat(64), sourcePlanRevision: 'layout-1',
    compilers: BAKED_COMPILERS, size: 256, height: 256, seaLevel: 0,
    seat: { offset: [16, 5, 32], columns: { x0: 32, z0: 64, x1: 64, z1: 96 }, band: 96 },
    physicalRegion: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 }, bounds: { min: [-16, -5, -32], max: [112, 123, 96] },
    palette: [{ id: 126, colour: '#aaaaaa', kind: 0 }], surface,
    regions: [{ rx: 0, rz: 0, exact: true, bounds: { min: [-16, -5, -32], max: [112, 11, 96] },
      meshes: [{ ...mesh, level: 0, rx: 0, rz: 0, minY: 0, maxY: 32, quadCount: 1 }] }] };
  const manifest = await store.put(encodeBakedMetadata(metadata));
  return { metadata, binding: { version: 1 as const, kingdomId: '123', sceneHash: 'a'.repeat(64), layoutRevision: 'layout-1',
    collisionRevision: 1, sourcePlanHash: metadata.sourcePlanHash, recipeHash, manifest } };
}

async function coarseTopArtifact(localY: number) {
  const recipeHash = await store.pinRecipe('123', { version: 1 });
  const surface = await store.put(encodeBakedSurface({ size: 512, height: 384, seaLevel: 0,
    ground: new Uint16Array(512 ** 2), water: new Uint16Array(512 ** 2) }));
  const regions: BakedRegion[] = [];
  for (let rz = 0; rz < 2; rz++) for (let rx = 0; rx < 2; rx++) {
    const exact = rx === 0 && rz === 0, meshes = [];
    for (let level = 0; level < (exact ? 1 : 4); level++) {
      const hasQuad = rx === 1 && rz === 0 && level === 3;
      const maxY = hasQuad ? 64 : 0;
      const bytes = encodeBakedRegion({ rx, rz, level, minY: 0, maxY,
        quads: hasQuad ? new Uint32Array([(localY << 5) | (2 << 25), 126 | (16 << 16)]) : new Uint32Array(),
        offsets: hasQuad ? new Int32Array([0, 0, 0, 1, 1, 1, 1]) : new Int32Array(7) });
      meshes.push({ ...await store.put(bytes), rx, rz, level, minY: 0, maxY, quadCount: hasQuad ? 1 : 0 });
    }
    regions.push({ rx, rz, exact, meshes, bounds: { min: [rx * 128 - 16, -5, rz * 128 - 32],
      max: [(rx + 1) * 128 - 16, rx === 1 && rz === 0 ? 251 : -5, (rz + 1) * 128 - 32] } });
  }
  const metadata: BakedMetadata = { version: 1, kingdomId: '123', recipeHash, sourcePlanHash: 'b'.repeat(64), sourcePlanRevision: 'layout-1',
    compilers: BAKED_COMPILERS, size: 512, height: 384, seaLevel: 0,
    seat: { offset: [16, 5, 32], columns: { x0: 32, z0: 64, x1: 64, z1: 96 }, band: 96 },
    physicalRegion: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 }, bounds: { min: [-16, -5, -32], max: [240, 187, 224] },
    palette: [{ id: 126, colour: '#aaaaaa', kind: 0 }], surface, regions };
  const manifest = await store.put(encodeBakedMetadata(metadata));
  return { version: 1 as const, kingdomId: '123', sceneHash: 'a'.repeat(64), layoutRevision: 'layout-1', collisionRevision: 1,
    sourcePlanHash: metadata.sourcePlanHash, recipeHash, manifest };
}

describe('verifyLandArtifact', () => {
  it('reopens and validates metadata, surface and mesh before publication', async () => {
    const { binding, metadata } = await artifact();
    let checks = 0;
    const result = await verifyLandArtifact(store, binding, () => { checks++; });
    expect(result.metadata).toEqual(metadata);
    expect(result.surface.ground[0]).toBe(8);
    expect(checks).toBe(1);
  });
  it('rejects a different source plan or binding revision', async () => {
    const { binding } = await artifact();
    await expect(verifyLandArtifact(store, { ...binding, sourcePlanHash: 'c'.repeat(64) })).rejects.toThrow('founded receipt binding');
    await expect(verifyLandArtifact(store, { ...binding, layoutRevision: 'other' })).rejects.toThrow('founded receipt binding');
  });
  it('rejects a valid mesh whose header disagrees with its reference', async () => {
    const { binding } = await artifact(126, 1);
    await expect(verifyLandArtifact(store, binding)).rejects.toThrow('mesh does not match its region reference');
  });
  it('rejects a packed quad using a material absent from the palette', async () => {
    const { binding } = await artifact(127);
    await expect(verifyLandArtifact(store, binding)).rejects.toThrow('material outside its palette');
  });
  it('rejects an L3 face above world height while accepting one exactly at the top', async () => {
    await expect(verifyLandArtifact(store, await coarseTopArtifact(31))).rejects.toThrow('declared world height');
    const valid = await verifyLandArtifact(store, await coarseTopArtifact(15));
    expect(valid.metadata.height).toBe(384);
  });

});
