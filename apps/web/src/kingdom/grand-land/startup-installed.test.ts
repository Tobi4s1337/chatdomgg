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

/* Format 2 is the same land in a compression-friendly byte order. With both stores of the same recipe and plan,
 * every mesh and the surface must decode to identical arrays, and the recorded first views (each capture's own
 * visible regions, mapped by region rather than by hash) are planned again on the format 2 descriptors. */
const formatTwo = process.env.GRAND_BAKED_DIRECTORY_F2;
it.skipIf(!directory || !formatTwo)('format 2 decodes to the identical land and brings recorded first views under budget', async () => {
  const { decodeBakedRegion, decodeBakedSurface } = await import('../../../../../packages/world/src/grand/baked/codec');
  const expected = JSON.parse(await readFile('work/evidence/grand-world/gw10-bake.json', 'utf8')).bakes[0].binding;
  const open = async (path: string) => {
    const store = new LandArtifactStore(path), binding = (await store.binding(expected.kingdomId, expected.sceneHash))!;
    return { store, binding, metadata: decodeBakedMetadata(await store.read(binding.manifest)) };
  };
  const one = await open(directory!), two = await open(formatTwo!);
  expect([one.metadata.version, two.metadata.version]).toEqual([1, 2]);
  for (const key of ['kingdomId', 'recipeHash', 'sourcePlanHash', 'sourcePlanRevision', 'compilers', 'seat', 'bounds', 'palette'] as const)
    expect(two.metadata[key]).toEqual(one.metadata[key]);
  expect(two.binding.recipeHash).toBe(one.binding.recipeHash);
  const [s1, s2] = [decodeBakedSurface(await one.store.read(one.metadata.surface), 1), decodeBakedSurface(await two.store.read(two.metadata.surface), 2)];
  expect(Buffer.from(s2.ground.buffer).equals(Buffer.from(s1.ground.buffer))).toBe(true);
  expect(Buffer.from(s2.water.buffer).equals(Buffer.from(s1.water.buffer))).toBe(true);
  const sizes = { one: one.metadata.surface.gzipBytes, two: two.metadata.surface.gzipBytes, meshesOne: 0, meshesTwo: 0 };
  for (let i = 0; i < one.metadata.regions.length; i++) for (let level = 0; level < one.metadata.regions[i]!.meshes.length; level++) {
    const a = one.metadata.regions[i]!.meshes[level]!, b = two.metadata.regions[i]!.meshes[level]!;
    expect([b.rx, b.rz, b.level, b.minY, b.maxY, b.quadCount, b.rawBytes]).toEqual([a.rx, a.rz, a.level, a.minY, a.maxY, a.quadCount, a.rawBytes]);
    const ma = decodeBakedRegion(await one.store.read(a), 1), mb = decodeBakedRegion(await two.store.read(b), 2);
    expect(Buffer.from(mb.quads.buffer).equals(Buffer.from(ma.quads.buffer))).toBe(true);
    expect(Array.from(mb.offsets)).toEqual(Array.from(ma.offsets));
    sizes.meshesOne += a.gzipBytes; sizes.meshesTwo += b.gzipBytes;
  }
  const views: Record<string, unknown> = {};
  for (const [name, file] of [['hero 1920x1080', 'gw10-native-hero-golden@1920x1080.json'], ['phone 390x844', 'gw10-startup-land@390x844.json'],
    ['door 1440x900', 'gw10-native-canvas-door-golden@1440x900.json'], ['startup 1920x1080', 'gw10-baked-stream.json']] as const) {
    const capture = JSON.parse(await readFile(`work/evidence/grand-world/${file}`, 'utf8'));
    const hashes = new Set<string>((capture.landRequests ?? capture.requests).map((request: { path: string }) => request.path.split('/').at(-1)));
    const visible = one.metadata.regions.map(region => region.meshes.some(ref => hashes.has(ref.hash)));
    const bootstrap = (m: typeof one) => Buffer.byteLength(JSON.stringify(m.binding)) + m.binding.manifest.gzipBytes + m.metadata.surface.gzipBytes;
    const before = planStartupCoverage(one.metadata, visible, bootstrap(one)), after = planStartupCoverage(two.metadata, visible, bootstrap(two));
    expect(after.levels).toEqual(before.levels); expect(after.required).toEqual(before.required);
    expect(after.budgetExceeded).toBe(false);
    views[name] = { regions: after.required.filter(Boolean).length, formatOneBytes: before.plannedBytes, formatTwoBytes: after.plannedBytes };
  }
  const all = planStartupCoverage(two.metadata, two.metadata.regions.map(() => true), Buffer.byteLength(JSON.stringify(two.binding)) + two.binding.manifest.gzipBytes + two.metadata.surface.gzipBytes);
  const report = { kind: 'planned compressed bytes from stored artifacts, not a network trace', manifestGzip: [one.binding.manifest.gzipBytes, two.binding.manifest.gzipBytes],
    surfaceGzip: [sizes.one, sizes.two], meshGzip: [sizes.meshesOne, sizes.meshesTwo], views, allRegionsFormatTwo: all.plannedBytes, budgetBytes: STARTUP_BUDGET_BYTES };
  if (process.env.GRAND_FORMAT_REPORT) await writeFile(process.env.GRAND_FORMAT_REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.info(JSON.stringify(report));
}, 600_000);
