import { KingdomIdSchema, PersonIdSchema, type KingdomId, type PersonId } from '@chatdom/shared';
import { createTwitchMomentIngest, type CitizenDisclosure, type IngestStatus, type TwitchMomentIngest } from '../../../herald/src/twitch-moments';
import { createLocalProviderTransport, eventSubFrame } from '../../../herald/src/twitch-moments/local-transport';
import { createMemoryMomentRecords } from '../../../herald/src/twitch-moments/memory';
import type { TwitchMomentFeed } from '../twitch-moments';
import { createSimulatedBattleAuthority, type BattleOutcome } from './battle-authority';

/** A simulated channel ID: not a real Twitch account, labelled SIMULATED wherever it is shown. */
export const BENCH_KINGDOM = KingdomIdSchema.parse('424242');
const BENCH_HAMLET = BENCH_KINGDOM;
/** The simulated chat reader the notification subscription is conditioned on. */
const BENCH_READER = PersonIdSchema.parse('90999');

export interface BenchCitizen {
  readonly id: PersonId;
  readonly name: string;
  /** Null for a named citizen who has no home yet: their gifts are welcomed at the gate. */
  readonly slot: number | null;
  readonly disclosure: 'named' | 'anonymous';
}

export type BenchDelivery = 'subscribe' | 'repeat' | 'late' | 'wrong-channel' | 'resub' | 'tier-2' | 'tier-3' | 'lapse' | 'rejoin';

/**
 * The SIMULATED pipeline. Synthetic EventSub frames enter the real Herald ingest through a local transport,
 * are claimed and mapped through the in-memory record port and the citizen directory, and leave through the same
 * public feed adapter a production binding uses. Chat notices are the canonical support source, as they are
 * whenever a reader is authorized; `channel.subscription.end` reports lapses. Nothing forges a browser success.
 */
export function createBenchSimulation(citizens: readonly BenchCitizen[], clock: { now(): number },
  options: { battle: 'simulated' | 'unbound'; outcome: () => BattleOutcome; kingdomId?: KingdomId } = { battle: 'simulated', outcome: () => 'victory' }) {
  // The channel the frames are addressed to: the bench hamlet's, or the fixture kingdom a real scene renders.
  const BENCH_KINGDOM = options.kingdomId ?? BENCH_HAMLET;
  const records = createMemoryMomentRecords(clock), local = createLocalProviderTransport();
  // The realm's battle authority is SIMULATED here; with 'unbound' no battle can be requested at all.
  const authority = options.battle === 'simulated'
    ? createSimulatedBattleAuthority({ kingdomId: BENCH_KINGDOM, clock, observe: (state): unknown => ingest.observeBattle(state), outcome: options.outcome }) : null;
  const people = new Map<PersonId, CitizenDisclosure>(citizens.map(c => [c.id, c.disclosure === 'named'
    ? { disclosure: 'named', displayName: c.name, homeSlot: c.slot } : { disclosure: 'anonymous' }]));
  let generation = 0, messages = 0, lastFrame: string | null = null;
  const make = (): TwitchMomentIngest => createTwitchMomentIngest({ kingdomId: BENCH_KINGDOM, origin: 'simulated', epochPrefix: `bench${generation}`, moderatorId: null, readerId: BENCH_READER,
    authorized: new Set(['moments.chat-notices', 'moments.subscriptions', 'moments.bits', 'moments.hype']), transport: local.transport, records: records.port,
    directory: { resolve: async (kingdom, id) => (kingdom === BENCH_KINGDOM ? people.get(id) ?? null : null) }, clock, battle: authority?.port ?? null });
  let ingest: TwitchMomentIngest = make();
  const listeners = new Set<{ reset: Parameters<TwitchMomentFeed['subscribe']>[0]; receive: Parameters<TwitchMomentFeed['subscribe']>[1]; unavailable: () => void; stop: () => void }>();
  // A stable feed for the bench, re-subscribed to whichever ingest is current.
  const feed: TwitchMomentFeed = {
    origin: 'simulated',
    subscribe(reset, receive, unavailable) {
      const entry = { reset, receive, unavailable, stop: ingest.feed.subscribe(reset, receive, unavailable) };
      listeners.add(entry);
      return () => { entry.stop(); listeners.delete(entry); };
    },
  };
  const rewire = () => { for (const entry of listeners) { entry.stop(); entry.stop = ingest.feed.subscribe(entry.reset, entry.receive, entry.unavailable); } };

  const NULLS = Object.fromEntries(['sub', 'resub', 'sub_gift', 'community_sub_gift', 'gift_paid_upgrade', 'prime_paid_upgrade', 'pay_it_forward'].map(k => [k, null]));
  /** A `channel.chat.notification` in Twitch's wire shape; the ingest reads only the support fields it needs. */
  function notice(at: number, chatter: BenchCitizen | 'anonymous', type: string, detail: object, options: { messageId?: string; broadcaster?: string } = {}): string {
    const anonymous = chatter === 'anonymous';
    return eventSubFrame({ messageId: `bench-${generation}-${++messages}`, at, type: 'channel.chat.notification', version: '1',
      condition: { broadcaster_user_id: BENCH_KINGDOM, user_id: BENCH_READER },
      event: { broadcaster_user_id: options.broadcaster ?? BENCH_KINGDOM, broadcaster_user_login: 'willowmere', broadcaster_user_name: 'Willowmere',
        chatter_user_id: anonymous ? '274598607' : chatter.id, chatter_user_login: anonymous ? 'ananonymousgifter' : `citizen${chatter.id}`,
        chatter_user_name: anonymous ? 'AnAnonymousGifter' : chatter.name, chatter_is_anonymous: anonymous, color: '#c9a96a', badges: [],
        system_message: '', message_id: options.messageId ?? `notice-${generation}-${messages}`, message: { text: '', fragments: [] },
        notice_type: type, ...NULLS, [type]: detail, source_broadcaster_user_id: null, source_message_id: null, source_badges: null } });
  }
  const sub = (tier: string) => ({ sub_tier: tier, is_prime: false, duration_months: 1 });
  const lapse = (citizen: BenchCitizen, at: number) => eventSubFrame({ messageId: `bench-${generation}-${++messages}`, at, type: 'channel.subscription.end', version: '1',
    condition: { broadcaster_user_id: BENCH_KINGDOM }, event: { user_id: citizen.id, user_login: `citizen${citizen.id}`, user_name: citizen.name,
      broadcaster_user_id: BENCH_KINGDOM, broadcaster_user_login: 'willowmere', broadcaster_user_name: 'Willowmere', tier: '1000', is_gift: false } });
  const gift = (recipient: BenchCitizen, community: string | null, tier: string) => ({ duration_months: 1, cumulative_total: 1, recipient_user_id: recipient.id,
    recipient_user_name: recipient.name, recipient_user_login: `citizen${recipient.id}`, sub_tier: tier, community_gift_id: community });

  const send = (text: string) => { lastFrame = text; return local.deliver(text); };

  const broadcaster = { broadcaster_user_id: BENCH_KINGDOM, broadcaster_user_login: 'willowmere', broadcaster_user_name: 'Willowmere' };
  /** Twitch's stand-in account for an anonymous cheer. */
  const payer = (who: BenchCitizen | 'anonymous') => who === 'anonymous'
    ? { user_id: '407665396', user_login: 'ananonymouscheerer', user_name: 'AnAnonymousCheerer' }
    : { user_id: who.id, user_login: `citizen${who.id}`, user_name: who.name };
  const bitsUse = (who: BenchCitizen | 'anonymous', bits: number, type: 'cheer' | 'power_up' | 'custom_power_up', extra: object) =>
    eventSubFrame({ messageId: `bench-${generation}-${++messages}`, at: clock.now(), type: 'channel.bits.use', version: '1', condition: { broadcaster_user_id: BENCH_KINGDOM },
      event: { ...broadcaster, ...payer(who), bits, type, message: { text: '', fragments: [] }, power_up: null, custom_power_up: null, ...extra } });
  const iso = (ms: number) => new Date(ms).toISOString();
  let train: { id: string; startedAt: number; level: number; total: number } | null = null;
  const hypeFrame = (phase: 'begin' | 'progress' | 'end', contributors: readonly BenchCitizen[], golden: boolean) => {
    const t = train!, now = clock.now();
    const common = { ...broadcaster, id: t.id, total: t.total, level: t.level, started_at: iso(t.startedAt), type: golden ? 'golden_kappa' : 'regular', is_shared_train: false,
      shared_train_participants: null, top_contributions: contributors.map(c => ({ user_id: c.id, user_login: `citizen${c.id}`, user_name: c.name, type: 'bits', total: 500 })) };
    const running = { ...common, progress: 120 + t.level * 40, goal: 600 + t.level * 200, expires_at: iso(now + 300_000) };
    const event = phase === 'begin' ? { ...running, all_time_high_level: 6, all_time_high_total: 9000 } : phase === 'progress' ? running
      : { ...common, ended_at: iso(now), cooldown_ends_at: iso(now + 3_600_000) };
    return eventSubFrame({ messageId: `bench-${generation}-${++messages}`, at: now, type: `channel.hype_train.${phase}`, version: '2',
      condition: { broadcaster_user_id: BENCH_KINGDOM }, event });
  };

  return {
    feed,
    start(): IngestStatus { const status = ingest.start(); rewire(); return status; },
    deliver(kind: BenchDelivery, citizen: BenchCitizen): boolean {
      const now = clock.now();
      switch (kind) {
        case 'repeat': return lastFrame !== null && local.deliver(lastFrame);
        case 'late': return send(notice(now - 240_000, citizen, 'sub', sub('1000')));
        case 'wrong-channel': return send(notice(now, citizen, 'sub', sub('1000'), { broadcaster: '777' }));
        case 'resub': return send(notice(now, citizen, 'resub', { cumulative_months: 7, duration_months: 1, streak_months: null, sub_tier: '1000', is_prime: false, is_gift: false }));
        case 'tier-2': return send(notice(now, citizen, 'sub', sub('2000')));
        case 'tier-3': return send(notice(now, citizen, 'sub', sub('3000')));
        case 'lapse': return send(lapse(citizen, now));
        case 'subscribe': case 'rejoin': return send(notice(now, citizen, 'sub', sub('1000')));
      }
    },
    /** One gifted sub from a giver (or anonymously), optionally paid forward from someone who once gifted them. */
    giftOne(giver: BenchCitizen | 'anonymous', recipient: BenchCitizen, forwardFrom: { id: PersonId; name: string } | null = null): boolean {
      const now = clock.now();
      if (forwardFrom && giver !== 'anonymous') send(notice(now, giver, 'pay_it_forward', { gifter_is_anonymous: false, gifter_user_id: forwardFrom.id, gifter_user_name: forwardFrom.name }));
      return send(notice(now + 150, giver, 'sub_gift', gift(recipient, null, '1000')));
    },
    /**
     * A community gift: the aggregate, then the recipient notices Twitch disclosed (possibly fewer than the total).
     * The ingest coalesces them under the provider's own community gift ID.
     */
    giftGroup(giver: BenchCitizen | 'anonymous', total: number, recipients: readonly BenchCitizen[], tier = '1000'): boolean {
      const now = clock.now(), id = `community-${generation}-${++messages}`;
      const ok = send(notice(now, giver, 'community_sub_gift', { id, total, sub_tier: tier, cumulative_total: null }));
      recipients.forEach((r, i) => send(notice(now + 40 * (i + 1), giver, 'sub_gift', gift(r, id, tier))));
      return ok;
    },
    /** A cheer of `bits` through `channel.bits.use`: the sky answers by the kingdom's ladder. */
    cheer(who: BenchCitizen | 'anonymous', bits: number): boolean { return send(bitsUse(who, bits, 'cheer', {})); },
    /** A Twitch Power-up: a celebration, a message effect or a gigantified emote (whose approval is the bench's emote lookup). */
    powerUp(who: BenchCitizen | 'anonymous', kind: 'celebration' | 'message_effect' | 'gigantify_an_emote', emote: { id: string; name: string } | null = null): boolean {
      return send(bitsUse(who, kind === 'celebration' ? 50 : 30, 'power_up', { power_up: { type: kind, emote, message_effect_id: kind === 'message_effect' ? 'cosmic' : null } }));
    },
    /** One Hype Train report. `begin` starts a fresh train; `progress` moves it to `level`; `end` closes it. */
    hype(phase: 'begin' | 'progress' | 'end', level: number, contributors: readonly BenchCitizen[], golden = false): boolean {
      if (phase === 'begin' || !train) train = { id: `simtrain-${generation}-${++messages}`, startedAt: clock.now(), level: 1, total: 0 };
      train = { ...train, level: Math.max(train.level, level), total: train.total + 400 * level };
      return send(hypeFrame(phase, contributors, golden));
    },
    /** The SIMULATED realm battle authority, or null when no battle port is bound. */
    authority,
    /** The source drops, as a lost conduit shard would; listeners become unavailable and keep known homes. */
    disconnect() { local.lose('disconnected'); },
    /** A new source session: a fresh epoch and a non-animating reset from the records. */
    restartSource(): IngestStatus { ingest.stop(); generation++; ingest = make(); const status = ingest.start(); rewire(); return status; },
    status: () => ingest.status(),
    settled: () => ingest.settled(),
    stop() { ingest.stop(); },
  };
}
export type BenchSimulation = ReturnType<typeof createBenchSimulation>;

export const benchPerson = (n: number) => PersonIdSchema.parse(String(90_000 + n));
