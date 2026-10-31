import type { KingdomId, PersonId } from '@chatdom/shared';
import type { MomentBodyOf } from '../../../web/src/twitch-moments/contracts';
import { publicCredit } from './credit';
import type { NormalizedFact } from './normalizer';
import type { CitizenDirectory } from './ports';
import type { MomentRepository, SubscriberRecord } from './records';

/** A named home banner may begin unfurling for two minutes after Twitch reports the sub; later it simply flies. */
export const SUB_BEAT_WINDOW_MS = 120_000;

/** Home keys are public slots, never person IDs. */
export const subscriptionHomeKey = (slot: number) => `subscription.home.${slot}`;

export type SubTier = SubscriberRecord['tier'];
/** Prime and tier 1 are the same rank: moving between them is never an upgrade. */
const RANK: Readonly<Record<SubTier, number>> = { prime: 1, 1: 1, 2: 2, 3: 3 };

/**
 * One upstream entitlement act, as its source reports it. Every sub source maps onto exactly these:
 * - `start`: a new paid or Prime sub (or a rejoin after a lapse).
 * - `gift`: a gifted sub received; the parcel is the gift family's beat, so this is state only.
 * - `resub`: a resub the subscriber chose to share in chat.
 * - `upgrade`: a gifted or Prime sub continued as paid; `tier` null keeps the known tier.
 * - `lapse`: the sub ended. A lapse keeps months, tier and founder.
 * - `badge`: chat metadata. Months and tier from the badge; no badge with `lapse` set is a quiet lapse.
 */
export type EntitlementAct =
  | { readonly kind: 'start'; readonly tier: SubTier }
  | { readonly kind: 'gift'; readonly tier: SubTier }
  | { readonly kind: 'resub'; readonly tier: SubTier; readonly months: number; readonly gifted: boolean | null }
  | { readonly kind: 'upgrade'; readonly tier: SubTier | null }
  | { readonly kind: 'lapse'; readonly tier: SubTier }
  | { readonly kind: 'badge'; readonly months: number | null; readonly tier: '1' | '2' | '3' | null; readonly lapse: boolean };

export interface EntitlementContext {
  readonly kingdomId: KingdomId;
  readonly repository: MomentRepository;
  readonly directory: CitizenDirectory;
}

export type EntitlementResult =
  | { readonly outcome: 'stale' }
  | { readonly outcome: 'applied'; readonly changed: boolean; readonly facts: readonly NormalizedFact[] };

type Transition = { readonly next: Omit<SubscriberRecord, 'version' | 'personId' | 'changedAt'>; readonly celebrate: boolean;
  readonly shared: boolean; readonly publish: boolean };

const MONTHS_MAX = 1200;
const months = (...values: number[]) => Math.min(MONTHS_MAX, Math.max(...values));

/** The pure transition: what the record becomes and whether the act earns a beat. Null leaves everything alone. */
function transition(previous: SubscriberRecord | null, act: EntitlementAct): Transition | null {
  const base = { months: previous?.months ?? 0, founder: previous?.founder ?? false };
  const held = previous?.active === true;
  switch (act.kind) {
    case 'start':
      // New, rejoined or upgraded subs celebrate; a same-tier repeat or a downgrade only changes state.
      return { next: { ...base, tier: act.tier, active: true, months: months(base.months, 1), gifted: false },
        celebrate: !held || RANK[act.tier] > RANK[previous!.tier], shared: false, publish: true };
    case 'gift': {
      // A gift on top of a higher held tier does not lower what the home shows.
      const tier = held && RANK[previous!.tier] > RANK[act.tier] ? previous!.tier : act.tier;
      return { next: { ...base, tier, active: true, months: months(base.months, 1), gifted: true }, celebrate: false, shared: false, publish: true };
    }
    case 'resub':
      return { next: { ...base, tier: act.tier, active: true, months: months(base.months, act.months, 1), gifted: act.gifted ?? previous?.gifted ?? false },
        celebrate: true, shared: true, publish: true };
    case 'upgrade':
      return { next: { ...base, tier: act.tier ?? previous?.tier ?? '1', active: true, months: months(base.months, 1), gifted: false },
        celebrate: true, shared: false, publish: true };
    case 'lapse':
      // An end for someone never seen subscribed is kept privately (it orders later deliveries) but shows nothing.
      if (!previous) return { next: { ...base, tier: act.tier, active: false, gifted: false }, celebrate: false, shared: false, publish: false };
      return { next: { ...base, tier: previous.tier, active: false, gifted: previous.gifted }, celebrate: false, shared: false, publish: true };
    case 'badge': {
      if (act.months === null && act.tier === null) {
        return act.lapse && held ? { next: { ...base, tier: previous!.tier, active: false, gifted: previous!.gifted }, celebrate: false, shared: false, publish: true } : null;
      }
      // A badge cannot tell Prime from tier 1, so a tier-1 badge never overwrites a known Prime sub.
      const known = previous?.tier ?? '1';
      const tier = act.tier === null || (act.tier === '1' && known === 'prime') ? known : act.tier;
      return { next: { ...base, tier, active: true, months: months(base.months, act.months ?? 0, 1), gifted: previous?.gifted ?? false },
        celebrate: false, shared: false, publish: true };
    }
  }
}

const sameRecord = (a: SubscriberRecord | null, b: Transition['next']) => a !== null && a.tier === b.tier && a.active === b.active
  && a.months === b.months && a.gifted === b.gifted && a.founder === b.founder;

type SubscriptionBody = MomentBodyOf<'subscription'>;
const samePublicState = (a: SubscriptionBody, b: SubscriptionBody) => a.tier === b.tier && a.months === b.months && a.active === b.active
  && a.founder === b.founder && a.credit?.displayName === b.credit?.displayName && a.credit?.slot === b.credit?.slot;

/**
 * Apply one entitlement act for one person inside the current record transaction. Every sub source goes through
 * here, so the rules hold everywhere: months only rise; a lapse keeps what was earned; provider time orders
 * changes and an older delivery never overrides a newer recorded change (`stale`); `changedAt` moves only when
 * the record changes. Publicly, only a named citizen with a home is shown, at `subscription.home.<slot>`;
 * quiet, unknown and homeless people update their private record only. A beat (`displayUntil` two minutes out)
 * belongs to a new sub, a rejoin, a higher tier, an upgrade notice and a shared resub; everything else is state
 * with a zero-length window, and unchanged public state is never published twice.
 */
export async function applyEntitlement(context: EntitlementContext, personId: PersonId, occurredAt: number, act: EntitlementAct): Promise<EntitlementResult> {
  const { kingdomId, repository, directory } = context;
  const previous = await repository.subscriber(personId);
  if (previous && previous.changedAt > occurredAt) return { outcome: 'stale' };
  const step = transition(previous, act);
  if (!step) return { outcome: 'applied', changed: false, facts: [] };
  const changed = !sameRecord(previous, step.next);
  const record: SubscriberRecord = changed ? { version: 1, personId, ...step.next, changedAt: occurredAt } : previous!;
  if (changed) await repository.putSubscriber(record);
  if (!step.publish || (!changed && !step.celebrate)) return { outcome: 'applied', changed, facts: [] };
  const citizen = await directory.resolve(kingdomId, personId);
  // Quiet or unknown people are never named, located or tinted; the entitlement stays private.
  if (!citizen || citizen.disclosure !== 'named' || citizen.homeSlot === null) return { outcome: 'applied', changed, facts: [] };
  const credit = publicCredit(citizen.displayName, citizen.homeSlot);
  if (!credit) return { outcome: 'applied', changed, facts: [] };
  const body: SubscriptionBody = {
    kind: 'subscription', key: subscriptionHomeKey(citizen.homeSlot),
    // Zero-length window: the home's state changes with no beat of its own.
    displayUntil: step.celebrate ? occurredAt + SUB_BEAT_WINDOW_MS : occurredAt,
    credit, tier: record.tier, months: record.months, active: record.active, sharedNotice: step.celebrate && step.shared, founder: record.founder,
  };
  if (!step.celebrate) {
    const current = await repository.currentFact(body.key);
    if (current?.body.kind === 'subscription' && samePublicState(current.body, body)) return { outcome: 'applied', changed, facts: [] };
  }
  return { outcome: 'applied', changed, facts: [{ current: true, body }] };
}
