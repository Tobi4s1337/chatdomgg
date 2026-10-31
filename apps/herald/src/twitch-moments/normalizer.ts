import type { KingdomId } from '@chatdom/shared';
import type { TwitchMomentBody } from '../../../web/src/twitch-moments/contracts';
import type { SupportSource } from './plan';
import type { CitizenDirectory, DragonSummonRequest } from './ports';
import type { ProviderNotification } from './provider';
import type { CurrentSlot, MomentRepository } from './records';

export interface NormalizerContext {
  readonly kingdomId: KingdomId;
  readonly notification: ProviderNotification;
  readonly repository: MomentRepository;
  readonly directory: CitizenDirectory;
  /** The one canonical source of support acts for this epoch (see `planSubscriptions`). */
  readonly support: SupportSource;
  /** True only when no `channel.subscription.end` is planned, so a missing subscriber badge is the lapse signal. */
  readonly lapseFromBadges: boolean;
  /** True only when a dragon battle port is bound; without one no dragon request is ever claimed. */
  readonly summonable: boolean;
}

/**
 * What one delivery changes publicly. `current` facts replace the public state for their key. A fact with a `slot`
 * belongs to a family with one current fact: current takes the slot (when `order` is not older than its
 * occupant's), not current releases it.
 */
export interface NormalizedFact {
  readonly body: TwitchMomentBody;
  readonly current: boolean;
  readonly slot?: { readonly name: CurrentSlot; readonly order: number };
}
/** A dragon request claimed inside the transaction; the ingest sends it only after that transaction commits. */
export type ClaimedSummon = Omit<DragonSummonRequest, 'origin'>;
export type NormalizeResult =
  | { readonly outcome: 'applied'; readonly facts: readonly NormalizedFact[]; readonly summons?: readonly ClaimedSummon[] }
  | { readonly outcome: 'stale' };

/**
 * A well-formed, correctly addressed event this ingest deliberately does not project: a notice another family
 * owns, a shared-chat twin or another channel's support. It is counted and dropped before any record is touched.
 */
export const IGNORED: unique symbol = Symbol('ignored');

/**
 * A normalizer for one exact `type@version`. `parse` is pure and runs before any record is touched, so a
 * malformed or wrong-channel event is never claimed. `apply` runs inside the record transaction.
 */
export interface MomentNormalizer<P> {
  readonly type: string;
  readonly version: string;
  parse(event: unknown, kingdomId: KingdomId): P | typeof IGNORED | null;
  apply(parsed: P, context: NormalizerContext): Promise<NormalizeResult>;
}
