import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import { decodeBakedMetadata, decodeBakedSurface } from '../../../../../packages/world/src/grand/baked/codec';
import { bakedNativeWater, bakedVisualHeight } from '../../../../../packages/world/src/grand/baked/surface';
import { bakedWaterLevel, grandShots } from './vista';
import { planForestFringe } from './fringe';

// Private acceptance on the real baked land and founded plan; both stay outside the repository.
const directory = process.env.GRAND_BAKED_DIRECTORY_A, scenePath = process.env.GRAND_FOUNDED_SCENE;
it.skipIf(!directory || !scenePath)('finds the island, hero and vista shots over the real Willowmere land', async () => {
  const scene = JSON.parse(await readFile(scenePath!, 'utf8'));
  const binding = JSON.parse(await readFile(`${directory}/bindings/${scene.kingdomId}/${process.env.GRAND_SCENE_HASH}.json`, 'utf8'));
  const blob = async (hash: string) => new Uint8Array(gunzipSync(await readFile(`${directory}/blobs/${hash}.gz`)));
  const metadata = decodeBakedMetadata(await blob(binding.manifest.hash));
  const surface = decodeBakedSurface(await blob(metadata.surface.hash));
  const plan = scene.plan, market: Vec3 = plan.nodes.find((node: { id: string }) => node.id === plan.market.nodeId).position;
  const castle: Vec3 = plan.castle.centre, [ox, oy, oz] = metadata.seat.offset;
  let top = -Infinity;
  for (let i = 0; i < surface.ground.length; i++) top = Math.max(top, surface.ground[i]!);
  const bounds = { min: { x: -ox, y: -oy, z: -oz }, max: { x: surface.size * .5 - ox, y: top * .5 - oy, z: surface.size * .5 - oz } };
  const height = (x: number, z: number) => bakedVisualHeight(surface, metadata.seat, x, z);
  const water = bakedWaterLevel(bakedNativeWater(surface, metadata.seat));
  const report: Record<string, unknown> = { kingdomId: scene.kingdomId, market, castle, bounds };
  for (const [name, aspect, heroEye, heroFov] of [
    ['landscape', 16 / 9, [market[0] - 110, market[1] + 40, market[2] + 160], 52],
    ['portrait', 390 / 844, [market[0] + 150, market[1] + 36, market[2] + 160], 58],
  ] as const) {
    const started = performance.now();
    const shots = grandShots({ height, water, seaLevel: surface.seaLevel * .5 - oy, bounds, town: plan.bounds, market, castle,
      lake: plan.lake, aspect, heroEye: [...heroEye] as Vec3, heroFov });
    report[name] = { ms: Math.round(performance.now() - started), ...Object.fromEntries(Object.entries(shots).map(([shot, value]) =>
      [shot, value && { ...value, yawDegrees: Math.round(value.yaw * 1800 / Math.PI) / 10 }])) };
    expect(shots.island).not.toBeNull();
    expect(shots.hero).not.toBeNull();
  }
  const fringe = planForestFringe({ region: metadata.physicalRegion, height, water, seaLevel: surface.seaLevel * .5 - oy, seed: plan.config.seed, style: 'hearth' });
  report.fringe = { trees: fringe.length, water: fringe.filter(site => site.zone === 'water').length, region: metadata.physicalRegion };
  expect(fringe.length).toBeGreaterThan(100);
  if (process.env.GRAND_VISTA_REPORT) await writeFile(process.env.GRAND_VISTA_REPORT, `${JSON.stringify(report, null, 2)}\n`);
}, 120_000);
