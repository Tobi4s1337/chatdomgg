import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type PersonId } from '@chatdom/shared';
import type { TwitchMomentFact } from '../../../web/src/twitch-moments/contracts';
import { createTwitchMomentIngest, type CitizenDisclosure, type MomentCapability } from './index';
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

function rig(authorized: MomentCapability[], readerId: PersonId | null) {
  let now = START;
  const clock = { now: () => now };
  const memory = createMemoryMomentRecords(clock), local = createLocalProviderTransport();
  const ingest = createTwitchMomentIngest({ kingdomId: K, origin: 'simulated', epochPrefix: 'scratch', moderatorId: null, readerId,
    authorized: new Set(authorized), transport: local.transport, records: memory.port, directory, clock });
  const facts: TwitchMomentFact[] = [];
  const status = ingest.start();
  ingest.feed.subscribe(() => undefined, (_e, fact) => facts.push(fact), () => undefined);
  const drain = async () => { await ingest.settled(); for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)); const out = facts.splice(0); return out.map(f => f.body); };
  return { ingest, local, memory, status, drain, advance: (ms: number) => { now += ms; }, now: () => now, all: facts };
}

describe('support sources (scratch)', () => {
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
