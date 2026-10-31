import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type KingdomPresenceFrame, type PersonId } from '@chatdom/shared';
import { createTwitchMomentIngest, type CitizenDirectory, type CitizenDisclosure } from '../../../herald/src/twitch-moments';
import { createLocalProviderTransport, eventSubFrame } from '../../../herald/src/twitch-moments/local-transport';
import { createMemoryMomentRecords } from '../../../herald/src/twitch-moments/memory';
import { BANNER_BEAT } from './choreography';
import type { DragonSummonRequest } from '../../../herald/src/twitch-moments/ports';
import { ApprovedEffectSchema, type ActionPort, type KingdomMomentIntent } from './contracts';
import { createTwitchMoments, type MomentFrame } from './controller';
import { rungFor, type SpectaclePlaces } from './spectacle';
import { createTwitchMomentView, type CameraLease, type GiftRoute, type HomeAnchor, type MomentViewHost, type PlaceAnchor } from './view';
import type { CameraPose } from './contracts';

const KINGDOM = KingdomIdSchema.parse('424242');
const person = (id: string) => PersonIdSchema.parse(id);
const JUNIPER = person('9001'), QUIET = person('9002'), ROWAN = person('9003'), WREN = person('9004');
const START = Date.UTC(2026, 9, 30, 19, 30);

/** A real home slot is only ever supplied by the directory, keyed by person ID. */
const people = new Map<PersonId, CitizenDisclosure>([
  [JUNIPER, { disclosure: 'named', displayName: 'Juniper', homeSlot: 3 }],
  [QUIET, { disclosure: 'anonymous' }],
  [ROWAN, { disclosure: 'named', displayName: 'Rowan', homeSlot: 5 }],
  [WREN, { disclosure: 'named', displayName: 'Wren', homeSlot: 7 }],
]);
const directory: CitizenDirectory = { resolve: async (kingdom, id) => (kingdom === KINGDOM ? people.get(id) ?? null : null) };

let messages = 0;
const structuredEnd = (user: PersonId, at: number) => eventSubFrame({ messageId: `end-${++messages}`, at, type: 'channel.subscription.end', version: '1',
  condition: { broadcaster_user_id: KINGDOM }, event: { user_id: user, user_login: `login${user}`, user_name: `Provider${user}`, broadcaster_user_id: KINGDOM,
    broadcaster_user_login: 'kingdom', broadcaster_user_name: 'Kingdom', tier: '1000', is_gift: false } });
function subscribe(user: PersonId, at: number, options: { gift?: boolean; broadcaster?: string; condition?: string; id?: string; type?: string; tier?: string } = {}) {
  return eventSubFrame({ messageId: options.id ?? `msg-${++messages}`, at, type: options.type ?? 'channel.subscribe', version: '1',
    condition: { broadcaster_user_id: options.condition ?? KINGDOM },
    event: { user_id: user, user_login: `login${user}`, user_name: `Provider${user}`, broadcaster_user_id: options.broadcaster ?? KINGDOM,
      broadcaster_user_login: 'kingdom', broadcaster_user_name: 'Kingdom', tier: options.tier ?? '1000', is_gift: options.gift ?? false } });
}

const READER = person('9100');
const NULLS = Object.fromEntries(['sub', 'resub', 'sub_gift', 'community_sub_gift', 'gift_paid_upgrade', 'prime_paid_upgrade', 'pay_it_forward'].map(k => [k, null]));
/** A chat notification in Twitch's wire shape, carrying private fields that must never pass the boundary. */
function notice(at: number, chatter: PersonId | 'anon', type: string, detail: object, messageId = `notice-${++messages}`) {
  return eventSubFrame({ messageId: `d-${++messages}`, at, type: 'channel.chat.notification', version: '1', condition: { broadcaster_user_id: KINGDOM, user_id: READER },
    event: { broadcaster_user_id: KINGDOM, broadcaster_user_login: 'kingdom', broadcaster_user_name: 'Kingdom', chatter_user_id: chatter === 'anon' ? '274598607' : chatter,
      chatter_user_login: `login${chatter}`, chatter_user_name: chatter === 'anon' ? 'AnAnonymousGifter' : `Provider${chatter}`, chatter_is_anonymous: chatter === 'anon',
      color: '#ff0000', badges: [], system_message: 'SECRET SYSTEM TEXT', message_id: messageId, message: { text: 'SECRET CHAT TEXT', fragments: [] },
      notice_type: type, ...NULLS, [type]: detail, source_broadcaster_user_id: null, source_message_id: null, source_badges: null } });
}
const giftTo = (to: PersonId, community: string | null, tier = '1000') =>
  ({ duration_months: 1, cumulative_total: 42, recipient_user_id: to, recipient_user_name: `Provider${to}`, recipient_user_login: `login${to}`, sub_tier: tier, community_gift_id: community });
/** First kingdom time at or after `from` when `test` holds, sampling every 50 ms. */
function firstAt(from: number, until: number, test: (at: number) => boolean): number {
  for (let at = from; at <= until; at += 50) if (test(at)) return at;
  throw new Error('The awaited moment never came');
}

const settle = async (ingest: { settled(): Promise<void> }) => { await ingest.settled(); for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)); };

/** A host with real THREE groups and recording ports; geometry stands in for the worker mesher. */
function testHost(anchors: Map<number, HomeAnchor>) {
  const parent = new THREE.Group(), played: { cue: string; atMs: number }[] = [], cancelled: string[] = [], writes: CameraPose[] = [];
  const prior: CameraPose = { eye: [0, 30, 60], target: [0, 0, 0], fov: 52 };
  let current = prior, leased = 0, released = 0;
  const host: MomentViewHost = {
    parent, material: new THREE.MeshBasicMaterial(), kit: 'hearth',
    mesh: async () => new THREE.BoxGeometry(0.125, 0.125, 0.125),
    homeAnchor: slot => anchors.get(slot) ?? null,
    sound: { play(cue, atMs) { const id = `${cue}@${atMs}`; played.push({ cue, atMs }); return () => cancelled.push(id); } },
    camera: { acquire(): CameraLease { leased++; let open = true;
      return { read: () => current, write: pose => { if (!open) return false; current = pose; writes.push(pose); return true; }, release: () => { open = false; released++; } }; } },
    viewport: () => ({ width: 1440, height: 900 }),
  };
  return { host, parent, played, cancelled, writes, prior, camera: () => current, leases: () => ({ leased, released }) };
}

const anchorAt = (x: number): HomeAnchor => ({ mount: [x, 2.6, 4], normal: [0, 0, 1], right: [1, 0, 0], doorstep: [x - 0.8, 0.1, 4.6] });
/** Gift places for the view: the market stop at the end of a real two-leg route, and the gate where it began. */
const giftPlaces = {
  placeAnchor: (place: 'market' | 'gate'): PlaceAnchor => (place === 'market' ? { position: [20, 0, 20], facing: [0, 0, -1] } : { position: [-30, 0, 20], facing: [1, 0, 0] }),
  giftRoute: (): GiftRoute => ({ inbound: [[-30, 0, 20], [0, 0, 20], [20, 0, 20]], outbound: [[20, 0, 20], [20, 0, 50]] }),
};

describe('Twitch moments: one sub travels from Twitch to a named home and nowhere else', () => {
  it('normalizes, records, projects and presents real support input with honest refusals and cleanup', async () => {
    let now = START;
    const clock = { now: () => now };
    const memory = createMemoryMomentRecords(clock), local = createLocalProviderTransport();
    const ingestOptions = { kingdomId: KINGDOM, origin: 'simulated' as const, moderatorId: null, readerId: null,
      authorized: new Set(['moments.subscriptions', 'moments.polls'] as const), transport: local.transport, records: memory.port, directory, clock };
    const ingest = createTwitchMomentIngest({ ...ingestOptions, epochPrefix: 'bench' });

    // The plan holds only authorized families this ingest can normalize, with exact conditions.
    const started = ingest.start();
    expect(started.state).toBe('running');
    expect(local.plan).toEqual(['channel.subscribe', 'channel.subscription.end', 'channel.subscription.gift', 'channel.subscription.message'].map(type => ({ capability: 'moments.subscriptions', type, version: '1', condition: { broadcaster_user_id: KINGDOM } })));
    expect(started.unavailable).toContain('moments.bits');

    const moments = createTwitchMoments({ kingdomId: KINGDOM, expectedOrigin: 'simulated', clock });
    moments.connect(ingest.feed);
    await settle(ingest);
    expect(moments.status).toBe('ready');
    expect(moments.sample(now).homes).toEqual([]);

    // Juniper subscribes: one named banner beat on her real home, horn then cloth, on the authored clock.
    expect(local.deliver(subscribe(JUNIPER, now))).toBe(true);
    await settle(ingest);
    const beatStart = now;
    expect(moments.currentFacts()).toHaveLength(1);
    const first = moments.sample(beatStart + 200);
    expect(first.homes).toEqual([expect.objectContaining({ slot: 3, phase: 'anticipation', unfurl: 0, ribbons: 1, tier: '1' })]);
    expect(first.audio.map(a => [a.cue, a.atMs - beatStart])).toEqual([['horn', BANNER_BEAT.horn], ['cloth-unfurl', BANNER_BEAT.cloth]]);
    expect(first.focus).toMatchObject({ subject: { kind: 'home', slot: 3 }, cut: true, wide: false });
    const mid = moments.sample(beatStart + 2000).homes[0]!;
    expect(mid.phase).toBe('action');
    expect(mid.unfurl).toBeGreaterThan(0.3);
    expect(mid.unfurl).toBeLessThan(1);
    const held = moments.sample(beatStart + 6000);
    expect(held.homes[0]).toMatchObject({ phase: 'hold', unfurl: 1 });
    expect(held.captions).toEqual([expect.objectContaining({ at: { kind: 'home', slot: 3 }, title: 'Juniper', line: 'raises a banner at home' })]);
    expect(moments.sample(beatStart + BANNER_BEAT.end + 10).homes[0]).toMatchObject({ phase: 'idle', unfurl: 1 });

    // A quiet neighbour's sub is recorded privately and never named, located, tinted or celebrated.
    local.deliver(subscribe(QUIET, now));
    await settle(ingest);
    expect(ingest.status().counts).toMatchObject({ applied: 2, published: 1 });
    expect(memory.dump(KINGDOM).some(([key]) => key === `twitch-moments:subscriber:${QUIET}`)).toBe(true);

    // Presence tints only a present, named window; an anonymous light is never marked.
    const presence: KingdomPresenceFrame = { version: 1, kingdomId: KINGDOM, epoch: 'presence', sequence: 1, asOf: now, origin: 'simulated', streamLive: true,
      connection: 'fresh', windows: [{ slot: 3, present: true, publicName: 'Juniper', since: now }, { slot: 4, present: true, publicName: null, since: now }] };
    expect(moments.receivePresence(presence)).toBe(true);
    const lit = moments.sample(now + 20_000);
    expect(lit.homes).toEqual([expect.objectContaining({ slot: 3, tint: 'gold' })]);
    expect(lit.homes.some(h => h.slot === 4)).toBe(false);

    // Duplicate, misrouted, wrong-channel and unplanned deliveries never reach the projector.
    const repeated = subscribe(ROWAN, now, { id: 'msg-repeat' });
    local.deliver(repeated); local.deliver(repeated);
    local.deliver(subscribe(ROWAN, now, { condition: '777' }), { misrouted: true });
    local.deliver(subscribe(ROWAN, now, { broadcaster: '777' }));
    local.deliver(subscribe(ROWAN, now, { type: 'channel.cheer' }), { misrouted: true });
    expect(local.deliver(subscribe(ROWAN, now, { type: 'channel.cheer' }))).toBe(false);
    await settle(ingest);
    expect(ingest.status().counts).toMatchObject({ duplicate: 1, condition: 1, malformed: 1, unplanned: 1 });
    expect(moments.currentFacts()).toHaveLength(2);

    // Rowan's beat waits its turn rather than fighting Juniper's for the camera.
    expect(moments.sample(now + 1).homes.map(h => h.slot)).toEqual([3]);
    const rowan = moments.sample(beatStart + 3600 + 200);
    expect(rowan.homes.map(h => [h.slot, h.phase])).toEqual([[3, 'settle'], [5, 'anticipation']]);
    expect(rowan.focus).toMatchObject({ subject: { kind: 'home', slot: 3 } });

    // A gifted recipient's entitlement changes silently: the parcel is the gift family's beat, not a second one.
    now += 30_000;
    local.deliver(subscribe(WREN, now, { gift: true }));
    await settle(ingest);
    const wren = moments.sample(now + 2000);
    expect(wren.homes.find(h => h.slot === 7)).toMatchObject({ phase: 'idle', unfurl: 1 });
    expect(wren.focus).toBeNull();

    // A late delivery updates the home but starts no historical spectacle.
    people.set(person('9005'), { disclosure: 'named', displayName: 'Hazel', homeSlot: 9 });
    local.deliver(subscribe(person('9005'), now - 180_000));
    await settle(ingest);
    expect(moments.sample(now + 500).homes.find(h => h.slot === 9)).toMatchObject({ phase: 'idle', unfurl: 1 });
    expect(moments.metrics().suppressed.expired).toBe(2);

    // The public boundary refuses private extras, oversize names, actors, replays and foreign epochs.
    const sample = moments.currentFacts().find(f => f.body.kind === 'subscription' && f.body.credit?.slot === 3)!;
    const forged = (patch: object) => ({ ...sample, seq: 999, ...patch });
    expect(moments.receiveFact(moments.epoch!, forged({ body: { ...sample.body, personId: JUNIPER } }))).toEqual({ accepted: false, reason: 'invalid' });
    expect(moments.receiveFact(moments.epoch!, forged({ body: { ...sample.body, credit: { displayName: 'x'.repeat(129), slot: 3 } } })).accepted).toBe(false);
    expect(moments.receiveFact(moments.epoch!, forged({ actor: JUNIPER }))).toEqual({ accepted: false, reason: 'invalid' });
    expect(moments.receiveFact(moments.epoch!, forged({ origin: 'live' }))).toEqual({ accepted: false, reason: 'origin' });
    expect(moments.receiveFact(moments.epoch!, sample)).toEqual({ accepted: false, reason: 'replay' });
    expect(moments.receiveFact('other-epoch', forged({}))).toEqual({ accepted: false, reason: 'epoch' });
    expect(moments.reset({ epoch: 'x', asOf: now, throughSeq: 0, current: Array.from({ length: 1025 }, () => sample) })).toEqual({ accepted: false, reason: 'partial' });
    expect(moments.status).toBe('unavailable');

    // The view: frames drive real groups, sound and a leased shot that hands the camera back.
    const restart = createTwitchMomentIngest({ ...ingestOptions, epochPrefix: 'restart' });
    restart.start();
    moments.connect(restart.feed);
    await settle(restart);
    expect(moments.status).toBe('ready');
    // Restoration from records is state, not a "just happened" beat.
    expect(moments.sample(now).homes.map(h => [h.slot, h.phase])).toEqual([[3, 'idle'], [5, 'idle'], [7, 'idle'], [9, 'idle']]);
    expect(moments.sample(now).focus).toBeNull();

    const anchors = new Map([[3, anchorAt(0)], [5, anchorAt(9)], [7, anchorAt(18)], [9, anchorAt(27)], [11, anchorAt(36)]]);
    people.set(person('9006'), { disclosure: 'named', displayName: 'Ash', homeSlot: 11 });
    const runs: { cue: string; atMs: number }[][] = [];
    let beatAt = 0;
    for (const step of [16, 50]) {
      const t = testHost(anchors);
      const view = createTwitchMomentView(t.host);
      await view.prepare();
      if (step === 16) {
        beatAt = now;
        local.deliver(subscribe(person('9006'), now));
        await settle(restart);
      }
      for (let at = beatAt; at <= beatAt + BANNER_BEAT.end + 2500; at += step) view.apply(moments.sample(at));
      runs.push(t.played);
      expect(t.parent.children).toHaveLength(1);
      expect(t.parent.children[0]!.children.filter(c => c.name.startsWith('banner-'))).toHaveLength(5);
      expect(t.leases()).toEqual({ leased: 1, released: 1 });
      expect(t.camera()).toEqual(t.prior);
      view.dispose();
      expect(t.parent.children).toHaveLength(0);
      expect(view.stats()).toMatchObject({ banners: 0, sounds: 0, leased: false, attached: false });
    }
    // Equal semantic timing whatever the render interval.
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[0]!.map(r => [r.cue, r.atMs - beatAt])).toEqual([['horn', BANNER_BEAT.horn], ['cloth-unfurl', BANNER_BEAT.cloth]]);

    // Hiding mid-beat cancels sound, releases the lease and restores the prior view.
    const t = testHost(anchors), view = createTwitchMomentView(t.host);
    await view.prepare();
    now += 60_000;
    people.set(person('9007'), { disclosure: 'named', displayName: 'Bram', homeSlot: 5 });
    local.deliver(subscribe(person('9007'), now, { tier: '2000' }));
    await settle(restart);
    for (let at = now; at < now + 2000; at += 33) view.apply(moments.sample(at));
    expect(view.stats().leased).toBe(true);
    expect(t.played.map(p => p.cue)).toEqual(['horn', 'cloth-unfurl']);
    moments.setPresentation({ layout: 'stage', mood: 'show', busy: false, visible: false, safeRects: [], autoOpenKinds: [] });
    view.apply(moments.sample(now + 2033));
    expect(t.cancelled).toHaveLength(2);
    expect(view.stats()).toMatchObject({ leased: false, sounds: 0 });
    expect(t.camera()).toEqual(t.prior);
    moments.setPresentation({ layout: 'stage', mood: 'show', busy: false, visible: true, safeRects: [], autoOpenKinds: [] });
    // Its state survives: the tier-2 banner flies; the cancelled beat does not replay.
    expect(moments.sample(now + 2100).homes.find(h => h.slot === 5)).toMatchObject({ tier: '2', phase: 'idle', unfurl: 1 });

    // A record failure publishes nothing and makes the source unavailable; known homes stay.
    memory.failNextCommit();
    const lost = subscribe(person('9008'), now);
    people.set(person('9008'), { disclosure: 'named', displayName: 'Ivy', homeSlot: 13 });
    local.deliver(lost);
    await settle(restart);
    expect(restart.status().state).toBe('unavailable');
    expect(moments.status).toBe('unavailable');
    expect(moments.sample(now + 3000).homes).toHaveLength(5);
    expect(moments.sample(now + 3000).focus).toBeNull();

    // A new source epoch resets without spectacle; the unacknowledged delivery is processed exactly once.
    const again = createTwitchMomentIngest({ ...ingestOptions, epochPrefix: 'again' });
    again.start();
    moments.connect(again.feed);
    await settle(again);
    const before = moments.metrics().admitted;
    local.deliver(lost); local.deliver(lost);
    await settle(again);
    expect(moments.metrics().admitted).toBe(before + 1);
    expect(again.status().counts.duplicate).toBe(1);
    expect(moments.receiveFact('restart.1', sample)).toEqual({ accepted: false, reason: 'epoch' });

    // ---- Support arrives at the right door with truthful names: chat notices become the one canonical source.
    const MOSS = person('9011'), PIP = person('9012'), ORIGIN = person('9013'), FERN = person('9015');
    people.set(MOSS, { disclosure: 'named', displayName: 'Moss', homeSlot: null });
    people.set(PIP, { disclosure: 'named', displayName: 'Pip', homeSlot: 15 });
    people.set(FERN, { disclosure: 'named', displayName: 'Fern', homeSlot: 17 });
    const notices = createTwitchMomentIngest({ ...ingestOptions, authorized: new Set(['moments.chat-notices', 'moments.subscriptions'] as const), readerId: READER, epochPrefix: 'notices' });
    expect(notices.start().support).toBe('notices');
    moments.connect(notices.feed);
    await settle(notices);
    now += 60_000;
    const admittedBefore = moments.metrics().admitted;

    // Rowan's community gift of five: the aggregate and its recipient notices coalesce under one group, in any order.
    local.deliver(notice(now, ROWAN, 'sub_gift', giftTo(JUNIPER, 'cg-1'), 'm-juniper'));
    local.deliver(notice(now, ROWAN, 'community_sub_gift', { id: 'cg-1', total: 5, sub_tier: '1000', cumulative_total: 99 }));
    local.deliver(notice(now, ROWAN, 'sub_gift', giftTo(MOSS, 'cg-1'), 'm-moss'));
    local.deliver(notice(now, ROWAN, 'sub_gift', giftTo(QUIET, 'cg-1'), 'm-quiet'));
    local.deliver(notice(now, ROWAN, 'sub_gift', giftTo(JUNIPER, 'cg-1'), 'm-juniper'));
    local.deliver(notice(now, ROWAN, 'community_sub_gift', { id: 'cg-1', total: 5, sub_tier: '1000' }));
    await settle(notices);
    expect(moments.metrics().admitted).toBe(admittedBefore + 1);
    const cartAt = firstAt(now, now + 20_000, at => moments.sample(at).carts.length > 0);
    const arriving = moments.sample(cartAt + 1000);
    expect(arriving.carts).toEqual([expect.objectContaining({ tier: '1', seal: 'named', load: 5 })]);
    expect(arriving.focus).toMatchObject({ subject: { kind: 'place', place: 'market' }, wide: true, follow: { subject: { kind: 'home', slot: 3 } } });
    // No second celebration: the gifted recipient's home only changed state.
    expect(arriving.homes.find(h => h.slot === 3)).toMatchObject({ phase: 'idle', unfurl: 1 });
    const named = moments.sample(cartAt + 4000).captions.find(c => c.at.kind === 'place');
    expect(named).toMatchObject({ title: 'Rowan', line: 'sends 5 gifts', detail: 'for Moss, Juniper and 3 others' });
    // Two located parcels lift off in the first wave; the quiet citizen and the two undisclosed ride on.
    const wave = moments.sample(cartAt + 5600);
    expect(wave.parcels.map(p => [p.key, p.to, p.elapsed !== null])).toEqual([['m-moss', { kind: 'gate' }, true], ['m-juniper', { kind: 'home', slot: 3 }, true]]);
    expect(wave.carts[0]!.load).toBe(3);
    const landed = firstAt(cartAt + 5600, cartAt + 20_000, at => moments.sample(at).captions.some(c => c.at.kind === 'home'));
    expect(moments.sample(landed + 400).captions.find(c => c.at.kind === 'home')).toMatchObject({ title: 'Juniper', line: 'a gift from Rowan' });
    const cartGone = firstAt(cartAt, cartAt + 45_000, at => moments.sample(at).carts.length === 0);
    const settled = moments.sample(cartGone + 2000);
    expect(settled.parcels.map(p => [p.key, p.elapsed]).sort()).toEqual([['m-juniper', null], ['m-moss', null]]);
    expect(settled.focus).toBeNull();
    // The cart's cues follow its clock: wheels, bell, one knock per landing, wheels away.
    expect(arriving.audio.map(a => a.cue)).toEqual(['cart-roll', 'gift-bell', 'cart-roll', 'parcel-land', 'parcel-land']);

    // Pip pays forward Origin's gift to Fern: one parcel sinks from the sky to Fern's door under Pip's forward seal.
    now = cartGone + 3000;
    local.deliver(notice(now, PIP, 'pay_it_forward', { gifter_is_anonymous: false, gifter_user_id: ORIGIN, gifter_user_name: 'Origin', gifter_user_login: 'origin' }));
    local.deliver(notice(now + 200, PIP, 'sub_gift', giftTo(FERN, null), 'm-fern'));
    await settle(notices);
    const sky = firstAt(now, now + 10_000, at => moments.sample(at).parcels.some(p => p.key === 'm-fern'));
    const sinking = moments.sample(sky + 1500);
    expect(sinking.carts).toEqual([]);
    expect(sinking.parcels.find(p => p.key === 'm-fern')).toMatchObject({ seal: 'forward', fromSky: true, to: { kind: 'home', slot: 17 } });
    expect(sinking.focus).toMatchObject({ subject: { kind: 'home', slot: 17 }, wide: false, follow: null });
    expect(moments.sample(sky + 4200).captions).toEqual([expect.objectContaining({ at: { kind: 'home', slot: 17 }, title: 'Pip', line: 'pays forward Origin’s gift', detail: 'for Fern' })]);
    expect(sinking.audio.filter(a => a.id.startsWith('gifts.')).map(a => [a.cue, a.atMs - sky])).toEqual([['gift-bell', 240], ['parcel-land', 3900]]);

    // An anonymous gift of two stays anonymous, and its undisclosed recipients are never located or named.
    now = sky + 12_000;
    local.deliver(notice(now, 'anon', 'community_sub_gift', { id: 'cg-2', total: 2, sub_tier: '3000' }));
    await settle(notices);
    const friend = firstAt(now, now + 10_000, at => moments.sample(at).carts.length > 0);
    expect(moments.sample(friend + 4000)).toMatchObject({ carts: [expect.objectContaining({ tier: '3', seal: 'friend', load: 2 })],
      captions: [expect.objectContaining({ title: 'A friend of the realm', line: 'sends 2 gifts', detail: 'for 2 friends of the realm' })] });
    expect(moments.sample(friend + 4000).parcels.filter(p => p.elapsed !== null)).toEqual([]);

    // Juniper shares a resub: the flying banner lifts in a gust and gains its new ribbons; nothing re-furls.
    now = firstAt(friend, friend + 45_000, at => moments.sample(at).carts.length === 0) + 1000;
    local.deliver(notice(now, JUNIPER, 'resub', { cumulative_months: 7, duration_months: 1, streak_months: null, sub_tier: '1000', is_prime: false, is_gift: false }));
    await settle(notices);
    const gust = firstAt(now, now + 5000, at => moments.sample(at).homes.find(h => h.slot === 3)?.phase !== 'idle');
    const tying = moments.sample(gust + 1200).homes.find(h => h.slot === 3)!;
    expect(tying).toMatchObject({ unfurl: 1, ribbons: 3, phase: 'action' });
    expect(tying.ribbonDrop).toBeGreaterThan(0);
    expect(tying.ribbonDrop).toBeLessThan(1);
    expect(moments.sample(gust + 3000).captions[0]).toMatchObject({ title: 'Juniper', line: '7 months under the banner' });
    // Her sub ends: the cloth quietly furls with no shot, caption or sound, and keeps every ribbon.
    now = gust + 9000;
    local.deliver(structuredEnd(JUNIPER, now));
    await settle(notices);
    const furling = moments.sample(now + 1300);
    expect(furling.homes.find(h => h.slot === 3)).toMatchObject({ active: false, phase: 'idle', ribbons: 3, tint: null });
    expect(furling.homes.find(h => h.slot === 3)!.unfurl).toBeGreaterThan(0.1);
    expect(furling.homes.find(h => h.slot === 3)!.unfurl).toBeLessThan(0.9);
    expect([furling.focus, furling.captions, furling.audio]).toEqual([null, [], []]);
    expect(moments.sample(now + 3000).homes.find(h => h.slot === 3)).toMatchObject({ unfurl: 0, active: false });
    // A rejoin raises the banner again from its furled roll, with her earned months intact.
    now += 5000;
    local.deliver(notice(now, JUNIPER, 'sub', { sub_tier: '1000', is_prime: false, duration_months: 1 }));
    await settle(notices);
    const rejoin = firstAt(now, now + 5000, at => moments.sample(at).homes.find(h => h.slot === 3)?.phase === 'anticipation');
    expect(moments.sample(rejoin + 6000).captions[0]).toMatchObject({ title: 'Juniper', line: 'raises the banner again' });
    expect(moments.sample(rejoin + 6000).homes.find(h => h.slot === 3)).toMatchObject({ ribbons: 3, active: true });

    // The view lays every parcel at a real doorstep or the gate, builds the cart on its route and cleans up.
    {
      const giftAnchors = new Map([[3, anchorAt(0)], [5, anchorAt(9)], [15, anchorAt(40)], [17, anchorAt(48)]]);
      const mount = async () => { const t = testHost(giftAnchors), view = createTwitchMomentView({ ...t.host, ...giftPlaces }); await view.prepare(); return { t, view }; };
      now = rejoin + 12_000;
      local.deliver(notice(now, ROWAN, 'community_sub_gift', { id: 'cg-3', total: 3, sub_tier: '2000' }));
      local.deliver(notice(now, ROWAN, 'sub_gift', giftTo(PIP, 'cg-3', '2000'), 'm-pip'));
      await settle(notices);
      const start = firstAt(now, now + 10_000, at => moments.sample(at).carts.length > 0);
      const cues: string[][] = [];
      for (const step of [16, 50]) {
        const { t, view } = await mount();
        for (let at = start; at < start + 9000; at += step) view.apply(moments.sample(at));
        expect(view.stats()).toMatchObject({ carts: 1, leased: true });
        expect(view.stats().parcels).toBeGreaterThan(0);
        cues.push(t.played.map(p => `${p.cue}@${p.atMs - start}`));
        view.dispose();
        expect(t.parent.children).toHaveLength(0);
        expect(t.camera()).toEqual(t.prior);
      }
      expect(cues[0]).toEqual(cues[1]);
      expect(cues[0]).toEqual(['cart-roll@0', 'gift-bell@3300', 'parcel-land@8300']);
      // Hiding mid-cart ends the procession at once: the lease returns, and the parcel rests where it was sent.
      const { t, view } = await mount();
      for (let at = start; at < start + 6000; at += 33) view.apply(moments.sample(at));
      moments.setPresentation({ layout: 'stage', mood: 'show', busy: false, visible: false, safeRects: [], autoOpenKinds: [] });
      view.apply(moments.sample(start + 6033));
      expect(view.stats()).toMatchObject({ leased: false, sounds: 0, carts: 0 });
      expect(t.cancelled.length).toBeGreaterThan(0);
      expect(t.camera()).toEqual(t.prior);
      moments.setPresentation({ layout: 'stage', mood: 'show', busy: false, visible: true, safeRects: [], autoOpenKinds: [] });
      const after = moments.sample(start + 7000);
      expect(after.carts).toEqual([]);
      expect(after.parcels.find(p => p.key === 'm-pip')).toMatchObject({ elapsed: null, to: { kind: 'home', slot: 15 } });
      view.apply(after);
      expect(view.stats().parcels).toBe(after.parcels.length);
      view.dispose();
      expect(t.parent.children).toHaveLength(0);
      now = start + 8000;
    }

    // A new source session restores homes and resting parcels without any beat, cart or replayed gift.
    const later = createTwitchMomentIngest({ ...ingestOptions, authorized: new Set(['moments.chat-notices', 'moments.subscriptions'] as const), readerId: READER, epochPrefix: 'later' });
    later.start();
    moments.connect(later.feed);
    await settle(later);
    const restored = moments.sample(now + 100);
    expect([restored.carts, restored.captions, restored.focus]).toEqual([[], [], null]);
    expect(restored.parcels.map(p => p.key).sort()).toEqual(['m-fern', 'm-juniper', 'm-moss', 'm-pip']);
    expect(restored.homes.find(h => h.slot === 3)).toMatchObject({ ribbons: 3, active: true, phase: 'idle' });
    // A late sibling notice for a celebrated group is state only: no second cart.
    local.deliver(notice(now, ROWAN, 'sub_gift', giftTo(FERN, 'cg-3', '2000'), 'm-fern-late'));
    await settle(later);
    expect(moments.sample(now + 6000).carts).toEqual([]);
    expect(moments.sample(now + 6000).parcels.some(p => p.key === 'm-fern-late' && p.elapsed === null)).toBe(true);

    // A capital-shaped gift of 200 with 60 disclosed recipients: one cart, waves of six street by street, at most 48 flights
    // and six knocks, no per-recipient caption or cut, and every disclosed parcel resting exactly once afterwards.
    {
      now += 10_000;
      const ward = Array.from({ length: 60 }, (_, i) => person(String(70_000 + i)));
      ward.slice(0, 12).forEach((id, i) => people.set(id, { disclosure: 'named', displayName: `Warden ${i + 1}`, homeSlot: 100 + i }));
      local.deliver(notice(now, ROWAN, 'community_sub_gift', { id: 'cg-ward', total: 200, sub_tier: '1000' }));
      ward.forEach((id, i) => local.deliver(notice(now + i * 10, ROWAN, 'sub_gift',
        { duration_months: 1, cumulative_total: null, recipient_user_id: id, recipient_user_name: `Wayfarer${i}`, recipient_user_login: `wayfarer${i}`, sub_tier: '1000', community_gift_id: 'cg-ward' },
        `m-ward-${i}`)));
      await settle(later);
      const begins = firstAt(now, now + 10_000, at => moments.sample(at).carts.length > 0);
      let flying = 0, homeCaptions = 0;
      const launched = new Set<string>();
      for (let at = begins; at < begins + 40_000; at += 100) {
        const frame = moments.sample(at);
        expect(frame.carts.length).toBeLessThanOrEqual(1);
        const air = frame.parcels.filter(p => p.elapsed !== null);
        for (const p of air) launched.add(p.key);
        flying = Math.max(flying, air.length);
        homeCaptions += frame.captions.filter(c => c.at.kind === 'home').length;
      }
      expect(launched.size).toBe(48);
      expect(flying).toBeLessThanOrEqual(48);
      expect(homeCaptions).toBe(0);
      const gathering = moments.sample(begins + 4000);
      expect(gathering.captions[0]).toMatchObject({ title: 'Rowan', line: 'sends 200 gifts' });
      expect(gathering.captions[0]!.detail).toMatch(/^for [^,]+, [^,]+, [^,]+ and 197 others$/u);
      expect(gathering.audio.filter(a => a.cue === 'parcel-land').length).toBeLessThanOrEqual(6);
      const after = moments.sample(firstAt(begins, begins + 45_000, at => moments.sample(at).carts.length === 0) + 1000);
      const resting = after.parcels.filter(p => p.key.startsWith('m-ward-'));
      expect(resting.every(p => p.elapsed === null)).toBe(true);
      expect(new Set(resting.map(p => p.key)).size).toBe(60);
      expect(resting.filter(p => p.to.kind === 'home')).toHaveLength(12);
      now = begins + 46_000;
    }

    // Writes stay honestly unavailable without a bound service; nothing is dispatched.
    const decree = { kind: 'poll-create', title: 'Where shall the new well go?', choices: ['By the bridge', 'In the market'], durationSeconds: 120 };
    const preview = moments.previewAction(decree);
    expect(preview).toMatchObject({ ok: true, capability: { available: false, reason: 'unavailable' } });
    expect(await moments.submitAction({ id: 'decree-1', type: 'twitch.action', args: decree })).toEqual({ status: 'unavailable', intentId: 'decree-1' });
    expect(await moments.submitAction({ id: 'decree-2', type: 'twitch.action', args: { ...decree, actor: JUNIPER } })).toEqual({ status: 'invalid', intentId: null });

    // Nothing public carries a person ID, login, provider name or delivery payload.
    const frames: MomentFrame[] = [0, 1500, 5000].map(dt => moments.sample(now + dt));
    const publicOutput = JSON.stringify([moments.currentFacts(), frames, moments.metrics(), again.status(), notices.status(), later.status()]);
    for (const secret of [JUNIPER, QUIET, ROWAN, WREN, MOSS, PIP, ORIGIN, FERN, READER, '274598607', 'login9001', 'Provider9001', 'user_id', 'is_gift', 'SECRET',
      'AnAnonymousGifter', 'cumulative', '#ff0000']) expect(publicOutput).not.toContain(secret);
    for (const [key, value] of memory.dump(KINGDOM)) expect(JSON.stringify([key, value])).not.toMatch(/login|Provider|user_name|is_gift|SECRET|AnAnonymous|cumulative/);
    // A wrapping keeps the giver's seal at each located recipient's home; nothing counts or ranks the giver.
    expect(memory.dump(KINGDOM).filter(([key]) => key.startsWith('twitch-moments:wrapping:')).map(([, v]) => (v as { giver: unknown }).giver))
      .toContainEqual({ displayName: 'Rowan', slot: 5 });
    expect(memory.dump(KINGDOM).some(([key]) => /giver-count|rank/u.test(key))).toBe(false);

    moments.dispose();
    expect(moments.sample(now).visible).toBe(false);
    again.stop(); notices.stop(); later.stop();
  });
});

describe('Twitch moments: a cheer and the sky answers; the earned train brings its dragon', () => {
  let kingdomNow = START;
  const bitsUse = (user: PersonId | 'anon', bits: number, extra: object = {}, type = 'cheer') => eventSubFrame({ messageId: `bits-${++messages}`, at: kingdomNow,
    type: 'channel.bits.use', version: '1', condition: { broadcaster_user_id: KINGDOM },
    event: { broadcaster_user_id: KINGDOM, broadcaster_user_login: 'kingdom', broadcaster_user_name: 'Kingdom',
      user_id: user === 'anon' ? '407665396' : user, user_login: user === 'anon' ? 'ananonymouscheerer' : `login${user}`, user_name: user === 'anon' ? 'AnAnonymousCheerer' : `Provider${user}`,
      bits, type, message: { text: 'SECRET CHEER TEXT', fragments: [] }, power_up: null, custom_power_up: null, ...extra } });
  const iso = (ms: number) => new Date(ms).toISOString();
  const hype = (phase: 'begin' | 'progress' | 'end', level: number, at: number, contributors: readonly PersonId[]) => {
    const common = { broadcaster_user_id: KINGDOM, broadcaster_user_login: 'kingdom', broadcaster_user_name: 'Kingdom', id: 'train-one', total: 900 * level, level,
      started_at: iso(START), type: 'regular', is_shared_train: false, shared_train_participants: null,
      top_contributions: contributors.map(id => ({ user_id: id, user_login: `login${id}`, user_name: `Provider${id}`, type: 'bits', total: 777 })) };
    const running = { ...common, progress: 100, goal: 1000, expires_at: iso(at + 300_000) };
    return eventSubFrame({ messageId: `hype-${++messages}`, at, type: `channel.hype_train.${phase}`, version: '2', condition: { broadcaster_user_id: KINGDOM },
      event: phase === 'begin' ? { ...running, all_time_high_level: 9, all_time_high_total: 99_999 } : phase === 'progress' ? running
        : { ...common, ended_at: iso(at), cooldown_ends_at: iso(at + 3_600_000) } });
  };

  it('runs every rung, Power-up, train and authoritative battle through the real ingest, honestly and on one clock', async () => {
    let now = START;
    const clock = { now: () => (kingdomNow = now) };
    const memory = createMemoryMomentRecords(clock), local = createLocalProviderTransport();
    const summons: DragonSummonRequest[] = [];
    const ingest = createTwitchMomentIngest({ kingdomId: KINGDOM, origin: 'simulated', epochPrefix: 'sky', moderatorId: null, readerId: null,
      authorized: new Set(['moments.bits', 'moments.hype'] as const), transport: local.transport, records: memory.port, directory, clock,
      battle: { summon: async request => { summons.push(request); return { status: 'accepted' }; } } });
    expect(ingest.start().plan.map(p => p.type)).toEqual(['channel.bits.use', 'channel.hype_train.begin', 'channel.hype_train.progress', 'channel.hype_train.end']);
    const effect = ApprovedEffectSchema.parse({ id: 'emotefox', revision: 2, origin: 'simulated', periodMs: 2000,
      frames: [{ blueprint: { version: 1, id: 'emote-fox', styleId: 'tide', kind: 'prop', lattice: 'build', size: [2, 2, 1], boxes: [{ from: [0, 0, 0], to: [2, 2, 1], material: 3 }], windows: [] }, durationMs: 2000 }] });
    const strikes: string[] = [];
    const gameplay: ActionPort<KingdomMomentIntent> = {
      capabilities: () => new Map([['strike', { available: true, reason: 'ready', retryAt: null }]]),
      submit: async intent => { strikes.push(intent.id); return { status: 'accepted', intentId: intent.id, receiptKey: `r${intent.id}`, acceptedAt: now, providerId: null }; },
      reconcile: async () => { throw new Error('nothing pending'); },
    };
    const moments = createTwitchMoments({ kingdomId: KINGDOM, expectedOrigin: 'simulated', clock, gameplay,
      effect: id => (id === 'emotefox' ? effect : null), channelEffects: () => [effect] });
    moments.connect(ingest.feed);
    await settle(ingest);
    const step = async (make: string | (() => string), advance = 0) => { kingdomNow = now; const frame = typeof make === 'string' ? make : make(); expect(local.deliver(frame)).toBe(true); await settle(ingest); const at = now; now += advance; return at; };

    // Every default threshold, exactly at and just below it.
    for (const [bits, rung] of [[1, 'spark'], [99, 'spark'], [100, 'street-fireworks'], [499, 'street-fireworks'], [500, 'castle-volley'], [999, 'castle-volley'],
      [1000, 'hearthbeast'], [4999, 'hearthbeast'], [5000, 'skyfire'], [9999, 'skyfire'], [10_000, 'kites']] as const) expect(rungFor(bits)).toBe(rung);

    // Juniper's single Bit: a spark climbs from her own roof, credited by name, never by amount.
    const spark = await step(() => bitsUse(JUNIPER, 1), 30_000);
    const climbing = moments.sample(spark + 1000);
    expect(climbing.sky).toEqual([expect.objectContaining({ kind: 'cheer', rung: 'spark', origin: { kind: 'home', slot: 3 }, name: 'Juniper' })]);
    const lit = moments.sample(spark + 2500);
    expect(lit.captions).toEqual([expect.objectContaining({ title: 'Juniper', line: 'sends a spark up from home', detail: null })]);
    expect(lit.focus).toMatchObject({ subject: { kind: 'home', slot: 3 }, wide: false });
    expect(lit.captions.map(c => [c.title, c.line, c.detail].join(' ')).join(' ')).not.toMatch(/\d|Bit/u);

    // An anonymous cheer is a friend of the realm from the market, even at castle-volley strength; the burst is an approved emote.
    const volley = await step(() => bitsUse('anon', 750), 30_000);
    const fired = moments.sample(volley + 3000);
    expect(fired.sky).toEqual([expect.objectContaining({ rung: 'castle-volley', origin: { kind: 'place', place: 'market' }, name: 'A friend of the realm',
      effect: expect.objectContaining({ id: 'emotefox', revision: 2, origin: 'simulated' }) })]);
    expect(fired.focus).toMatchObject({ subject: { kind: 'place', place: 'sky' }, wide: true });

    // No cheer ever wakes the dragon, however large.
    const kites = await step(() => bitsUse(ROWAN, 250_000), 30_000);
    expect(moments.sample(kites + 4000).sky[0]).toMatchObject({ rung: 'kites', origin: { kind: 'home', slot: 5 } });
    expect(summons).toEqual([]);
    expect(moments.sample(kites + 4000)).toMatchObject({ dragon: null, train: null, battle: null });

    // A gigantified emote floats only with its exact approved effect; an unknown one shows nothing at all.
    const balloon = await step(() => bitsUse(WREN, 30, { power_up: { type: 'gigantify_an_emote', emote: { id: 'emotefox', name: 'fox' }, message_effect_id: null } }, 'power_up'), 30_000);
    expect(moments.sample(balloon + 4000).sky).toEqual([expect.objectContaining({ kind: 'balloon', effect: expect.objectContaining({ id: 'emotefox' }) })]);
    const refused = await step(() => bitsUse(WREN, 30, { power_up: { type: 'gigantify_an_emote', emote: { id: 'emoteunknown', name: 'x' }, message_effect_id: null } }, 'power_up'), 30_000);
    expect(moments.sample(refused + 2000).sky).toEqual([]);
    expect(moments.metrics().suppressed.unapproved).toBe(1);

    // Cue times belong to the beat, not the frame rate: sampled at 16 ms or 50 ms, the same cues at the same instants.
    const skyfire = await step(() => bitsUse(JUNIPER, 5000));
    const cues = (dt: number) => { const seen = new Map<string, number>(); for (let at = skyfire; at < skyfire + 19_000; at += dt) for (const c of moments.sample(at).audio) seen.set(c.id, c.atMs); return [...seen].sort(); };
    expect(cues(16)).toEqual(cues(50));
    expect(cues(50).length).toBeGreaterThan(6);
    now += 30_000;

    // The Hype Train: out with its bunting, carriages per level, contributors by name only; level 3 asks the realm once.
    const rode = [JUNIPER, QUIET, ROWAN];
    const begun = await step(hype('begin', 1, now, rode), 9000);
    const arriving = moments.sample(begun + 1500);
    expect(arriving.train).toMatchObject({ state: 'arriving', level: 1, names: ['Juniper', 'Rowan'] });
    expect(arriving.focus).toMatchObject({ subject: { kind: 'place', place: 'train' }, wide: true });
    await step(hype('progress', 2, now, rode), 9000);
    expect(summons).toEqual([]);
    const woke = await step(hype('progress', 3, now, rode));
    await step(hype('progress', 3, now + 50, rode));
    expect(summons).toEqual([expect.objectContaining({ source: 'hype', level: 3, form: 'young', origin: 'simulated' })]);
    // Accepting a request is not a battle: until the realm reports one, the status says so and nothing fights.
    expect(moments.sample(woke + 500)).toMatchObject({ battle: 'requested', dragon: null });
    expect(moments.sample(woke + 500).train?.carriages).toBeGreaterThanOrEqual(3);

    // The realm's battle: summoning, then the encounter; strikes are what the realm accepted, never local damage.
    const fight = (revision: number, phase: string, extra: object = {}) => ({ kingdomId: KINGDOM, battleKey: 'dragon1', source: 'hype', trainKey: summons[0]!.trainKey,
      phase, form: 'young', startsAt: woke + 8400, endsAt: woke + 68_400, healthPermille: 1000, fighters: 0, acceptedStrikes: 0, sharedSessionKey: null,
      revision, observedAt: now, origin: 'simulated', ...extra });
    expect(ingest.observeBattle(fight(1, 'summoning'))).toBe('accepted');
    await settle(ingest);
    const summoned = now;
    expect(moments.sample(summoned + 1000)).toMatchObject({ battle: 'battle', dragon: { phase: 'summoning', form: 'young', source: 'hype' } });
    expect(moments.sample(summoned + 1000).focus).toMatchObject({ subject: { kind: 'place', place: 'dragon' } });
    expect(moments.sample(summoned + 3200).audio.some(c => c.cue === 'dragon-roar')).toBe(true);
    now = woke + 8400;
    ingest.observeBattle(fight(2, 'active'));
    await settle(ingest);
    const health = moments.sample(now + 100).dragon!.health;
    expect(await moments.submitMoment({ id: 'strike1', type: 'kingdom.moment', args: { kind: 'strike', battleKey: 'dragon1' } })).toMatchObject({ status: 'accepted' });
    expect(strikes).toEqual(['strike1']);
    // A strike the realm accepted changes nothing here until its fact returns.
    expect(moments.sample(now + 200).dragon).toMatchObject({ health, strikes: 0, flinch: null });
    now += 2000;
    ingest.observeBattle(fight(3, 'active', { acceptedStrikes: 4, fighters: 2, healthPermille: 880 }));
    await settle(ingest);
    expect(moments.sample(now + 100).dragon).toMatchObject({ health: 0.88, strikes: 4, fighters: 2, flinch: 100 });
    expect(moments.sample(now + 100).audio.some(c => c.cue === 'dragon-hit')).toBe(true);

    // The realm says it retreats: the dragon flies home and the train's battle is over.
    now += 20_000;
    ingest.observeBattle(fight(4, 'retreat', { acceptedStrikes: 30, fighters: 9, healthPermille: 610 }));
    ingest.observeBattle(fight(3, 'active'));
    await settle(ingest);
    const retreat = moments.sample(now + 1500);
    expect(retreat).toMatchObject({ battle: 'ended', dragon: { phase: 'retreat' } });
    expect(moments.sample(now + 6000).captions.map(c => c.line)).toContain('It will wake again. Nothing is lost');

    // The Wyrm Bell rings the very same battle, free, with no train behind it.
    now += 60_000;
    ingest.observeBattle({ ...fight(1, 'summoning'), battleKey: 'bell1', source: 'wyrm-bell', trainKey: null, startsAt: now + 8400, endsAt: now + 60_000, observedAt: now });
    await settle(ingest);
    const bell = moments.sample(now + 500);
    expect(bell.dragon).toMatchObject({ source: 'wyrm-bell', phase: 'summoning', form: 'young' });
    expect(bell.audio.filter(c => c.cue === 'wyrm-bell')).toHaveLength(3);

    // Hidden, every beat, shot and sound stops at once.
    moments.setPresentation({ layout: 'stage', mood: 'show', busy: false, visible: false, safeRects: [], autoOpenKinds: [] });
    expect(moments.sample(now + 600)).toMatchObject({ visible: false, sky: [], train: null, dragon: null, audio: [] });

    // Nothing public carries a person ID, login, amount, message or provider name.
    moments.setPresentation({ layout: 'stage', mood: 'show', busy: false, visible: true, safeRects: [], autoOpenKinds: [] });
    const publicOutput = JSON.stringify([moments.currentFacts(), moments.sample(now + 1000), moments.metrics()]);
    for (const secret of [JUNIPER, QUIET, ROWAN, WREN, '407665396', 'login9001', 'Provider9001', 'SECRET', 'AnAnonymous', '250000', '777']) expect(publicOutput).not.toContain(secret);
    moments.dispose();
    ingest.stop();
  });

  it('stages the sky, the train and the dragon on the host, and an interruption releases every sound, shot and part', async () => {
    let now = START;
    const clock = { now: () => (kingdomNow = now) };
    const local = createLocalProviderTransport();
    const ingest = createTwitchMomentIngest({ kingdomId: KINGDOM, origin: 'simulated', epochPrefix: 'stage', moderatorId: null, readerId: null,
      authorized: new Set(['moments.bits', 'moments.hype'] as const), transport: local.transport, records: createMemoryMomentRecords(clock).port, directory, clock,
      battle: { summon: async () => ({ status: 'accepted' }) } });
    ingest.start();
    const moments = createTwitchMoments({ kingdomId: KINGDOM, expectedOrigin: 'simulated', clock });
    moments.connect(ingest.feed);
    const rig = testHost(new Map([[3, anchorAt(0)], [5, anchorAt(8)]]));
    const ring = Array.from({ length: 48 }, (_, i) => [Math.cos(i / 48 * Math.PI * 2) * 40, 0, Math.sin(i / 48 * Math.PI * 2) * 30] as [number, number, number]);
    const places: SpectaclePlaces = {
      sky: () => ({ centre: [0, 0, 0], radius: 40, ceiling: 58 }), castle: () => ({ crown: [0, 18, -46], walls: [[-12, 9, -40], [12, 9, -40]] }),
      plaza: () => [20, 0, 20], lair: () => ({ position: [0, 6, -120], facing: [0, 0, 1] }), track: () => ring,
      bunting: () => [[[-10, 4.4, 0], [10, 4.4, 0]]], roof: slot => (slot === 3 ? [0, 7, 0] : slot === 5 ? [8, 7, 0] : null), homes: () => [3, 5],
    };
    const view = createTwitchMomentView({ ...rig.host, ...giftPlaces, places });
    await view.prepare();
    await settle(ingest);
    local.deliver(bitsUse(ROWAN, 600)); await settle(ingest);
    const cheered = now;
    for (let at = cheered; at <= cheered + 4000; at += 100) { now = at; view.apply(moments.sample(at)); }
    expect(view.stats()).toMatchObject({ 'sky.beats': 1, leased: true });
    expect(view.stats()['sky.motes']).toBeGreaterThan(0);
    expect(rig.played.some(p => p.cue === 'firework-bloom')).toBe(true);
    expect(view.glow().strength).toBeGreaterThan(0);

    // Hidden mid-volley: every playing cue is cancelled with its tail, the shot is handed back and the sky empties.
    moments.setPresentation({ layout: 'stage', mood: 'show', busy: false, visible: false, safeRects: [], autoOpenKinds: [] });
    view.apply(moments.sample(now));
    expect(view.stats()).toMatchObject({ sounds: 0, leased: false, 'sky.beats': 0 });
    expect(rig.cancelled.length).toBeGreaterThan(0);
    expect(rig.camera()).toEqual(rig.prior);
    moments.setPresentation({ layout: 'stage', mood: 'show', busy: false, visible: true, safeRects: [], autoOpenKinds: [] });

    // The train sets out on the supplied track and carries its riders' names; level 3 wakes the realm's dragon.
    now += 60_000; kingdomNow = now;
    local.deliver(hype('begin', 1, now, [JUNIPER, ROWAN])); await settle(ingest);
    now += 6000; kingdomNow = now;
    local.deliver(hype('progress', 3, now, [JUNIPER, ROWAN])); await settle(ingest);
    ingest.observeBattle({ kingdomId: KINGDOM, battleKey: 'stage1', source: 'hype', trainKey: 'ht.train-one', phase: 'summoning', form: 'young', startsAt: now + 8400,
      endsAt: now + 60_000, healthPermille: 1000, fighters: 0, acceptedStrikes: 0, sharedSessionKey: null, revision: 1, observedAt: now, origin: 'simulated' });
    await settle(ingest);
    for (let at = now; at <= now + 3200; at += 100) view.apply(moments.sample(at));
    const stats = view.stats();
    expect(stats['train.cars']).toBeGreaterThanOrEqual(4);
    expect(stats['dragon.parts'] ?? Object.entries(stats).filter(([k, v]) => k.startsWith('dragon.') && Number(v) > 0).length).toBeGreaterThan(0);
    expect(view.nameplates(new THREE.PerspectiveCamera()).map(p => p.name).every(n => n === 'Juniper' || n === 'Rowan')).toBe(true);
    expect(rig.played.some(p => p.cue === 'dragon-roar')).toBe(true);

    view.dispose();
    expect(rig.parent.children).toHaveLength(0);
    expect(view.stats()).toMatchObject({ sounds: 0, leased: false, attached: false });
    moments.dispose(); ingest.stop();
  });

  it('without a realm battle port the earned dragon is honestly unavailable, and a short train closes with fireworks', async () => {
    let now = START;
    const clock = { now: () => now };
    const local = createLocalProviderTransport();
    const ingest = createTwitchMomentIngest({ kingdomId: KINGDOM, origin: 'simulated', epochPrefix: 'unbound', moderatorId: null, readerId: null,
      authorized: new Set(['moments.hype'] as const), transport: local.transport, records: createMemoryMomentRecords(clock).port, directory, clock });
    ingest.start();
    const moments = createTwitchMoments({ kingdomId: KINGDOM, expectedOrigin: 'simulated', clock });
    moments.connect(ingest.feed);
    await settle(ingest);
    const send = async (frame: string) => { local.deliver(frame); await settle(ingest); };
    await send(hype('begin', 1, now, [ROWAN]));
    now += 10_000; await send(hype('progress', 3, now, [ROWAN]));
    expect(moments.sample(now + 500)).toMatchObject({ battle: 'unavailable', dragon: null });
    expect(moments.sample(now + 2000).captions.map(c => c.line)).toContain('The dragon stirs, but no battle can be fought here');
    expect(await moments.submitMoment({ id: 'strike2', type: 'kingdom.moment', args: { kind: 'strike', battleKey: 'nothing' } })).toEqual({ status: 'unavailable', intentId: 'strike2' });
    moments.dispose(); ingest.stop();

    // A second kingdom's short train: home at level 2 with closing fireworks over the castle and a sleeping stir in the hills.
    now = START + 600_000;
    const local2 = createLocalProviderTransport();
    const short = createTwitchMomentIngest({ kingdomId: KINGDOM, origin: 'simulated', epochPrefix: 'short', moderatorId: null, readerId: null,
      authorized: new Set(['moments.hype'] as const), transport: local2.transport, records: createMemoryMomentRecords(clock).port, directory, clock });
    short.start();
    const quiet = createTwitchMoments({ kingdomId: KINGDOM, expectedOrigin: 'simulated', clock });
    quiet.connect(short.feed);
    await settle(short);
    for (const [phase, level] of [['begin', 1], ['progress', 2], ['end', 2]] as const) { now += 10_000; local2.deliver(hype(phase, level, now, [ROWAN])); await settle(short); }
    const closing = quiet.sample(now + 2000);
    expect(closing.train).toMatchObject({ state: 'closing', closingFireworks: true });
    expect(closing.sky).toEqual([expect.objectContaining({ kind: 'festival', rung: 'castle-volley', name: '' })]);
    expect(quiet.sample(now + 4000).dragon).toMatchObject({ phase: 'stir' });
    expect(quiet.sample(now + 4000).battle).toBeNull();
    quiet.dispose(); short.stop();
  });
});
