import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import { transformCardinalPoint } from '../settlement/geometry';
import type { BoundsXZ } from '../settlement/types';
import type { LandWaterCoverage, PierAnchor, PierSiteContext } from './pier-sites-types';
import { AUTHORED_PIER_BUDGET as B, type AuthoredPierDetail, type AuthoredPierProposal, type AuthoredPierWork } from './pier-authored-types';
import { deny, EPS, validPoint, worldBounds, type AuthoredHeader } from './pier-authored-checks';
import { requireDrySupport } from './pier-authored-physics';

export function authoredWaters(context: PierSiteContext, p: AuthoredPierProposal, header: AuthoredHeader, base: CollisionWorld, work: AuthoredPierWork): PierAnchor {
  const ground = (x: number, z: number): Vec3 => {
    if (work.groundSamples >= B.groundSamples) deny('budget-exceeded', { stage: 'water' });
    work.groundSamples++;
    const at = context.groundAt(x, z);
    if (!validPoint(at) || at[0] !== x || at[2] !== z) deny('unknown-ground', { stage: 'water', at: [x, 0, z] });
    return at;
  };
  const matches = (water: Exclude<LandWaterCoverage, { state: 'dry' }>, detail: AuthoredPierDetail) => {
    if (!Number.isFinite(water.level) || !Number.isFinite(water.minDepth) || water.minDepth < 0 || water.state === 'wet' && water.minDepth <= 0
      || typeof water.biome !== 'string' || !water.biome.trim() || !['lake', 'river', 'sea'].includes(water.kind)) deny('invalid-water', detail);
    if (Math.abs(water.level - p.anchor.waterY) > EPS) deny('nonflat-water', detail);
    if (water.kind !== p.anchor.water || water.biome !== p.anchor.biome) deny('mixed-water', detail);
  };
  const coverage = (bounds: BoundsXZ, detail: AuthoredPierDetail, mode: 'known' | 'wet' | 'dry', minDepth = 0) => {
    if (work.coverageQueries >= B.coverageQueries) deny('budget-exceeded', detail);
    work.coverageQueries++;
    const water = context.water!.coverage(bounds);
    if (!water) deny('unknown-water', detail);
    if (!['dry', 'wet', 'shore'].includes(water.state)) deny('invalid-water', detail);
    if (water.state !== 'dry') matches(water, detail);
    if (mode === 'dry' && water.state !== 'dry') deny('wet-root', detail);
    if (mode === 'wet' && water.state !== 'wet') deny('dry-deck', detail);
    if (mode === 'wet' && water.state === 'wet' && water.minDepth < minDepth - EPS) deny('shallow-water', detail);
  };
  for (const at of [p.anchor.root, p.entry]) {
    const physical = ground(at[0], at[2]);
    if (Math.abs(physical[1] - at[1]) > EPS) deny('uneven-ground', { stage: 'root', at });
    const bounds = requireDrySupport(base, at);
    coverage(bounds, { stage: 'root', at }, 'dry');
  }
  for (const piece of header.pieces) {
    const detail: AuthoredPierDetail = { stage: 'water', pieceId: piece.id };
    coverage(piece.world, detail, 'known');
    // Every intersecting physical column exists, even where the source reports a dry shore section.
    for (let x = Math.floor(piece.world.minX * 2) / 2; x < piece.world.maxX; x += .5)
      for (let z = Math.floor(piece.world.minZ * 2) / 2; z < piece.world.maxZ; z += .5) ground(
        (Math.max(x, piece.world.minX) + Math.min(x + .5, piece.world.maxX)) / 2,
        (Math.max(z, piece.world.minZ) + Math.min(z + .5, piece.world.maxZ)) / 2);
    if (piece.id === p.head.pieceId) coverage(piece.world, detail, 'wet', 1);
    else if (piece.local.maxZ > 4) coverage(worldBounds(p, { ...piece.local, minZ: Math.max(4, piece.local.minZ) }), detail, 'wet');
    // Base owns unknown regions; a water provider cannot override its barriers. Never put the pier in an
    // existing obstruction above the bank/deck step allowance. Actual route collision below this is tested too.
    const authored = p.pieces.find(v => v.id === piece.id)!;
    const floor = Math.max(p.deckY, p.anchor.root[1]) + .5;
    const ceiling = Math.max(floor + 1, authored.position[1] + authored.blueprint.size[1] * .125, p.deckY + 1.75);
    const query = { min: [piece.world.minX, floor, piece.world.minZ] as Vec3, max: [piece.world.maxX, ceiling, piece.world.maxZ] as Vec3 };
    if (base.query(query).some(b => b.max[1] > floor + EPS && b.min[1] < ceiling - EPS)) deny('solid-overlap', detail);
  }
  for (const f of p.fishing) {
    const detail: AuthoredPierDetail = { stage: 'water', routeId: f.id };
    coverage(f.castArea, detail, 'wet', 1);
    // The cast has known physical volume and no existing solid sticking through the water.
    const query = { min: [f.castArea.minX, p.anchor.waterY + EPS, f.castArea.minZ] as Vec3,
      max: [f.castArea.maxX, Math.max(p.deckY, f.position[1]) + 1.75, f.castArea.maxZ] as Vec3 };
    if (base.query(query).length) deny('solid-overlap', detail);
  }
  const depth: number[] = [];
  for (let z = 0; z <= p.walkLength + p.head.depth; z++) {
    const at = transformCardinalPoint(p.anchor.root, p.anchor.turn, [0, 0, z]);
    if (work.waterSamples >= B.waterSamples) deny('budget-exceeded', { stage: 'water', at });
    work.waterSamples++;
    const sample = context.water!.sample(at[0], at[2]);
    if (!sample) deny('unknown-water', { stage: 'water', at });
    if (sample.state === 'dry') {
      if (z > 4) deny('dry-deck', { stage: 'water', at });
      depth.push(0); continue;
    }
    if (!['wet', 'shore'].includes(sample.state) || !Number.isFinite(sample.depth)
      || (sample.state === 'shore' ? sample.depth !== 0 : sample.depth <= 0)) deny('invalid-water', { stage: 'water', at });
    if (sample.state === 'shore' && z > 4) deny('shallow-water', { stage: 'water', at });
    if (z === 0) deny('wet-root', { stage: 'water', at });
    matches({ ...sample, minDepth: sample.depth }, { stage: 'water', at });
    const bed = ground(at[0], at[2]);
    if (Math.abs(sample.level - bed[1] - sample.depth) > EPS) deny('bed-mismatch', { stage: 'water', at });
    depth.push(sample.depth);
  }
  return { ...p.anchor, depth };
}
