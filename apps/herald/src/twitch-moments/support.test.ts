import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type PersonId } from '@chatdom/shared';
import type { TwitchMomentFact } from '../../../web/src/twitch-moments/contracts';
import {
  createTwitchMomentIngest, type CitizenDisclosure, type DragonBattlePort, type DragonSummonRequest, type MomentCapability, type MomentRead, type MomentReadPort,
} from './index';
import { createLocalProviderTransport, eventSubFrame } from './local-transport';
import { createMemoryMomentRecords } from './memory';

const K = KingdomIdSchema.parse('424242');
const p = (id: string) => PersonIdSchema.parse(id);
const GIVER = p('81000001'), JUNI = p('81000002'), QUIET = p('81000003'), STRANGER = p('81000004'), MOSS = p('81000005'),
  PIP = p('81000006'), ORIGIN = p('81000007'), ROW = p('81000008'), PRIMER = p('81000009'), ASH = p('81000010'), READER = p('81000099');
const ALL = [GIVER, JUNI, QUIET, STRANGER, MOSS, PIP, ORIGIN, ROW, PRIMER, ASH];
const people = new Map<PersonId, CitizenDisclosure>([
  [GIVER, { disclosure: 'named', displayName: 'Giver', homeSlot: 2 }],
  [JUNI, { disclosure: 'named', displayName: 'Juniper', homeSlot: 3 }],
  [QUIET, { disclosure: 'anonymous' }],
  [MOSS, { disclosure: 'named', displayName: 'Moss', homeSlot: null }],
  [PIP, { disclosure: 'named', displayName: 'Pip', homeSlot: 6 }],
  [ROW, { disclosure: 'named', displayName: 'Rowan', homeSlot: 8 }],
  [PRIMER, { disclosure: 'named', displayName: 'Primrose', homeSlot: 9 }],
  [ASH, { disclosure: 'named', displayName: 'Ash', homeSlot: 10 }],
]);
const directory = { resolve: async (k: string, id: PersonId) => (k === K ? people.get(id) ?? null : null) };
const START = Date.UTC(2026, 9, 30, 20, 0);

let n = 0;
const NULLS = Object.fromEntries(['sub', 'resub', 'sub_gift', 'community_sub_gift', 'gift_paid_upgrade', 'prime_paid_upgrade', 'pay_it_forward', 'raid',
  'announcement', 'shared_chat_sub'].map(k => [k, null]));
function notice(at: number, chatter: PersonId | 'anon', type: string, detail: object, extra: { messageId?: string; delivery?: string; source?: string } = {}) {
  const id = extra.messageId ?? `notice-${++n}`;
  return eventSubFrame({ messageId: extra.delivery ?? `d-${++n}`, at, type: 'channel.chat.notification', version: '1',
    condition: { broadcaster_user_id: K, user_id: READER },
    event: { broadcaster_user_id: K, broadcaster_user_login: 'kingdom', broadcaster_user_name: 'Kingdom',
      chatter_user_id: chatter === 'anon' ? '274598607' : chatter, chatter_user_login: `login${chatter}`, chatter_user_name: chatter === 'anon' ? 'AnAnonymousGifter' : `Name${chatter}`,
      chatter_is_anonymous: chatter === 'anon', color: '#ff0000', badges: [{ set_id: 'subscriber', id: '12', info: '12' }],
      system_message: 'SECRET SYSTEM TEXT', message_id: id, message: { text: 'SECRET CHAT TEXT', fragments: [{ type: 'text', text: 'SECRET CHAT TEXT' }] },
      notice_type: type, ...NULLS, [type]: detail, source_broadcaster_user_id: extra.source ?? null, source_message_id: null, source_badges: null } });
}
function structured(at: number, type: string, event: object) {
  return eventSubFrame({ messageId: `s-${++n}`, at, type, version: '1', condition: { broadcaster_user_id: K },
    event: { broadcaster_user_id: K, broadcaster_user_login: 'kingdom', broadcaster_user_name: 'Kingdom', ...event } });
}
const user = (id: PersonId) => ({ user_id: id, user_login: `login${id}`, user_name: `Name${id}` });
const subGift = (to: PersonId, name: string, community: string | null, tier = '1000') =>
  ({ duration_months: 1, cumulative_total: 42, recipient_user_id: to, recipient_user_name: name, recipient_user_login: `login${to}`, sub_tier: tier, community_gift_id: community });

function rig(authorized: MomentCapability[], readerId: PersonId | null, ports: { battle?: DragonBattlePort; reads?: MomentReadPort } = {}) {
  let now = START;
  const clock = { now: () => now };
  const memory = createMemoryMomentRecords(clock), local = createLocalProviderTransport();
  const ingest = createTwitchMomentIngest({ kingdomId: K, origin: 'simulated', epochPrefix: 'scratch', moderatorId: null, readerId,
    authorized: new Set(authorized), transport: local.transport, records: memory.port, directory, clock, ...ports });
  const facts: TwitchMomentFact[] = [];
  const status = ingest.start();
  ingest.feed.subscribe(() => undefined, (_e, fact) => facts.push(fact), () => undefined);
  const drainFacts = async () => { await ingest.settled(); for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)); return facts.splice(0); };
  const drain = async () => (await drainFacts()).map(f => f.body);
  /** What a fresh subscriber's reset carries as current public state. */
  const current = () => new Promise<string[]>(resolve => { const stop = ingest.feed.subscribe(info => { stop(); resolve(info.current.map(f => f.body.key)); }, () => undefined, () => resolve([])); });
  return { ingest, local, memory, status, drain, drainFacts, current, advance: (ms: number) => { now += ms; }, now: () => now, all: facts };
}

describe('support sources: chat notices and the structured subscription family', () => {
  it('chat notices: gift groups, forwards, resubs, lapses, upgrades and badges', async () => {
    const r = rig(['moments.chat-notices', 'moments.subscriptions'], READER);
    expect(r.status.support).toBe('notices');
    expect(r.local.plan.map(e => e.type)).toEqual(['channel.chat.notification', 'channel.subscription.end']);
    await r.drain();
    const t = r.now();
    const published: unknown[] = [];
    const drain = async () => { const out = await r.drain(); published.push(...out); return out; };

    // Recipient before aggregate: Juniper's home updates silently, one parcel published under the group.
    r.local.deliver(notice(t, GIVER, 'sub_gift', subGift(JUNI, 'NameJuni', '777'), { messageId: 'm-juni' }));
    let out = await drain();
    expect(out).toEqual([
      expect.objectContaining({ kind: 'subscription', key: 'subscription.home.3', displayUntil: t, active: true, months: 1, sharedNotice: false }),
      { kind: 'gifts', key: 'gifts.cg.777', displayUntil: t + 120_000, groupKey: 'cg.777', giver: { displayName: 'Giver', slot: 2 }, tier: '1', total: 1,
        recipients: [{ noticeKey: 'm-juni', credit: { displayName: 'Juniper', slot: 3 } }], forwardedFrom: null },
    ]);
    // Aggregate later: total rises, same key, window still counted from the group's first time.
    r.local.deliver(notice(t + 1000, GIVER, 'community_sub_gift', { id: '777', total: 5, sub_tier: '1000', cumulative_total: 99 }));
    out = await drain();
    expect(out).toEqual([expect.objectContaining({ key: 'gifts.cg.777', total: 5, displayUntil: t + 120_000 })]);
    // Duplicate recipient notice (new delivery, same notice) and a repeated aggregate change nothing.
    r.local.deliver(notice(t + 1500, GIVER, 'sub_gift', subGift(JUNI, 'NameJuni', '777'), { messageId: 'm-juni' }));
    r.local.deliver(notice(t + 1600, GIVER, 'community_sub_gift', { id: '777', total: 5, sub_tier: '1000' }));
    expect(await drain()).toEqual([]);
    // Non-citizen, quiet and homeless recipients.
    r.local.deliver(notice(t + 2000, GIVER, 'sub_gift', subGift(STRANGER, 'Stranger', '777'), { messageId: 'm-str' }));
    r.local.deliver(notice(t + 2000, GIVER, 'sub_gift', subGift(QUIET, 'QuietName', '777'), { messageId: 'm-quiet' }));
    r.local.deliver(notice(t + 2000, GIVER, 'sub_gift', subGift(MOSS, 'NameMoss', '777'), { messageId: 'm-moss' }));
    out = await drain();
    expect(out.map(b => b.kind)).toEqual(['gifts', 'gifts', 'gifts']);
    expect(out.at(-1)).toMatchObject({ total: 5, recipients: [
      { noticeKey: 'm-juni', credit: { displayName: 'Juniper', slot: 3 } }, { noticeKey: 'm-str', credit: { displayName: 'Stranger', slot: null } },
      { noticeKey: 'm-quiet', credit: null }, { noticeKey: 'm-moss', credit: { displayName: 'Moss', slot: null } }] });

    // Anonymous community gift: no giver, even though the chatter has an account ID.
    r.local.deliver(notice(t + 3000, 'anon', 'community_sub_gift', { id: '888', total: 2, sub_tier: '2000' }));
    r.local.deliver(notice(t + 3000, 'anon', 'sub_gift', subGift(ROW, 'NameRow', '888', '2000'), { messageId: 'm-row' }));
    out = await drain();
    expect(out.find(b => b.kind === 'gifts' && b.recipients.length === 1)).toMatchObject({ groupKey: 'cg.888', giver: null, tier: '2', total: 2 });

    // Pay it forward before its group (exact gifter Pip), then Pip's single gift binds and consumes it.
    r.local.deliver(notice(t + 4000, PIP, 'pay_it_forward', { gifter_is_anonymous: false, gifter_user_id: ORIGIN, gifter_user_name: 'Origin', gifter_user_login: 'origin' }));
    expect(await drain()).toEqual([]);
    r.local.deliver(notice(t + 5000, PIP, 'sub_gift', subGift(ASH, 'NameAsh', null), { messageId: 'm-ash' }));
    out = await drain();
    expect(out.find(b => b.kind === 'gifts')).toMatchObject({ groupKey: 'g.m-ash', total: 1, giver: { displayName: 'Pip', slot: 6 },
      forwardedFrom: { displayName: 'Origin', slot: null } });
    // A second Pip gift does not reuse the consumed forward.
    r.local.deliver(notice(t + 6000, PIP, 'sub_gift', subGift(STRANGER, 'Stranger', null), { messageId: 'm-pip2' }));
    out = await drain();
    expect(out.find(b => b.kind === 'gifts')).toMatchObject({ groupKey: 'g.m-pip2', forwardedFrom: null });

    // Pay it forward after its group: Giver's new community gift republished with the attribution.
    r.advance(100_000);
    const t2 = r.now();
    r.local.deliver(notice(t2, GIVER, 'community_sub_gift', { id: '999', total: 3, sub_tier: '1000' }));
    await drain();
    r.local.deliver(notice(t2 + 2000, GIVER, 'pay_it_forward', { gifter_is_anonymous: false, gifter_user_id: JUNI, gifter_user_name: 'x' }));
    out = await drain();
    expect(out).toEqual([expect.objectContaining({ groupKey: 'cg.999', total: 3, forwardedFrom: { displayName: 'Juniper', slot: 3 } })]);
    // Outside ±30 s, nothing binds; anonymous original gifter keeps nothing.
    r.local.deliver(notice(t2 + 60_000, GIVER, 'pay_it_forward', { gifter_is_anonymous: true, gifter_user_id: null, gifter_user_name: null }));
    expect(await drain()).toEqual([]);

    r.advance(70_000);
    // Shared resub, then an end (lapse, quiet), then a rejoin that celebrates and keeps earned months.
    r.local.deliver(notice(t2 + 61_000, JUNI, 'resub', { cumulative_months: 7, duration_months: 1, streak_months: null, sub_tier: '1000', is_prime: false, is_gift: false }));
    out = await drain();
    expect(out).toEqual([expect.objectContaining({ key: 'subscription.home.3', months: 7, sharedNotice: true, displayUntil: t2 + 61_000 + 120_000 })]);
    r.local.deliver(structured(t2 + 62_000, 'channel.subscription.end', { ...user(JUNI), tier: '1000', is_gift: false }));
    out = await drain();
    expect(out).toEqual([expect.objectContaining({ key: 'subscription.home.3', active: false, months: 7, displayUntil: t2 + 62_000 })]);
    r.local.deliver(structured(t2 + 62_500, 'channel.subscription.end', { ...user(JUNI), tier: '1000', is_gift: false }));
    expect(await drain()).toEqual([]);
    r.local.deliver(notice(t2 + 63_000, JUNI, 'sub', { sub_tier: '1000', is_prime: false, duration_months: 1 }));
    out = await drain();
    expect(out).toEqual([expect.objectContaining({ active: true, months: 7, sharedNotice: false, displayUntil: t2 + 63_000 + 120_000 })]);
    // An older delivery never overrides a newer recorded change.
    r.local.deliver(structured(t2 + 10, 'channel.subscription.end', { ...user(JUNI), tier: '1000', is_gift: false }));
    expect(await drain()).toEqual([]);
    expect(r.ingest.status().counts.stale).toBe(1);

    // Prime sub, then a Prime→paid upgrade to tier 2 celebrates; a gift→paid upgrade celebrates too.
    r.local.deliver(notice(t2 + 64_000, PRIMER, 'sub', { sub_tier: '1000', is_prime: true, duration_months: 1 }));
    r.local.deliver(notice(t2 + 65_000, PRIMER, 'prime_paid_upgrade', { sub_tier: '2000' }));
    r.local.deliver(notice(t2 + 66_000, ROW, 'gift_paid_upgrade', { gifter_is_anonymous: true, gifter_user_id: null, gifter_user_name: null }));
    out = await drain();
    expect(out.map(b => b.kind === 'subscription' && [b.key, b.tier, b.displayUntil - t2]))
      .toEqual([['subscription.home.9', 'prime', 184_000], ['subscription.home.9', '2', 185_000], ['subscription.home.8', '2', 186_000]]);

    // Another channel's notice, a shared-chat twin and a raid never reach the projector.
    const before = r.ingest.status().counts;
    r.local.deliver(notice(t2 + 67_000, ASH, 'sub', { sub_tier: '1000', is_prime: false }, { source: '999999' }));
    r.local.deliver(notice(t2 + 67_000, ASH, 'shared_chat_sub', { sub_tier: '1000', is_prime: false }));
    r.local.deliver(notice(t2 + 67_000, ASH, 'raid', { user_id: '5', user_name: 'x', user_login: 'x', viewer_count: 3, profile_image_url: 'https://x' }));
    expect(await drain()).toEqual([]);
    expect(r.ingest.status().counts.ignored).toBe(before.ignored + 3);
    expect(r.ingest.status().counts.applied).toBe(before.applied);

    // Badges: months rise silently; same badge again changes nothing; an unknown wrong kingdom is refused.
    // `end` is planned here, so a missing badge never lapses anyone.
    const meta = (id: string, person: PersonId, months: number | null, tier: '1' | '2' | '3' | null) => ({ deliveryId: id, kingdomId: K, personId: person,
      displayName: 'whatever', observedAt: r.now(), subscriberBadgeMonths: months, subscriberTier: tier, origin: 'simulated' });
    r.advance(70_000);
    expect(r.ingest.observeChatMetadata(meta('c1', JUNI, 9, '1'))).toBe('accepted');
    out = await drain();
    expect(out).toEqual([expect.objectContaining({ key: 'subscription.home.3', months: 9, sharedNotice: false, active: true })]);
    expect(out[0]!.displayUntil).toBe(r.now());
    r.ingest.observeChatMetadata(meta('c1', JUNI, 9, '1'));
    r.ingest.observeChatMetadata(meta('c2', JUNI, 9, '1'));
    r.ingest.observeChatMetadata(meta('c3', JUNI, null, null));
    expect(await drain()).toEqual([]);
    expect(r.ingest.observeChatMetadata({ ...meta('c4', JUNI, 9, '1'), kingdomId: '1' })).toBe('condition');
    expect(r.ingest.observeChatMetadata({ ...meta('c5', JUNI, 9, '1'), origin: 'live' })).toBe('origin');
    expect(r.ingest.observeChatMetadata({ ...meta('c6', JUNI, 9, '1'), text: 'hi' })).toBe('malformed');
    // A badge with no record starts an active record; a tier-1 badge never turns Prime into tier 1.
    r.ingest.observeChatMetadata(meta('c7', p('81000077'), 4, '1'));
    await drain();
    expect(r.ingest.status().counts).toMatchObject({ duplicate: 1, unchanged: 2 });

    // Wrapping records carry the giver seal and forward; nothing counts or ranks the giver.
    const dump = r.memory.dump(K);
    const wrap = dump.find(([key]) => key === `twitch-moments:wrapping:${ASH}:g.m-ash`)?.[1];
    expect(wrap).toMatchObject({ giver: { displayName: 'Pip', slot: 6 }, forwardedFrom: { displayName: 'Origin', slot: null }, tier: '1' });
    expect(dump.find(([key]) => key === `twitch-moments:wrapping:${MOSS}:cg.777`)).toBeTruthy();
    expect(dump.find(([key]) => key === `twitch-moments:subscriber:${QUIET}`)?.[1]).toMatchObject({ active: true, gifted: true });

    const publicText = JSON.stringify([published, r.all, r.ingest.status()]);
    for (const secret of [...ALL, READER, '274598607', 'login', 'SECRET', 'NameJuni', 'QuietName', 'AnAnonymousGifter', 'cumulative', '#ff0000']) {
      expect(publicText).not.toContain(secret);
    }
    const stored = JSON.stringify(dump);
    for (const secret of ['login', 'SECRET', 'AnAnonymousGifter', '274598607', 'cumulative', '#ff0000', 'badges', 'QuietName', 'NameJuni']) {
      expect(stored, secret).not.toContain(secret);
    }
    // A large community gift: the public list stops at 100, the total and private ledger keep counting.
    for (let i = 0; i < 101; i++) r.local.deliver(notice(r.now(), GIVER, 'sub_gift', subGift(p(String(82000000 + i)), `Guest${i}`, 'big'), { messageId: `big-${i}` }));
    out = await drain();
    const last = out.filter(b => b.kind === 'gifts').at(-1)!;
    expect(last.kind === 'gifts' && [last.recipients.length, last.total]).toEqual([100, 101]);
    const big = dump.length;
    expect(r.memory.dump(K).length).toBeGreaterThan(big + 101);
    expect(r.ingest.status()).toMatchObject({ state: 'running', counts: { record: 0, overflow: 0, malformed: 1 } });
    r.ingest.stop();
  });

  it('structured family: collective wave, no correlation, shared resub, no badge lapse', async () => {
    const r = rig(['moments.subscriptions'], null);
    expect(r.status.support).toBe('structured');
    expect(r.local.plan.map(e => e.type)).toEqual(['channel.subscribe', 'channel.subscription.end', 'channel.subscription.gift', 'channel.subscription.message']);
    const t = r.now();
    r.local.deliver(structured(t, 'channel.subscription.gift', { ...user(GIVER), total: 3, tier: '1000', cumulative_total: 284, is_anonymous: false }));
    r.local.deliver(structured(t, 'channel.subscription.gift', { user_id: null, user_login: null, user_name: null, total: 2, tier: '3000', cumulative_total: null, is_anonymous: true }));
    r.local.deliver(structured(t, 'channel.subscription.gift', { ...user(STRANGER), total: 1, tier: '1000', cumulative_total: 1, is_anonymous: false }));
    r.local.deliver(structured(t, 'channel.subscribe', { ...user(JUNI), tier: '1000', is_gift: true }));
    let out = await r.drain();
    expect(out.filter(b => b.kind === 'gifts')).toEqual([
      expect.objectContaining({ giver: { displayName: 'Giver', slot: 2 }, total: 3, tier: '1', recipients: [], forwardedFrom: null, displayUntil: t + 120_000 }),
      expect.objectContaining({ giver: null, total: 2, tier: '3', recipients: [] }),
      expect.objectContaining({ giver: { displayName: `Name${STRANGER}`, slot: null }, total: 1 }),
    ]);
    expect(out.filter(b => b.kind === 'gifts').every(b => b.kind === 'gifts' && /^sg\.s-\d+$/u.test(b.groupKey))).toBe(true);
    expect(out.filter(b => b.kind === 'subscription')).toEqual([expect.objectContaining({ key: 'subscription.home.3', displayUntil: t })]);
    r.local.deliver(structured(t + 1000, 'channel.subscription.message', { ...user(JUNI), tier: '1000', message: { text: 'SECRET', emotes: [] },
      cumulative_months: 15, streak_months: 1, duration_months: 1 }));
    out = await r.drain();
    expect(out).toEqual([expect.objectContaining({ months: 15, sharedNotice: true, displayUntil: t + 121_000 })]);
    // Upgrade via a new sub at a higher tier celebrates; a downgrade is state only.
    r.local.deliver(structured(t + 2000, 'channel.subscribe', { ...user(JUNI), tier: '3000', is_gift: false }));
    r.local.deliver(structured(t + 3000, 'channel.subscribe', { ...user(JUNI), tier: '2000', is_gift: false }));
    out = await r.drain();
    expect(out.map(b => b.kind === 'subscription' && [b.tier, b.displayUntil - (b.tier === '3' ? t + 2000 : t + 3000)])).toEqual([['3', 120_000], ['2', 0]]);
    // `end` is planned, so a missing badge is not a lapse.
    expect(r.ingest.observeChatMetadata({ deliveryId: 'x1', kingdomId: K, personId: JUNI, displayName: 'J', observedAt: t + 4000, subscriberBadgeMonths: null,
      subscriberTier: null, origin: 'simulated' })).toBe('accepted');
    expect(await r.drain()).toEqual([]);
    expect(JSON.stringify(r.memory.dump(K))).not.toMatch(/SECRET|login|cumulative/u);
    r.ingest.stop();
  });

  it('chat notices without the subscription grant: a missing badge is the lapse signal', async () => {
    const r = rig(['moments.chat-notices'], READER);
    expect(r.status.support).toBe('notices');
    expect(r.local.plan.map(e => e.type)).toEqual(['channel.chat.notification']);
    const t = r.now();
    const meta = (id: string, months: number | null, at: number) => ({ deliveryId: id, kingdomId: K, personId: JUNI, displayName: 'J', observedAt: at,
      subscriberBadgeMonths: months, subscriberTier: months === null ? null : '1' as const, origin: 'simulated' as const });
    r.ingest.observeChatMetadata(meta('b1', 3, t));
    let out = await r.drain();
    expect(out).toEqual([expect.objectContaining({ active: true, months: 3, displayUntil: t })]);
    r.ingest.observeChatMetadata(meta('b2', null, t + 1000));
    out = await r.drain();
    expect(out).toEqual([expect.objectContaining({ active: false, months: 3, displayUntil: t + 1000 })]);
    // A delivery from a type the plan dropped is refused as unplanned, and a stopped ingest refuses metadata.
    r.local.deliver(structured(t, 'channel.subscribe', { ...user(JUNI), tier: '1000', is_gift: false }), { misrouted: true });
    await r.drain();
    expect(r.ingest.status().counts.unplanned).toBe(1);
    r.ingest.stop();
    expect(r.ingest.observeChatMetadata(meta('b3', 3, t + 2000))).toBe('unavailable');
  });
});

describe('shared spectacle: Bits, Hype Trains and the earned dragon', () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  const CHEERER = { user_id: '407665396', user_login: 'ananonymouscheerer', user_name: 'AnAnonymousCheerer' };
  const channel = { broadcaster_user_id: K, broadcaster_user_login: 'kingdom', broadcaster_user_name: 'Kingdom' };
  const frame = (at: number, type: string, version: string, event: object, messageId = `h-${++n}`) =>
    eventSubFrame({ messageId, at, type, version, condition: { broadcaster_user_id: K }, event: { ...channel, ...event } });
  const bits = (at: number, payer: object, amount: number, kind: object) => frame(at, 'channel.bits.use', '1', { ...payer, bits: amount, power_up: null,
    custom_power_up: null, message: { text: 'SECRET CHEER TEXT', fragments: [{ type: 'text', text: 'SECRET CHEER TEXT', cheermote: null, emote: null }] }, ...kind });
  const TOP = [{ user_id: PIP, user_login: 'loginpip', user_name: 'NamePip', type: 'bits', total: 900 },
    { user_id: QUIET, user_login: 'loginquiet', user_name: 'QuietName', type: 'bits', total: 800 },
    { ...CHEERER, type: 'bits', total: 700 }, { user_id: STRANGER, user_login: 'loginwander', user_name: 'Wanderer', type: 'subscription', total: 600 },
    { user_id: PIP, user_login: 'loginpip', user_name: 'NamePip', type: 'subscription', total: 100 }];
  const train = (id: string, startedAt: number, level: number, total: number, extra: object = {}) => ({ id, total, progress: total % 500, goal: 500 + level * 100,
    top_contributions: TOP, shared_train_participants: null, level, started_at: iso(startedAt), expires_at: iso(startedAt + 300_000 + level * 60_000),
    is_shared_train: false, type: 'regular', ...extra });
  const ended = (id: string, startedAt: number, level: number, total: number, endedAt: number) => ({ id, total, top_contributions: TOP, shared_train_participants: null,
    level, started_at: iso(startedAt), ended_at: iso(endedAt), cooldown_ends_at: iso(endedAt + 3_600_000), is_shared_train: false, type: 'regular' });

  it('cheers stay shared and anonymous; a reordered train earns one dragon request and one elder upgrade; battles and reads are authority', async () => {
    const summons: DragonSummonRequest[] = [];
    const battle: DragonBattlePort = { summon: async request => { summons.push(request); return { status: 'accepted' }; } };
    let read: () => Promise<MomentRead> = async () => ({ kind: 'unavailable' });
    const r = rig(['moments.bits', 'moments.hype'], null, { battle, reads: { hypeTrainStatus: () => read() } });
    expect(r.local.plan.map(e => e.type)).toEqual(['channel.bits.use', 'channel.hype_train.begin', 'channel.hype_train.progress', 'channel.hype_train.end']);
    const t = r.now(), published: unknown[] = [];
    const drain = async () => { const out = await r.drain(); published.push(...out); return out; };

    // Cheers: named by home, anonymous by null user or Twitch's stand-in account, quiet citizens unnamed.
    r.local.deliver(bits(t, user(PIP), 150, { type: 'cheer' }));
    r.local.deliver(bits(t, { user_id: null, user_login: null, user_name: null }, 500, { type: 'cheer' }));
    r.local.deliver(bits(t, CHEERER, 1000, { type: 'cheer' }));
    r.local.deliver(bits(t, user(QUIET), 100, { type: 'cheer' }));
    r.local.deliver(bits(t, { user_id: STRANGER, user_login: 'loginwander', user_name: 'Wanderer' }, 250_000_000, { type: 'cheer' }));
    let out = await drain();
    expect(out.map(b => b.kind === 'cheer' && [b.credit, b.bits, b.displayUntil - t])).toEqual([
      [{ displayName: 'Pip', slot: 6 }, 150, 60_000], [null, 500, 60_000], [null, 1000, 60_000], [null, 100, 60_000],
      [{ displayName: 'Wanderer', slot: null }, 100_000_000, 60_000]]);
    expect(out.every(b => /^cheer\.h-\d+$/u.test(b.key))).toBe(true);
    // Power-ups: a gigantified emote names its emote, a custom one its reward mapping; no emote is malformed.
    r.local.deliver(bits(t + 1, user(PIP), 50, { type: 'power_up', power_up: { type: 'gigantify_an_emote', emote: { id: 'emotesv2_cafe', name: 'Kappa' }, message_effect_id: null } }));
    r.local.deliver(bits(t + 2, CHEERER, 300, { type: 'custom_power_up', custom_power_up: { title: 'SECRET TITLE', reward_id: 'rw-77' } }));
    r.local.deliver(bits(t + 3, user(PIP), 50, { type: 'power_up', power_up: { type: 'celebration', emote: null, message_effect_id: null } }));
    r.local.deliver(bits(t + 4, user(PIP), 50, { type: 'power_up', power_up: { type: 'gigantify_an_emote', emote: null, message_effect_id: null } }));
    out = await drain();
    expect(out.map(b => b.kind === 'power-up' && [b.effect, b.emoteId, b.mappingKey, b.credit?.displayName ?? null])).toEqual([
      ['emote-balloon', 'emotesv2_cafe', null, 'Pip'], ['custom', null, 'cp.rw-77', null], ['celebration', null, null, 'Pip']]);
    expect(r.ingest.status().counts.malformed).toBe(1);
    // Bits are transient: nothing but delivery claims and the watermark was stored, so no total, counter or rank.
    expect(r.memory.dump(K).every(([key]) => /^twitch-moments:(delivery:|watermark$)/u.test(key))).toBe(true);
    expect(await r.current()).toEqual([]);

    // Train one: its progress arrives before its begin; the delayed begin only adds the all-time high (6).
    r.advance(10_000);
    const h = r.now();
    r.local.deliver(frame(h + 1000, 'channel.hype_train.progress', '2', train('train-one', h, 1, 120)));
    out = await drain();
    expect(out).toEqual([{ kind: 'hype', key: 'hype.ht.train-one', displayUntil: h + 61_000, trainKey: 'ht.train-one', phase: 'progress', level: 1, progress: 120,
      goal: 600, endsAt: h + 360_000, contributors: [{ displayName: 'Pip', slot: 6 }, { displayName: 'Wanderer', slot: null }], otherContributors: null,
      golden: false, treasure: false, record: false, sharedSessionKey: null }]);
    r.local.deliver(frame(h, 'channel.hype_train.begin', '2', { ...train('train-one', h, 1, 120), all_time_high_level: 6, all_time_high_total: 9000 }));
    expect(await drain()).toEqual([]);
    // Level 3 earns exactly one request; a redelivery and an older report are refused; level 5 upgrades to elder.
    const three = frame(h + 5000, 'channel.hype_train.progress', '2', train('train-one', h, 3, 1400), 'hype-three');
    r.local.deliver(three);
    out = await drain();
    expect(out).toEqual([expect.objectContaining({ key: 'hype.ht.train-one', level: 3, phase: 'progress', displayUntil: h + 65_000, record: false })]);
    r.local.deliver(three);
    r.local.deliver(frame(h + 6000, 'channel.hype_train.progress', '2', train('train-one', h, 2, 900)));
    r.local.deliver(frame(h + 7000, 'channel.hype_train.progress', '2', train('train-one', h, 3, 1450)));
    out = await drain();
    expect(out).toEqual([expect.objectContaining({ level: 3, progress: 450, displayUntil: h + 7000 })]);
    r.local.deliver(frame(h + 9000, 'channel.hype_train.progress', '2', train('train-one', h, 5, 3100)));
    r.local.deliver(frame(h + 20_000, 'channel.hype_train.end', '2', ended('train-one', h, 5, 3300, h + 20_000)));
    out = await drain();
    expect(out.map(b => b.kind === 'hype' && [b.phase, b.level, b.endsAt - h, b.displayUntil - h])).toEqual([['progress', 5, 600_000, 69_000], ['end', 5, 20_000, 80_000]]);
    expect(summons).toEqual([
      { kingdomId: K, source: 'hype', requestKey: 'ht.train-one.young', trainKey: 'ht.train-one', level: 3, form: 'young', sharedSessionKey: null, origin: 'simulated' },
      { kingdomId: K, source: 'hype', requestKey: 'ht.train-one.elder', trainKey: 'ht.train-one', level: 5, form: 'elder', sharedSessionKey: null, origin: 'simulated' }]);
    // Nothing reopens an ended train: a delayed begin or progress is stale.
    const before = r.ingest.status().counts;
    r.local.deliver(frame(h, 'channel.hype_train.begin', '2', { ...train('train-one', h, 1, 120), all_time_high_level: 6, all_time_high_total: 9000 }));
    r.local.deliver(frame(h + 10_000, 'channel.hype_train.progress', '2', train('train-one', h, 6, 4000)));
    expect(await drain()).toEqual([]);
    expect(r.ingest.status().counts).toMatchObject({ stale: before.stale + 2, duplicate: before.duplicate });
    expect(r.ingest.status().counts.duplicate).toBe(1);
    expect(r.ingest.status().summons).toEqual({ requested: 2, accepted: 2, refused: 0, unavailable: 0, failed: 0 });

    // Train two never reaches level 3: closing state, no dragon, and it alone is the current train now.
    r.advance(60_000);
    const g = r.now();
    r.local.deliver(frame(g, 'channel.hype_train.begin', '2', { ...train('train-two', g, 1, 50), all_time_high_level: 6, all_time_high_total: 9000 }));
    r.local.deliver(frame(g + 3000, 'channel.hype_train.progress', '2', train('train-two', g, 2, 700)));
    r.local.deliver(frame(g + 9000, 'channel.hype_train.end', '2', ended('train-two', g, 2, 800, g + 9000)));
    out = await drain();
    expect(out.map(b => b.kind === 'hype' && [b.trainKey, b.phase, b.level])).toEqual([['ht.train-two', 'begin', 1], ['ht.train-two', 'progress', 2], ['ht.train-two', 'end', 2]]);
    expect(summons).toHaveLength(2);
    expect(await r.current()).toEqual(['hype.ht.train-two']);

    // The dragon's battle is what the realm reports, ordered by revision; a finished battle stays finished.
    const fight = (revision: number, phase: string, extra: object = {}) => ({ kingdomId: K, battleKey: 'dragon-1', source: 'hype', trainKey: 'ht.train-one', phase,
      form: 'elder', startsAt: g + 1000, endsAt: g + 181_000, healthPermille: 1000, fighters: 0, acceptedStrikes: 0, sharedSessionKey: null, revision,
      observedAt: r.now(), origin: 'simulated', ...extra });
    expect(r.ingest.observeBattle(fight(1, 'summoning'))).toBe('accepted');
    out = await drain();
    expect(out).toEqual([{ kind: 'battle', key: 'battle.dragon-1', displayUntil: r.now() + 60_000, battleKey: 'dragon-1', source: 'hype', phase: 'summoning',
      form: 'elder', startsAt: g + 1000, endsAt: g + 181_000, healthPermille: 1000, fighters: 0, acceptedStrikes: 0, sharedSessionKey: null }]);
    r.advance(30_000);
    r.ingest.observeBattle(fight(3, 'active', { healthPermille: 640, fighters: 4, acceptedStrikes: 37 }));
    r.ingest.observeBattle(fight(2, 'active', { healthPermille: 900, fighters: 2, acceptedStrikes: 5 }));
    r.ingest.observeBattle(fight(3, 'active', { healthPermille: 640, fighters: 4, acceptedStrikes: 37 }));
    out = await drain();
    expect(out).toEqual([expect.objectContaining({ phase: 'active', healthPermille: 640, acceptedStrikes: 37, displayUntil: r.now() + 60_000 })]);
    expect((await r.current()).sort()).toEqual(['battle.dragon-1', 'hype.ht.train-two']);
    r.ingest.observeBattle(fight(4, 'active', { healthPermille: 610, fighters: 4, acceptedStrikes: 41 }));
    r.ingest.observeBattle(fight(5, 'retreat', { healthPermille: 610, fighters: 4, acceptedStrikes: 41 }));
    r.ingest.observeBattle(fight(6, 'active', { healthPermille: 100 }));
    out = await drain();
    expect(out.map(b => b.kind === 'battle' && [b.phase, b.displayUntil - r.now()])).toEqual([['active', 0], ['retreat', 60_000]]);
    expect(await r.current()).toEqual(['hype.ht.train-two']);
    expect(r.ingest.observeBattle({ ...fight(7, 'active'), origin: 'live' })).toBe('origin');
    expect(r.ingest.observeBattle({ ...fight(7, 'active'), kingdomId: '1' })).toBe('condition');
    expect(r.ingest.observeBattle({ ...fight(7, 'active'), victor: 'someone' })).toBe('malformed');
    expect(r.ingest.observeBattle({ ...fight(7, 'active'), source: 'wyrm-bell' })).toBe('malformed');

    // Read recovery: a train the records missed arrives as recovered state with Twitch's own times, no beat.
    const status = (current: object | null, high: object | null = null) => ({ data: [{ current, all_time_high: high, shared_all_time_high: null }] });
    const missed = (level: number, total: number) => ({ ...channel, ...train('train-three', g + 60_000, level, total), type: 'golden_kappa', is_shared_train: true,
      shared_train_participants: [{ broadcaster_user_id: '5150', broadcaster_user_login: 'neighbour', broadcaster_user_name: 'Neighbour' }] });
    r.advance(120_000);
    read = async () => ({ kind: 'response', status: 200, body: status(missed(4, 2100), { level: 6, total: 9000, achieved_at: iso(g - 86_400_000) }) });
    expect(await r.ingest.reconcile(new AbortController().signal)).toEqual({ hype: 'current' });
    let facts = await r.drainFacts();
    expect(facts.map(f => [f.origin, f.occurredAt, f.body.displayUntil])).toEqual([['recovered', g + 60_000, g + 60_000]]);
    expect(facts[0]!.body).toMatchObject({ trainKey: 'ht.train-three', phase: 'progress', level: 4, golden: true, record: false, sharedSessionKey: 'hts.train-three',
      endsAt: g + 60_000 + 540_000 });
    // The same state again changes nothing; a higher level above the read's all-time high is a verified record.
    expect(await r.ingest.reconcile(new AbortController().signal)).toEqual({ hype: 'current' });
    expect(await r.drain()).toEqual([]);
    read = async () => ({ kind: 'response', status: 200, body: status(missed(8, 7000), { level: 6, total: 9000, achieved_at: iso(g - 86_400_000) }) });
    await r.ingest.reconcile(new AbortController().signal);
    facts = await r.drainFacts();
    expect(facts.map(f => [f.origin, f.body.kind === 'hype' && f.body.level, f.body.kind === 'hype' && f.body.record])).toEqual([['recovered', 8, true]]);
    // A recovered train at level 3+ still earns its one request, in its verified form (Golden Kappa outranks record).
    expect(summons.slice(2).map(s => [s.requestKey, s.form, s.sharedSessionKey])).toEqual([['ht.train-three.golden', 'golden', 'hts.train-three']]);
    // Failed, partial, foreign or empty reads are unknown or none, and change nothing: never an end.
    const failures: (() => Promise<MomentRead>)[] = [
      async () => ({ kind: 'response', status: 503, body: { error: 'Service Unavailable' } }),
      async () => { throw new Error('connection reset'); },
      async () => ({ kind: 'response', status: 200, body: { data: [] } }),
      async () => ({ kind: 'response', status: 200, body: status({ ...missed(9, 8000), broadcaster_user_id: '999' }) })];
    for (const failure of failures) {
      read = failure;
      expect(await r.ingest.reconcile(new AbortController().signal)).toEqual({ hype: 'unknown' });
    }
    read = async () => ({ kind: 'response', status: 200, body: status(null) });
    expect(await r.ingest.reconcile(new AbortController().signal)).toEqual({ hype: 'none' });
    read = async () => ({ kind: 'unavailable' });
    expect(await r.ingest.reconcile(new AbortController().signal)).toEqual({ hype: 'unavailable' });
    expect(await r.drain()).toEqual([]);
    expect(await r.current()).toEqual(['hype.ht.train-three']);

    // Nothing private, raw or counted leaves the module or enters a record.
    const publicText = JSON.stringify([published, facts, r.all, r.ingest.status()]);
    for (const secret of [PIP, QUIET, STRANGER, '407665396', 'ananonymouscheerer', 'AnAnonymousCheerer', 'login', 'SECRET', 'QuietName', 'NamePip', 'Neighbour', '5150']) {
      expect(publicText, secret).not.toContain(secret);
    }
    const stored = JSON.stringify(r.memory.dump(K));
    for (const secret of [QUIET, '407665396', 'AnAnonymousCheerer', 'login', 'SECRET', 'QuietName', 'NamePip', 'Neighbour', 'bits', 'all_time', 'cooldown', 'participants']) {
      expect(stored, secret).not.toContain(secret);
    }
    expect(r.ingest.status()).toMatchObject({ state: 'running', counts: { record: 0, overflow: 0 } });
    r.ingest.stop();
    expect(await r.ingest.reconcile(new AbortController().signal)).toEqual({ hype: 'unavailable' });
    expect(r.ingest.observeBattle(fight(9, 'active'))).toBe('unavailable');
  });
});
