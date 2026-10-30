import { type EventSubAdmin, type EventSubSubscription, isTwitchFailure, matchesRequest, type SubscriptionRequest } from '@chatdom/twitch';
import type { Capability } from '../auth/grants';

/** The seven v1 subscriptions Herald reads (Spec 03 R5). Nothing else is ever created. */
export const HERALD_EVENT_TYPES = [
  'channel.chat.message',
  'channel.chat.message_delete',
  'channel.chat.clear',
  'channel.chat.clear_user_messages',
  'stream.online',
  'stream.offline',
  'user.authorization.revoke',
] as const;
export type HeraldEventType = (typeof HERALD_EVENT_TYPES)[number];

export interface SubscriptionPlan extends SubscriptionRequest {
  readonly type: HeraldEventType;
  /** The grant family that must be verified before this subscription may be created. */
  readonly capability: Capability;
  /**
   * Named chat is published only while every required subscription is enabled: the message itself, the
   * three cleanup types that take it away again, and revocation, which erases a withdrawn kingdom.
   */
  readonly required: boolean;
}

export interface PlanIds {
  readonly broadcasterId: string;
  readonly readerId: string;
  readonly clientId: string;
}

export function planSubscriptions(ids: PlanIds): SubscriptionPlan[] {
  const chat = { broadcaster_user_id: ids.broadcasterId, user_id: ids.readerId };
  const stream = { broadcaster_user_id: ids.broadcasterId };
  return [
    { type: 'channel.chat.message', version: '1', condition: chat, capability: 'chat', required: true },
    { type: 'channel.chat.message_delete', version: '1', condition: chat, capability: 'chat', required: true },
    { type: 'channel.chat.clear', version: '1', condition: chat, capability: 'chat', required: true },
    { type: 'channel.chat.clear_user_messages', version: '1', condition: chat, capability: 'chat', required: true },
    { type: 'stream.online', version: '1', condition: stream, capability: 'stream', required: false },
    { type: 'stream.offline', version: '1', condition: stream, capability: 'stream', required: false },
    { type: 'user.authorization.revoke', version: '1', condition: { client_id: ids.clientId }, capability: 'revocation', required: true },
  ];
}

/**
 * Where one subscription stands. `enabled` is the only state that delivers. The others say why not, by
 * code: `unauthorized` (Herald did not try, the grant is not verified), `missing_grant` (Twitch refused,
 * 403), `conflict` (an identical subscription exists but not on this conduit), `version_removed` (410),
 * `limit_reached` (429), `disabled` (Twitch revoked it; the reason is kept), `failed` (try again later).
 */
export type CoverageState = 'enabled' | 'unauthorized' | 'missing_grant' | 'conflict' | 'version_removed' | 'limit_reached' | 'disabled' | 'failed' | 'unknown';

export interface SubscriptionCoverage {
  readonly type: HeraldEventType;
  readonly required: boolean;
  readonly state: CoverageState;
  /** For `disabled`: Twitch's status code (`authorization_revoked`, `user_removed`, …). */
  readonly reason: string | null;
}

export interface ReconcileResult {
  readonly coverage: readonly SubscriptionCoverage[];
  readonly created: number;
  readonly deleted: number;
  /** Subscriptions on this conduit that match no plan (an older channel, say). Left alone and counted. */
  readonly unexpected: number;
}

/**
 * Brings the conduit's subscriptions to the plan, idempotently. It lists only this conduit, deletes only
 * this conduit's own disabled copies of a planned subscription, and creates only planned ones whose grants
 * are verified. A 409 is accepted only after a fresh listing shows the matching enabled subscription here.
 */
export async function reconcileSubscriptions(options: {
  readonly admin: Pick<EventSubAdmin, 'listConduitSubscriptions' | 'createSubscription' | 'deleteSubscription'>;
  readonly conduitId: string;
  readonly plans: readonly SubscriptionPlan[];
  readonly authorized: (capability: Capability) => boolean;
  readonly signal?: AbortSignal;
}): Promise<ReconcileResult> {
  const { admin, conduitId, plans } = options;
  const call = options.signal ? { signal: options.signal } : {};
  let listed = await admin.listConduitSubscriptions(conduitId, call);
  const unexpected = listed.filter(subscription => !plans.some(plan => matchesRequest(subscription, plan))).length;
  let created = 0;
  let deleted = 0;
  const coverage: SubscriptionCoverage[] = [];

  for (const plan of plans) {
    const state = (value: CoverageState, reason: string | null = null) => coverage.push({ type: plan.type, required: plan.required, state: value, reason });
    const matching = listed.filter(subscription => matchesRequest(subscription, plan));
    if (matching.some(subscription => subscription.status === 'enabled')) {
      state('enabled');
      continue;
    }
    if (!options.authorized(plan.capability)) {
      const revoked = matching.find(subscription => subscription.status !== 'enabled');
      state(revoked ? 'disabled' : 'unauthorized', revoked ? statusCode(revoked) : null);
      continue;
    }
    try {
      for (const stale of matching) {
        await admin.deleteSubscription(stale.id, call);
        deleted++;
      }
      const made = await admin.createSubscription(conduitId, plan, call);
      created++;
      if (made.conduitId === conduitId && matchesRequest(made, plan)) state(made.status === 'enabled' ? 'enabled' : 'disabled', made.status === 'enabled' ? null : statusCode(made));
      else state('failed');
    } catch (error) {
      if (isTwitchFailure(error, 'conflict')) {
        listed = await admin.listConduitSubscriptions(conduitId, call);
        const owned = listed.some(subscription => matchesRequest(subscription, plan) && subscription.status === 'enabled');
        state(owned ? 'enabled' : 'conflict');
      } else if (isTwitchFailure(error, 'forbidden')) state('missing_grant');
      else if (isTwitchFailure(error, 'gone')) state('version_removed');
      else if (isTwitchFailure(error, 'limit_reached')) state('limit_reached');
      else if (isTwitchFailure(error, 'aborted')) throw error;
      else state('failed');
    }
  }
  return { coverage, created, deleted, unexpected };
}

function statusCode(subscription: EventSubSubscription): string {
  return /^[a-z_]{1,64}$/.test(subscription.status) ? subscription.status : 'disabled';
}
