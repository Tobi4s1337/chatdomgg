import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalSceneJson } from '../../../../packages/world/src/founded-world/codec';
import { decodeSketchRecord, grandSketchRecipeHash, type GrandSketchRecipe } from '../../../../packages/world/src/grand/sketch';
import { storeSketch } from './sketch.test-helper';
import { genesisSketchRecipe } from './sketch';
import { createSketchService, type SketchBakeRunner, type TrustedWorld } from './sketches';
import { postLandRoute, readLandRoute } from './routes';
import { LandArtifactStore } from './store';

let directory: string, store: LandArtifactStore;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'chatdom-sketch-')); store = new LandArtifactStore(directory); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

/** A small stand-in for the bake command. */
function fakeBake(counts: { runs: number }, gate?: Promise<void>): SketchBakeRunner {
  return async job => {
    counts.runs++;
    job.onProgress({ stage: 'raising', done: 0, total: 0 });
    await gate;
    await storeSketch(store, job.recipe, done => job.onProgress({ stage: 'meshes', done, total: 4 }));
    return { storedBytes: 1, cpuSeconds: 0, wallSeconds: 0, peakMemoryKiB: 0, meshes: 4 };
  };
}
const recipeOf = (id: string, name: string): GrandSketchRecipe => genesisSketchRecipe(id, name);
const body = (recipe: GrandSketchRecipe) => Buffer.from(canonicalSceneJson(recipe));
const aggman = () => recipeOf('63920635', 'The_AGGman');
const unfounded = async () => false;
/** The worlds the realm itself reads from the Atlas for the three Genesis channels; any other channel has no holding. */
const GENESIS: Record<string, string> = { '63920635': 'The_AGGman', '4363967': 'PinkKittyRose', '154972160': 'MashaD4' };
const trusted: TrustedWorld = async id => GENESIS[id] ? recipeOf(id, GENESIS[id]!) : null;

describe('channel sketches', () => {
  it('are each channel’s own grand-land-2 world, keyed by its full identity', async () => {
    const recipes = [['63920635', 'The_AGGman'], ['4363967', 'PinkKittyRose'], ['154972160', 'MashaD4']].map(([id, name]) => recipeOf(id!, name!));
    for (const recipe of recipes) { expect(recipe.generator).toBe('grand-land-2'); expect(recipe.seed.seedKey).toBe(`channel-genesis-1/broadcaster/${recipe.seed.kingdomId}`); }
    expect(new Set(await Promise.all(recipes.map(grandSketchRecipeHash))).size).toBe(3);
    expect(() => recipeOf('129634568', 'tobi4s_')).toThrow(/No observed Genesis facts/);
  });

  it('raise a requested world once, report the bake’s own counts, then serve it', async () => {
    const counts = { runs: 0 };
    let open!: () => void;
    const service = createSketchService({ store, founded: unfounded, trusted, bake: fakeBake(counts, new Promise(done => { open = done; })) });
    const recipe = aggman(), hash = await grandSketchRecipeHash(recipe);
    expect(await service.request('63920635', hash, body(recipe))).toEqual({ state: 'raising', ahead: 0, stage: 'raising', done: 0, total: 0 });
    // Asking again follows the same bake; it never starts another.
    await new Promise(done => setTimeout(done, 5));
    expect(await service.request('63920635', hash, body(recipe))).toMatchObject({ state: 'raising', ahead: 0 });
    open();
    await service.idle();
    expect(counts.runs).toBe(1);
    expect(await service.request('63920635', hash, body(recipe))).toEqual({ state: 'ready' });
    const record = await readLandRoute(store, `/api/realm/land/63920635/${hash}`);
    expect(record?.status).toBe(200);
    expect(record?.headers['cache-control']).toContain('immutable');
    const decoded = decodeSketchRecord(record!.body, { kingdomId: '63920635', recipeHash: hash });
    expect(decoded.recipe).toEqual(recipe);
    const blob = await readLandRoute(store, `/api/realm/land/63920635/${hash}/${decoded.meshes[2]!.hash}`);
    expect(blob?.headers['content-type']).toBe('application/gzip');
    // A stored blob is served only under a record that names it.
    expect((await readLandRoute(store, `/api/realm/land/4363967/${hash}/${decoded.meshes[2]!.hash}`))?.status).toBe(404);
    expect((await readLandRoute(store, `/api/realm/land/63920635/${hash}/${'f'.repeat(64)}`))?.status).toBe(404);
  });

  it('refuse anything that is not exactly the channel world it names', async () => {
    const service = createSketchService({ store, founded: unfounded, trusted, bake: fakeBake({ runs: 0 }) });
    const recipe = aggman(), hash = await grandSketchRecipeHash(recipe);
    const refused = { state: 'refused', reason: 'invalid' };
    expect(await service.request('4363967', hash, body(recipe))).toEqual(refused);
    expect(await service.request('63920635', 'e'.repeat(64), body(recipe))).toEqual(refused);
    expect(await service.request('63920635', hash, Buffer.from(JSON.stringify(recipe, null, 1)))).toEqual(refused);
    const stranger = { ...recipe, seed: { ...recipe.seed, seedKey: 'someone-else/63920635' } };
    expect(await service.request('63920635', await grandSketchRecipeHash(stranger as GrandSketchRecipe), Buffer.from(canonicalSceneJson(stranger)))).toEqual(refused);
    const tagged = { ...recipe, seed: { ...recipe.seed, minSize: 4096 } };
    expect(await service.request('63920635', await grandSketchRecipeHash(tagged as GrandSketchRecipe), Buffer.from(canonicalSceneJson(tagged)))).toEqual(refused);
    const neon = { ...recipe, seed: { ...recipe.seed, world: { ...recipe.seed.world, crest: { field: '#00ff00', charge: '#efe4cc' } } } };
    expect(await service.request('63920635', await grandSketchRecipeHash(neon as GrandSketchRecipe), Buffer.from(canonicalSceneJson(neon)))).toEqual(refused);
  });

  it('give each channel one world, the first one asked for, and none to a founded kingdom', async () => {
    const service = createSketchService({ store, founded: unfounded, trusted, bake: fakeBake({ runs: 0 }) });
    const first = aggman(), drifted = recipeOf('63920635', 'The AGGman');
    const firstHash = await grandSketchRecipeHash(first), driftedHash = await grandSketchRecipeHash(drifted);
    expect((await readLandRoute(store, '/api/realm/land/63920635/world'))?.status).toBe(404);
    expect((await service.request('63920635', firstHash, body(first))).state).toBe('raising');
    // A later survey whose facts drifted is pointed at the world every visitor sees.
    expect(await service.request('63920635', driftedHash, body(drifted))).toEqual({ state: 'refused', reason: 'pinned', pinnedHash: firstHash });
    const world = await readLandRoute(store, '/api/realm/land/63920635/world');
    expect(world?.status).toBe(200);
    expect(world?.headers['etag']).toBe(`"${firstHash}"`);
    expect(Buffer.from(world!.body).toString()).toBe(canonicalSceneJson(first));
    await service.idle();
    expect(await service.request('63920635', firstHash, body(first))).toEqual({ state: 'ready' });
    // A founded kingdom gets no sketch, and when the realm cannot tell, nothing is raised or pinned.
    const pink = recipeOf('4363967', 'PinkKittyRose'), pinkHash = await grandSketchRecipeHash(pink);
    const founded = createSketchService({ store, founded: async () => true, trusted, bake: fakeBake({ runs: 0 }) });
    expect(await founded.request('4363967', pinkHash, body(pink))).toEqual({ state: 'refused', reason: 'founded' });
    const unsure = createSketchService({ store, founded: async () => { throw new Error('database away'); }, trusted, bake: fakeBake({ runs: 0 }) });
    expect(await unsure.request('4363967', pinkHash, body(pink))).toEqual({ state: 'refused', reason: 'resting' });
    expect(await createSketchService({ store, bake: fakeBake({ runs: 0 }) }).request('4363967', pinkHash, body(pink))).toEqual({ state: 'refused', reason: 'resting' });
    expect(await store.world('4363967')).toBeNull();
  });

  it('never let a caller choose a channel’s world: the realm reads the channel’s facts and raises its own', async () => {
    const counts = { runs: 0 };
    const service = createSketchService({ store, founded: unfounded, trusted, bake: fakeBake(counts) });
    const own = aggman(), ownHash = await grandSketchRecipeHash(own);
    // Another channel's traits, or a name of the caller's choosing, under The_AGGman's id.
    const pink = recipeOf('4363967', 'PinkKittyRose');
    const forged = { ...own, seed: { ...own.seed, name: 'Somebody else', world: pink.seed.world } } as GrandSketchRecipe;
    const forgedHash = await grandSketchRecipeHash(forged);
    expect(forgedHash).not.toBe(ownHash);
    expect(await service.request('63920635', forgedHash, body(forged))).toEqual({ state: 'refused', reason: 'pinned', pinnedHash: ownHash });
    expect((await store.world('63920635'))?.hash).toBe(ownHash);
    await service.idle();
    expect(counts.runs).toBe(1);
    expect(await store.sketchBytes('63920635', forgedHash)).toBeFalsy();
    expect(await service.request('63920635', ownHash, body(own))).toEqual({ state: 'ready' });
    // A channel the Atlas has no public holding for gets no world; an Atlas that cannot be read pins nothing.
    const stranger = { ...own, seed: { ...own.seed, kingdomId: '999', seedKey: 'channel-genesis-1/broadcaster/999' } } as GrandSketchRecipe;
    expect(await service.request('999', await grandSketchRecipeHash(stranger), body(stranger))).toEqual({ state: 'refused', reason: 'invalid' });
    const away = createSketchService({ store, founded: unfounded, trusted: async () => undefined, bake: fakeBake(counts) });
    const masha = recipeOf('154972160', 'MashaD4');
    expect(await away.request('154972160', await grandSketchRecipeHash(masha), body(masha))).toEqual({ state: 'refused', reason: 'resting' });
    expect(await createSketchService({ store, founded: unfounded, bake: fakeBake(counts) }).request('154972160', await grandSketchRecipeHash(masha), body(masha))).toEqual({ state: 'refused', reason: 'resting' });
    expect(await store.world('154972160')).toBeNull();
  });

  it('bound the work a flood of lookups can ask of the host, without pinning what it refuses', async () => {
    let open!: () => void;
    const service = createSketchService({ store, founded: unfounded, trusted, bake: fakeBake({ runs: 0 }, new Promise(done => { open = done; })), limits: { queue: 1, perDay: 3 } });
    const [agg, pink, masha] = await Promise.all([['63920635', 'The_AGGman'], ['4363967', 'PinkKittyRose'], ['154972160', 'MashaD4']].map(async ([id, name]) => {
      const recipe = recipeOf(id!, name!); return { id: id!, recipe, hash: await grandSketchRecipeHash(recipe) };
    }));
    expect((await service.request(agg!.id, agg!.hash, body(agg!.recipe))).state).toBe('raising');
    expect(await service.request(pink!.id, pink!.hash, body(pink!.recipe))).toMatchObject({ state: 'raising', ahead: 1 });
    expect(await service.request(masha!.id, masha!.hash, body(masha!.recipe))).toEqual({ state: 'refused', reason: 'busy' });
    expect(await store.world(masha!.id)).toBeNull();
    open();
    await service.idle();
    expect(await service.request(agg!.id, agg!.hash, body(agg!.recipe))).toEqual({ state: 'ready' });
  });

  it('answer over HTTP with the status a visitor can act on', async () => {
    const recipe = aggman(), hash = await grandSketchRecipeHash(recipe), path = `/api/realm/land/63920635/${hash}`;
    expect((await postLandRoute(null, path, body(recipe)))?.status).toBe(503);
    const service = createSketchService({ store, founded: unfounded, trusted, bake: fakeBake({ runs: 0 }) });
    const first = await postLandRoute(service, path, body(recipe));
    expect(first?.status).toBe(202);
    expect(first?.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(Buffer.from(first!.body).toString())).toMatchObject({ state: 'raising' });
    await service.idle();
    expect((await postLandRoute(service, path, body(recipe)))?.status).toBe(200);
    expect((await postLandRoute(service, `${path}/${hash}`, body(recipe)))?.status).toBe(404);
    expect((await postLandRoute(service, path, Buffer.from('{}')))?.status).toBe(200);
    // The channel has its world now: another recipe is answered with that, before its body is even read.
    expect((await postLandRoute(service, `/api/realm/land/63920635/${'0'.repeat(64)}`, Buffer.from('{}')))?.status).toBe(409);
    expect((await postLandRoute(service, `/api/realm/land/4363967/${'0'.repeat(64)}`, Buffer.from('{}')))?.status).toBe(400);
    const idle = createSketchService({ store, founded: unfounded, trusted, bake: null });
    expect((await postLandRoute(idle, `/api/realm/land/4363967/${'0'.repeat(64)}`, Buffer.from('{}')))?.status).toBe(400);
  });
});
