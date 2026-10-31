import { enrichNativeForgeHearth } from '../../../apps/realm/src/founded/forge-hearth-furnishings';
import type { NativeTown } from '../../../apps/realm/src/founded/native';
import { assetHashOf } from '../../world/src/founded-world/codec';
import { validateFoundedScene } from '../../world/src/founded-world/validate';
import type { RealmFoundedScene } from '../../world/src';

/** Prospective rehearsal only. Uses the room's exact fixture recipe; it issues no adoption receipt. */
export async function prepareForgeRehearsal(scene: RealmFoundedScene): Promise<RealmFoundedScene> {
  const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const native: NativeTown = { revision: scene.layoutRevision, homes: new Map(), fixtures: scene.placements.map(piece => ({
    id: piece.id, blueprint: assets.get(piece.assetHash)!, position: piece.position, rotation: piece.rotation,
  })) };
  const furnished = enrichNativeForgeHearth(scene.plan, native);
  if (furnished === native) throw new Error('The adopted town cannot receive the rehearsal forge hearth');
  const nextAssets = [...scene.assets], placements = [...scene.placements];
  for (const piece of furnished.fixtures.slice(native.fixtures.length)) {
    const assetHash = await assetHashOf(piece.blueprint);
    if (!nextAssets.some(asset => asset.assetHash === assetHash)) nextAssets.push({ assetHash, blueprint: piece.blueprint });
    placements.push({ id: piece.id, assetHash, position: piece.position, rotation: piece.rotation });
  }
  return validateFoundedScene({ ...scene, collisionRevision: scene.collisionRevision + 1, assets: nextAssets, placements });
}
