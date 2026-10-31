import type { KingdomId, PersonId } from '@chatdom/shared';

/**
 * Exact EventSub subscriptions per support family, checked against the EventSub catalogue on 2026-10-30.
 * A capability key names what main's verified grant system must currently authorize. This module never reads
 * grants or provisions anything; it only declares what it can consume. Online/offline/chat/delete/clear/revoke
 * stay with Herald H03, and incoming raids come from existing Atlas/Gate evidence.
 */
export const MOMENT_CAPABILITIES = ['moments.chat-notices', 'moments.follows', 'moments.subscriptions', 'moments.bits', 'moments.redemptions',
  'moments.hype', 'moments.goals', 'moments.polls', 'moments.predictions', 'moments.shared-chat', 'moments.shoutouts', 'moments.ads',
  'moments.channel', 'moments.offices', 'moments.charity'] as const;
export type MomentCapability = typeof MOMENT_CAPABILITIES[number];

export type ConditionRole = 'broadcaster' | 'moderator' | 'reader';
export interface CatalogueEntry { readonly type: string; readonly version: string; readonly condition: readonly ConditionRole[] }

const b = (type: string, version = '1'): CatalogueEntry => ({ type, version, condition: ['broadcaster'] });
export const MOMENT_SUBSCRIPTIONS: Readonly<Record<MomentCapability, readonly CatalogueEntry[]>> = {
  'moments.chat-notices': [{ type: 'channel.chat.notification', version: '1', condition: ['broadcaster', 'reader'] }],
  'moments.follows': [{ type: 'channel.follow', version: '2', condition: ['broadcaster', 'moderator'] }],
  'moments.subscriptions': [b('channel.subscribe'), b('channel.subscription.end'), b('channel.subscription.gift'), b('channel.subscription.message')],
  'moments.bits': [b('channel.bits.use')],
  'moments.redemptions': [b('channel.channel_points_custom_reward_redemption.add'), b('channel.channel_points_custom_reward_redemption.update')],
  'moments.hype': [b('channel.hype_train.begin', '2'), b('channel.hype_train.progress', '2'), b('channel.hype_train.end', '2')],
  'moments.goals': [b('channel.goal.begin'), b('channel.goal.progress'), b('channel.goal.end')],
  'moments.polls': [b('channel.poll.begin'), b('channel.poll.progress'), b('channel.poll.end')],
  'moments.predictions': [b('channel.prediction.begin'), b('channel.prediction.progress'), b('channel.prediction.lock'), b('channel.prediction.end')],
  'moments.shared-chat': [b('channel.shared_chat.begin'), b('channel.shared_chat.update'), b('channel.shared_chat.end')],
  'moments.shoutouts': [{ type: 'channel.shoutout.create', version: '1', condition: ['broadcaster', 'moderator'] },
    { type: 'channel.shoutout.receive', version: '1', condition: ['broadcaster', 'moderator'] }],
  'moments.ads': [b('channel.ad_break.begin')],
  'moments.channel': [b('channel.update', '2')],
  'moments.offices': [b('channel.moderator.add'), b('channel.moderator.remove'), b('channel.vip.add'), b('channel.vip.remove')],
  'moments.charity': [b('channel.charity_campaign.start'), b('channel.charity_campaign.progress'), b('channel.charity_campaign.stop'),
    b('channel.charity_campaign.donate')],
};

const CONDITION_FIELD: Readonly<Record<ConditionRole, string>> = { broadcaster: 'broadcaster_user_id', moderator: 'moderator_user_id', reader: 'user_id' };

export interface SubscriptionPlanEntry {
  readonly capability: MomentCapability;
  readonly type: string;
  readonly version: string;
  /** Exact condition object sent to and expected back from Twitch. */
  readonly condition: Readonly<Record<string, string>>;
}
export type SubscriptionPlan = readonly SubscriptionPlanEntry[];

export interface PlanAccounts {
  readonly kingdomId: KingdomId;
  /** The moderator identity for follow/shoutout conditions; null leaves those families out. */
  readonly moderatorId: PersonId | null;
  /** The chat reader for notification conditions; null leaves chat notices out. */
  readonly readerId: PersonId | null;
}

/** Which source celebrates support acts: chat notices, the structured subscription family, or neither. */
export type SupportSource = 'notices' | 'structured' | null;

const NOTICES = 'channel.chat.notification@1';
/** Structured entries that would celebrate the same act a chat notice already celebrates. */
const STRUCTURED_SUPPORT: ReadonlySet<string> = new Set(['channel.subscribe@1', 'channel.subscription.gift@1', 'channel.subscription.message@1']);
const LAPSE = 'channel.subscription.end@1';
const id = (entry: { type: string; version: string }) => `${entry.type}@${entry.version}`;

export interface PlannedSubscriptions {
  readonly plan: SubscriptionPlan;
  readonly unavailable: readonly MomentCapability[];
  readonly support: SupportSource;
  /** True only when `channel.subscription.end` is not planned: then a missing subscriber badge is the lapse signal. */
  readonly lapseFromBadges: boolean;
}

/**
 * The plan contains only families that are currently authorized *and* that this ingest can normalize.
 * Anything else is reported back as unavailable, never subscribed and dropped.
 *
 * Exactly one source celebrates support. When chat notices are planned they are canonical, and the structured
 * subscribe/gift/message entries are left out entirely, so one act can never celebrate twice. `end` stays when
 * authorized because no notice reports a lapse. Each start is a fresh epoch, so a source change is a reset.
 */
export function planSubscriptions(accounts: PlanAccounts, authorized: ReadonlySet<MomentCapability>, normalized: ReadonlySet<string>): PlannedSubscriptions {
  const planned: SubscriptionPlanEntry[] = [], unavailable: MomentCapability[] = [];
  for (const capability of MOMENT_CAPABILITIES) {
    if (!authorized.has(capability)) { unavailable.push(capability); continue; }
    for (const entry of MOMENT_SUBSCRIPTIONS[capability]) {
      if (!normalized.has(id(entry))) continue;
      const ids: Record<ConditionRole, string | null> = { broadcaster: accounts.kingdomId, moderator: accounts.moderatorId, reader: accounts.readerId };
      if (entry.condition.some(role => ids[role] === null)) { if (!unavailable.includes(capability)) unavailable.push(capability); continue; }
      planned.push({ capability, type: entry.type, version: entry.version,
        condition: Object.fromEntries(entry.condition.map(role => [CONDITION_FIELD[role], ids[role]!])) });
    }
  }
  const notices = planned.some(e => id(e) === NOTICES);
  const plan = notices ? planned.filter(e => !STRUCTURED_SUPPORT.has(id(e))) : planned;
  const support: SupportSource = notices ? 'notices' : plan.some(e => STRUCTURED_SUPPORT.has(id(e))) ? 'structured' : null;
  return { plan, unavailable, support, lapseFromBadges: !plan.some(e => id(e) === LAPSE) };
}

export function sameCondition(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && a[key] === b[key]);
}
