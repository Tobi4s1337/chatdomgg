import { readFile, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { LandArtifactStore } from '../../../../realm/src/land/store';
import { decodeBakedMetadata, decodeBakedSurface } from '../../../../../packages/world/src/grand/baked/codec';
import { bakedNativeWater } from '../../../../../packages/world/src/grand/baked/surface';
import { groundSample } from '../../places/water/surface/coverage';
import { rasterLevel } from '../../places/water/surface/raster';

const directory = process.env.GRAND_BAKED_DIRECTORY_A;
it.skipIf(!directory)('reuses every real baked surface column and preserves its prior metre interpretation', async () => {
  const evidence = JSON.parse(await readFile('work/evidence/grand-world/gw10-bake.json', 'utf8'));
  const expected = evidence.bakes[0].binding;
  const store = new LandArtifactStore(directory!);
  const binding = await store.binding(expected.kingdomId, expected.sceneHash);
  expect(binding).not.toBeNull();
  const metadata = decodeBakedMetadata(await store.read(binding!.manifest));
  const surface = decodeBakedSurface(await store.read(metadata.surface));
  const { ground, raster } = bakedNativeWater(surface, metadata.seat);
  expect(ground.data).toBe(surface.ground);
  expect(raster.levels).toBe(surface.water);
  expect(raster.dryGround).toBe(surface.ground);
  let wet = 0, dry = 0;
  for (let i = 0; i < surface.ground.length; i++) {
    const originalGround = surface.ground[i]! * 0.5 - metadata.seat.offset[1];
    if (groundSample(ground, i) !== originalGround) throw new Error(`Bed mismatch at column ${i}`);
    const value = rasterLevel(raster, i);
    if (surface.water[i]! > surface.ground[i]!) {
      if (value !== surface.water[i]! * 0.5 - metadata.seat.offset[1]) throw new Error(`Water mismatch at column ${i}`);
      wet++;
    } else {
      if (!Number.isNaN(value)) throw new Error(`Dry mismatch at column ${i}`);
      dry++;
    }
  }
  expect(wet).toBeGreaterThan(0); expect(dry).toBeGreaterThan(0);
  const bytes = surface.ground.byteLength + surface.water.byteLength;
  expect(bytes).toBe(surface.ground.length * 4);
  const paddedTextureBytes = (surface.size + 1) ** 2 * 4;
  const report = { columns: wet + dry, wet, dry, sceneHash: binding!.sceneHash, recipeHash: binding!.recipeHash,
    metadataHash: binding!.manifest.hash, originalSharedBytes: bytes,
    legacyAdditionalRasterBytes: surface.ground.length * 8, legacyAdditionalPaddedTextureBytes: paddedTextureBytes,
    legacyRetainedCpuBytes: bytes + surface.ground.length * 8 + paddedTextureBytes,
    compactRetainedCpuBytes: bytes, compactAdditionalBytes: 0,
    legacyGpuBedTextureBytes: paddedTextureBytes, compactGpuBedTextureBytes: surface.ground.byteLength,
    scope: 'surface arrays and bed texture only; decoder transient, geometry, driver copies and other scene resources excluded' };
  console.info(JSON.stringify(report));
  if (process.env.GRAND_COMPACT_REPORT) await writeFile(process.env.GRAND_COMPACT_REPORT, `${JSON.stringify(report, null, 2)}\n`);
}, 120_000);
