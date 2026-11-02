import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import { decodeBakedMetadata, decodeBakedSurface } from '../../../../../packages/world/src/grand/baked/codec';
import { bakedVisualHeight } from '../../../../../packages/world/src/grand/baked/surface';
import { heroLensOnLand } from './hero-lens';

// Private acceptance on the real baked land and founded plan; both stay outside the repository.
const directory = process.env.GRAND_BAKED_DIRECTORY_A, scenePath = process.env.GRAND_FOUNDED_SCENE;
it.skipIf(!directory || !scenePath)('frames the real ranges behind Willowmere castle in landscape and portrait', async () => {
  const scene = JSON.parse(await readFile(scenePath!, 'utf8'));
  const binding = JSON.parse(await readFile(`${directory}/bindings/${scene.kingdomId}/${process.env.GRAND_SCENE_HASH}.json`, 'utf8'));
  const blob = async (hash: string) => new Uint8Array(gunzipSync(await readFile(`${directory}/blobs/${hash}.gz`)));
  const metadata = decodeBakedMetadata(await blob(binding.manifest.hash));
  const surface = decodeBakedSurface(await blob(metadata.surface.hash));
  const plan = scene.plan, market: Vec3 = plan.nodes.find((node: { id: string }) => node.id === plan.market.nodeId).position;
  const castle: Vec3 = plan.castle.centre, seaLevel = surface.seaLevel * .5 - metadata.seat.offset[1];
  const height = (x: number, z: number) => bakedVisualHeight(surface, metadata.seat, x, z);
  const landscape = heroLensOnLand({ height, pivot: market, seaLevel, fov: 52, aspect: 16 / 9,
    eye: [market[0] - 110, market[1] + 40, market[2] + 160], target: [castle[0], castle[1] + 9, market[2] - 8] });
  const portrait = heroLensOnLand({ height, pivot: market, seaLevel, fov: 58, aspect: 390 / 844,
    eye: [market[0] + 150, market[1] + 36, market[2] + 160], target: [castle[0], castle[1] + 9, -35] });
  const report = { kingdomId: scene.kingdomId, market, castle, seaLevel,
    landscape: { ...landscape, yawDegrees: landscape.yaw * 180 / Math.PI }, portrait: { ...portrait, yawDegrees: portrait.yaw * 180 / Math.PI } };
  if (process.env.GRAND_HERO_REPORT) await writeFile(process.env.GRAND_HERO_REPORT, `${JSON.stringify(report, null, 2)}\n`);
  expect(landscape.target).toEqual([castle[0], castle[1] + 9, market[2] - 8]);
  expect(Math.abs(landscape.yaw)).toBeLessThanOrEqual(40 * Math.PI / 180 + 1e-9);
});
