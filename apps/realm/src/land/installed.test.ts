import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { RealmFoundedManifestSchema } from '@chatdom/shared/realm';
import { decodeFoundedScene } from '../../../../packages/world/src/founded-world/validate';
import { canonicalSceneJson, sha256Hex, utf8 } from '../../../../packages/world/src/founded-world/codec';
import { foundedGroundAt, sampleFoundedTerrain } from '../../../../packages/world/src/founded-world/collision';
import { bakedVisualHeight } from '../../../../packages/world/src/grand/baked/surface';
import { LandArtifactStore } from './store';
import { verifyLandArtifact } from './bake';

const first = process.env.GRAND_BAKED_DIRECTORY_A, second = process.env.GRAND_BAKED_DIRECTORY_B;
const scenePath = process.env.GRAND_FOUNDED_SCENE, receiptPath = process.env.GRAND_FOUNDED_RECEIPT;
it.skipIf(!first || !second || !scenePath || !receiptPath)('two independent real bakes preserve every physical column and have identical stored artifact bytes', async () => {
  const receipt = RealmFoundedManifestSchema.parse(JSON.parse(await readFile(receiptPath!, 'utf8')));
  const scene = await decodeFoundedScene(new Uint8Array(await readFile(scenePath!)), receipt);
  const a = new LandArtifactStore(first!), b = new LandArtifactStore(second!);
  const binding = await a.binding(scene.kingdomId, receipt.sceneHash);
  expect(binding).not.toBeNull();
  expect(binding).toEqual(await b.binding(scene.kingdomId, receipt.sceneHash));
  expect(binding!.sourcePlanHash).toBe(await sha256Hex(utf8(canonicalSceneJson(scene.plan))));
  expect(binding!.layoutRevision).toBe(scene.layoutRevision);
  expect(binding!.collisionRevision).toBe(scene.collisionRevision);
  const { metadata, surface } = await verifyLandArtifact(a, binding!);
  const files = (await readdir(join(first!, 'blobs'))).sort();
  expect(files).toEqual((await readdir(join(second!, 'blobs'))).sort());
  let storedBytes = 0;
  for (const name of files) {
    const bytes = await readFile(join(first!, 'blobs', name));
    expect(bytes.equals(await readFile(join(second!, 'blobs', name)))).toBe(true);
    storedBytes += bytes.byteLength;
  }
  const grid = sampleFoundedTerrain(scene.plan);
  let columns = 0;
  for (let row = 0; row < grid.rows; row++) for (let col = 0; col < grid.columns; col++) {
    const x = grid.origin[0] + (col + .5) * .5, z = grid.origin[2] + (row + .5) * .5;
    const actual = bakedVisualHeight(surface, metadata.seat, x, z);
    if (actual !== foundedGroundAt(scene.plan, x, z)[1]) throw new Error(`Baked physical floor differs at column ${col},${row}`);
    columns++;
  }
  expect(columns).toBe(grid.columns * grid.rows);
  console.info(JSON.stringify({ manifestHash: binding!.manifest.hash, recipeHash: binding!.recipeHash,
    matchedBlobs: files.length, storedBlobBytes: storedBytes, physicalColumns: columns,
    regions: metadata.regions.length, exactRegions: metadata.regions.filter(region => region.exact).length }));
}, 180_000);
