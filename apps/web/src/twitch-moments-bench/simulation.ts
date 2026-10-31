import { KingdomIdSchema, PersonIdSchema, type PersonId } from '@chatdom/shared';
import { createTwitchMomentIngest, type CitizenDisclosure, type IngestStatus } from '../../../herald/src/twitch-moments';
import { createLocalProviderTransport, eventSubFrame } from '../../../herald/src/twitch-moments/local-transport';
import { createMemoryMomentRecords } from '../../../herald/src/twitch-moments/memory';
import type { TwitchMomentFeed } from '../twitch-moments';

/** A simulated channel ID: not a real Twitch account, labelled SIMULATED wherever it is shown. */
export const BENCH_KINGDOM = KingdomIdSchema.parse('424242');
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
export function createBenchSimulation(citizens: readonly BenchCitizen[], clock: { now(): number }) {
  const records = createMemoryMomentRecords(clock), local = createLocalProviderTransport();
  const people = new Map<PersonId, CitizenDisclosure>(citizens.map(c => [c.id, c.disclosure === 'named'
    ? { disclosure: 'named', displayName: c.name, homeSlot: c.slot } : { disclosure: 'anonymous' }]));
  let generation = 0, messages = 0, lastFrame: string | null = null;
  const make = () => createTwitchMomentIngest({ kingdomId: BENCH_KINGDOM, origin: 'simulated', epochPrefix: `bench${generation}`, moderatorId: null, readerId: BENCH_READER,
    authorized: new Set(['moments.chat-notices', 'moments.subscriptions']), transport: local.transport, records: records.port,
    directory: { resolve: async (kingdom, id) => (kingdom === BENCH_KINGDOM ? people.get(id) ?? null : null) }, clock });
  let ingest = make();
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
