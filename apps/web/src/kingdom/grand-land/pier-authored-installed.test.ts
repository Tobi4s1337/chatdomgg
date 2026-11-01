import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { expect, it } from 'vitest';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import type { SettlementPlan, CardinalTurn } from '../../../../../packages/world/src/settlement/types';
import { decodeFoundedScene } from '../../../../../packages/world/src/founded-world/validate';
import { compileFoundedScene } from '../../../../../packages/world/src/founded-world/collision';
import { createKingdomLandInterface, createFishingPierProposal, fishingPierCandidates, validateAuthoredPier,
  type AuthoredPierCertificate, type AuthoredPierProposal, type FishingPierGeometry } from '../../../../../packages/world/src/land-interface';
import { seedHash } from '../../../../../packages/world/src/seed';
import { pierWaterFixture } from './pier-water-fixture';

interface ProducedSite {
  version: 1; id: string; root: Vec3; turn: CardinalTurn; deckY: number; waterY: number; walk: number;
  water: 'lake' | 'river' | 'sea'; biome: string; depth: readonly number[];
}
interface ProducedPiece { id: string; blueprint: VoxelBlueprint; position: Vec3; rotation: CardinalTurn }
interface Producer {
  findPierSite(plan: SettlementPlan): ProducedSite | null;
  pierWaterAt(plan: SettlementPlan, x: number, z: number): number | null;
  pierLocalToWorld(site: FishingPierGeometry, local: Vec3): Vec3;
  installPier(plan: SettlementPlan, pieces: readonly ProducedPiece[]): {
    site: ProducedSite; pieces: readonly ProducedPiece[]; content: { anchors: { fishing: readonly Vec3[] } };
  } | null;
}
interface ContentFactory {
  createFishingPier(style: string, site: { walk: number; freeboard: number; seed: number; depth(x: number, z: number): number }): {
    modules: readonly { id: string; blueprint: VoxelBlueprint; offset: Vec3 }[];
    anchors: { fishing: readonly Vec3[] };
  };
}
const scenePath = process.env.GRAND_FOUNDED_SCENE, receiptPath = process.env.GRAND_FOUNDED_RECEIPT;
const producerPath = process.env.GRAND_PIER_PRODUCER;

// Optional read-only integration with the neighboring lane's actual authored factory. No production cross-worktree import.
it.skipIf(!scenePath || !receiptPath || !producerPath)('validates the real authored ramp and T-head on both receipt-matched lands', async () => {
  const scene = await decodeFoundedScene(new Uint8Array(readFileSync(scenePath!)), JSON.parse(readFileSync(receiptPath!, 'utf8')));
  const producer = await import(/* @vite-ignore */ producerPath!) as Producer;
  const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const pieces = scene.placements.map(placement => ({ id: placement.id, blueprint: assets.get(placement.assetHash)!,
    position: placement.position, rotation: placement.rotation }));
  const site = producer.findPierSite(scene.plan), installation = producer.installPier(scene.plan, pieces);
  console.info(JSON.stringify({ site, installation: installation ? { pieceCount: installation.pieces.length,
    boxCount: installation.pieces.reduce((sum, piece) => sum + piece.blueprint.boxes.length, 0) } : null }));
  expect(installation, 'the actual producer proposes authored geometry in this receipt').not.toBeNull();
  if (!installation) throw new Error('Actual authored producer found no site');
  const output = resolve('shots/grand-world/pier-authored-input.json');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(installation));
  expect(installation.site).toEqual(site);
  const unchanged = JSON.stringify(scene);
  const water = pierWaterFixture(scene), collision = compileFoundedScene(scene);
  const factoryPath = resolve(dirname(producerPath!), '../../../../packages/content/src/pier/layout.ts');
  const factory = await import(/* @vite-ignore */ factoryPath) as ContentFactory;
  const rejected: Record<string, number> = {};
  const rejectionExamples: Record<string, unknown> = {};
  let proposal: AuthoredPierProposal | undefined, pin: AuthoredPierCertificate | undefined, checked = 0;
  for (const candidate of fishingPierCandidates(scene.plan, water.ground.sample, (x, z) => producer.pierWaterAt(scene.plan, x, z))) {
    checked++;
    let content: ReturnType<ContentFactory['createFishingPier']>;
    try { content = factory.createFishingPier(scene.plan.homes[0]?.style ?? 'hearth', {
      walk: candidate.walk / .125, freeboard: (candidate.deckY - candidate.waterY) / .125,
      seed: seedHash(`${scene.plan.config.seed}:pier-detail`),
      depth(x, z) {
        const at = producer.pierLocalToWorld(candidate, [x, 0, z]), bed = water.ground.sample(at[0], at[2]);
        if (!bed) throw new Error('An authored footing leaves known physical ground');
        return (candidate.deckY - bed[1]) / .125;
      },
    }); } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      const key = `factory:${error.message}`;
      rejected[key] = (rejected[key] ?? 0) + 1;
      continue; // The actual author refuses this bank/ramp; never clamp or repair its geometry.
    }
    const authored = content.modules.map(module => ({ id: `${candidate.id}:${module.id}`, blueprint: module.blueprint,
      position: producer.pierLocalToWorld(candidate, module.offset), rotation: candidate.turn }));
    const trial = createFishingPierProposal({ site: candidate, pieces: authored, fishing: content.anchors.fishing,
      groundAt: water.ground.sample, biome: water.biome });
    if (!trial) { rejected['unknown-entry'] = (rejected['unknown-entry'] ?? 0) + 1; continue; }
    const result = validateAuthoredPier({ scene, groundAt: water.ground.sample, collision, water: water.old }, trial);
    if (result.ok) { proposal = trial; pin = result.certificate; break; }
    const key = `${result.detail.stage}:${result.reason}`;
    rejected[key] = (rejected[key] ?? 0) + 1;
    rejectionExamples[key] ??= { root: candidate.root, turn: candidate.turn, walk: candidate.walk, result };
  }
  console.info(JSON.stringify({ checked, rejected, rejectionExamples, accepted: pin?.anchor ?? null }));
  expect(proposal, 'the authored candidate sequence must produce a physically valid pier').toBeDefined();
  if (!proposal || !pin) throw new Error('No actual authored proposal passed native physics and water');
  const geometry = JSON.stringify(proposal.pieces);
  const old = createKingdomLandInterface({ scene, ground: water.ground, collision, water: water.old, authoredPier: { proposal, pinned: pin } });
  console.info(JSON.stringify({ surface: 'old', result: old.authoredPier?.ok ? { ok: true, anchor: old.piers?.[0], work: old.authoredPier.work } : old.authoredPier }));
  expect(old.authoredPier?.ok, 'the exact authored pier must work on native ground and water').toBe(true);
  if (!old.authoredPier?.ok) throw new Error('Native authored pier validation failed');
  const grand = createKingdomLandInterface({ scene, ground: water.ground, collision, water: water.grand(),
    authoredPier: { proposal, pinned: old.authoredPier.certificate } });
  console.info(JSON.stringify({ surface: 'grand', result: grand.authoredPier?.ok ? { ok: true, anchor: grand.piers?.[0], work: grand.authoredPier.work } : grand.authoredPier }));
  expect(grand.authoredPier?.ok, 'the same exact authored proposal must work on the grand raster').toBe(true);
  expect(grand.piers).toEqual(old.piers);
  expect(JSON.stringify(scene) === unchanged, 'no old terrain, placement or asset changed').toBe(true);
  expect(JSON.stringify(proposal.pieces) === geometry, 'no supplied pier piece changed').toBe(true);
  if (grand.authoredPier?.ok) writeFileSync(resolve('shots/grand-world/pier-authored-certificate.json'), JSON.stringify(grand.authoredPier.certificate));
}, 600_000);

const certificatePath = process.env.GRAND_PIER_CERTIFICATE;
it.skipIf(!scenePath || !receiptPath || !certificatePath)('revalidates a saved actual-piece certificate without searching or changing its geometry', async () => {
  const scene = await decodeFoundedScene(new Uint8Array(readFileSync(scenePath!)), JSON.parse(readFileSync(receiptPath!, 'utf8')));
  const certificate = JSON.parse(readFileSync(certificatePath!, 'utf8')) as AuthoredPierCertificate;
  const water = pierWaterFixture(scene), collision = compileFoundedScene(scene);
  const result = validateAuthoredPier({ scene, collision, groundAt: water.ground.sample, water: water.old },
    certificate.proposal, { pinned: certificate });
  expect(result.ok, 'the saved actual-piece certificate must still pass physical walking and native water').toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result));
  expect(result.certificate).toEqual(certificate);
  console.info(JSON.stringify({ savedCertificate: true, work: result.work }));
}, 120_000);
