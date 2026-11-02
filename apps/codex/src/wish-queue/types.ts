import type { ForgeAttempt, KingdomForgeCommand } from '@chatdom/shared/realm';
import type { KingdomId, PersonId } from '@chatdom/shared';

/** Only JSON data enters private recovery snapshots; never executable objects or provider exceptions. */
export type ForgeWishJson = null | boolean | number | string | readonly ForgeWishJson[] | { readonly [key: string]: ForgeWishJson };
export type ForgeWishStage = 'arrival' | 'words' | 'drafting' | 'result' | 'commit';
export type ForgeWishModelStage = 'words' | 'drafting' | 'result';

/** This is a private durable outcome record, not permission to attach anything to a kingdom. */
export type ForgeWishTerminal =
  | { readonly kind: 'committed'; readonly runId: string; readonly committedAt: number }
  | { readonly kind: 'refused' | 'held' | 'cold' | 'canceled' };

/** Safe for operational code, not a public HTTP response: identities and private outcomes still need filtering. */
export interface ForgeWishReceipt extends ForgeAttempt {
  readonly sequence: number;
  readonly kingdomId: KingdomId;
  readonly personId: PersonId;
  readonly messageId: string;
  readonly slot: number;
  readonly observedAt: number;
  readonly state: 'queued' | 'running' | 'finished';
  readonly stage: ForgeWishStage;
  readonly generation: number;
  readonly modelCalls: number;
  readonly callLimit: 5 | 7;
  readonly outcome?: ForgeWishTerminal;
}

/** Immutable private snapshot. Its data is not an approval and must be validated by the resuming adapter. */
export interface ForgeWishCheckpoint {
  readonly id: string;
  readonly stage: Exclude<ForgeWishStage, 'arrival'>;
  readonly modelCalls: number;
  readonly data: ForgeWishJson;
}
export interface ForgeWishCheckpointInput {
  readonly id: string;
  readonly stage: Exclude<ForgeWishStage, 'arrival'>;
  readonly data: ForgeWishJson;
}

export interface ForgeWishClaim {
  readonly receipt: ForgeWishReceipt;
  readonly attempt: ForgeAttempt;
  readonly command: KingdomForgeCommand;
  readonly checkpoints: readonly ForgeWishCheckpoint[];
  readonly signal: AbortSignal;
  current(): boolean;
}

export interface FileForgeWishQueueOptions {
  /** Dedicated local private directory. Symlinks and nonprivate existing queue files are refused. */
  readonly directory: string;
  readonly origin: 'live' | 'simulated';
  readonly maxConcurrent?: number;
  readonly maxPending?: number;
  readonly claimMs?: number;
  readonly now?: () => number;
}

export type ForgeWishQueueErrorCode = 'unavailable' | 'busy' | 'invalid' | 'conflict' | 'full' | 'stale' | 'budget' | 'corrupt' | 'closed';
/** No input, path, source exception or original wish is retained by errors from this boundary. */
export class ForgeWishQueueError extends Error {
  constructor(readonly code: ForgeWishQueueErrorCode) {
    super(`The private wish queue is ${code}.`);
    this.name = 'ForgeWishQueueError';
  }
}
