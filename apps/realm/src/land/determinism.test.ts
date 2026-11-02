import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KingdomIdSchema, VoxelBlueprintSchema } from '@chatdom/shared';
import { generateSettlementPlan } from '../../../../packages/world/src/settlement/generator';
import { assetHashOf, canonicalSceneJson, sha256Hex, utf8 } from '../../../../packages/world/src/founded-world/codec';
import { encodeFoundedScene, validateFoundedScene } from '../../../../packages/world/src/founded-world/validate';
import { createGrandLandRecipe, grandLandRecipeHash, type GrandLandRecipe } from '../../../../packages/world/src/grand/recipe';
import type { GrandLandSeed } from '../../../../packages/world/src/grand/types';
import { encodeBakedMetadata, encodeBakedRegion, encodeBakedSurface } from '../../../../packages/world/src/grand/baked/codec';
import { BAKED_COMPILERS, type BakedBlobRef, type BakedMetadata } from '../../../../packages/world/src/grand/baked/types';
import { bakeFoundedLand, verifyLandArtifact } from './bake';
import { publishFoundedLand } from './publication';
import { LandArtifactStore, type StoredLandBinding } from './store';

/*
 * GW11: the same seed and recipe give the same recipe hash and the same stored bytes everywhere, and a new
 * recipe version never changes a founded kingdom. A whole kingdom bake takes minutes, so the determinism check
 * runs the real producer chain (settlement plan -> recipe -> generator and seat -> pinned mesher -> codec ->
 * normalised gzip store) for the surface and a representative set of region meshes, in this process and in
 * two separate Node processes that load the same sources through their own Vite module graph.
 */

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const REALM = fileURLToPath(new URL('../../', import.meta.url));
const KINGDOM = '129634568';
const SETTLEMENT = { seed: 'willowmere', firstYear: 2025, year: 2026, tier: 'hamlet' } as const;
const PROFILE: Omit<GrandLandSeed, 'minSize'> = { seedKey: `twitch:${KINGDOM}`, kingdomId: KINGDOM, name: 'Willowmere',
  biome: 'meadow', tier: 'hamlet', character: 'river-valley' };

/** Every producer export the run needs, by source module. Both processes and this test load exactly these. */
const PRODUCER_MODULES = {
  generateSettlementPlan: 'packages/world/src/settlement/generator.ts',
  createGrandLandRecipe: 'packages/world/src/grand/recipe.ts',
  grandLandRecipeHash: 'packages/world/src/grand/recipe.ts',
  identityForBakedLand: 'packages/world/src/grand/baked/metadata.ts',
  prepareInstalledLand: 'packages/world/src/grand/baked/prepare.ts',
  regionTouchesPhysical: 'packages/world/src/grand/baked/prepare.ts',
  createInstalledRegionMesher: 'packages/world/src/grand/baked/mesher.ts',
  encodeBakedSurface: 'packages/world/src/grand/baked/codec.ts',
  encodeBakedRegion: 'packages/world/src/grand/baked/codec.ts',
  GRAND_REGION: 'packages/world/src/grand/types.ts',
  LandArtifactStore: 'apps/realm/src/land/store.ts',
} as const;

interface Producer {
  readonly generateSettlementPlan: typeof import('../../../../packages/world/src/settlement/generator').generateSettlementPlan;
  readonly createGrandLandRecipe: typeof import('../../../../packages/world/src/grand/recipe').createGrandLandRecipe;
  readonly grandLandRecipeHash: typeof import('../../../../packages/world/src/grand/recipe').grandLandRecipeHash;
  readonly identityForBakedLand: typeof import('../../../../packages/world/src/grand/baked/metadata').identityForBakedLand;
  readonly prepareInstalledLand: typeof import('../../../../packages/world/src/grand/baked/prepare').prepareInstalledLand;
  readonly regionTouchesPhysical: typeof import('../../../../packages/world/src/grand/baked/prepare').regionTouchesPhysical;
  readonly createInstalledRegionMesher: typeof import('../../../../packages/world/src/grand/baked/mesher').createInstalledRegionMesher;
  readonly encodeBakedSurface: typeof import('../../../../packages/world/src/grand/baked/codec').encodeBakedSurface;
  readonly encodeBakedRegion: typeof import('../../../../packages/world/src/grand/baked/codec').encodeBakedRegion;
  readonly GRAND_REGION: number;
  readonly LandArtifactStore: typeof LandArtifactStore;
  readonly readdir: typeof readdir;
  readonly readFile: typeof readFile;
  readonly createHash: typeof createHash;
}
interface ProducedMesh extends BakedBlobRef {
  readonly rx: number; readonly rz: number; readonly level: number;
  readonly exact: boolean; readonly quadCount: number; readonly minY: number; readonly maxY: number;
}
interface ProducedLand {
  readonly recipeHash: string;
  readonly pinnedRecipeHash: string;
  readonly sourcePlanHash: string;
  readonly sourcePlanRevision: string;
  readonly land: { readonly size: number; readonly height: number; readonly seaLevel: number; readonly seat: unknown };
  readonly surface: BakedBlobRef;
  readonly meshes: readonly ProducedMesh[];
  /** Relative path -> sha256 of every file the store wrote. */
  readonly files: Readonly<Record<string, string>>;
}

/**
 * The producer run. It is serialised with `toString()` and evaluated in the child processes, so it must stay
 * self-contained: everything it uses arrives through `m` (no imported binding or module constant).
 */
async function produceLand(m: Producer, directory: string): Promise<ProducedLand> {
  const kingdomId = '129634568';
  const plan = m.generateSettlementPlan({ seed: 'willowmere', firstYear: 2025, year: 2026, tier: 'hamlet' });
  const recipe = m.createGrandLandRecipe(plan, { seedKey: `twitch:${kingdomId}`, kingdomId, name: 'Willowmere',
    biome: 'meadow', tier: 'hamlet', character: 'river-valley' });
  const store = new m.LandArtifactStore(directory);
  const recipeHash = await m.grandLandRecipeHash(recipe);
  const pinnedRecipeHash = await store.pinRecipe(kingdomId, recipe);
  const identity = await m.identityForBakedLand(plan, recipe);
  const prepared = m.prepareInstalledLand(plan, recipe);
  const { land, seated } = prepared;
  const surface = await store.put(m.encodeBakedSurface(land));
  // The region under the town (pinned to level zero) and the nearest region beyond the physical floor, at
  // every level of detail: both kinds of mesh a bake writes.
  const region = m.GRAND_REGION, per = land.size / region, { x0, z0, x1, z1 } = seated.seat.columns;
  const home = { rx: Math.floor((x0 + x1) / 2 / region), rz: Math.floor((z0 + z1) / 2 / region) };
  let far: { rx: number; rz: number } | undefined;
  for (let ring = 1; ring < per && !far; ring++) {
    for (let rz = home.rz - ring; rz <= home.rz + ring && !far; rz++) for (let rx = home.rx - ring; rx <= home.rx + ring && !far; rx++) {
      if (rx < 0 || rz < 0 || rx >= per || rz >= per || Math.max(Math.abs(rx - home.rx), Math.abs(rz - home.rz)) !== ring) continue;
      if (!m.regionTouchesPhysical(rx, rz, seated)) far = { rx, rz };
    }
  }
  if (!far) throw new Error('The land has no region beyond its physical floor');
  const outside = far;
  const keys = [{ ...home, level: 0 }, ...[0, 1, 2, 3].map(level => ({ ...outside, level }))];
  const mesher = m.createInstalledRegionMesher(prepared), meshes: ProducedMesh[] = [];
  for (const key of keys) {
    const mesh = mesher.mesh(key), ref = await store.put(m.encodeBakedRegion(mesh));
    meshes.push({ ...key, exact: m.regionTouchesPhysical(key.rx, key.rz, seated), quadCount: mesh.quads.length / 2,
      minY: mesh.minY, maxY: mesh.maxY, ...ref });
  }
  const files: Record<string, string> = {};
  const walk = async (path: string, prefix: string): Promise<void> => {
    const entries = (await m.readdir(path, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(`${path}/${entry.name}`, name);
      else files[name] = m.createHash('sha256').update(await m.readFile(`${path}/${entry.name}`)).digest('hex');
    }
  };
  await walk(directory, '');
  return { recipeHash, pinnedRecipeHash, sourcePlanHash: identity.sourcePlanHash, sourcePlanRevision: identity.sourcePlanRevision,
    land: { size: land.size, height: land.height, seaLevel: land.seaLevel, seat: seated.seat }, surface, meshes, files };
}

/** Loads the producer modules through Vite's own SSR module graph (the kits use `import.meta.glob`). */
const CHILD = `
const { createServer } = await import('vite');
const { root, cacheDir, directory, modules, source } = JSON.parse(process.argv.at(-1));
const server = await createServer({ configFile: false, envDir: cacheDir, root, cacheDir, logLevel: 'silent', clearScreen: false,
  appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const m = { ...(await import('node:fs/promises')), createHash: (await import('node:crypto')).createHash };
  for (const [name, path] of Object.entries(modules)) {
    const loaded = await server.ssrLoadModule('/' + path);
    if (!(name in loaded)) throw new Error('Missing producer export ' + name);
    m[name] = loaded[name];
  }
  const produce = (0, eval)('(' + source + ')');
  const result = await produce(m, directory);
  process.stdout.write(JSON.stringify({ pid: process.pid, result }) + '\\n');
} finally { await server.close(); }
`;

function runInProcess(workspace: string, name: string): Promise<{ pid: number; result: ProducedLand; seconds: number }> {
  const started = performance.now();
  const input = JSON.stringify({ root: REPO.replace(/\/$/, ''), cacheDir: join(workspace, `${name}-vite`),
    directory: join(workspace, `${name}-store`), modules: PRODUCER_MODULES, source: produceLand.toString() });
  const env: NodeJS.ProcessEnv = { ...process.env, UV_THREADPOOL_SIZE: '2' };
  delete env.NODE_OPTIONS;
  // The eval script resolves `vite` from the realm package, which depends on it.
  const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD, input], { cwd: REALM, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      const line = stdout.trim().split('\n').at(-1);
      if (code !== 0 || !line) { reject(new Error(`Producer process ${name} exited with ${code}:\n${stderr || stdout}`)); return; }
      resolve({ ...(JSON.parse(line) as { pid: number; result: ProducedLand }), seconds: (performance.now() - started) / 1000 });
    });
  });
}

async function loadProducer(): Promise<Producer> {
  const m: Record<string, unknown> = { readdir, readFile, createHash };
  for (const [name, path] of Object.entries(PRODUCER_MODULES)) {
    const loaded = await import(/* @vite-ignore */ join(REPO, path)) as Record<string, unknown>;
    if (!(name in loaded)) throw new Error(`Missing producer export ${name}`);
    m[name] = loaded[name];
  }
  return m as unknown as Producer;
}

/** Every entry under a store directory: file bytes, size and inode, so a rewrite in place also shows. */
async function snapshot(directory: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(path: string): Promise<void> {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(path, entry.name), name = relative(directory, full).split(sep).join('/');
      if (entry.isDirectory()) { out.push(`${name}/`); await walk(full); continue; }
      const info = await stat(full);
      out.push(`${name} ${createHash('sha256').update(await readFile(full)).digest('hex')} ${info.size} ${info.ino} ${info.mtimeMs}`);
    }
  }
  await walk(directory);
  return out;
}

let workspace: string;
beforeAll(async () => { workspace = await mkdtemp(join(tmpdir(), 'chatdom-land-determinism-')); });
afterAll(async () => { if (workspace) await rm(workspace, { recursive: true, force: true }); });

describe('land recipe and bake determinism', () => {
  it('the same seed and recipe give the same recipe hash and identical region bytes in two separate processes', async () => {
    const started = performance.now();
    // Keep producer runs sequential on the shared host.
    const localDirectory = join(workspace, 'local-store');
    const local = await produceLand(await loadProducer(), localDirectory);
    const localSeconds = (performance.now() - started) / 1000;
    const first = await runInProcess(workspace, 'first');
    const second = await runInProcess(workspace, 'second');

    expect(new Set([process.pid, first.pid, second.pid]).size).toBe(3);
    expect(first.result).toEqual(local);
    expect(second.result).toEqual(local);

    // The recipe identity is the pinned canonical bytes, and it is bound to the full kingdom identity.
    expect(local.pinnedRecipeHash).toBe(local.recipeHash);
    expect(local.recipeHash).toBe(await grandLandRecipeHash(createGrandLandRecipe(generateSettlementPlan(SETTLEMENT), PROFILE)));
    expect(local.files[`recipes/${KINGDOM}.json`]).toBe(local.recipeHash);
    expect(local.sourcePlanHash).toBe(await sha256Hex(utf8(canonicalSceneJson(generateSettlementPlan(SETTLEMENT)))));

    // The compared bytes are real land: a populated surface, the town's exact floor and a far region at every level.
    expect(local.surface.rawBytes).toBe(32 + local.land.size ** 2 * 4);
    expect(local.meshes.map(mesh => [mesh.exact, mesh.level])).toEqual([[true, 0], [false, 0], [false, 1], [false, 2], [false, 3]]);
    for (const mesh of local.meshes) expect(mesh.quadCount, `region ${mesh.rx},${mesh.rz} L${mesh.level}`).toBeGreaterThan(0);
    const blobs = [local.surface, ...local.meshes];
    expect(Object.keys(local.files).sort()).toEqual([`recipes/${KINGDOM}.json`, ...blobs.map(ref => `blobs/${ref.hash}.gz`)].sort());
    const store = new LandArtifactStore(localDirectory);
    for (const ref of blobs) {
      expect(local.files[`blobs/${ref.hash}.gz`]).toBe(ref.gzipHash);
      const gzip = Buffer.from(await store.compressed(ref));
      // Normalised gzip header: no wall clock and no host OS byte.
      expect([...gzip.subarray(4, 8), gzip[9]]).toEqual([0, 0, 0, 0, 255]);
      expect((await store.read(ref)).byteLength).toBe(ref.rawBytes);
    }
    console.info(JSON.stringify({ recipeHash: local.recipeHash, landColumns: local.land.size, blobs: blobs.length,
      rawBytes: blobs.reduce((n, ref) => n + ref.rawBytes, 0), gzipBytes: blobs.reduce((n, ref) => n + ref.gzipBytes, 0),
      seconds: { local: +localSeconds.toFixed(1), first: +first.seconds.toFixed(1), second: +second.seconds.toFixed(1) } }));
  }, 360_000);

  describe('a founded kingdom under a pinned recipe', () => {
    const settlement = generateSettlementPlan(SETTLEMENT);
    const current = createGrandLandRecipe(settlement, PROFILE);
    const materials = { version: 1, revision: 1, materials: [
      { id: 0, name: 'Air', solid: false, occludesFaces: false, occludesAo: false, blocksLight: false, colour: '#000000', surface: 'air' },
      { id: 3, name: 'Stone', solid: true, occludesFaces: true, occludesAo: true, blocksLight: true, colour: '#777777', surface: 'stone' },
    ] };

    async function foundedScene() {
      const blueprint = VoxelBlueprintSchema.parse({ version: 1, id: 'prop:well', styleId: 'hearth', kind: 'prop', lattice: 'build',
        size: [2, 2, 2], boxes: [{ from: [0, 0, 0], to: [2, 2, 2], material: 3 }], windows: [] });
      const assetHash = await assetHashOf(blueprint);
      const scene = await validateFoundedScene({ version: 1, kingdomId: KingdomIdSchema.parse(KINGDOM), origin: 'live',
        layoutRevision: settlement.revision, collisionRevision: 1, plan: { ...settlement, homes: [] }, materials,
        assets: [{ assetHash, blueprint }], placements: [{ id: 'prop:well', assetHash, position: [0, 0, 0], rotation: 0 }] });
      return { scene, ...(await encodeFoundedScene(scene)) };
    }

    /** Pins the kingdom's recipe and publishes a complete, verified land for its receipt, as a bake does. */
    async function found(recipe: GrandLandRecipe) {
      const directory = await mkdtemp(join(workspace, 'founded-')), store = new LandArtifactStore(directory);
      const { scene, bytes, manifest: receipt } = await foundedScene();
      const recipeHash = await store.pinRecipe(KINGDOM, recipe);
      const sourcePlanHash = await sha256Hex(utf8(canonicalSceneJson(scene.plan)));
      const surface = await store.put(encodeBakedSurface({ size: 256, height: 256, seaLevel: 0,
        ground: new Uint16Array(256 ** 2).fill(8), water: new Uint16Array(256 ** 2) }));
      const mesh = await store.put(encodeBakedRegion({ rx: 0, rz: 0, level: 0, minY: 0, maxY: 32,
        quads: new Uint32Array([0, 126]), offsets: new Int32Array([0, 1, 1, 1, 1, 1, 1]) }));
      const metadata: BakedMetadata = { version: 2, kingdomId: KINGDOM, recipeHash, sourcePlanHash, sourcePlanRevision: scene.layoutRevision,
        compilers: BAKED_COMPILERS, size: 256, height: 256, seaLevel: 0,
        seat: { offset: [16, 5, 32], columns: { x0: 32, z0: 64, x1: 64, z1: 96 }, band: 96 },
        physicalRegion: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 }, bounds: { min: [-16, -5, -32], max: [112, 123, 96] },
        palette: [{ id: 126, colour: '#aaaaaa', kind: 0 }], surface,
        regions: [{ rx: 0, rz: 0, exact: true, bounds: { min: [-16, -5, -32], max: [112, 11, 96] },
          meshes: [{ ...mesh, level: 0, rx: 0, rz: 0, minY: 0, maxY: 32, quadCount: 1 }] }] };
      const manifest = await store.put(encodeBakedMetadata(metadata));
      const binding: StoredLandBinding = { version: 1, kingdomId: KINGDOM, sceneHash: receipt.sceneHash, layoutRevision: scene.layoutRevision,
        collisionRevision: scene.collisionRevision, sourcePlanHash, recipeHash, manifest };
      await verifyLandArtifact(store, binding);
      const plan = { version: 1 as const, kingdomId: KINGDOM, recipeHash, sourcePlanHash, layoutRevision: scene.layoutRevision, manifest };
      await store.cataloguePlan(plan);
      await store.bind(binding);
      return { directory, store, bytes, receipt, recipeHash, binding, plan };
    }

    async function expectUnchanged(founded: Awaited<ReturnType<typeof found>>, before: string[]) {
      expect(await snapshot(founded.directory)).toEqual(before);
      expect(await founded.store.recipeHash(KINGDOM)).toBe(founded.recipeHash);
      expect(await founded.store.binding(KINGDOM, founded.receipt.sceneHash)).toEqual(founded.binding);
      expect(await founded.store.plan(KINGDOM, founded.recipeHash, founded.plan.sourcePlanHash)).toEqual(founded.plan);
      await verifyLandArtifact(founded.store, founded.binding);
    }

    it('a changed recipe version gives a new hash and leaves a founded kingdom\'s stored land untouched', async () => {
      const founded = await found(current), before = await snapshot(founded.directory);
      expect(founded.recipeHash).toBe(await grandLandRecipeHash(current));
      expect(before.filter(line => !line.endsWith('/')).map(line => line.split(' ')[0]!.split('/')[0])).toEqual(
        ['bindings', 'blobs', 'blobs', 'blobs', 'plans', 'recipes']);

      const changed: GrandLandRecipe[] = [
        { ...current, version: 2 } as unknown as GrandLandRecipe,
        ...(['generator', 'kit', 'grader', 'mesher'] as const).map(key => ({ ...current, [key]: `${current[key]}-next` }) as unknown as GrandLandRecipe),
      ];
      const hashes = await Promise.all(changed.map(recipe => grandLandRecipeHash(recipe)));
      expect(new Set([founded.recipeHash, ...hashes]).size).toBe(changed.length + 1);

      for (const [i, recipe] of changed.entries()) {
        const hash = hashes[i]!;
        // A kingdom founded under the new version keys its land by the new hash, in its own pin.
        const beside = new LandArtifactStore(await mkdtemp(join(workspace, 'beside-')));
        expect(await beside.pinRecipe(KINGDOM, recipe)).toBe(hash);
        // The founded kingdom's pin cannot be replaced by any path: pin, bake, publish, catalogue or bind.
        await expect(founded.store.pinRecipe(KINGDOM, recipe)).rejects.toThrow('conflicts with stored bytes');
        await expect(bakeFoundedLand({ sceneBytes: founded.bytes, receipt: founded.receipt, recipe, store: founded.store }))
          .rejects.toThrow('does not match this kingdom and compiler');
        await expect(publishFoundedLand({ sceneBytes: founded.bytes, receipt: founded.receipt, recipeHash: hash, store: founded.store }))
          .rejects.toThrow('differs from the pinned kingdom recipe');
        await expect(founded.store.cataloguePlan({ ...founded.plan, recipeHash: hash })).rejects.toThrow('differs from the pinned kingdom recipe');
        await expect(founded.store.bind({ ...founded.binding, recipeHash: hash })).rejects.toThrow('differs from the pinned kingdom recipe');
        await expectUnchanged(founded, before);
      }

      // The original recipe still serves the same land, and republishing it writes nothing.
      const again = await publishFoundedLand({ sceneBytes: founded.bytes, receipt: founded.receipt, recipeHash: founded.recipeHash, store: founded.store });
      expect(again.disposition).toBe('existing');
      expect(again.binding).toEqual(founded.binding);
      await expectUnchanged(founded, before);
    }, 60_000);

    it('a newer compiler cannot silently re-bake a kingdom founded under an older recipe version', async () => {
      const older = { ...current, mesher: 'hosted-grand-land-1' } as unknown as GrandLandRecipe;
      const founded = await found(older), before = await snapshot(founded.directory);
      expect(founded.recipeHash).not.toBe(await grandLandRecipeHash(current));
      // The current compiler accepts the current recipe, then refuses to migrate the founded kingdom.
      await expect(bakeFoundedLand({ sceneBytes: founded.bytes, receipt: founded.receipt, recipe: current, store: founded.store }))
        .rejects.toThrow('cannot be silently migrated');
      // Nor can the older recipe be re-run by a compiler that no longer produces it.
      await expect(bakeFoundedLand({ sceneBytes: founded.bytes, receipt: founded.receipt, recipe: older, store: founded.store }))
        .rejects.toThrow('does not match this kingdom and compiler');
      await expectUnchanged(founded, before);
    }, 60_000);
  });
});
