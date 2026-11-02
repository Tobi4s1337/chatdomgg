import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { RealmFoundedManifestSchema } from '@chatdom/shared/realm';
import { decodeFoundedScene, encodeFoundedScene } from '../../../../packages/world/src/founded-world/validate';
import { canonicalSceneJson } from '../../../../packages/world/src/founded-world/codec';
import { LandArtifactStore } from './store';
import { createLandPublicationGuard, publishFoundedLand } from './publication';

const directory = process.env.GRAND_BAKED_DIRECTORY_A;
const scenePath = process.env.GRAND_FOUNDED_SCENE, receiptPath = process.env.GRAND_FOUNDED_RECEIPT;
it.skipIf(!directory || !scenePath || !receiptPath)('reuses the real complete bake across isolated receipt revisions without changing a blob', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'chatdom-real-land-publication-'));
  try {
    // Copy, never hard-link: this proof cannot mutate the original bake or a live realm.
    await cp(directory!, temporary, { recursive: true });
    const receipt = RealmFoundedManifestSchema.parse(JSON.parse(await readFile(receiptPath!, 'utf8')));
    const bytes = new Uint8Array(await readFile(scenePath!)), scene = await decodeFoundedScene(bytes, receipt);
    const store = new LandArtifactStore(temporary), original = await store.binding(scene.kingdomId, receipt.sceneHash);
    expect(original).not.toBeNull();
    const recipeHash = original!.recipeHash, started = performance.now(), cpu = process.cpuUsage();
    const indexed = await publishFoundedLand({ sceneBytes: bytes, receipt, recipeHash, store });
    expect(indexed.disposition).toBe('existing');
    expect(indexed.binding).toEqual(original);
    // A derived test receipt exercises revision reuse only. It is not adopted authority or a real Forge event.
    const target = await encodeFoundedScene({ ...scene, collisionRevision: scene.collisionRevision + 1 });
    const guard = createLandPublicationGuard({ store, recipeFor: id => id === scene.kingdomId ? recipeHash : null });
    const rebound = await guard(target.bytes, target.manifest);
    expect(rebound!.disposition).toBe('rebound');
    expect(rebound!.binding.manifest).toEqual(original!.manifest);
    expect(rebound!.binding.sceneHash).toBe(target.manifest.sceneHash);
    expect((await decodeFoundedScene(target.bytes, target.manifest)).placements).toEqual(scene.placements);
    expect((await publishFoundedLand({ sceneBytes: target.bytes, receipt: target.manifest, recipeHash, store })).disposition).toBe('existing');
    const changed = await encodeFoundedScene({ ...scene, plan: { ...scene.plan,
      config: { ...scene.plan.config, seed: 'isolated-changed-plan-proof' } } });
    await expect(guard(changed.bytes, changed.manifest)).rejects.toMatchObject({ code: 'land.needs-bake' });
    expect(await store.binding(scene.kingdomId, changed.manifest.sceneHash)).toBeNull();
    expect(canonicalSceneJson(await store.binding(scene.kingdomId, receipt.sceneHash))).toBe(canonicalSceneJson(original));
    const files = (await readdir(join(directory!, 'blobs'))).sort();
    expect((await readdir(join(temporary, 'blobs'))).sort()).toEqual(files);
    let unchangedBytes = 0;
    for (const name of files) {
      const stored = await readFile(join(directory!, 'blobs', name));
      expect(stored.equals(await readFile(join(temporary, 'blobs', name)))).toBe(true);
      unchangedBytes += stored.byteLength;
    }
    const used = process.cpuUsage(cpu);
    const report = { result: 'pass', receiptKind: 'real source; isolated revision-only target; never adopted',
      sourceSceneHash: receipt.sceneHash, manifestHash: original!.manifest.hash, recipeHash,
      reused: rebound!.reused, unchangedBlobs: files.length, unchangedBytes, changedPlanRejected: true,
      originalBindingUnchanged: true, artifactFilesAdded: 0,
      wallSeconds: (performance.now() - started) / 1000, cpuSeconds: (used.user + used.system) / 1e6,
      peakMemoryKiB: process.resourceUsage().maxRSS };
    if (process.env.GRAND_PUBLICATION_REPORT) await writeFile(process.env.GRAND_PUBLICATION_REPORT, `${JSON.stringify(report, null, 2)}\n`);
    console.info(JSON.stringify(report));
  } finally { await rm(temporary, { recursive: true, force: true }); }
}, 120_000);
