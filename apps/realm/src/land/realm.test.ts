import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GrandLandRecipe } from '../../../../packages/world/src/grand/recipe';
import { adoptedGrandRecipe } from '../../../../packages/world/src/grand/adopted';
import { grandLandRecipeHash } from '../../../../packages/world/src/grand/recipe';
import { artifact, scene } from './fixtures.test-helper';
import { genesisSketchRecipe } from './sketch';
import { childLandBake, createRealmLand, realmLandBakeScript, type LandBakeJob, type LandBakeReport } from './realm';
import { LandArtifactStore } from './store';

let directory: string;
let store: LandArtifactStore;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'chatdom-realm-land-')); store = new LandArtifactStore(directory); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

// The fixtures pin recipe {version: 1}; the host maps kingdom 123 to exactly that recipe.
const recipe = { version: 1 } as unknown as GrandLandRecipe;
const recipeFor = (kingdomId: string) => kingdomId === '123' ? recipe : undefined;
const report: LandBakeReport = { storedBytes: 1, cpuSeconds: 1, wallSeconds: 1, peakMemoryKiB: 1024, meshes: 1 };

describe('the realm land service', () => {
  it('binds a new receipt of an already baked plan before the founded write continues, without a bake', async () => {
    const original = await scene(), grown = await scene(1);
    const { binding } = await artifact(store, original.scene);
    const bakes: LandBakeJob[] = [], lines: string[] = [];
    const land = createRealmLand({ directory, recipeFor, bake: async job => { bakes.push(job); return report; }, log: line => lines.push(line) });
    await land.beforePublication(grown.bytes, grown.manifest);
    expect(await store.binding('123', grown.manifest.sceneHash)).toEqual({ ...binding, sceneHash: grown.manifest.sceneHash, collisionRevision: grown.manifest.collisionRevision });
    await land.beforePublication(original.bytes, original.manifest);
    await land.idle();
    expect(bakes).toEqual([]);
    expect(lines).toEqual([expect.stringMatching(/^land: 123 scene [0-9a-f]{8} bound to baked land [0-9a-f]{8} \(1 meshes reused\)$/)]);
  });

  it('queues a changed plan for one bake, keeps the write moving, and binds newer receipts of that plan after it', async () => {
    const original = await scene(), changed = await scene(1, { changedPlan: true }), later = await scene(2, { changedPlan: true });
    await artifact(store, original.scene);
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    const bakes: string[] = [];
    const land = createRealmLand({ directory, recipeFor, log: () => {}, bake: async job => {
      bakes.push(job.receipt.sceneHash);
      expect(job.directory).toBe(directory);
      expect(job.recipe).toBe(recipe);
      await gate;
      await artifact(store, changed.scene);
      return report;
    } });
    await land.beforePublication(changed.bytes, changed.manifest);
    expect(await store.binding('123', changed.manifest.sceneHash)).toBeNull();
    await land.beforePublication(later.bytes, later.manifest);
    release();
    await land.idle();
    expect(bakes).toEqual([changed.manifest.sceneHash]);
    expect(await store.binding('123', changed.manifest.sceneHash)).not.toBeNull();
    expect((await store.binding('123', later.manifest.sceneHash))?.manifest).toEqual((await store.binding('123', changed.manifest.sceneHash))?.manifest);
  });

  it('raises the first land into an empty store, which pins the recipe', async () => {
    const first = await scene();
    const land = createRealmLand({ directory, recipeFor, log: () => {}, bake: async () => { await artifact(store, first.scene); return report; } });
    await land.beforePublication(first.bytes, first.manifest);
    await land.idle();
    expect(await store.pinnedRecipeHash('123')).toBe(await grandLandRecipeHash(recipe));
    expect(await store.binding('123', first.manifest.sceneHash)).not.toBeNull();
  });

  it('leaves unadopted and simulated kingdoms alone and never throws into the founded write', async () => {
    const foreign = await scene(0, { kingdomId: '124' }), simulated = await scene(1, { origin: 'simulated' }), original = await scene();
    const bakes: string[] = [], lines: string[] = [];
    const land = createRealmLand({ directory, recipeFor: id => id === '124' || id === '123' ? recipe : undefined,
      bake: async job => { bakes.push(job.receipt.kingdomId); throw new Error('the bake ran out of memory'); }, log: line => lines.push(line) });
    await land.beforePublication(simulated.bytes, simulated.manifest);
    // A different recipe already pinned for 123: a deliberate migration, never a silent rebake.
    await store.pinRecipe('123', { version: 1, other: true });
    await expect(land.beforePublication(original.bytes, original.manifest)).resolves.toBeUndefined();
    await expect(land.beforePublication(foreign.bytes, foreign.manifest)).resolves.toBeUndefined();
    await expect(land.beforePublication(new Uint8Array([1, 2]), { ...original.manifest, sceneHash: 'e'.repeat(64) })).resolves.toBeUndefined();
    await land.idle();
    // 124 has no land yet, so it is baked once; its failure is logged, and the same plan is not retried.
    expect(bakes).toEqual(['124']);
    await land.beforePublication(foreign.bytes, foreign.manifest);
    await land.idle();
    expect(bakes).toEqual(['124']);
    expect(lines.some(line => line.includes('differs from the pinned kingdom recipe'))).toBe(true);
    expect(lines.some(line => line.includes('failed; it keeps today\'s land') && line.includes('ran out of memory'))).toBe(true);
    expect(await store.binding('123', original.manifest.sceneHash)).toBeNull();
  });

  it('says when a plan needs the offline bake because no bake command is configured', async () => {
    const first = await scene(), lines: string[] = [];
    const land = createRealmLand({ directory, recipeFor, bake: null, log: line => lines.push(line) });
    await land.beforePublication(first.bytes, first.manifest);
    await land.idle();
    expect(lines).toEqual([expect.stringContaining('needs a bake; no bake command is configured')]);
  });

  it('founds a kingdom on the world its channel was pinned to, and keeps that recipe for ever', async () => {
    const world = genesisSketchRecipe('63920635', 'The_AGGman');
    await store.pinWorld(world);
    const founding = await scene(0, { kingdomId: '63920635' }), grown = await scene(1, { kingdomId: '63920635' });
    const recipes: GrandLandRecipe[] = [], lines: string[] = [];
    const bake = async (job: LandBakeJob) => { recipes.push(job.recipe); throw new Error('stopped after choosing its recipe'); };
    const land = createRealmLand({ directory, recipeFor: () => undefined, bake, log: line => lines.push(line) });
    await land.beforePublication(founding.bytes, founding.manifest);
    await land.idle();
    const [chosen] = recipes;
    expect(chosen?.generator).toBe('grand-land-2');
    expect({ ...chosen!.seed, minSize: undefined }).toEqual({ ...world.seed, minSize: undefined });
    expect(await store.landRecipe('63920635')).toEqual(chosen);
    expect(lines.some(line => line.startsWith('land: 63920635 founded on its own world ('))).toBe(true);
    // A restarted realm, a grown plan: the same pinned recipe, never one recomputed from today's homes.
    const again = createRealmLand({ directory, recipeFor: () => undefined, bake, log: () => {} });
    await again.beforePublication(grown.bytes, grown.manifest);
    await again.idle();
    expect(recipes[1]).toEqual(chosen);
    // A kingdom whose channel has no world keeps today's land.
    const other = await scene(0, { kingdomId: '4363967' });
    await again.beforePublication(other.bytes, other.manifest);
    await again.idle();
    expect(recipes).toHaveLength(2);
    expect(await store.landRecipe('4363967')).toBeNull();
  });

  it('pins the adopted Willowmere recipe the lane baked (grader 3)', async () => {
    const willowmere = adoptedGrandRecipe('129634568');
    expect(willowmere && await grandLandRecipeHash(willowmere)).toBe('71f6888b7ad0b405f949e19203e221520d7a2ee11c2ed2675a7c2ae4eac9d1cd');
    expect(adoptedGrandRecipe('123')).toBeUndefined();
  });
});

describe('the child bake', () => {
  it('runs the bake command with private inputs, two threads and none of the realm environment', async () => {
    const script = join(directory, 'stub-bake.mjs');
    await writeFile(script, `
      import { readFileSync, writeFileSync } from 'node:fs';
      const args = process.argv.slice(2), at = name => args[args.indexOf(name) + 1];
      process.stdout.write(JSON.stringify({ stage: 'meshes', completed: 1, total: 2 }) + '\\n');
      writeFileSync(at('--report'), JSON.stringify({ storedBytes: readFileSync(at('--scene')).length, cpuSeconds: 2, wallSeconds: 3,
        peakMemoryKiB: 4096, meshes: 5, env: Object.keys(process.env).sort(), threads: process.env.UV_THREADPOOL_SIZE,
        recipe: JSON.parse(readFileSync(at('--recipe'), 'utf8')), directory: at('--directory') }));
    `);
    process.env.REALM_TEST_SECRET = 'not for the bake';
    const first = await scene(), lines: string[] = [];
    try {
      const result = await childLandBake(script, line => lines.push(line))({ sceneBytes: first.bytes, receipt: first.manifest,
        recipe, directory, signal: new AbortController().signal }) as LandBakeReport & { env: string[]; threads: string; recipe: unknown; directory: string };
      expect(result.storedBytes).toBe(first.bytes.byteLength);
      expect(result.threads).toBe('2');
      expect(result.env).not.toContain('REALM_TEST_SECRET');
      expect(result.recipe).toEqual(recipe);
      expect(result.directory).toBe(directory);
      expect(lines).toEqual(['land: bake 123 meshes']);
      expect((await readdir(directory)).filter(name => name.startsWith('.bake-'))).toEqual([]);
    } finally { delete process.env.REALM_TEST_SECRET; }
  });

  it('reports a failed bake with its last error lines and removes its inputs', async () => {
    const script = join(directory, 'failing-bake.mjs');
    await writeFile(script, `process.stderr.write('Error: The grand landscape cannot contain the installed physical region\\n'); process.exit(1);`);
    const first = await scene();
    await expect(childLandBake(script)({ sceneBytes: first.bytes, receipt: first.manifest, recipe, directory, signal: new AbortController().signal }))
      .rejects.toThrow(/exited with 1: Error: The grand landscape cannot contain/);
    expect((await readdir(directory)).filter(name => name.startsWith('.bake-'))).toEqual([]);
  });

  it('finds the bake bundle beside the realm bundle or from the explicit setting', async () => {
    const script = join(directory, 'land-bake.mjs');
    expect(realmLandBakeScript({}, join(directory, 'realm.mjs'))).toBeNull();
    await writeFile(script, '');
    expect(realmLandBakeScript({}, join(directory, 'realm.mjs'))).toBe(script);
    expect(realmLandBakeScript({ REALM_LAND_BAKE_SCRIPT: join(directory, 'missing.mjs') }, join(directory, 'realm.mjs'))).toBeNull();
  });
});
