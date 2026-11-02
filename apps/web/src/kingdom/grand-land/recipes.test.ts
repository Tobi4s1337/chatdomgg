import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalSceneJson } from '../../../../../packages/world/src/founded-world/codec';
import { adoptedGrandRecipe } from '../../../../../packages/world/src/grand/adopted';
import type { GrandLandRecipe } from '../../../../../packages/world/src/grand/recipe';
import { scene } from '../../../../realm/src/land/fixtures.test-helper';
import { createRealmLand, type LandBakeJob } from '../../../../realm/src/land/realm';
import { readLandRoute } from '../../../../realm/src/land/routes';
import { genesisSketchRecipe } from '../../../../realm/src/land/sketch';
import { LandArtifactStore } from '../../../../realm/src/land/store';
import { readServedLandRecipe, validateServedLandRecipe } from './recipes';

let directory: string, store: LandArtifactStore;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'chatdom-served-recipe-')); store = new LandArtifactStore(directory); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

const realm = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const answer = await readLandRoute(store, String(input), init?.method ?? 'GET');
  if (!answer) return new Response(null, { status: 404 });
  return new Response(answer.status === 304 ? null : new Uint8Array(answer.body), { status: answer.status, headers: answer.headers });
}) as typeof fetch;

/** Found The_AGGman on the world its channel was pinned to, as the realm does at its first live publication. */
async function foundOnOwnWorld(): Promise<GrandLandRecipe> {
  await store.pinWorld(genesisSketchRecipe('63920635', 'The_AGGman'));
  const founding = await scene(0, { kingdomId: '63920635' }), chosen: GrandLandRecipe[] = [];
  const land = createRealmLand({ directory, recipeFor: () => undefined, log: () => {},
    bake: async (job: LandBakeJob) => { chosen.push(job.recipe); throw new Error('stopped after choosing its recipe'); } });
  await land.beforePublication(founding.bytes, founding.manifest);
  await land.idle();
  await land.stop();
  return chosen[0]!;
}

describe('a kingdom founded on its own world names its land through the realm', () => {
  it('reads exactly the recipe the realm pinned at founding', async () => {
    const pinned = await foundOnOwnWorld();
    expect(pinned.generator).toBe('grand-land-2');
    const answer = await readLandRoute(store, '/api/realm/land/63920635/recipe');
    expect(answer?.status).toBe(200);
    expect(answer?.headers['cache-control']).toBe('no-cache');
    expect(Buffer.from(answer!.body).toString()).toBe(canonicalSceneJson(pinned));
    expect(await readServedLandRecipe('63920635', { fetch: realm })).toEqual(pinned);
  });

  it('keeps today’s land when the realm has no recipe, does not answer, or answers with one it would not draw', async () => {
    expect((await readLandRoute(store, '/api/realm/land/63920635/recipe'))?.status).toBe(404);
    expect(await readServedLandRecipe('63920635', { fetch: realm })).toBeUndefined();
    const silent = ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, fail) =>
      init?.signal?.addEventListener('abort', () => fail(new DOMException('Aborted', 'AbortError'))))) as typeof fetch;
    expect(await readServedLandRecipe('63920635', { fetch: silent, timeoutMs: 20 })).toBeUndefined();
    const offline = (async () => { throw new TypeError('offline'); }) as typeof fetch;
    expect(await readServedLandRecipe('63920635', { fetch: offline })).toBeUndefined();
    const page = (async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;
    expect(await readServedLandRecipe('63920635', { fetch: page })).toBeUndefined();

    const pinned = await foundOnOwnWorld(), text = canonicalSceneJson(pinned);
    expect(() => validateServedLandRecipe(text, '4363967')).toThrow(/another kingdom/);
    expect(() => validateServedLandRecipe(JSON.stringify(pinned, null, 1), '63920635')).toThrow(/canonical/);
    // Willowmere's adopted grand-land-1 recipe is the build's own and never stands in from the network.
    const willowmere = adoptedGrandRecipe('129634568')!;
    expect(() => validateServedLandRecipe(canonicalSceneJson(willowmere), '129634568')).toThrow();
    const neon = { ...pinned, seed: { ...pinned.seed, world: { ...pinned.seed.world!, crest: { field: '#00ff00', charge: '#efe4cc' } } } };
    expect(() => validateServedLandRecipe(canonicalSceneJson(neon), '63920635')).toThrow();
    const stranger = { ...pinned, seed: { ...pinned.seed, seedKey: 'someone-else/63920635' } };
    expect(() => validateServedLandRecipe(canonicalSceneJson(stranger), '63920635')).toThrow();
  });
});
