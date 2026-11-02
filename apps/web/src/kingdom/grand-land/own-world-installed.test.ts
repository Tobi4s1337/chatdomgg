import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { canonicalSceneJson, sha256Hex, utf8 } from '../../../../../packages/world/src/founded-world/codec';
import { scene } from '../../../../realm/src/land/fixtures.test-helper';
import { childLandBake, createRealmLand } from '../../../../realm/src/land/realm';
import { readLandRoute } from '../../../../realm/src/land/routes';
import { genesisSketchRecipe } from '../../../../realm/src/land/sketch';
import { openBakedLand } from './baked-client';
import { probePublishedLand } from './land-availability';
import { readServedLandRecipe } from './recipes';
import { createKingdomReveal } from './reveal';

// Private: the bundled bake command (`build:land`, or the lane's sketch host bundle of the same `cli.ts`).
const script = process.env.GRAND_LAND_BAKE_SCRIPT;
it.skipIf(!script)('founds a hamlet on its channel’s own world end to end: the realm reads the world, bakes and binds it; the page reads the recipe, probes the binding and opens the verified land under its mist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-own-world-'));
  try {
    const world = genesisSketchRecipe('63920635', 'The_AGGman'), lines: string[] = [];
    const log = (line: string) => { lines.push(line); process.stdout.write(`${line}\n`); };
    const land = createRealmLand({ directory, recipeFor: () => undefined, bake: childLandBake(script!, log), trusted: async () => world, log });
    const founding = await scene(0, { kingdomId: '63920635' });
    const started = performance.now();
    await land.beforePublication(founding.bytes, founding.manifest);
    await land.idle();
    const bakeMs = performance.now() - started;
    expect((await land.store.world('63920635'))?.recipe).toEqual(world);
    expect(await land.store.binding('63920635', founding.manifest.sceneHash)).not.toBeNull();

    const realm = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const answer = await readLandRoute(land.store, String(input), init?.method ?? 'GET');
      if (!answer) return new Response(null, { status: 404 });
      return new Response(answer.status === 304 ? null : new Uint8Array(answer.body), { status: answer.status, headers: answer.headers });
    }) as typeof fetch;
    // What scene.ts does for a kingdom the build has no recipe for.
    const recipe = await readServedLandRecipe('63920635', { fetch: realm });
    expect(recipe?.generator).toBe('grand-land-2');
    expect(recipe?.seed.world).toEqual(world.seed.world);
    const published = await probePublishedLand({ kingdomId: '63920635', receipt: founding.manifest, fetch: realm });
    expect(published.kind).toBe('published');
    const source = await openBakedLand({ fetch: realm, cache: null, expected: { kingdomId: '63920635', sceneHash: founding.manifest.sceneHash,
      layoutRevision: founding.manifest.layoutRevision, collisionRevision: founding.manifest.collisionRevision,
      recipeHash: await sha256Hex(utf8(canonicalSceneJson(recipe))), sourcePlanHash: await sha256Hex(utf8(canonicalSceneJson(founding.scene.plan))) } });
    try {
      expect(source.metadata.regions.some(region => region.exact)).toBe(true);
      const physical = source.metadata.regions.find(region => region.exact)!;
      expect((await source.mesh(physical.meshes[0]!)).quads.length).toBeGreaterThan(0);
      // A hamlet opens in its own clear valley; the rest of its world lies under the sea mist.
      const reveal = createKingdomReveal('63920635');
      const opening = reveal.lay(source.surface, source.metadata.seat, founding.scene.plan.homes.length);
      process.stdout.write(`${JSON.stringify({ bakeSeconds: +(bakeMs / 1000).toFixed(1), size: source.metadata.size, regions: source.metadata.regions.length,
        exact: source.metadata.regions.filter(region => region.exact).length, networkBytes: source.stats.networkBytes, opening: opening?.line ?? null, revealed: reveal.inspect() })}\n`);
      expect(reveal.inspect().stage).toBe(0);
      reveal.dispose();
    } finally { source.dispose(); }
    await land.stop();
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 900_000);
