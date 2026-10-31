import type { RealmFoundedManifest } from './founded-world';
import type { RealmBootstrap } from './messages';

/** Read-only public stream projection. No join ticket, principal, walker, input or command channel. */
export const REALM_WATCH_ROUTE = '/api/realm/watch/:kingdomId';
/** Named SSE event `checkpoint`; subsequent `world`/`transient` payloads use the existing room contracts. */
export interface RealmWatchCheckpoint {
  readonly version: 1;
  readonly manifest: RealmFoundedManifest;
  readonly checkpoint: RealmBootstrap;
}
/** Named SSE event `revision`; reopen at a fresh checkpoint and fetch its exact current scene bytes. */
export interface RealmWatchRevision {
  readonly layoutRevision: string;
  readonly collisionRevision: number;
}
