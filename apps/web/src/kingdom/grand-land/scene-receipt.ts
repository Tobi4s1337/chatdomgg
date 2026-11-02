import { RealmFoundedManifestSchema, type RealmFoundedManifest } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '../../../../../packages/world/src/founded-world/types';
import { encodeFoundedScene } from '../../../../../packages/world/src/founded-world/validate';

/** Callers pass scenes already verified by entry. Prefer their original byte receipt; legacy callers use
 * the existing canonical producer encoding. A derived hash identifies bytes, never grants scene authority. */
export async function foundedLandReceipt(scene: RealmFoundedScene, supplied?: RealmFoundedManifest): Promise<RealmFoundedManifest> {
  const receipt = supplied ? RealmFoundedManifestSchema.parse(supplied) : (await encodeFoundedScene(scene)).manifest;
  if (receipt.kingdomId !== scene.kingdomId || receipt.origin !== scene.origin
    || receipt.layoutRevision !== scene.layoutRevision || receipt.collisionRevision !== scene.collisionRevision)
    throw new Error('The land receipt does not match the installed scene');
  return receipt;
}
