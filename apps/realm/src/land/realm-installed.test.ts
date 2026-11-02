import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { RealmFoundedManifestSchema } from '@chatdom/shared/realm';
import { decodeFoundedScene, encodeFoundedScene } from '../../../../packages/world/src/founded-world/validate';
import { decodeBakedMetadata } from '../../../../packages/world/src/grand/baked/codec';
import { childLandBake, createRealmLand } from './realm';
import { LandArtifactStore } from './store';

// Private: the real founded scene read once from the live public GET (kept out of the repo), the bundled bake
// command (`build:land`) and the lane's reference bake of the same receipt.
const scenePath = process.env.GRAND_FOUNDED_SCENE, receiptPath = process.env.GRAND_FOUNDED_RECEIPT;
const script = process.env.GRAND_LAND_BAKE_SCRIPT, reference = process.env.GRAND_BAKED_DIRECTORY_REFERENCE;
it.skipIf(!scenePath || !receiptPath || !script || !reference)('raises the real land into an empty realm store on first publication, byte-identical to the offline bake, then rebinds a new receipt in milliseconds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-realm-land-real-'));
  try {
    const receipt = RealmFoundedManifestSchema.parse(JSON.parse(await readFile(receiptPath!, 'utf8')));
    const bytes = new Uint8Array(await readFile(scenePath!)), scene = await decodeFoundedScene(bytes, receipt);
    const lines: string[] = [], log = (line: string) => { lines.push(line); process.stdout.write(`${line}\n`); };
    const land = createRealmLand({ directory, bake: childLandBake(script!, log), log });
    const write = performance.now();
    await land.beforePublication(bytes, receipt);
    const held = performance.now() - write;
    await land.idle();
    const baked = await land.store.binding(scene.kingdomId, receipt.sceneHash), expected = await new LandArtifactStore(reference!).binding(scene.kingdomId, receipt.sceneHash);
    expect(baked).toEqual(expected);
    const metadata = decodeBakedMetadata(await land.store.read(baked!.manifest));
    const refs = [baked!.manifest, metadata.surface, ...metadata.regions.flatMap(region => region.meshes)];
    for (const ref of refs) expect((await readFile(join(directory, 'blobs', `${ref.hash}.gz`))).equals(await readFile(join(reference!, 'blobs', `${ref.hash}.gz`)))).toBe(true);
    expect((await readdir(join(directory, 'blobs'))).length).toBe(refs.length);
    expect((await readdir(directory)).filter(name => name.startsWith('.bake-'))).toEqual([]);
    // A new receipt of the same plan, as a Forge piece or a new collision revision gives (derived, never adopted).
    const next = await encodeFoundedScene({ ...scene, collisionRevision: scene.collisionRevision + 1 });
    const rebind = performance.now();
    await land.beforePublication(next.bytes, next.manifest);
    const rebound = performance.now() - rebind;
    expect((await land.store.binding(scene.kingdomId, next.manifest.sceneHash))?.manifest).toEqual(baked!.manifest);
    process.stdout.write(`${JSON.stringify({ heldFirstWriteMs: Math.round(held), reboundMs: Math.round(rebound), blobs: refs.length,
      storedBytes: (await Promise.all(refs.map(async ref => ref.gzipBytes))).reduce((a, b) => a + b, 0), lines })}\n`);
    expect(rebound).toBeLessThan(4000);
    await land.stop();
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 900_000);
