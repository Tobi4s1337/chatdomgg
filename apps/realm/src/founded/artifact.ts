import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RealmDatabase } from '../persistence/database';
import { loadAdoptedPlan } from './load';
import { createNativeTown } from './native';
import { assembleFoundedScene } from './scene';
import { SIMULATED_TOWN, foundSimulatedTown } from './simulated';
import { decodeFoundedScene } from './validate';

/** Accepted static places the current town does not have yet. Integration must not stand in for these. */
export const ABSENT_PLACE_DEPENDENCIES = [
  'pier: no accepted pier/landing site or content exists in the adopted SettlementPlan or @chatdom/content; plaza->pier acceptance waits for it',
  'anvil: the Forge anvil is a browser presentation (apps/web/src/forge/anvil-hero), not an accepted content blueprint or adopted site; not a static solid in this scene',
  'civic places (footbridge, gateway, noticeboard, benches, lantern posts): reviewed blueprints exist in @chatdom/content/civic but no accepted site places them in an adopted plan',
  'tavern, campfire and home interiors: no accepted static site or interior content is adopted',
  'kingdom name: no kingdom-level approved public name exists in realm authority; only per-home attribution carries approved names',
] as const;

/**
 * Write the SIMULATED current-town artifact: found the SIMULATED town in a throwaway schema through the real
 * allocation and fenced writer, load the exact adopted plan back through AllocationService, assemble, then decode
 * the written bytes exactly as a browser would. Files are written atomically.
 */
export async function writeSimulatedTownArtifact(db: RealmDatabase, dir: string): Promise<Record<string, unknown>> {
  const started = performance.now(), rss0 = process.memoryUsage().rss;
  const town = await foundSimulatedTown(db);
  const founded = performance.now();
  const adopted = await loadAdoptedPlan(town.allocation, town.kingdomId, town.state);
  const loaded = performance.now();
  const native = createNativeTown(adopted.plan);
  const prepared = performance.now();
  const build = await assembleFoundedScene({ kingdomId: town.kingdomId, plan: adopted.plan, state: town.state, collisionRevision: 1, native });
  const assembled = performance.now();
  const decoded = await decodeFoundedScene(build.bytes, build.manifest);
  const verified = performance.now();
  const owned = build.homes.filter(home => home.source === 'owned');

  const evidence = {
    label: 'SIMULATED',
    note: 'SIMULATED fixture authority: kingdom, adopted plan, citizen, tenure, names approval and judge receipts are SIMULATED. Not live founding, naming, sign-in or Twitch evidence.',
    kingdomId: town.kingdomId, origin: build.manifest.origin, layoutRevision: adopted.revision, config: SIMULATED_TOWN.config,
    manifest: build.manifest, geometryDigest: build.geometryDigest, sceneBytes: build.bytes.byteLength,
    planBytes: new TextEncoder().encode(JSON.stringify(adopted.plan)).byteLength,
    counts: { ...build.counts, planHomes: adopted.plan.homes.length, nativeFixtures: native.fixtures.length,
      castleModules: adopted.plan.castle.modules.length, trees: native.fixtures.filter(f => f.id.startsWith('tree:')).length,
      gardenEdges: native.fixtures.filter(f => f.id.startsWith('garden:')).length },
    owned: owned.map(home => ({ plotId: home.plotId, attachments: home.attachments })),
    displacedPart: town.displacedPart, attachedPart: town.attachedPart,
    decoded: { placements: decoded.placements.length, assets: decoded.assets.length },
    timingsMs: { foundSimulated: round(founded - started), loadAdoptedPlan: round(loaded - founded), nativeContent: round(prepared - loaded),
      assembleValidateEncode: round(assembled - prepared), decodeVerify: round(verified - assembled) },
    memory: { rssDeltaBytes: process.memoryUsage().rss - rss0, heapUsedBytes: process.memoryUsage().heapUsed },
    absentDependencies: ABSENT_PLACE_DEPENDENCIES,
  };
  await mkdir(dir, { recursive: true });
  await atomic(join(dir, 'simulated-town.scene.json'), build.bytes);
  await atomic(join(dir, 'simulated-town.manifest.json'), `${JSON.stringify(build.manifest, null, 2)}\n`);
  await atomic(join(dir, 'simulated-town.evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

const round = (ms: number) => Math.round(ms * 10) / 10;
async function atomic(path: string, data: Uint8Array | string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, path);
}
