import { readFile, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { LandArtifactStore } from '../../../../realm/src/land/store';
import { decodeBakedMetadata } from '../../../../../packages/world/src/grand/baked/codec';
import { STARTUP_BUDGET_BYTES, planStartupCoverage } from './startup-selection';

const directory = process.env.GRAND_BAKED_DIRECTORY_A;
it.skipIf(!directory)('plans first native view within budget and never drops coverage for an oversized view', async () => {
  const evidence = JSON.parse(await readFile('work/evidence/grand-world/gw10-bake.json', 'utf8'));
  const capture = JSON.parse(await readFile('work/evidence/grand-world/gw10-baked-stream.json', 'utf8'));
  const expected = evidence.bakes[0].binding, store = new LandArtifactStore(directory!);
  const binding = await store.binding(expected.kingdomId, expected.sceneHash);
  expect(binding).not.toBeNull();
  const metadata = decodeBakedMetadata(await store.read(binding!.manifest));
  const hashes = new Set<string>(capture.landRequests.filter((request: { status: number }) => request.status === 200)
    .map((request: { path: string }) => request.path.split('/').at(-1)));
  const visible = metadata.regions.map(region => region.meshes.some(ref => hashes.has(ref.hash)));
  const bootstrapBytes = Buffer.byteLength(JSON.stringify(binding)) + binding!.manifest.gzipBytes + metadata.surface.gzipBytes;
  const plan = planStartupCoverage(metadata, visible, bootstrapBytes);
  expect(metadata.regions).toHaveLength(100);
  expect(metadata.regions.filter(region => region.exact)).toHaveLength(16);
  expect(plan.required.filter(Boolean)).toHaveLength(38);
  expect(plan.plannedBytes).toBe(3_967_107);
  expect(plan.budgetExceeded).toBe(false);
  expect(plan.plannedBytes).toBeLessThanOrEqual(STARTUP_BUDGET_BYTES);
  for (let i = 0; i < metadata.regions.length; i++) {
    const region = metadata.regions[i]!;
    if (plan.required[i]) expect(plan.refs[i]).not.toBeNull();
    if (region.exact) expect(plan.levels[i]).toBe(0);
    for (let j = i + 1; j < metadata.regions.length; j++) {
      const neighbour = metadata.regions[j]!;
      if (Math.abs(region.rx - neighbour.rx) <= 1 && Math.abs(region.rz - neighbour.rz) <= 1)
        expect(Math.abs(plan.levels[i]! - plan.levels[j]!)).toBeLessThanOrEqual(1);
    }
  }
  const all = planStartupCoverage(metadata, metadata.regions.map(() => true), bootstrapBytes);
  expect(all.refs.every(Boolean)).toBe(true);
  expect(all.required.every(Boolean)).toBe(true);
  expect(all.budgetExceeded).toBe(true);
  expect(all.plannedBytes).toBe(7_109_907);
  const report = { kind: 'planned compressed bytes, not renderer measurements', regions: metadata.regions.length,
    exact: 16, firstViewRequired: plan.required.filter(Boolean).length, bootstrapBytes, firstViewMeshBytes: plan.meshBytes,
    firstViewPlannedBytes: plan.plannedBytes, allRegionsPlannedBytes: all.plannedBytes, budgetBytes: plan.budgetBytes };
  if (process.env.GRAND_STARTUP_REPORT) await writeFile(process.env.GRAND_STARTUP_REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.info(JSON.stringify(report));
}, 30_000);
