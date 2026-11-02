// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { genesisSketchRecipe } from '../../../realm/src/land/sketch';
import { storeSketch } from '../../../realm/src/land/sketch.test-helper';
import { createSketchService, type SketchBakeRunner, type SketchService } from '../../../realm/src/land/sketches';
import { postLandRoute, readLandRoute } from '../../../realm/src/land/routes';
import { LandArtifactStore } from '../../../realm/src/land/store';
import { grandSketchRecipeHash } from '../../../../packages/world/src/grand/sketch';
import { coastField, sketchDrawnLand } from './sketch-land';
import { openSketchLand, resolveChannelWorld, SketchRefused, type SketchSourceState } from './sketch-source';

let directory: string, store: LandArtifactStore;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'chatdom-sketch-web-')); store = new LandArtifactStore(directory); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

/** The realm's own land routes and sketch service behind a fetch, as the gateway carries them. */
function realmFetch(sketches: SketchService | null, seen: string[] = [], founded: ReadonlySet<string> = new Set()): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input), method = init?.method ?? 'GET';
    seen.push(`${method} ${path.replace(/[a-f0-9]{64}/g, h => h.slice(0, 6))}`);
    // The founded receipt route's two answers, as the realm's bootstrap gives them.
    const receipt = /^\/api\/realm\/founded\/([0-9]+)$/.exec(path);
    if (receipt) return founded.has(receipt[1]!) ? Response.json({ version: 1, kingdomId: receipt[1] }, { status: 200 })
      : Response.json({ version: 1, status: 'unavailable', message: 'This kingdom has no adopted layout.' }, { status: 404 });
    const body = init?.body ? new Uint8Array(new TextEncoder().encode(String(init.body))) : new Uint8Array();
    const answer = method === 'POST' ? await postLandRoute(sketches, path, body) : await readLandRoute(store, path, method);
    if (!answer) return new Response(null, { status: 404 });
    return new Response(answer.status === 204 || answer.status === 304 ? null : new Uint8Array(answer.body), { status: answer.status, headers: answer.headers });
  }) as typeof fetch;
}
const bake = (): SketchBakeRunner => async job => {
  job.onProgress({ stage: 'raising', done: 0, total: 0 });
  await storeSketch(store, job.recipe, done => job.onProgress({ stage: 'meshes', done, total: 4 }));
  return { storedBytes: 1, cpuSeconds: 0, wallSeconds: 0, peakMemoryKiB: 0, meshes: 4 };
};

describe('a channel’s own land in the browser', () => {
  it('asks the realm for exactly its recipe, follows the bake, then reads and verifies the land', async () => {
    const recipe = genesisSketchRecipe('63920635', 'The_AGGman'), seen: string[] = [], states: SketchSourceState[] = [];
    const sketches = createSketchService({ store, founded: async () => false, trusted: async id => id === '63920635' ? genesisSketchRecipe(id, 'The_AGGman') : null, bake: bake() });
    const land = await openSketchLand({ recipe, fetch: realmFetch(sketches, seen), cache: null, pollMs: 5, onState: state => states.push(state) });
    expect(seen[0]).toMatch(/^GET \/api\/realm\/land\/63920635\/[a-f0-9]{6}$/);
    expect(seen[1]).toMatch(/^POST /);
    expect(states[0]).toEqual({ kind: 'asking' });
    expect(states.some(state => state.kind === 'raising')).toBe(true);
    expect(land.record.recipe).toEqual(recipe);
    expect(land.surface.size).toBe(256);
    const mesh = await land.mesh(land.record.meshes[1]!);
    expect(mesh.level).toBe(1);
    // Every byte counted is a byte read: the record, the surface and one mesh.
    const recordBytes = (await readLandRoute(store, `/api/realm/land/63920635/${land.record.recipeHash}`))!.body.byteLength;
    expect(land.stats.blobs).toBe(2);
    expect(land.stats.networkBytes).toBe(recordBytes + land.record.surface.gzipBytes + land.record.meshes[1]!.gzipBytes);
    expect(states.at(-1)).toMatchObject({ kind: 'reading', blobs: 2 });
    await expect(land.mesh({ ...land.record.meshes[1]! })).rejects.toThrow(/not part of the sketch/);
    land.dispose();

    // A second visit finds it raised and never asks for a bake.
    const again: string[] = [];
    (await openSketchLand({ recipe, fetch: realmFetch(sketches, again), cache: null })).dispose();
    expect(again.some(line => line.startsWith('POST'))).toBe(false);
    await sketches.stop();
  });

  it('asks the realm first: a founded kingdom gets no sketch, and a channel keeps the world it was first given', async () => {
    const first = genesisSketchRecipe('63920635', 'The_AGGman'), drifted = genesisSketchRecipe('63920635', 'The AGGman');
    const sketches = createSketchService({ store, founded: async () => false, trusted: async id => id === '63920635' ? genesisSketchRecipe(id, 'The_AGGman') : null, bake: bake() });
    expect(await resolveChannelWorld({ proposed: first, fetch: realmFetch(sketches, [], new Set(['63920635'])) })).toEqual({ kind: 'founded' });
    expect(await resolveChannelWorld({ proposed: first, fetch: realmFetch(sketches) })).toEqual({ kind: 'world', recipe: first, pinned: false });
    (await openSketchLand({ recipe: first, fetch: realmFetch(sketches), cache: null, pollMs: 5 })).dispose();
    // A visitor whose survey drifted is shown the pinned world, not their own.
    const world = await resolveChannelWorld({ proposed: drifted, fetch: realmFetch(sketches) });
    expect(world).toEqual({ kind: 'world', recipe: first, pinned: true });
    await expect(openSketchLand({ recipe: drifted, fetch: realmFetch(sketches), cache: null })).rejects.toMatchObject({ reason: 'pinned' });
    // When the realm cannot say (a gateway page, the realm away), nothing is promised.
    const away = (async () => new Response('<html>', { status: 404, headers: { 'content-type': 'text/html' } })) as typeof fetch;
    await expect(resolveChannelWorld({ proposed: first, fetch: away })).rejects.toMatchObject({ reason: 'unreachable' });
    const down = (async () => { throw new TypeError('offline'); }) as typeof fetch;
    await expect(resolveChannelWorld({ proposed: first, fetch: down })).rejects.toMatchObject({ reason: 'unreachable' });
    await sketches.stop();
  });

  it('names the realm’s refusal and never draws another channel’s land', async () => {
    const recipe = genesisSketchRecipe('63920635', 'The_AGGman');
    await expect(openSketchLand({ recipe, fetch: realmFetch(null), cache: null })).rejects.toMatchObject({ name: 'SketchRefused', reason: 'resting' });
    // A record stored under this recipe's address that carries another recipe is refused.
    const other = genesisSketchRecipe('4363967', 'PinkKittyRose');
    await storeSketch(store, other);
    const forged = realmFetch(null), otherHash = await grandSketchRecipeHash(other);
    const wrong = (async (input: RequestInfo | URL, init?: RequestInit) =>
      forged(String(input).replace(/\/63920635\/[a-f0-9]{64}/, `/4363967/${otherHash}`), init)) as typeof fetch;
    const refused = openSketchLand({ recipe, fetch: wrong, cache: null });
    await expect(refused).rejects.toThrow();
    await expect(refused).rejects.not.toBeInstanceOf(SketchRefused);
  });

  it('draws the served surface: the coast from the sea line and region bounds from the record', async () => {
    const recipe = genesisSketchRecipe('154972160', 'MashaD4');
    await storeSketch(store, recipe);
    const land = await openSketchLand({ recipe, fetch: realmFetch(null), cache: null });
    const drawn = sketchDrawnLand(land);
    expect(drawn.land.size).toBe(256);
    expect(drawn.bounds.get('0,0')).toEqual([0, 32 * 8]);
    expect(drawn.sky.size).toBe(64);
    land.dispose();
    // An inland lake is not sea; a column's coast distance grows away from the sea line.
    const size = 8, ground = new Uint16Array(size * size).fill(10);
    for (let z = 0; z < size; z++) ground[z * size] = 2;
    const coast = coastField({ size, ground, seaLevel: 4 });
    expect(coast[0]).toBeLessThan(0);
    expect(coast[1]).toBe(1);
    expect(coast[5]).toBe(5);
  });
});
