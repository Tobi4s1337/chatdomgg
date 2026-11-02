import type { FoundedWorldStore } from '../founded/provider';
import { RealmFoundedManifestSchema, type RealmFoundedManifest } from '@chatdom/shared/realm';
import { FOUNDED_SCENE_LIMITS } from '../../../../packages/world/src/founded-world/validate';

export type BeforeFoundedPublication = (bytes: Uint8Array, receipt: RealmFoundedManifest, signal?: AbortSignal) => Promise<unknown>;

/** Install at the loader's store boundary, before its candidate can become an adopted public scene.
 * The underlying store remains the reader's authority. This wrapper does not adopt a world or generate land. */
export function withLandPublication(store: FoundedWorldStore, beforePublish: BeforeFoundedPublication,
  signal?: AbortSignal): FoundedWorldStore {
  return {
    revision: (kingdomId, digest) => store.revision(kingdomId, digest),
    native: (kingdomId, plan, origin) => store.native(kingdomId, plan, origin),
    async put(bytes, receipt) {
      signal?.throwIfAborted();
      if (bytes.byteLength > FOUNDED_SCENE_LIMITS.bytes) throw new Error('The founded scene exceeds its byte budget');
      // The guard and writer must observe one snapshot even when the producer supplied a Node Buffer.
      const ownedBytes = new Uint8Array(bytes), ownedReceipt = RealmFoundedManifestSchema.parse(receipt);
      await beforePublish(ownedBytes, ownedReceipt, signal);
      signal?.throwIfAborted();
      await store.put(ownedBytes, ownedReceipt);
    },
  };
}
