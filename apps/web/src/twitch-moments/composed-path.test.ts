import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type PersonId } from '@chatdom/shared';
import type { TwitchMomentFact } from '@chatdom/shared/twitch-moments';
import { ChatIngest } from '../../../herald/src/ingest/ingest';
import { planSubscriptions } from '../../../herald/src/ingest/subscriptions';
import { RealmDelivery } from '../../../herald/src/realm-delivery/delivery';
import { MemoryBindingStore } from '../../../herald/src/source/bindings';
import { PresenceSource } from '../../../herald/src/source/source';
import type { CitizenDisclosure } from '../../../herald/src/twitch-moments/ports';
import { createRoomMomentFeed } from '../realm/adapters/moments';
import { observeRealm } from '../realm/adapters/observer';
import { createSimulatedRealmRelay } from '../twitch-moments-bench/relay';
import { createTwitchMoments, type MomentFrame } from './controller';

/**
 * The composed support path as main binds it: an EventSub notification frame enters Herald's actual `ChatIngest`
 * (conduit/plan verification, delivery-ID dedupe, the lane's chat-notice parser), is written to Herald's actual
 * durable `RealmDelivery` outbox and posted with its retries; the realm's held writer is the SIMULATED in-process
 * relay (main's writer needs Postgres); committed rows reach the actual browser `observeRealm` and
 * `createRoomMomentFeed`, and the lane's controller stages them. Everything here is SIMULATED; no Twitch call is made.
 */
const KINGDOM = KingdomIdSchema.parse('424242');
const READER = PersonIdSchema.parse('9100');
const JUNIPER = PersonIdSchema.parse('9001'), ROWAN = PersonIdSchema.parse('9003');
const START = Date.UTC(2026, 9, 31, 19, 30);
const SECRET = 'simulated-service-secret-000000000000';
const people = new Map<PersonId, CitizenDisclosure>([
  [JUNIPER, { disclosure: 'named', displayName: 'Juniper', homeSlot: 3 }],
  [ROWAN, { disclosure: 'named', displayName: 'Rowan', homeSlot: 5 }],
]);
const NULLS = Object.fromEntries(['sub', 'resub', 'sub_gift', 'community_sub_gift', 'gift_paid_upgrade', 'prime_paid_upgrade', 'pay_it_forward'].map(k => [k, null]));
const PRIVATE = ['274598607', 'AnAnonymousGifter', 'SECRET CHAT TEXT', 'SECRET SYSTEM TEXT', 'chatter_user_id', 'loginanon'];

/** A `channel.chat.notification` v1 body in Twitch's wire shape, with the private fields that must never cross. */
function notice(chatter: PersonId | 'anon', type: string, detail: object) {
  const anon = chatter === 'anon';
  return { broadcaster_user_id: KINGDOM, broadcaster_user_login: 'kingdom', broadcaster_user_name: 'Kingdom',
    chatter_user_id: anon ? '274598607' : chatter, chatter_user_login: anon ? 'loginanon' : `login${chatter}`,
    chatter_user_name: anon ? 'AnAnonymousGifter' : `Provider${chatter}`, chatter_is_anonymous: anon, color: '#ff0000', badges: [],
    system_message: 'SECRET SYSTEM TEXT', message_id: `notice-${type}-${chatter}`, message: { text: 'SECRET CHAT TEXT', fragments: [] },
    notice_type: type, ...NULLS, [type]: detail, source_broadcaster_user_id: null, source_message_id: null, source_badges: null };
}
const giftTo = (to: PersonId, community: string) => ({ duration_months: 1, cumulative_total: 42, recipient_user_id: to,
  recipient_user_name: `Provider${to}`, recipient_user_login: `login${to}`, sub_tier: '1000', community_gift_id: community });

interface Viewer {
  readonly observer: ReturnType<typeof observeRealm>;
  readonly moments: ReturnType<typeof createTwitchMoments>;
  readonly facts: TwitchMomentFact[];
  readonly resets: { throughSeq: number; current: number }[];
  close(): void;
}

/** Herald, the relay and as many browser observers as a test asks for, sharing one kingdom clock. */
async function composed(options: { readonly relayOrigin?: 'live' | 'simulated' } = {}) {
  let now = START;
  const clock = { now: () => now };
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-moments-composed-'));
  const relay = createSimulatedRealmRelay({ kingdomId: KINGDOM, origin: options.relayOrigin ?? 'simulated', clock,
    directory: { resolve: async (kingdom, id) => (kingdom === KINGDOM ? people.get(id) ?? null : null) },
    layoutRevision: 'SIMULATED-layout', collisionRevision: 1 });
  const attempts: { status: number | 'lost'; id: string; at: number }[] = [];
  // The wire between Herald and the realm. Each attempt costs kingdom time, as a real backoff would.
  const request: typeof fetch = async (url, init) => {
    expect(new URL(String(url)).pathname).toBe('/internal/realm/ingress');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${SECRET}`);
    const envelope = JSON.parse(String(init?.body)) as { version: 1; support: { id: string } };
    now += 1_500;
    try {
      const reply = await relay.accept(envelope.support);
      attempts.push({ status: reply.http, id: envelope.support.id, at: now });
      return Response.json(reply.body, { status: reply.http });
    } catch (error) { attempts.push({ status: 'lost', id: envelope.support.id, at: now }); throw error; }
  };
  const sender = await RealmDelivery.open({ url: 'http://127.0.0.1:5191', secret: SECRET, directory, origin: 'simulated', fetch: request, now: clock.now, retryMs: 5 });
  const source = new PresenceSource({ kingdomId: KINGDOM, origin: 'simulated', slots: [], store: new MemoryBindingStore(), now: clock.now, tickMs: 0 });
  const plans = planSubscriptions({ broadcasterId: KINGDOM, readerId: READER, clientId: 'simulated-client' });
  const plan = plans.find(p => p.type === 'channel.chat.notification')!;
  const ingest = new ChatIngest({ source, conduitId: 'simulated-conduit', clientId: 'simulated-client', plans, realm: sender,
    covered: () => true, onAuthorizationRevoked: () => {}, onSubscriptionRevoked: () => {}, now: clock.now });
  /** One EventSub delivery. Twitch may send the same message ID again; `at` is Twitch's own message timestamp. */
  const deliver = (messageId: string, event: object, at = now) => ingest.handle({ kind: 'notification', meta: { messageId, at },
    subscription: { id: 'simulated-subscription', status: 'enabled', type: plan.type, version: plan.version, condition: plan.condition, conduitId: 'simulated-conduit' }, event });

  const viewers: Viewer[] = [];
  /** A browser on the kingdom: the actual observer and room feed, into the lane's controller. */
  function viewer(expect: 'live' | 'simulated' = 'simulated'): Viewer {
    const room = relay.room();
    const observer = observeRealm(room, { kingdomId: KINGDOM, origin: expect, collisionRevision: 1, layoutRevision: 'SIMULATED-layout' });
    const moments = createTwitchMoments({ kingdomId: KINGDOM, expectedOrigin: expect, clock });
    moments.setPresentation({ layout: 'stage', mood: 'show', busy: false, visible: true, safeRects: [], autoOpenKinds: [] });
    const facts: TwitchMomentFact[] = [], resets: { throughSeq: number; current: number }[] = [];
    const offRecord = observer.subscribe({ moment: fact => facts.push(fact) });
    const feed = createRoomMomentFeed(observer, expect, clock.now);
    const offTap = feed.subscribe(info => resets.push({ throughSeq: info.throughSeq, current: info.current.length }), () => {}, () => {});
    const disconnect = moments.connect(feed);
    const entry = { observer, moments, facts, resets, close() { disconnect(); offTap(); offRecord(); observer.dispose(); room.close(); moments.dispose(); } };
    viewers.push(entry);
    return entry;
  }
  const ready = (v: Viewer) => vi.waitFor(() => expect(v.observer.current().status).toBe('ready'));
  return {
    relay, sender, ingest, deliver, viewer, ready, attempts, directory, clock, advance: (ms: number) => { now += ms; },
    async close() { for (const v of viewers) v.close(); ingest.dispose(); await source.close(); await sender.close(); await rm(directory, { recursive: true, force: true }); },
  };
}

/** Every audio cue and cart the controller stages over a beat, sampled as a renderer would (every 50 ms). */
function watch(moments: ReturnType<typeof createTwitchMoments>, from: number, ms: number) {
  const cues = new Map<string, number>(), names = new Map<string, string>(), carts = new Set<string>(), labels = new Set<MomentFrame['label']>(), captions = new Set<string>();
  for (let at = from; at <= from + ms; at += 50) {
    const frame = moments.sample(at);
    labels.add(frame.label);
    for (const cue of frame.audio) { cues.set(cue.id, cue.atMs); names.set(cue.id, cue.cue); }
    for (const cart of frame.carts) carts.add(cart.id);
    for (const caption of frame.captions) captions.add(`${caption.title} · ${caption.line}`);
  }
  return { cues: [...cues.keys()], sounds: [...names.values()], carts: [...carts], labels: [...labels], captions: [...captions] };
}

let open: Awaited<ReturnType<typeof composed>> | null = null;
afterEach(async () => { await open?.close(); open = null; });

describe('the composed support path (SIMULATED)', () => {
  it('carries one gift through redelivery, an outage, a crash and a lost reply, and stages it once with its Twitch cause', async () => {
    const path = open = await composed();
    const first = path.viewer(), second = path.viewer();
    await path.ready(first); await path.ready(second);
    expect(first.resets).toEqual([{ throughSeq: 0, current: 0 }]);

    // The realm is down, then its commit crashes, then it commits and the answer is lost on the way back.
    path.relay.fail('down', 'crash', 'lose-reply');
    const twitchAt = START - 400;
    path.deliver('eventsub-aggregate', notice('anon', 'community_sub_gift', { id: 'SIMULATED-group', total: 3, sub_tier: '1000', cumulative_total: null }), twitchAt);
    // Twitch redelivers the same message: Herald drops it before anything is written.
    path.deliver('eventsub-aggregate', notice('anon', 'community_sub_gift', { id: 'SIMULATED-group', total: 3, sub_tier: '1000', cumulative_total: null }), twitchAt);
    path.deliver('eventsub-recipient', notice('anon', 'sub_gift', giftTo(JUNIPER, 'SIMULATED-group')), twitchAt + 40);
    expect(path.ingest.health().counters).toMatchObject({ duplicateDeliveries: 1 });

    // Herald's durable outbox holds only stripped evidence while the realm cannot answer.
    await vi.waitFor(() => expect(path.attempts.length).toBeGreaterThanOrEqual(1));
    const pending = await Promise.all((await readdir(path.directory)).filter(f => f.endsWith('.json')).map(f => readFile(join(path.directory, f), 'utf8')));
    expect(pending.length).toBeGreaterThanOrEqual(1);
    for (const secret of PRIVATE) expect(pending.join('')).not.toContain(secret);

    await vi.waitFor(() => expect(path.sender.health().pending).toBe(0), { timeout: 3_000 });
    // Every attempt carried the same evidence ID; the resend after the lost reply is a duplicate, never a second commit.
    expect(path.attempts.map(a => [a.id, a.status])).toEqual([
      ['eventsub-aggregate', 503], ['eventsub-aggregate', 503], ['eventsub-aggregate', 'lost'], ['eventsub-aggregate', 202], ['eventsub-recipient', 202],
    ]);
    expect(path.relay.log().map(l => l.outcome)).toEqual(['unavailable', 'unavailable', 'reply-lost', 'duplicate', 'accepted']);
    expect(path.sender.health().counters).toMatchObject({ accepted: 2, delivered: 2, retries: 3 });

    const rows = path.relay.rows();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // A reconnecting dispatcher may send a row twice; observers apply it once.
    path.relay.redeliver();
    for (const v of [first, second]) expect(v.facts.map(f => f.seq)).toEqual(rows.map(r => (r.message as { fact: TwitchMomentFact }).fact.seq));
    expect(first.facts).toEqual(second.facts);

    // Truthful identity: Twitch's own message is the cause, Twitch's time is when it happened, the retries only
    // moved when the realm committed it. The giver stays a friend of the realm; no private field survived.
    const [aggregate] = first.facts;
    expect(aggregate).toMatchObject({ origin: 'simulated', actor: null, occurredAt: twitchAt, receivedAt: START,
      cause: { kind: 'external', source: 'twitch.eventsub', id: 'eventsub-aggregate' }, body: { kind: 'gifts', giver: null, total: 3 } });
    expect(aggregate!.committedAt).toBe(path.attempts[2]!.at);
    expect(first.facts.at(-1)!.cause).toEqual({ kind: 'external', source: 'twitch.eventsub', id: 'eventsub-recipient' });
    const published = JSON.stringify(rows);
    for (const secret of PRIVATE) expect(published).not.toContain(secret);

    // The lane's controller staged that one gift once, labelled SIMULATED, naming the home it reached.
    const metrics = first.moments.metrics();
    // Aggregate, Juniper's own home quietly gaining the gifted sub, then the parcel's recipient joining the same cart.
    expect(first.facts.map(f => f.body.kind)).toEqual(['gifts', 'subscription', 'gifts']);
    expect(metrics.admitted).toBe(1);
    expect(metrics.suppressed).toMatchObject({ coalesced: 1, expired: 1 });
    expect(metrics.rejected).toMatchObject({ replay: 0, origin: 0, epoch: 0 });
    const seen = watch(first.moments, path.clock.now(), 20_000);
    expect(seen.labels).toEqual(['SIMULATED']);
    // One cart for the group (keyed by the first fact), one parcel landing at Juniper's, no crowd (no presence here).
    expect(seen.carts).toEqual(['gifts.cg.SIMULATED-group@1']);
    expect(seen.sounds).toEqual(['cart-roll', 'gift-bell', 'cart-roll', 'parcel-land']);
    expect(new Set(seen.cues).size).toBe(seen.cues.length);
    expect(seen.captions.some(c => c.includes('Juniper'))).toBe(true);
    expect(seen.captions.some(c => /friend of the realm/i.test(c))).toBe(true);
    expect(seen.captions.join(' ')).not.toMatch(/AnAnonymousGifter|Provider/);
  });

  it('lets evidence that waited out a long outage land as lasting state without pretending it just happened', async () => {
    const path = open = await composed();
    const v = path.viewer();
    await path.ready(v);
    // The realm stays down for six minutes of kingdom time: past the five-minute display window.
    path.relay.outage(true);
    path.deliver('eventsub-sub', notice(JUNIPER, 'sub', { sub_tier: '1000', is_prime: false, duration_months: 1 }));
    await vi.waitFor(() => expect(path.attempts.length).toBeGreaterThanOrEqual(2));
    path.advance(360_000);
    path.relay.outage(false);
    await vi.waitFor(() => expect(path.sender.health().pending).toBe(0), { timeout: 3_000 });
    expect(v.facts).toHaveLength(1);
    expect(v.facts[0]).toMatchObject({ occurredAt: START, cause: { id: 'eventsub-sub' }, body: { kind: 'subscription', credit: { displayName: 'Juniper', slot: 3 } } });
    // The banner is kept (quietly), and nothing unfurls as if the sub happened now.
    expect(v.moments.metrics().suppressed.expired).toBe(1);
    const seen = watch(v.moments, path.clock.now(), 12_000);
    expect(seen.cues).toEqual([]);
    expect(seen.captions).toEqual([]);
    expect(v.moments.sample(path.clock.now()).homes.map(h => h.slot)).toEqual([3]);
  });

  it('restores a returning viewer and a writer takeover quietly, and never lets simulated evidence pass as live', async () => {
    const path = open = await composed();
    const early = path.viewer();
    await path.ready(early);
    path.deliver('eventsub-sub', notice(JUNIPER, 'sub', { sub_tier: '1000', is_prime: false, duration_months: 1 }));
    await vi.waitFor(() => expect(path.sender.health().counters.delivered).toBe(1));
    expect(early.facts).toHaveLength(1);

    // A viewer who opens the stream afterwards sees the banner already flying, with no unfurl.
    const late = path.viewer();
    await path.ready(late);
    expect(late.resets).toEqual([{ throughSeq: 1, current: 1 }]);
    expect(late.facts).toEqual([]);
    expect(late.moments.metrics()).toMatchObject({ admitted: 0, restored: 1 });
    expect(watch(late.moments, path.clock.now(), 8_000).cues).toEqual([]);

    // Another process takes the writer lease. The next row carries the new epoch: observers fetch a checkpoint and
    // restore it quietly rather than guess what they missed; later deliveries animate again.
    path.relay.takeover();
    path.advance(10_000);
    path.deliver('eventsub-rowan', notice(ROWAN, 'sub', { sub_tier: '1000', is_prime: false, duration_months: 1 }));
    await vi.waitFor(() => expect(early.resets).toHaveLength(2));
    expect(early.observer.current().writerEpoch).toBe(path.relay.writerEpoch);
    expect(early.resets.at(-1)).toEqual({ throughSeq: 2, current: 2 });
    expect(early.moments.metrics().admitted).toBe(1);
    path.advance(1_000);
    path.deliver('eventsub-juniper-resub', notice(JUNIPER, 'resub', { cumulative_months: 2, duration_months: 1, streak_months: null, sub_tier: '1000', is_prime: false, is_gift: false }));
    await vi.waitFor(() => expect(early.moments.metrics().admitted).toBe(2));
    expect(watch(early.moments, path.clock.now(), 8_000).cues.length).toBeGreaterThan(0);

    // A viewer expecting the live realm drops simulated rows and stays without moments, never a fixture shown as live.
    const strict = path.viewer('live');
    await path.ready(strict);
    expect(strict.observer.current().moments?.current.size).toBe(0);
    expect(strict.moments.metrics().restored).toBe(0);
    path.deliver('eventsub-rowan-resub', notice(ROWAN, 'resub', { cumulative_months: 2, duration_months: 1, streak_months: null, sub_tier: '1000', is_prime: false, is_gift: false }));
    await vi.waitFor(() => expect(early.moments.metrics().admitted).toBe(3));
    expect(strict.facts).toEqual([]);
    expect(watch(strict.moments, path.clock.now(), 8_000).labels).toEqual(['LIVE']);
    expect(watch(strict.moments, path.clock.now(), 8_000).cues).toEqual([]);
    // And a writer that holds a live kingdom answers simulated evidence as unavailable.
    const live = createSimulatedRealmRelay({ kingdomId: KINGDOM, origin: 'live', clock: path.clock, directory: { resolve: async () => null },
      layoutRevision: 'SIMULATED-layout', collisionRevision: 1 });
    expect(await live.accept({ version: 1, id: 'eventsub-x', kingdomId: KINGDOM, origin: 'simulated', occurredAt: START, receivedAt: START,
      notice: { kind: 'entitlement', personId: JUNIPER, act: { kind: 'start', tier: '1' } } })).toMatchObject({ http: 503, body: { status: 'unavailable' } });
    expect(live.rows()).toEqual([]);
  });
});

