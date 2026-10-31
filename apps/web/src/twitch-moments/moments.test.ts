import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type KingdomPresenceFrame, type PersonId } from '@chatdom/shared';
import { createTwitchMomentIngest, type CitizenDirectory, type CitizenDisclosure } from '../../../herald/src/twitch-moments';
import { createLocalProviderTransport, eventSubFrame } from '../../../herald/src/twitch-moments/local-transport';
import { createMemoryMomentRecords } from '../../../herald/src/twitch-moments/memory';
import { BANNER_BEAT } from './choreography';
import { createTwitchMoments, type MomentFrame } from './controller';
import { createTwitchMomentView, type CameraLease, type HomeAnchor, type MomentViewHost } from './view';
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
function subscribe(user: PersonId, at: number, options: { gift?: boolean; broadcaster?: string; condition?: string; id?: string; type?: string; tier?: string } = {}) {
  return eventSubFrame({ messageId: options.id ?? `msg-${++messages}`, at, type: options.type ?? 'channel.subscribe', version: '1',
    condition: { broadcaster_user_id: options.condition ?? KINGDOM },
    event: { user_id: user, user_login: `login${user}`, user_name: `Provider${user}`, broadcaster_user_id: options.broadcaster ?? KINGDOM,
      broadcaster_user_login: 'kingdom', broadcaster_user_name: 'Kingdom', tier: options.tier ?? '1000', is_gift: options.gift ?? false } });
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
    expect(first.focus).toMatchObject({ slot: 3, cut: true });
    const mid = moments.sample(beatStart + 2000).homes[0]!;
    expect(mid.phase).toBe('action');
    expect(mid.unfurl).toBeGreaterThan(0.3);
    expect(mid.unfurl).toBeLessThan(1);
    const held = moments.sample(beatStart + 6000);
    expect(held.homes[0]).toMatchObject({ phase: 'hold', unfurl: 1 });
    expect(held.captions).toEqual([expect.objectContaining({ slot: 3, title: 'Juniper' })]);
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
    expect(rowan.focus).toMatchObject({ slot: 3 });

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
      expect(t.parent.children[0]!.children).toHaveLength(5);
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

    // Writes stay honestly unavailable without a bound service; nothing is dispatched.
    const decree = { kind: 'poll-create', title: 'Where shall the new well go?', choices: ['By the bridge', 'In the market'], durationSeconds: 120 };
    const preview = moments.previewAction(decree);
    expect(preview).toMatchObject({ ok: true, capability: { available: false, reason: 'unavailable' } });
    expect(await moments.submitAction({ id: 'decree-1', type: 'twitch.action', args: decree })).toEqual({ status: 'unavailable', intentId: 'decree-1' });
    expect(await moments.submitAction({ id: 'decree-2', type: 'twitch.action', args: { ...decree, actor: JUNIPER } })).toEqual({ status: 'invalid', intentId: null });

    // Nothing public carries a person ID, login, provider name or delivery payload.
    const frames: MomentFrame[] = [0, 1500, 5000].map(dt => moments.sample(now + dt));
    const publicOutput = JSON.stringify([moments.currentFacts(), frames, moments.metrics(), again.status()]);
    for (const secret of [JUNIPER, QUIET, ROWAN, WREN, 'login9001', 'Provider9001', 'user_id', 'is_gift']) expect(publicOutput).not.toContain(secret);
    for (const [key, value] of memory.dump(KINGDOM)) expect(JSON.stringify([key, value])).not.toMatch(/login|Provider|user_name|is_gift/);

    moments.dispose();
    expect(moments.sample(now).visible).toBe(false);
    again.stop();
  });
});
