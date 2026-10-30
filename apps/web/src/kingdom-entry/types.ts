import type { PresenceFeed } from '@chatdom/shared';
import type { CollisionWorld, RealmFoundedManifest } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import type { RealmClient, RealmCollision } from '../realm/client';

/** Entry owns this connection; the kingdom owns only its presentation. */
export interface KingdomEntryConnection {
  readonly scene: RealmFoundedScene;
  readonly manifest: RealmFoundedManifest;
  readonly collision: CollisionWorld | RealmCollision;
  readonly client: RealmClient;
  readonly presenceFeed: PresenceFeed;
  readonly kingdomName: string;
  readonly notice?: string;
  dispose(): void;
}

/** Returns one coherent scene/room bundle, or rejects without granting entry. */
export type KingdomEntrySource = (signal: AbortSignal) => Promise<KingdomEntryConnection>;
