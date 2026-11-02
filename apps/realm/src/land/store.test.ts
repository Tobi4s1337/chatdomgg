import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LandArtifactStore, MAX_LAND_GZIP_BYTES, MAX_LAND_RAW_BYTES, type StoredLandBinding } from './store';

const payload = Buffer.from('Chatdom land fixture\n');
const expected = {
  hash: '8c1200543b26b4752f4244a173a81eaecbdb3169ab8f2071a66277dc9f7b322d',
  rawBytes: 21,
  gzipHash: 'e69e2eeeb0c33deb222e6305bab6d75a7397403fe8aa3d6b263d10a4e3d11b70',
  gzipBytes: 41,
};
const sceneHash = 'a'.repeat(64);
let directory: string;
let store: LandArtifactStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'chatdom-land-store-'));
  store = new LandArtifactStore(directory);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function receipt(): Promise<StoredLandBinding> {
  const recipeHash = await store.pinRecipe('123', { version: 1, seed: 'test' });
  const manifest = await store.put(payload);
  return { version: 1, kingdomId: '123', sceneHash, layoutRevision: 'layout-1', collisionRevision: 1,
    sourcePlanHash: 'b'.repeat(64), recipeHash, manifest };
}

describe('land artifact store', () => {
  it('stores canonical deterministic gzip and round-trips its bytes, including racing duplicates', async () => {
    const refs = await Promise.all(Array.from({ length: 8 }, () => store.put(payload)));
    expect(refs).toEqual(Array(8).fill(expected));
    expect(Buffer.from(await store.read(expected))).toEqual(payload);
    const compressed = Buffer.from(await store.compressed(expected));
    expect(compressed.subarray(4, 8)).toEqual(Buffer.alloc(4));
    expect(compressed[9]).toBe(255);
    expect(await store.put(payload)).toEqual(expected);
  });

  it('rejects damaged bytes and incorrect declared content', async () => {
    const ref = await store.put(payload);
    const path = join(directory, 'blobs', `${ref.hash}.gz`);
    const bytes = Buffer.from(await store.compressed(ref));
    bytes[12] = bytes[12]! ^ 1;
    await writeFile(path, bytes);
    await expect(store.compressed(ref)).rejects.toThrow('gzip digest');
    await expect(store.read(ref)).rejects.toThrow('gzip digest');
    await writeFile(path, Buffer.alloc(1));
    await expect(store.compressed(ref)).rejects.toThrow('size');
  });

  it('rejects malformed and oversized references before accessing a file', async () => {
    const cases = [
      { ...expected, hash: '../escape' }, { ...expected, gzipHash: 'bad' },
      { ...expected, rawBytes: MAX_LAND_RAW_BYTES + 1 }, { ...expected, gzipBytes: MAX_LAND_GZIP_BYTES + 1 },
      { ...expected, rawBytes: 0 }, { ...expected, gzipBytes: Number.MAX_SAFE_INTEGER },
    ];
    for (const ref of cases) await expect(store.read(ref)).rejects.toThrow(/Invalid land content hash|byte budget/);
    await expect(store.put(new Uint8Array())).rejects.toThrow('byte budget');
  });

  it('pins one canonical recipe per kingdom, including across version changes', async () => {
    const initial = await store.pinRecipe('123', { version: 1, seed: 'test' });
    expect(await store.pinRecipe('123', { seed: 'test', version: 1 })).toBe(initial);
    await expect(store.pinRecipe('123', { version: 2, seed: 'test' })).rejects.toThrow('conflicts');
    expect(await store.recipeHash('123')).toBe(initial);
  });

  it('publishes a complete binding idempotently and preserves it after a conflict', async () => {
    const value = await receipt();
    await Promise.all(Array.from({ length: 6 }, () => store.bind(value)));
    expect(await store.binding('123', sceneHash)).toEqual(value);
    await expect(store.bind({ ...value, collisionRevision: 2 })).rejects.toThrow('conflicts');
    expect(await store.binding('123', sceneHash)).toEqual(value);
    await expect(store.pinRecipe('123', { version: 2, seed: 'test' })).rejects.toThrow('conflicts');
    expect(await store.binding('123', sceneHash)).toEqual(value);
  });

  it('does not publish a binding when its recipe or manifest is invalid', async () => {
    const value = await receipt();
    const extraFields = { ...value, citizen: 'private-field' };
    await expect(store.bind(extraFields)).rejects.toThrow('binding fields');
    await expect(store.bind({ ...value, collisionRevision: -1 })).rejects.toThrow('receipt binding');
    await expect(store.bind({ ...value, recipeHash: 'c'.repeat(64) })).rejects.toThrow('recipe');
    await expect(store.bind({ ...value, manifest: { ...value.manifest, gzipHash: 'c'.repeat(64) } })).rejects.toThrow('gzip digest');
    expect(await store.binding('123', sceneHash)).toBeNull();
  });

  it('returns null for a missing binding and rejects traversal in identities', async () => {
    expect(await store.binding('123', sceneHash)).toBeNull();
    await expect(store.binding('../123', sceneHash)).rejects.toThrow('kingdom');
    await expect(store.binding('123', '../scene')).rejects.toThrow('hash');
    await expect(store.pinRecipe('../123', {})).rejects.toThrow('kingdom');
    await expect(store.recipeHash('../123')).rejects.toThrow('kingdom');
  });
});
