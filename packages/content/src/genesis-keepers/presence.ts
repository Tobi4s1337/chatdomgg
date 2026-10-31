import type { KeeperRole } from './types';

/**
 * Keepers step indoors as real people fill the town (World-Tree §3). This module decides only the intent, from counts
 * the host supplies; it never counts anyone, never produces a presence light and never stands in for a person.
 *
 * The input is the realm's own presence: how many real people are at this keeper's place and in the town right now.
 * A bench may pass a simulated count, which is labelled SIMULATED on every intent it produces. Keepers themselves are
 * never part of either count.
 */
export type KeeperPresenceInput =
  | { readonly source: 'realm'; readonly atPlace: number; readonly inTown: number }
  | { readonly source: 'simulated'; readonly label: 'SIMULATED'; readonly atPlace: number; readonly inTown: number };

/**
 * When a keeper gives way. `withdraw` is reached when either count reaches its threshold; the keeper returns only when
 * both have fallen to their `return` levels, so a town hovering at the edge does not make keepers flicker in and out.
 */
export interface KeeperRetreatPolicy {
  readonly withdraw: { readonly atPlace: number; readonly inTown: number };
  readonly return: { readonly atPlace: number; readonly inTown: number };
  /** Where the keeper goes: indoors through the place's door, or out of sight along the place's edge. */
  readonly to: 'indoors' | 'aside';
  /** Seconds to finish the act in hand before leaving, so a keeper never vanishes mid-gesture. */
  readonly finish: number;
}

/**
 * Hand-set per role. The innkeeper gives way first at the door (the tavern fills from its doorway) but stays inside to keep
 * the room; the lamplighter finishes the lamp and goes home once the court is busy; the ferryman steps aside along the
 * landing early, since a landing crowds quickly.
 */
export const KEEPER_RETREAT: Readonly<Record<KeeperRole, KeeperRetreatPolicy>> = {
  innkeeper: { withdraw: { atPlace: 4, inTown: 24 }, return: { atPlace: 1, inTown: 16 }, to: 'indoors', finish: 4 },
  lamplighter: { withdraw: { atPlace: 6, inTown: 20 }, return: { atPlace: 2, inTown: 12 }, to: 'indoors', finish: 8 },
  ferryman: { withdraw: { atPlace: 3, inTown: 20 }, return: { atPlace: 0, inTown: 12 }, to: 'aside', finish: 6 },
};

export type KeeperPresenceIntent =
  | { readonly kind: 'at-work'; readonly label: 'SIMULATED' | null }
  | { readonly kind: 'withdraw'; readonly to: KeeperRetreatPolicy['to']; readonly reason: 'place-filling' | 'town-filling'; readonly finish: number; readonly label: 'SIMULATED' | null };

/**
 * The keeper's intent given the real counts and its previous intent (hysteresis). Pure and total: invalid counts throw
 * rather than being guessed.
 */
export function keeperPresenceIntent(policy: KeeperRetreatPolicy, input: KeeperPresenceInput, previous: KeeperPresenceIntent['kind'] = 'at-work'): KeeperPresenceIntent {
  for (const value of [input.atPlace, input.inTown]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Presence counts are whole, non-negative numbers of real people.');
  }
  if (input.atPlace > input.inTown) throw new Error('A place cannot hold more people than the town.');
  const label = input.source === 'simulated' ? 'SIMULATED' : null;
  const away = previous === 'withdraw'
    ? input.atPlace > policy.return.atPlace || input.inTown > policy.return.inTown
    : input.atPlace >= policy.withdraw.atPlace || input.inTown >= policy.withdraw.inTown;
  if (!away) return { kind: 'at-work', label };
  const reason = input.atPlace >= policy.withdraw.atPlace || (previous === 'withdraw' && input.atPlace > policy.return.atPlace) ? 'place-filling' : 'town-filling';
  return { kind: 'withdraw', to: policy.to, reason, finish: policy.finish, label };
}
