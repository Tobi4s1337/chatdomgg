import type { ForgeHouseSocket, ForgeLedgerEntry, VoxelBlueprint } from '@chatdom/shared';
import { assembleForge } from './assembly';
import { forgeStyleKit } from './plan';

type ComposedHousePartPlan = ForgeLedgerEntry['plan'];

/**
 * A remembered piece on its own, away from any home: the same registered construction and kit that made it, set on
 * a small neutral footing. Roof pieces stand on four short stone feet (a chimney keeps its own short stack); a
 * lantern hangs from its wall bracket. The wall at the forge and the ledger page both draw this, so a piece looks
 * the same wherever it is remembered.
 */
export function assembleForgeKeepsake(plan: ComposedHousePartPlan, family: 'hearth' | 'tide' | 'grove', kitRevision: number): VoxelBlueprint {
  const kit = forgeStyleKit(family, kitRevision);
  const socket: ForgeHouseSocket = plan.kind === 'lantern'
    ? { id: 'keepsake', kind: plan.kind, profile: 'wall', origin: [0, 0, 0], supports: [], hostId: 'keepsake', hostFingerprint: 'keepsake', clearanceHeight: 0 }
    : { id: 'keepsake', kind: plan.kind, profile: 'roof', origin: [0, 0, 0], supports: [[14, 0, 14], [17, 0, 14], [14, 0, 17], [17, 0, 17]],
      hostId: 'keepsake', hostFingerprint: 'keepsake', clearanceHeight: 0 };
  const blueprint = assembleForge(plan, kit, socket).blueprint;
  return { ...blueprint, id: `keepsake-${family}-${plan.kind}-${plan.motif}` };
}

/** The solid cells' bounds, in the keepsake's own cells: what a caller frames or scales. */
export function forgeKeepsakeBounds(blueprint: VoxelBlueprint): { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of blueprint.boxes) {
    if (!box.material) continue;
    for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis]!, box.from[axis]!); max[axis] = Math.max(max[axis]!, box.to[axis]!); }
  }
  if (min[0] === Infinity) throw new Error('A keepsake needs solid cells.');
  return { min, max };
}
