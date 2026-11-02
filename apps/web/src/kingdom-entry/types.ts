import type { GrowthSceneFeed, PresenceFeed } from '@chatdom/shared';
import type { TwitchMomentFeed } from '@chatdom/shared/twitch-moments';
import type { CollisionWorld, RealmFoundedManifest } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import type { RealmClient, RealmCollision, RealmEntry } from '../realm/client';
import type { RealmChatFeed } from '../realm/adapters/chat';
import type { RealmForgeFeed } from '../realm/adapters/forge-feed';

/** Entry owns this connection; the kingdom owns only its presentation. */
export interface KingdomEntryConnection {
  readonly scene: RealmFoundedScene;
  readonly manifest: RealmFoundedManifest;
  readonly collision: CollisionWorld | RealmCollision;
  readonly client: RealmClient;
  readonly presenceFeed: PresenceFeed;
  readonly growthFeed?: GrowthSceneFeed;
  readonly chatFeed?: RealmChatFeed;
  readonly forgeFeed?: RealmForgeFeed;
  readonly momentFeed?: TwitchMomentFeed;
  readonly kingdomName: string;
  readonly notice?: string;
  /**
   * The way through doors into rooms of their own (the tavern): an entry that asks the session for a fresh ticket each
   * time, never bound to this connection's lifetime, and the realm transport. Absent where doors do not open.
   */
  readonly entry?: RealmEntry;
  readonly endpoint?: string;
  dispose(reason?: 'scene-revision'): void;
}

/** Coming back through a door: the first join names it, and the realm decides where you stand. */
export interface KingdomEntryArrival { readonly portal: string }

/** Returns one coherent scene/room bundle, or rejects without granting entry. */
export type KingdomEntrySource = (signal: AbortSignal, arrival?: KingdomEntryArrival) => Promise<KingdomEntryConnection>;
